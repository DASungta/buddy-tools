use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenStatsAggregated {
    pub period: String,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_tokens: u64,
    pub request_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountTokenStats {
    pub account_email: String,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_tokens: u64,
    pub request_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenStatsSummary {
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_tokens: u64,
    pub total_requests: u64,
    pub unique_accounts: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelTokenStats {
    pub model: String,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_tokens: u64,
    pub request_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelTrendPoint {
    pub period: String,
    pub model_data: HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountTrendPoint {
    pub period: String,
    pub account_data: HashMap<String, u64>,
}

pub(crate) fn get_db_path() -> Result<PathBuf, String> {
    let data_dir = crate::modules::account::get_data_dir()?;
    Ok(data_dir.join("token_stats.db"))
}

pub fn init_db() -> Result<(), String> {
    Ok(())
}

pub fn record_usage(
    account_email: &str,
    model: &str,
    input_tokens: u32,
    output_tokens: u32,
) -> Result<(), String> {
    let _ = (account_email, model, input_tokens, output_tokens);
    Ok(())
}

pub fn get_hourly_stats(hours: i64) -> Result<Vec<TokenStatsAggregated>, String> {
    let _ = hours;
    Ok(Vec::new())
}

pub fn get_daily_stats(days: i64) -> Result<Vec<TokenStatsAggregated>, String> {
    let _ = days;
    Ok(Vec::new())
}

pub fn get_weekly_stats(weeks: i64) -> Result<Vec<TokenStatsAggregated>, String> {
    let _ = weeks;
    Ok(Vec::new())
}

pub fn get_account_stats(hours: i64) -> Result<Vec<AccountTokenStats>, String> {
    let _ = hours;
    Ok(Vec::new())
}

pub fn get_summary_stats(hours: i64) -> Result<TokenStatsSummary, String> {
    let _ = hours;
    Ok(TokenStatsSummary {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_tokens: 0,
        total_requests: 0,
        unique_accounts: 0,
    })
}

pub fn get_model_stats(hours: i64) -> Result<Vec<ModelTokenStats>, String> {
    let _ = hours;
    Ok(Vec::new())
}

pub fn get_model_trend_hourly(hours: i64) -> Result<Vec<ModelTrendPoint>, String> {
    let _ = hours;
    Ok(Vec::new())
}

pub fn get_model_trend_daily(days: i64) -> Result<Vec<ModelTrendPoint>, String> {
    let _ = days;
    Ok(Vec::new())
}

pub fn get_account_trend_hourly(hours: i64) -> Result<Vec<AccountTrendPoint>, String> {
    let _ = hours;
    Ok(Vec::new())
}

pub fn get_account_trend_daily(days: i64) -> Result<Vec<AccountTrendPoint>, String> {
    let _ = days;
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_defaults_to_zero() {
        let summary = get_summary_stats(24).unwrap();
        assert_eq!(summary.total_tokens, 0);
        assert_eq!(summary.total_requests, 0);
    }
}
