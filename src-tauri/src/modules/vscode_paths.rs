use std::fs;
use std::path::{Path, PathBuf};

const APP_DATA_DIR: &str = ".antigravity_tools";

pub fn get_data_dir() -> Result<PathBuf, String> {
    if let Ok(env_path) = std::env::var("ABV_DATA_DIR") {
        if !env_path.trim().is_empty() {
            let data_dir = PathBuf::from(env_path);
            if !data_dir.exists() {
                fs::create_dir_all(&data_dir)
                    .map_err(|e| format!("failed_to_create_custom_data_dir: {}", e))?;
            }
            return Ok(data_dir);
        }
    }

    let home = dirs::home_dir().ok_or("failed_to_get_home_dir")?;
    let data_dir = home.join(APP_DATA_DIR);

    if !data_dir.exists() {
        fs::create_dir_all(&data_dir)
            .map_err(|e| format!("failed_to_create_data_dir: {}", e))?;
    }

    Ok(data_dir)
}

pub fn vscode_data_root_candidates() -> Result<Vec<PathBuf>, String> {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
        let lib = home.join("Library").join("Application Support");
        Ok(vec![lib.join("CodeBuddy")])
    }

    #[cfg(target_os = "windows")]
    {
        let appdata = dirs::data_local_dir().ok_or("Cannot determine APPDATA")?;
        Ok(vec![appdata.join("CodeBuddy")])
    }

    #[cfg(target_os = "linux")]
    {
        let config = dirs::config_dir().ok_or("Cannot determine config dir")?;
        Ok(vec![config.join("CodeBuddy")])
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("CodeBuddy 仅支持 macOS、Windows 和 Linux".to_string())
    }
}

pub fn resolve_preferred_vscode_data_root() -> Result<PathBuf, String> {
    let candidates = vscode_data_root_candidates()?;
    for candidate in &candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }
    candidates
        .into_iter()
        .next()
        .ok_or_else(|| "No CodeBuddy data root candidates".to_string())
}

pub fn resolve_vscode_data_root_for_state_db() -> Result<PathBuf, String> {
    resolve_preferred_vscode_data_root()
}

pub fn resolve_vscode_data_root(user_data_dir: Option<&str>) -> Result<PathBuf, String> {
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = user_data_dir;
        return Err("CodeBuddy 仅支持 macOS、Windows 和 Linux".to_string());
    }

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        if let Some(dir) = user_data_dir {
            let trimmed = dir.trim();
            if !trimmed.is_empty() {
                return Ok(PathBuf::from(trimmed));
            }
        }
        resolve_preferred_vscode_data_root()
    }
}

pub fn vscode_state_db_path(data_root: &Path) -> PathBuf {
    data_root
        .join("User")
        .join("globalStorage")
        .join("state.vscdb")
}

#[cfg(target_os = "windows")]
pub fn vscode_local_state_path(data_root: &Path) -> PathBuf {
    data_root.join("Local State")
}
