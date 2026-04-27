// 工具函数

#[derive(Debug, Clone)]
pub struct ProxyOauthToken {
    pub access_token: String,
    pub expires_in: i64,
    pub refresh_token: Option<String>,
    pub oauth_client_key: Option<String>,
}

impl From<crate::modules::oauth::TokenResponse> for ProxyOauthToken {
    fn from(value: crate::modules::oauth::TokenResponse) -> Self {
        Self {
            access_token: value.access_token,
            expires_in: value.expires_in,
            refresh_token: value.refresh_token,
            oauth_client_key: value.oauth_client_key,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProxyOauthUserInfo {
    pub email: String,
    pub name: Option<String>,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    pub picture: Option<String>,
}

impl From<crate::modules::oauth::UserInfo> for ProxyOauthUserInfo {
    fn from(value: crate::modules::oauth::UserInfo) -> Self {
        Self {
            email: value.email,
            name: value.name,
            given_name: value.given_name,
            family_name: value.family_name,
            picture: value.picture,
        }
    }
}

pub async fn exchange_proxy_oauth_code(
    code: &str,
    redirect_uri: &str,
) -> Result<ProxyOauthToken, String> {
    crate::modules::oauth::exchange_code(code, redirect_uri)
        .await
        .map(Into::into)
}

pub async fn refresh_proxy_oauth_access_token(
    refresh_token: &str,
    account_id: Option<&str>,
) -> Result<ProxyOauthToken, String> {
    crate::modules::oauth::refresh_access_token(refresh_token, account_id)
        .await
        .map(Into::into)
}

pub async fn fetch_proxy_oauth_user_info(
    access_token: &str,
    account_id: Option<&str>,
) -> Result<ProxyOauthUserInfo, String> {
    crate::modules::oauth::get_user_info(access_token, account_id)
        .await
        .map(Into::into)
}

pub async fn fetch_proxy_oauth_user_info_from_refresh_token(
    refresh_token: &str,
) -> Result<ProxyOauthUserInfo, String> {
    let token = refresh_proxy_oauth_access_token(refresh_token, None)
        .await
        .map_err(|e| format!("刷新 Access Token 失败: {}", e))?;

    fetch_proxy_oauth_user_info(&token.access_token, None).await
}

pub fn get_proxy_oauth_url(redirect_uri: &str, state: &str) -> String {
    crate::modules::oauth::get_auth_url(redirect_uri, state)
}

pub fn list_proxy_oauth_clients_json() -> Result<serde_json::Value, String> {
    serde_json::to_value(crate::modules::oauth::list_oauth_clients()?)
        .map_err(|e| format!("Failed to serialize OAuth clients: {}", e))
}

pub fn get_active_proxy_oauth_client_key() -> Result<String, String> {
    crate::modules::oauth::get_active_oauth_client_key()
}

pub fn set_active_proxy_oauth_client_key(client_key: &str) -> Result<(), String> {
    crate::modules::oauth::set_active_oauth_client_key(client_key)
}

pub fn upsert_proxy_account(
    email: String,
    refresh_token: String,
    token: ProxyOauthToken,
    project_id: String,
) -> Result<(), String> {
    let token_data = crate::models::TokenData::new(
        token.access_token,
        refresh_token,
        token.expires_in,
        Some(email.clone()),
        Some(project_id),
        None,
        true,
    )
    .with_oauth_client_key(token.oauth_client_key);

    crate::modules::account::upsert_account(email, None, token_data).map(|_| ())
}

pub fn mark_proxy_account_forbidden(account_id: &str, reason: &str) -> Result<(), String> {
    crate::modules::account::mark_account_forbidden(account_id, reason)
}

pub fn find_proxy_account_id_by_email(email: &str) -> Option<String> {
    crate::modules::account::find_account_id_by_email(email)
}

pub fn generate_random_id() -> String {
    use rand::Rng;
    rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(8)
        .map(char::from)
        .collect()
}

/// 根据模型名称推测功能类型
// 注意：此函数已弃用，请改用 mappers::common_utils::resolve_request_config
pub fn _deprecated_infer_quota_group(model: &str) -> String {
    if model.to_lowercase().starts_with("claude") {
        "claude".to_string()
    } else {
        "gemini".to_string()
    }
}
