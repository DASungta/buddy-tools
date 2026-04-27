use crate::modules::user_token_db::{TokenIpBinding, UserToken};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateTokenRequest {
    pub username: String,
    pub expires_type: String,
    pub description: Option<String>,
    pub max_ips: i32,
    pub curfew_start: Option<String>,
    pub curfew_end: Option<String>,
    pub custom_expires_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateTokenRequest {
    pub username: Option<String>,
    pub description: Option<String>,
    pub enabled: Option<bool>,
    pub max_ips: Option<i32>,
    pub curfew_start: Option<Option<String>>,
    pub curfew_end: Option<Option<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserTokenStats {
    pub total_tokens: usize,
    pub active_tokens: usize,
    pub total_users: usize,
    pub today_requests: i64,
}

fn removed_message() -> String {
    "User token support has been removed.".to_string()
}

#[tauri::command]
pub async fn list_user_tokens() -> Result<Vec<UserToken>, String> {
    Ok(Vec::new())
}

#[tauri::command]
pub async fn create_user_token(request: CreateTokenRequest) -> Result<UserToken, String> {
    let _ = request;
    Err(removed_message())
}

#[tauri::command]
pub async fn update_user_token(id: String, request: UpdateTokenRequest) -> Result<(), String> {
    let _ = (id, request);
    Err(removed_message())
}

#[tauri::command]
pub async fn delete_user_token(id: String) -> Result<(), String> {
    let _ = id;
    Err(removed_message())
}

#[tauri::command]
pub async fn renew_user_token(id: String, expires_type: String) -> Result<(), String> {
    let _ = (id, expires_type);
    Err(removed_message())
}

#[tauri::command]
pub async fn get_token_ip_bindings(token_id: String) -> Result<Vec<TokenIpBinding>, String> {
    let _ = token_id;
    Ok(Vec::new())
}

#[tauri::command]
pub async fn get_user_token_summary() -> Result<UserTokenStats, String> {
    Ok(UserTokenStats {
        total_tokens: 0,
        active_tokens: 0,
        total_users: 0,
        today_requests: 0,
    })
}
