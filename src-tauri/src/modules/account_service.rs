use crate::models::Account;
use crate::modules::{self, logger};

pub struct AccountService {
    pub integration: crate::modules::integration::SystemManager,
}

impl AccountService {
    pub fn new(integration: crate::modules::integration::SystemManager) -> Self {
        Self { integration }
    }

    pub async fn add_account(&self, _refresh_token: &str) -> Result<Account, String> {
        logger::log_warn("Legacy account service add flow is disabled");
        Err("legacy_account_service_removed".to_string())
    }

    pub fn delete_account(&self, account_id: &str) -> Result<(), String> {
        modules::delete_account(account_id)?;
        self.integration.update_tray();
        Ok(())
    }

    pub async fn switch_account(&self, account_id: &str) -> Result<(), String> {
        modules::account::switch_account(account_id, &self.integration).await
    }

    pub fn list_accounts(&self) -> Result<Vec<Account>, String> {
        modules::list_accounts()
    }

    pub fn get_current_id(&self) -> Result<Option<String>, String> {
        modules::get_current_account_id()
    }

    pub async fn prepare_oauth_url(
        &self,
        oauth_client_key: Option<String>,
    ) -> Result<String, String> {
        let handle = match &self.integration {
            modules::integration::SystemManager::Desktop(h) => Some(h.clone()),
            modules::integration::SystemManager::Headless => None,
        };
        modules::oauth_server::prepare_oauth_url(handle, oauth_client_key).await
    }

    pub async fn start_oauth_login(
        &self,
        oauth_client_key: Option<String>,
    ) -> Result<Account, String> {
        let _ = oauth_client_key;
        logger::log_warn("Legacy account service OAuth start flow is disabled");
        Err("legacy_account_service_removed".to_string())
    }

    pub async fn complete_oauth_login(&self) -> Result<Account, String> {
        logger::log_warn("Legacy account service OAuth completion flow is disabled");
        Err("legacy_account_service_removed".to_string())
    }

    pub fn cancel_oauth_login(&self) {
        modules::oauth_server::cancel_oauth_flow();
    }

    pub async fn submit_oauth_code(
        &self,
        code: String,
        state: Option<String>,
    ) -> Result<(), String> {
        modules::oauth_server::submit_oauth_code(code, state).await
    }
}
