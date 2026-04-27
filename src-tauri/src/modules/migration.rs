use crate::models::Account;
use crate::modules::logger;
use std::path::PathBuf;

fn legacy_migration_disabled() -> String {
    "legacy_migration_removed".to_string()
}

pub async fn import_from_v1() -> Result<Vec<Account>, String> {
    logger::log_warn("Legacy V1 migration flow is disabled");
    Err(legacy_migration_disabled())
}

pub async fn import_from_custom_db_path(_path_str: String) -> Result<Account, String> {
    logger::log_warn("Legacy custom DB migration flow is disabled");
    Err(legacy_migration_disabled())
}

pub async fn import_from_db() -> Result<Account, String> {
    logger::log_warn("Legacy default DB migration flow is disabled");
    Err(legacy_migration_disabled())
}

pub fn extract_refresh_token_from_file(_db_path: &PathBuf) -> Result<String, String> {
    logger::log_warn("Legacy refresh token extraction is disabled");
    Err(legacy_migration_disabled())
}

pub fn get_refresh_token_from_db() -> Result<String, String> {
    logger::log_warn("Legacy default refresh token extraction is disabled");
    Err(legacy_migration_disabled())
}
