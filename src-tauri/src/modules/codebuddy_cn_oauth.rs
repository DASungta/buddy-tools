use serde_json::{json, Value};
use std::sync::{LazyLock, Mutex};
use tracing::{info, warn};

use crate::models::codebuddy::{
    CheckinResponse, CheckinStatusResponse, CodebuddyOAuthCompletePayload,
    CodebuddyOAuthStartResponse,
};

const CODEBUDDY_CN_API_ENDPOINT: &str = "https://www.codebuddy.cn";
const CODEBUDDY_CN_API_PREFIX: &str = "/v2/plugin";
const CODEBUDDY_CN_PLATFORM: &str = "ide";

fn now_timestamp() -> i64 {
    chrono::Utc::now().timestamp()
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

struct CodebuddyCnRequestContext<'a> {
    access_token: &'a str,
    uid: Option<&'a str>,
    enterprise_id: Option<&'a str>,
    domain: Option<&'a str>,
}

fn request_context<'a>(
    access_token: &'a str,
    uid: Option<&'a str>,
    enterprise_id: Option<&'a str>,
    domain: Option<&'a str>,
) -> CodebuddyCnRequestContext<'a> {
    CodebuddyCnRequestContext {
        access_token,
        uid,
        enterprise_id,
        domain,
    }
}

fn apply_codebuddy_headers(
    req: reqwest::RequestBuilder,
    ctx: &CodebuddyCnRequestContext<'_>,
) -> reqwest::RequestBuilder {
    let mut req = req.header("Authorization", format!("Bearer {}", ctx.access_token));
    if let Some(uid) = ctx.uid {
        req = req.header("X-User-Id", uid);
    }
    if let Some(eid) = ctx.enterprise_id {
        req = req.header("X-Enterprise-Id", eid);
        req = req.header("X-Tenant-Id", eid);
    }
    if let Some(domain) = ctx.domain {
        req = req.header("X-Domain", domain);
    }
    req
}

fn derive_account_scope(
    enterprise_id: Option<&str>,
    enterprise_name: Option<&str>,
    plan_type: Option<&str>,
) -> String {
    let has_enterprise = enterprise_id
        .or(enterprise_name)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let has_enterprise_plan = plan_type
        .map(|value| {
            let lower = value.to_ascii_lowercase();
            lower.contains("enterprise")
                || lower.contains("ultimate")
                || lower.contains("exclusive")
                || lower.contains("premise")
        })
        .unwrap_or(false);

    if has_enterprise || has_enterprise_plan {
        "enterprise".to_string()
    } else {
        "personal".to_string()
    }
}

fn normalize_context_part(value: Option<&str>, fallback: &str) -> String {
    value
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn derive_account_context_id(
    uid: Option<&str>,
    email: Option<&str>,
    enterprise_id: Option<&str>,
    enterprise_name: Option<&str>,
    account_scope: &str,
) -> String {
    let identity = normalize_context_part(uid.or(email), "codebuddy_cn_user");
    if account_scope == "enterprise" {
        let enterprise = normalize_context_part(enterprise_id.or(enterprise_name), "enterprise");
        format!("enterprise:{}:{}", enterprise, identity)
    } else {
        format!("personal:{}", identity)
    }
}

fn response_message(body: &Value) -> &str {
    body.get("message")
        .or_else(|| body.get("msg"))
        .and_then(Value::as_str)
        .unwrap_or("unknown error")
}

fn response_code(body: &Value) -> Option<i64> {
    body.get("code").and_then(Value::as_i64)
}

fn is_success_code(code: i64) -> bool {
    code == 0 || code == 200
}

fn wrap_user_resource_quota(body: Value) -> Value {
    if body.get("userResource").is_some() {
        body
    } else {
        json!({ "userResource": body })
    }
}

fn normalize_product_code(value: Option<&str>) -> String {
    value
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("p_tcaca")
        .to_string()
}

fn normalize_user_resource_status(status: &[i32]) -> Vec<i32> {
    let mut normalized: Vec<i32> = status.iter().copied().filter(|v| *v >= 0).collect();
    if normalized.is_empty() {
        return vec![0, 3];
    }
    normalized.sort_unstable();
    normalized.dedup();
    normalized
}

fn build_default_user_resource_time_range() -> (String, String) {
    let now = chrono::Local::now();
    let begin = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let end = (now + chrono::Duration::days(365 * 101))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    (begin, end)
}

async fn fetch_account_info(
    client: &reqwest::Client,
    access_token: &str,
    state: &str,
    domain: Option<&str>,
) -> Result<
    (
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<Value>,
    ),
    String,
> {
    let url = format!(
        "{}{}/login/account?state={}",
        CODEBUDDY_CN_API_ENDPOINT, CODEBUDDY_CN_API_PREFIX, state
    );

    let ctx = request_context(access_token, None, None, domain);
    let resp = apply_codebuddy_headers(client.get(&url), &ctx)
        .send()
        .await
        .map_err(|e| format!("请求 login/account 失败: {}", e))?;

    let status_code = resp.status();
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 login/account 响应失败: {}", e))?;

    if !status_code.is_success() {
        return Err(format!(
            "请求 login/account 失败 (http={}): {}",
            status_code.as_u16(),
            response_message(&body)
        ));
    }
    if let Some(code) = response_code(&body) {
        if !is_success_code(code) {
            return Err(format!(
                "请求 login/account 失败 (code={}): {}",
                code,
                response_message(&body)
            ));
        }
    }

    let data = body.get("data").cloned().unwrap_or(json!({}));

    let uid = data
        .get("uid")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let nickname = data
        .get("nickname")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let email = data
        .get("email")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let enterprise_id = data
        .get("enterpriseId")
        .or_else(|| data.get("enterprise_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let enterprise_name = data
        .get("enterpriseName")
        .or_else(|| data.get("enterprise_name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let plan_type = data
        .get("planType")
        .or_else(|| data.get("plan_type"))
        .and_then(|v| v.as_str());
    let account_scope = derive_account_scope(
        enterprise_id.as_deref(),
        enterprise_name.as_deref(),
        plan_type,
    );
    let account_context_id = derive_account_context_id(
        uid.as_deref(),
        Some(email.as_str()),
        enterprise_id.as_deref(),
        enterprise_name.as_deref(),
        &account_scope,
    );

    Ok((
        uid,
        nickname,
        email,
        enterprise_id,
        enterprise_name,
        Some(account_scope),
        Some(account_context_id),
        Some(data),
    ))
}

async fn fetch_quota_info(
    client: &reqwest::Client,
    access_token: &str,
    uid: Option<&str>,
    enterprise_id: Option<&str>,
    domain: Option<&str>,
) -> Option<Value> {
    let url = format!(
        "{}{}/billing/user-resource",
        CODEBUDDY_CN_API_ENDPOINT, CODEBUDDY_CN_API_PREFIX
    );

    let (begin, end) = build_default_user_resource_time_range();
    let status = normalize_user_resource_status(&[0, 3]);
    let product_code = normalize_product_code(None);

    let ctx = request_context(access_token, uid, enterprise_id, domain);
    let req = apply_codebuddy_headers(
        client.post(&url).json(&json!({
            "status": status,
            "productCode": product_code,
            "beginTime": begin,
            "endTime": end,
        })),
        &ctx,
    );

    let resp = match req.send().await {
        Ok(resp) => resp,
        Err(err) => {
            warn!(
                "[CodeBuddy CN OAuth] user-resource 请求失败: endpoint={}, error={}",
                url, err
            );
            return None;
        }
    };
    let status_code = resp.status();
    match resp.json::<Value>().await {
        Ok(body) => {
            if !status_code.is_success() {
                warn!(
                    "[CodeBuddy CN OAuth] user-resource 请求失败: endpoint={}, http={}, error={}",
                    url,
                    status_code.as_u16(),
                    response_message(&body)
                );
                return None;
            }
            if let Some(code) = response_code(&body) {
                if !is_success_code(code) {
                    warn!(
                        "[CodeBuddy CN OAuth] user-resource 请求失败: endpoint={}, http={}, code={}, error={}",
                        url,
                        status_code.as_u16(),
                        code,
                        response_message(&body)
                    );
                    return None;
                }
            }
            Some(wrap_user_resource_quota(body))
        }
        Err(err) => {
            warn!(
                "[CodeBuddy CN OAuth] user-resource 解析失败: endpoint={}, http={}, error={}",
                url,
                status_code.as_u16(),
                err
            );
            None
        }
    }
}

// ---------------------------------------------------------------------------
// Pending OAuth state
// ---------------------------------------------------------------------------

struct PendingOAuthState {
    pub login_id: String,
    pub state: String,
    pub cancelled: bool,
    pub expires_at: i64,
}

static PENDING_OAUTH_STATE_CN: LazyLock<Mutex<Option<PendingOAuthState>>> =
    LazyLock::new(|| Mutex::new(None));

pub fn cancel_login(login_id: Option<&str>) {
    if let Ok(mut pending) = PENDING_OAUTH_STATE_CN.lock() {
        if let Some(state) = pending.as_mut() {
            if login_id.map_or(true, |id| id == state.login_id) {
                state.cancelled = true;
            }
        }
    }
}

pub fn clear_pending_oauth_login(login_id: &str) {
    if let Ok(mut pending) = PENDING_OAUTH_STATE_CN.lock() {
        if pending.as_ref().map_or(false, |s| s.login_id == login_id) {
            *pending = None;
        }
    }
}

fn generate_login_id() -> String {
    use std::fmt::Write;
    let bytes: [u8; 8] = rand::random();
    let mut s = String::with_capacity(18);
    s.push_str("cb_cn_");
    for b in bytes {
        write!(s, "{:02x}", b).unwrap();
    }
    s
}

pub async fn start_login() -> Result<CodebuddyOAuthStartResponse, String> {
    let client = build_client()?;
    let login_id = generate_login_id();
    let expires_in: i64 = 600;
    let interval_seconds: i64 = 2;

    let url = format!(
        "{}{}/auth/state?platform={}",
        CODEBUDDY_CN_API_ENDPOINT, CODEBUDDY_CN_API_PREFIX, CODEBUDDY_CN_PLATFORM
    );

    let resp = client
        .post(&url)
        .json(&json!({}))
        .send()
        .await
        .map_err(|e| format!("请求 auth/state 失败: {}", e))?;

    let resp_body: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 auth/state 响应失败: {}", e))?;

    let data = resp_body
        .get("data")
        .ok_or_else(|| format!("auth/state 响应缺少 data 字段: {}", resp_body))?;

    let state = data
        .get("state")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "auth/state 响应缺少 state".to_string())?
        .to_string();

    let auth_url = data
        .get("authUrl")
        .or_else(|| data.get("auth_url"))
        .or_else(|| data.get("url"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let verification_uri = if auth_url.is_empty() {
        format!("{}/login?state={}", CODEBUDDY_CN_API_ENDPOINT, state)
    } else {
        auth_url.clone()
    };

    let expires_at = now_timestamp() + expires_in;
    if let Ok(mut pending) = PENDING_OAUTH_STATE_CN.lock() {
        *pending = Some(PendingOAuthState {
            login_id: login_id.clone(),
            state: state.clone(),
            cancelled: false,
            expires_at,
        });
    }

    info!("[CodeBuddy CN OAuth] 登录已启动: login_id={}", login_id);

    Ok(CodebuddyOAuthStartResponse {
        login_id,
        verification_uri: verification_uri.clone(),
        verification_uri_complete: Some(verification_uri),
        expires_in,
        interval_seconds,
    })
}

pub async fn complete_login(login_id: &str) -> Result<CodebuddyOAuthCompletePayload, String> {
    let client = build_client()?;

    let poll_state = {
        let pending = PENDING_OAUTH_STATE_CN
            .lock()
            .map_err(|_| "内部锁错误".to_string())?;
        pending
            .as_ref()
            .filter(|s| s.login_id == login_id)
            .map(|s| s.state.clone())
            .ok_or_else(|| "无效的 OAuth 登录状态".to_string())?
    };

    let poll_url = format!(
        "{}{}/auth/token?state={}",
        CODEBUDDY_CN_API_ENDPOINT, CODEBUDDY_CN_API_PREFIX, poll_state
    );

    let deadline = now_timestamp() + 600;
    let interval = std::time::Duration::from_millis(1500);

    loop {
        {
            let pending = PENDING_OAUTH_STATE_CN
                .lock()
                .map_err(|_| "内部锁错误".to_string())?;
            if let Some(state) = pending.as_ref() {
                if state.login_id == login_id {
                    if state.cancelled {
                        return Err("OAuth 登录已取消".to_string());
                    }
                } else {
                    return Err("OAuth 登录 ID 不匹配".to_string());
                }
            } else {
                return Err("无效的 OAuth 登录状态".to_string());
            }
        }

        if now_timestamp() > deadline {
            return Err("OAuth 登录超时".to_string());
        }

        let resp = client
            .get(&poll_url)
            .send()
            .await
            .map_err(|e| format!("轮询 auth/token 失败: {}", e))?;

        let body: Value = resp
            .json()
            .await
            .map_err(|e| format!("解析 auth/token 响应失败: {}", e))?;

        let code = body.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);

        if code == 0 || code == 200 {
            let data = body.get("data").cloned().unwrap_or(json!({}));

            let access_token = data
                .get("accessToken")
                .or_else(|| data.get("access_token"))
                .and_then(|v| v.as_str())
                .ok_or_else(|| "响应缺少 accessToken".to_string())?
                .to_string();

            let refresh_token_val = data
                .get("refreshToken")
                .or_else(|| data.get("refresh_token"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let expires_at_val = data
                .get("expiresAt")
                .or_else(|| data.get("expires_at"))
                .and_then(|v| v.as_i64());

            let domain = data
                .get("domain")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let state_val = data
                .get("state")
                .and_then(|v| v.as_str())
                .unwrap_or(&poll_state);

            let (
                uid,
                nickname,
                email,
                enterprise_id,
                enterprise_name,
                account_scope,
                account_context_id,
                account_raw,
            ) = fetch_account_info(&client, &access_token, state_val, domain.as_deref()).await?;

            let quota_raw = fetch_quota_info(
                &client,
                &access_token,
                uid.as_deref(),
                enterprise_id.as_deref(),
                domain.as_deref(),
            )
            .await;

            info!("[CodeBuddy CN OAuth] 登录成功: email={}", email);

            return Ok(CodebuddyOAuthCompletePayload {
                email,
                uid,
                nickname,
                enterprise_id,
                enterprise_name,
                account_scope,
                account_context_id,
                account_context_raw: account_raw.clone(),
                access_token,
                refresh_token: refresh_token_val,
                token_type: Some("Bearer".to_string()),
                expires_at: expires_at_val,
                domain,
                plan_type: None,
                dosage_notify_code: None,
                dosage_notify_zh: None,
                dosage_notify_en: None,
                payment_type: None,
                quota_raw,
                auth_raw: None,
                profile_raw: account_raw,
                usage_raw: None,
                status: Some("normal".to_string()),
                status_reason: None,
            });
        }

        tokio::time::sleep(interval).await;
    }
}

pub async fn build_payload_from_token(
    access_token: &str,
) -> Result<CodebuddyOAuthCompletePayload, String> {
    let client = build_client()?;
    let dummy_state = "";
    let (
        uid,
        nickname,
        email,
        enterprise_id,
        enterprise_name,
        account_scope,
        account_context_id,
        account_raw,
    ) = fetch_account_info(&client, access_token, dummy_state, None).await?;

    let quota_raw = fetch_quota_info(
        &client,
        access_token,
        uid.as_deref(),
        enterprise_id.as_deref(),
        None,
    )
    .await;

    Ok(CodebuddyOAuthCompletePayload {
        email,
        uid,
        nickname,
        enterprise_id,
        enterprise_name,
        account_scope,
        account_context_id,
        account_context_raw: account_raw.clone(),
        access_token: access_token.to_string(),
        refresh_token: None,
        token_type: Some("Bearer".to_string()),
        expires_at: None,
        domain: None,
        plan_type: None,
        dosage_notify_code: None,
        dosage_notify_zh: None,
        dosage_notify_en: None,
        payment_type: None,
        quota_raw,
        auth_raw: None,
        profile_raw: account_raw,
        usage_raw: None,
        status: Some("normal".to_string()),
        status_reason: None,
    })
}

// ---------------------------------------------------------------------------
// Checkin APIs
// ---------------------------------------------------------------------------

pub async fn get_checkin_status(
    access_token: &str,
    uid: Option<&str>,
    enterprise_id: Option<&str>,
    domain: Option<&str>,
) -> Result<CheckinStatusResponse, String> {
    let client = build_client()?;
    let url = format!(
        "{}/v2/billing/meter/checkin-status",
        CODEBUDDY_CN_API_ENDPOINT
    );

    let ctx = request_context(access_token, uid, enterprise_id, domain);
    let resp = apply_codebuddy_headers(
        client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&json!({})),
        &ctx,
    )
    .send()
    .await
    .map_err(|e| format!("请求 checkin-status 失败: {}", e))?;

    let status_code = resp.status();
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 checkin-status 响应失败: {}", e))?;

    if !status_code.is_success() {
        let message = body
            .get("message")
            .or_else(|| body.get("msg"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(format!(
            "请求 checkin-status 失败 (http={}): {}",
            status_code.as_u16(),
            message
        ));
    }

    let code = body.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
    if code != 0 && code != 200 {
        let message = body
            .get("message")
            .or_else(|| body.get("msg"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(format!(
            "请求 checkin-status 失败 (code={}): {}",
            code, message
        ));
    }

    let data = body
        .get("data")
        .ok_or_else(|| "checkin-status 响应缺少 data 字段".to_string())?;

    let status: CheckinStatusResponse = serde_json::from_value(data.clone())
        .map_err(|e| format!("解析 checkin-status data 失败: {}", e))?;

    Ok(status)
}

pub async fn perform_checkin(
    access_token: &str,
    uid: Option<&str>,
    enterprise_id: Option<&str>,
    domain: Option<&str>,
) -> Result<CheckinResponse, String> {
    let client = build_client()?;
    let url = format!(
        "{}/v2/billing/meter/daily-checkin",
        CODEBUDDY_CN_API_ENDPOINT
    );

    let ctx = request_context(access_token, uid, enterprise_id, domain);
    let resp = apply_codebuddy_headers(
        client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&json!({})),
        &ctx,
    )
    .send()
    .await
    .map_err(|e| format!("请求 daily-checkin 失败: {}", e))?;

    let status_code = resp.status();
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 daily-checkin 响应失败: {}", e))?;

    if !status_code.is_success() {
        let message = body
            .get("message")
            .or_else(|| body.get("msg"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(format!(
            "请求 daily-checkin 失败 (http={}): {}",
            status_code.as_u16(),
            message
        ));
    }

    let code = body.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
    let api_msg = body
        .get("message")
        .or_else(|| body.get("msg"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if code != 0 && code != 200 {
        return Err(format!(
            "签到失败 (code={}): {}",
            code,
            api_msg.as_deref().unwrap_or("unknown error")
        ));
    }

    let data = body.get("data").cloned().unwrap_or(json!({}));
    let reward = data
        .get("reward")
        .cloned()
        .or_else(|| body.get("data").cloned());

    Ok(CheckinResponse {
        success: true,
        message: api_msg,
        reward,
        next_checkin_in: data.get("nextCheckinIn").and_then(|v| v.as_i64()),
    })
}
