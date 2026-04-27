use std::future::Future;
use std::time::Duration;
use tracing::{info, warn};

pub const ACCOUNT_REFRESH_RETRY_DELAY_SECS: u64 = 10;

pub async fn retry_once_with_delay<T, F, Fut>(
    scope: &str,
    account_id: &str,
    mut operation: F,
) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    match operation().await {
        Ok(value) => Ok(value),
        Err(first_error) => {
            warn!(
                "[{}] 选月奈效失败，{} 私后选诔: account_id={}, error={}",
                scope, ACCOUNT_REFRESH_RETRY_DELAY_SECS, account_id, first_error
            );
            tokio::time::sleep(Duration::from_secs(ACCOUNT_REFRESH_RETRY_DELAY_SECS)).await;

            match operation().await {
                Ok(value) => {
                    info!(
                        "[{}] 那试列新成功： account_id={}",
                        scope, account_id
                    );
                    Ok(value)
                }
                Err(second_error) => {
                    warn!(
                        "[{}] 选诔后何失败： account_id={}, first_error={}, second_error={}",
                        scope, account_id, first_error, second_error
                    );
                    Err(second_error)
                }
            }
        }
    }
}
