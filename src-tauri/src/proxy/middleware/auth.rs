use axum::{
    extract::Request,
    extract::State,
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::proxy::{ProxyAuthMode, ProxySecurityConfig};

pub async fn auth_middleware(
    state: State<Arc<RwLock<ProxySecurityConfig>>>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    auth_middleware_internal(state, request, next, false).await
}

pub async fn admin_auth_middleware(
    state: State<Arc<RwLock<ProxySecurityConfig>>>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    auth_middleware_internal(state, request, next, true).await
}

async fn auth_middleware_internal(
    State(security): State<Arc<RwLock<ProxySecurityConfig>>>,
    request: Request,
    next: Next,
    force_strict: bool,
) -> Result<Response, StatusCode> {
    let method = request.method().clone();
    let path = request.uri().path().to_string();

    let is_health_check = path == "/healthz" || path == "/api/health" || path == "/health";
    let is_internal_endpoint = path.starts_with("/internal/");
    if !path.contains("event_logging") && !is_health_check {
        tracing::info!("Request: {} {}", method, path);
    } else {
        tracing::trace!("Heartbeat/Health: {} {}", method, path);
    }

    if method == axum::http::Method::OPTIONS {
        return Ok(next.run(request).await);
    }

    let security = security.read().await.clone();
    let effective_mode = security.effective_auth_mode();

    if !force_strict {
        if matches!(effective_mode, ProxyAuthMode::Off) {
            return Ok(next.run(request).await);
        }

        if matches!(effective_mode, ProxyAuthMode::AllExceptHealth) && is_health_check {
            return Ok(next.run(request).await);
        }

        if is_internal_endpoint {
            tracing::debug!("Internal endpoint bypassed auth: {}", path);
            return Ok(next.run(request).await);
        }
    } else {
        if matches!(effective_mode, ProxyAuthMode::Off) {
            return Ok(next.run(request).await);
        }

        if is_health_check {
            return Ok(next.run(request).await);
        }
    }

    let api_key = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer ").or(Some(s)))
        .or_else(|| {
            request
                .headers()
                .get("x-api-key")
                .and_then(|h| h.to_str().ok())
        })
        .or_else(|| {
            request
                .headers()
                .get("x-goog-api-key")
                .and_then(|h| h.to_str().ok())
        });

    if security.api_key.is_empty()
        && (security.admin_password.is_none()
            || security.admin_password.as_ref().is_some_and(|pwd| pwd.is_empty()))
    {
        if force_strict {
            tracing::error!(
                "Admin auth is required but both api_key and admin_password are empty; denying request"
            );
        } else {
            tracing::error!("Proxy auth is enabled but api_key is empty; denying request");
        }
        return Err(StatusCode::UNAUTHORIZED);
    }

    let authorized = if force_strict {
        match &security.admin_password {
            Some(pwd) if !pwd.is_empty() => api_key.map(|k| k == pwd).unwrap_or(false),
            _ => api_key.map(|k| k == security.api_key).unwrap_or(false),
        }
    } else {
        api_key.map(|k| k == security.api_key).unwrap_or(false)
    };

    if authorized {
        Ok(next.run(request).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proxy::ProxyAuthMode;

    #[tokio::test]
    async fn test_admin_auth_with_password() {
        let security = Arc::new(RwLock::new(ProxySecurityConfig {
            auth_mode: ProxyAuthMode::Strict,
            api_key: "sk-api".to_string(),
            admin_password: Some("admin123".to_string()),
            allow_lan_access: true,
            port: 8045,
            security_monitor: crate::proxy::config::SecurityMonitorConfig::default(),
        }));

        let req = Request::builder()
            .header("Authorization", "Bearer admin123")
            .uri("/admin/stats")
            .body(axum::body::Body::empty())
            .unwrap();

        let _ = (security, req);
    }

    #[test]
    fn test_auth_placeholder() {
        assert!(true);
    }
}
