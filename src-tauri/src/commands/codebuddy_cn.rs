use std::time::Instant;

use crate::models::codebuddy::{
    CheckinResponse, CheckinStatusResponse, CodebuddyAccount, CodebuddyCnModelInfo,
    CodebuddyOAuthStartResponse,
};
use crate::modules::{codebuddy_cn_account, codebuddy_cn_oauth};
use tauri::Emitter;

#[tauri::command]
pub fn list_codebuddy_cn_accounts() -> Result<Vec<CodebuddyAccount>, String> {
    codebuddy_cn_account::list_accounts_checked()
}

#[tauri::command]
pub fn list_codebuddy_cn_cached_models(
    account_id: Option<String>,
) -> Result<Vec<CodebuddyCnModelInfo>, String> {
    codebuddy_cn_account::list_cached_models_from_accounts(account_id.as_deref())
}

#[tauri::command]
pub async fn add_codebuddy_cn_account_with_token(
    access_token: String,
) -> Result<CodebuddyAccount, String> {
    let payload = codebuddy_cn_oauth::build_payload_from_token(&access_token).await?;
    let account = codebuddy_cn_account::upsert_account(payload)?;
    Ok(account)
}

#[tauri::command]
pub fn delete_codebuddy_cn_account(account_id: String) -> Result<(), String> {
    codebuddy_cn_account::remove_account(&account_id)
}

#[tauri::command]
pub fn delete_codebuddy_cn_accounts(account_ids: Vec<String>) -> Result<(), String> {
    codebuddy_cn_account::remove_accounts(&account_ids)
}

#[tauri::command]
pub async fn refresh_codebuddy_cn_token(account_id: String) -> Result<CodebuddyAccount, String> {
    let started_at = Instant::now();
    tracing::info!(
        "[CodeBuddy CN Command] 手动刷新账号开始: account_id={}",
        account_id
    );

    match codebuddy_cn_account::refresh_account_token(&account_id).await {
        Ok(account) => {
            tracing::info!(
                "[CodeBuddy CN Command] 手动刷新账号完成: account_id={}, email={}, elapsed={}ms",
                account.id,
                account.email,
                started_at.elapsed().as_millis()
            );
            Ok(account)
        }
        Err(err) => {
            tracing::warn!(
                "[CodeBuddy CN Command] 手动刷新账号失败: account_id={}, elapsed={}ms, error={}",
                account_id,
                started_at.elapsed().as_millis(),
                err
            );
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn refresh_all_codebuddy_cn_tokens() -> Result<i32, String> {
    let started_at = Instant::now();
    tracing::info!("[CodeBuddy CN Command] 手动批量刷新开始");

    let results = codebuddy_cn_account::refresh_all_tokens().await?;
    let success_count = results.iter().filter(|(_, item)| item.is_ok()).count();
    let failed_count = results.len().saturating_sub(success_count);

    tracing::info!(
        "[CodeBuddy CN Command] 手动批量刷新完成: success={}, failed={}, elapsed={}ms",
        success_count,
        failed_count,
        started_at.elapsed().as_millis()
    );

    Ok(success_count as i32)
}

#[tauri::command]
pub async fn update_codebuddy_cn_account_tags(
    account_id: String,
    tags: Vec<String>,
) -> Result<CodebuddyAccount, String> {
    codebuddy_cn_account::update_account_tags(&account_id, tags)
}

#[tauri::command]
pub fn get_codebuddy_cn_accounts_index_path() -> Result<String, String> {
    codebuddy_cn_account::accounts_index_path_string()
}

#[tauri::command]
pub fn import_codebuddy_cn_from_json(
    json_content: String,
) -> Result<Vec<CodebuddyAccount>, String> {
    codebuddy_cn_account::import_from_json(&json_content)
}

#[tauri::command]
pub fn export_codebuddy_cn_accounts(account_ids: Vec<String>) -> Result<String, String> {
    codebuddy_cn_account::export_accounts(&account_ids)
}

#[tauri::command]
pub async fn set_current_codebuddy_cn_account(
    app: tauri::AppHandle,
    proxy_state: tauri::State<'_, crate::commands::proxy::ProxyServiceState>,
    id: String,
) -> Result<(), String> {
    let mut config = crate::modules::config::load_app_config()?;
    config.proxy.codebuddy_cn.current_account_id = Some(id.clone());
    crate::modules::config::save_app_config(&config)?;
    tracing::info!("[CodeBuddy CN Command] 已设置当前活跃账号: {}", id);
    let instance_lock = proxy_state.instance.read().await;
    if let Some(instance) = instance_lock.as_ref() {
        instance
            .axum_server
            .update_codebuddy_cn(&config.proxy)
            .await;
    }
    drop(instance_lock);
    let _ = app.emit("config://updated", ());
    Ok(())
}

#[tauri::command]
pub async fn start_codebuddy_cn_oauth_login() -> Result<CodebuddyOAuthStartResponse, String> {
    codebuddy_cn_oauth::start_login().await
}

#[tauri::command]
pub async fn complete_codebuddy_cn_oauth_login(
    app: tauri::AppHandle,
    login_id: String,
) -> Result<CodebuddyAccount, String> {
    let payload = codebuddy_cn_oauth::complete_login(&login_id).await?;
    let account = codebuddy_cn_account::upsert_account(payload)?;
    let account = codebuddy_cn_account::refresh_account_token(&account.id)
        .await
        .unwrap_or(account);
    let _ = app.emit("config://updated", ());
    codebuddy_cn_oauth::clear_pending_oauth_login(&login_id);
    Ok(account)
}

#[tauri::command]
pub fn cancel_codebuddy_cn_oauth_login(login_id: Option<String>) {
    codebuddy_cn_oauth::cancel_login(login_id.as_deref());
}

#[tauri::command]
pub async fn get_checkin_status_codebuddy_cn(
    account_id: String,
) -> Result<CheckinStatusResponse, String> {
    let account =
        codebuddy_cn_account::load_account(&account_id).ok_or_else(|| "账号不存在".to_string())?;
    codebuddy_cn_oauth::get_checkin_status(
        &account.access_token,
        account.uid.as_deref(),
        account.enterprise_id.as_deref(),
        account.domain.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn checkin_codebuddy_cn(
    app: tauri::AppHandle,
    account_id: String,
) -> Result<(CheckinStatusResponse, Option<CheckinResponse>), String> {
    let result = codebuddy_cn_account::checkin_account(&account_id).await?;
    let _ = app.emit("codebuddy_cn:checkin_completed", &account_id);
    Ok(result)
}
