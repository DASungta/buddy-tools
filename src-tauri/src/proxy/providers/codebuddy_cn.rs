use axum::{
    body::Body,
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use futures::StreamExt;
use serde_json::{json, Value};
use tokio::time::Duration;

use crate::proxy::server::AppState;

const CODEBUDDY_CN_BASE_URL: &str = "https://copilot.tencent.com";

async fn resolve_active_codebuddy_cn_credentials(
    cb: &crate::proxy::config::CodeBuddyConfig,
) -> (String, String) {
    if let Some(ref account_id) = cb.current_account_id {
        if let Some(account) =
            crate::modules::codebuddy_cn_account::load_account(account_id.as_str())
        {
            let uid = account.uid.clone().unwrap_or_default();
            return (account.access_token, uid);
        }
        tracing::warn!(
            "[CodeBuddy CN] current_account_id={} 账号文件不存在，回退到 legacy token",
            account_id
        );
    }
    (cb.token.clone(), cb.user_id.clone())
}

fn join_base_url(base: &str, path: &str) -> String {
    let base = base.trim_end_matches('/');
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{}", path)
    };
    format!("{}{}", base, path)
}

fn build_client(
    upstream_proxy: Option<crate::proxy::config::UpstreamProxyConfig>,
    timeout_secs: u64,
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs.max(5)));

    if let Some(config) = upstream_proxy {
        if config.enabled && !config.url.is_empty() {
            let url = crate::proxy::config::normalize_proxy_url(&config.url);
            let proxy = reqwest::Proxy::all(&url)
                .map_err(|e| format!("Invalid upstream proxy url: {}", e))?;
            builder = builder.proxy(proxy);
        }
    }

    builder
        .tcp_nodelay(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

fn codebuddy_error_response(
    status: StatusCode,
    message: impl Into<String>,
    error_type: &str,
    code: &str,
) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/json")],
        axum::Json(json!({
            "error": {
                "message": message.into(),
                "type": error_type,
                "code": code
            }
        })),
    )
        .into_response()
}

fn inject_codebuddy_cn_headers(headers: &mut HeaderMap, token: &str, user_id: &str) {
    if let Ok(v) = HeaderValue::from_str(&format!("Bearer {}", token)) {
        headers.insert(header::AUTHORIZATION, v);
    }
    if !user_id.is_empty() {
        if let Ok(v) = HeaderValue::from_str(user_id) {
            headers.insert("x-user-id", v);
        }
    }
    headers.insert("x-domain", HeaderValue::from_static("www.codebuddy.cn"));
    headers.insert("x-ide-type", HeaderValue::from_static("CLI"));
    headers.insert("x-ide-name", HeaderValue::from_static("CLI"));
    headers.insert("x-ide-version", HeaderValue::from_static("2.93.3"));
    headers.insert("x-product", HeaderValue::from_static("SaaS"));
    headers.insert("x-requested-with", HeaderValue::from_static("XMLHttpRequest"));
    headers.insert("x-agent-intent", HeaderValue::from_static("craft"));
}

pub async fn forward_openai_json(
    state: &AppState,
    method: Method,
    path: &str,
    _incoming_headers: &HeaderMap,
    mut body: Value,
) -> Response {
    let cb = state.codebuddy_cn.read().await.clone();
    if !cb.enabled || cb.dispatch_mode == crate::proxy::CodeBuddyDispatchMode::Off {
        return codebuddy_error_response(
            StatusCode::BAD_REQUEST,
            "CodeBuddy account/token is not configured",
            "invalid_request_error",
            "codebuddy_not_configured",
        );
    }

    let (active_token, active_user_id) = resolve_active_codebuddy_cn_credentials(&cb).await;

    if active_token.trim().is_empty() {
        return codebuddy_error_response(
            StatusCode::BAD_REQUEST,
            "CodeBuddy account/token is not configured",
            "invalid_request_error",
            "codebuddy_not_configured",
        );
    }

    if let Some(model) = body.get("model").and_then(|v| v.as_str()) {
        if crate::proxy::common::model_mapping::canonicalize_buddy_model_id(model).is_none()
            && (model.starts_with("claude-") || model.starts_with("gpt-"))
        {
            body["model"] = Value::String(cb.model.clone());
        }
    }

    let caller_wants_stream = body.get("stream").and_then(|v| v.as_bool()).unwrap_or(false);
    body["stream"] = Value::Bool(true);

    let upstream_path = if path.is_empty() || path == "/" {
        "/v2/chat/completions".to_string()
    } else {
        path.to_string()
    };

    let base_url = if cb.base_url.trim().is_empty() {
        CODEBUDDY_CN_BASE_URL.to_string()
    } else {
        cb.base_url.clone()
    };
    let url = join_base_url(&base_url, &upstream_path);

    let timeout_secs = state.request_timeout.max(5);
    let upstream_proxy = state.upstream_proxy.read().await.clone();
    let client = match build_client(Some(upstream_proxy), timeout_secs) {
        Ok(c) => c,
        Err(e) => {
            return codebuddy_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                e,
                "server_error",
                "codebuddy_client_error",
            );
        }
    };

    let mut headers = HeaderMap::new();
    inject_codebuddy_cn_headers(&mut headers, &active_token, &active_user_id);
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        header::ACCEPT,
        HeaderValue::from_static("text/event-stream, application/json"),
    );

    let body_bytes = serde_json::to_vec(&body).unwrap_or_default();

    let model_in_body = body.get("model").and_then(|v| v.as_str()).unwrap_or("(none)");
    let token_preview = if active_token.len() > 8 {
        format!("{}…{}", &active_token[..4], &active_token[active_token.len()-4..])
    } else {
        "(short)".to_string()
    };
    tracing::info!(
        "[CodeBuddy CN] → {} | model={} | token={} | uid={} | body_len={}",
        url,
        model_in_body,
        token_preview,
        active_user_id,
        body_bytes.len(),
    );

    let req = client.request(method, &url).headers(headers).body(body_bytes);

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            return codebuddy_error_response(
                StatusCode::BAD_GATEWAY,
                format!("CodeBuddy CN upstream request failed: {}", e),
                "upstream_error",
                "codebuddy_upstream_request_failed",
            );
        }
    };

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    tracing::info!(
        "[CodeBuddy CN] ← {} {} | content-type={:?}",
        status.as_u16(),
        status.canonical_reason().unwrap_or(""),
        resp.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or(""),
    );

    if caller_wants_stream {
        let mut out = Response::builder().status(status);
        if let Some(ct) = resp.headers().get(header::CONTENT_TYPE) {
            out = out.header(header::CONTENT_TYPE, ct.clone());
        }
        let stream = resp.bytes_stream().map(|chunk| match chunk {
            Ok(b) => Ok::<Bytes, std::io::Error>(b),
            Err(e) => Ok(Bytes::from(format!("CodeBuddy CN stream error: {}", e))),
        });
        out.body(Body::from_stream(stream)).unwrap_or_else(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to build response").into_response()
        })
    } else {
        let raw = match resp.bytes().await {
            Ok(b) => b,
            Err(e) => {
                return codebuddy_error_response(
                    StatusCode::BAD_GATEWAY,
                    format!("CodeBuddy CN read error: {}", e),
                    "upstream_error",
                    "codebuddy_upstream_read_failed",
                )
            }
        };

        tracing::info!(
            "[CodeBuddy CN] non-stream raw body (first 512 bytes): {}",
            std::str::from_utf8(&raw[..raw.len().min(512)]).unwrap_or("(invalid utf8)")
        );
        if !status.is_success() {
            let message = std::str::from_utf8(&raw)
                .unwrap_or("CodeBuddy CN upstream request failed")
                .to_string();
            return codebuddy_error_response(
                status,
                message,
                "upstream_error",
                "codebuddy_upstream_error",
            );
        }

        let assembled = assemble_sse_to_json(&raw);
        (
            status,
            [(header::CONTENT_TYPE, "application/json")],
            assembled,
        )
            .into_response()
    }
}

fn assemble_sse_to_json(raw: &[u8]) -> String {
    let text = std::str::from_utf8(raw).unwrap_or("");
    let mut id = String::new();
    let mut model = String::new();
    let mut created: u64 = 0;
    let mut content = String::new();
    let mut finish_reason: Option<String> = None;
    let mut prompt_tokens: u64 = 0;
    let mut completion_tokens: u64 = 0;

    for line in text.lines() {
        let data = match line.strip_prefix("data: ") {
            Some(d) => d.trim(),
            None => continue,
        };
        if data == "[DONE]" {
            break;
        }
        if let Ok(chunk) = serde_json::from_str::<Value>(data) {
            if id.is_empty() {
                id = chunk["id"].as_str().unwrap_or("").to_string();
            }
            if model.is_empty() {
                model = chunk["model"].as_str().unwrap_or("").to_string();
            }
            if created == 0 {
                created = chunk["created"].as_u64().unwrap_or(0);
            }
            if let Some(delta_content) = chunk["choices"][0]["delta"]["content"].as_str() {
                content.push_str(delta_content);
            }
            if let Some(fr) = chunk["choices"][0]["finish_reason"].as_str() {
                if !fr.is_empty() {
                    finish_reason = Some(fr.to_string());
                }
            }
            if let Some(usage) = chunk["usage"].as_object() {
                if let Some(pt) = usage.get("prompt_tokens").and_then(|v| v.as_u64()) {
                    if pt > 0 {
                        prompt_tokens = pt;
                    }
                }
                if let Some(ct) = usage.get("completion_tokens").and_then(|v| v.as_u64()) {
                    if ct > 0 {
                        completion_tokens = ct;
                    }
                }
            }
        }
    }

    json!({
        "id": id,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": content },
            "finish_reason": finish_reason.unwrap_or_else(|| "stop".to_string())
        }],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens
        }
    })
    .to_string()
}
