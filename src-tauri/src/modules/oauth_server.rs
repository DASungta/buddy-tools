use crate::modules::{logger, oauth};
use tokio::sync::mpsc;

fn legacy_oauth_server_disabled() -> String {
    "legacy_oauth_server_removed".to_string()
}

pub async fn prepare_oauth_url(
    _app_handle: Option<tauri::AppHandle>,
    _oauth_client_key: Option<String>,
) -> Result<String, String> {
    logger::log_warn("Legacy OAuth server flow is disabled");
    Err(legacy_oauth_server_disabled())
}

pub fn cancel_oauth_flow() {
    logger::log_info("Ignored cancel request for disabled legacy OAuth server flow");
}

pub async fn start_oauth_flow(
    _app_handle: Option<tauri::AppHandle>,
    _oauth_client_key: Option<String>,
) -> Result<oauth::TokenResponse, String> {
    logger::log_warn("Legacy OAuth browser login flow is disabled");
    Err(legacy_oauth_server_disabled())
}

pub async fn complete_oauth_flow(
    _app_handle: Option<tauri::AppHandle>,
) -> Result<oauth::TokenResponse, String> {
    logger::log_warn("Legacy OAuth callback completion flow is disabled");
    Err(legacy_oauth_server_disabled())
}

pub async fn submit_oauth_code(
    _code_input: String,
    _state_input: Option<String>,
) -> Result<(), String> {
    logger::log_warn("Legacy OAuth manual code submission flow is disabled");
    Err(legacy_oauth_server_disabled())
}

pub fn prepare_oauth_flow_manually(
    _redirect_uri: String,
    _state_str: String,
    _oauth_client_key: Option<String>,
) -> Result<(String, mpsc::Receiver<Result<String, String>>), String> {
    logger::log_warn("Legacy manual OAuth flow preparation is disabled");
    Err(legacy_oauth_server_disabled())
}
