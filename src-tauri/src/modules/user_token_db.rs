#![allow(dead_code)]

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserToken {
    pub id: String,
    pub token: String,
    pub username: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub expires_type: String,
    pub expires_at: Option<i64>,
    pub max_ips: i32,
    pub curfew_start: Option<String>,
    pub curfew_end: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_used_at: Option<i64>,
    pub total_requests: i64,
    pub total_tokens_used: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenIpBinding {
    pub id: String,
    pub token_id: String,
    pub ip_address: String,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
    pub request_count: i64,
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsageLog {
    pub id: String,
    pub token_id: String,
    pub ip_address: String,
    pub model: String,
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub request_time: i64,
    pub status: u16,
}

fn removed_message() -> String {
    "User token support has been removed.".to_string()
}

pub fn get_db_path() -> Result<PathBuf, String> {
    let mut path = crate::modules::account::get_data_dir()?;
    path.push("user_tokens.db");
    Ok(path)
}

pub fn connect_db() -> Result<Connection, String> {
    Err(removed_message())
}

pub fn init_db() -> Result<(), String> {
    Ok(())
}

pub fn create_token(
    username: String,
    expires_type: String,
    description: Option<String>,
    max_ips: i32,
    curfew_start: Option<String>,
    curfew_end: Option<String>,
    custom_expires_at: Option<i64>,
) -> Result<UserToken, String> {
    let _ = (
        username,
        expires_type,
        description,
        max_ips,
        curfew_start,
        curfew_end,
        custom_expires_at,
    );
    Err(removed_message())
}

pub fn list_tokens() -> Result<Vec<UserToken>, String> {
    Ok(Vec::new())
}

pub fn get_token_by_id(id: &str) -> Result<Option<UserToken>, String> {
    let _ = id;
    Ok(None)
}

pub fn get_token_by_value(token: &str) -> Result<Option<UserToken>, String> {
    let _ = token;
    Ok(None)
}

pub fn update_token(
    id: &str,
    username: Option<String>,
    description: Option<String>,
    enabled: Option<bool>,
    max_ips: Option<i32>,
    curfew_start: Option<Option<String>>,
    curfew_end: Option<Option<String>>,
) -> Result<(), String> {
    let _ = (id, username, description, enabled, max_ips, curfew_start, curfew_end);
    Err(removed_message())
}

pub fn renew_token(id: &str, expires_type: &str) -> Result<(), String> {
    let _ = (id, expires_type);
    Err(removed_message())
}

pub fn delete_token(id: &str) -> Result<(), String> {
    let _ = id;
    Err(removed_message())
}

pub fn get_token_ips(token_id: &str) -> Result<Vec<TokenIpBinding>, String> {
    let _ = token_id;
    Ok(Vec::new())
}

pub fn record_token_usage_and_ip(
    token_id: &str,
    ip: &str,
    model: &str,
    input_tokens: i32,
    output_tokens: i32,
    status: u16,
    user_agent: Option<String>,
) -> Result<(), String> {
    let _ = (
        token_id,
        ip,
        model,
        input_tokens,
        output_tokens,
        status,
        user_agent,
    );
    Ok(())
}

pub fn validate_token(token_str: &str, ip: &str) -> Result<(bool, Option<String>), String> {
    let _ = (token_str, ip);
    Ok((false, Some(removed_message())))
}

pub fn get_username_for_ip(ip: &str) -> Result<Option<String>, String> {
    let _ = ip;
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removed_module_returns_empty_reads() {
        assert!(list_tokens().unwrap().is_empty());
        assert!(get_token_by_value("sk-test").unwrap().is_none());
    }
}
