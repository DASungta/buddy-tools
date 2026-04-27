use crate::modules::logger;
use serde::{Deserialize, Serialize};

pub const DEFAULT_PORT: u16 = 19527;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpApiSettings {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_port")]
    pub port: u16,
}

fn default_enabled() -> bool {
    true
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

impl Default for HttpApiSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            port: DEFAULT_PORT,
        }
    }
}

pub fn load_settings() -> Result<HttpApiSettings, String> {
    let data_dir = crate::modules::account::get_data_dir()
        .map_err(|e| format!("Failed to get data dir: {}", e))?;
    let settings_path = data_dir.join("http_api_settings.json");

    if !settings_path.exists() {
        return Ok(HttpApiSettings::default());
    }

    let content = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings file: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse settings: {}", e))
}

pub fn save_settings(settings: &HttpApiSettings) -> Result<(), String> {
    let data_dir = crate::modules::account::get_data_dir()
        .map_err(|e| format!("Failed to get data dir: {}", e))?;
    let settings_path = data_dir.join("http_api_settings.json");

    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    std::fs::write(&settings_path, content)
        .map_err(|e| format!("Failed to write settings file: {}", e))
}

pub async fn start_server(
    _port: u16,
    _integration: crate::modules::integration::SystemManager,
) -> Result<(), String> {
    logger::log_warn("Legacy local HTTP API server is disabled");
    Err("legacy_http_api_removed".to_string())
}

pub fn spawn_server(_port: u16, _integration: crate::modules::integration::SystemManager) {
    logger::log_info("Skipped startup for disabled legacy local HTTP API server");
}
