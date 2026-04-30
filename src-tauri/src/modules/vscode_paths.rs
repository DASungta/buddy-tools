use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

const APP_DATA_DIR: &str = ".buddy_tools";
const LEGACY_APP_DATA_DIR: &str = ".antigravity_tools";
const MIGRATION_LOCK_FILE: &str = ".migration.lock";
const MIGRATION_MARKER_DIR: &str = ".migration";
const MIGRATION_MARKER_FILE: &str = "antigravity-to-buddy-tools.json";
const MIGRATION_COPY_PATHS: &[&str] = &[
    "accounts",
    "accounts.json",
    "codebuddy_cn_accounts",
    "codebuddy_cn_accounts.json",
    "gui_config.json",
    "current_account.json",
    "storage.json",
    "token_stats.db",
    "security.db",
    "user_tokens.db",
    "proxy_logs.db",
];

static DATA_DIR_MIGRATION_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[cfg(test)]
static CURRENT_TEST_DATA_DIR: LazyLock<Mutex<Option<PathBuf>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Serialize)]
struct DataDirMigrationMarker {
    source: String,
    target: String,
    timestamp: String,
    app_version: String,
    copied_paths: Vec<String>,
}

pub fn get_data_dir() -> Result<PathBuf, String> {
    if let Some(data_dir) =
        env_data_dir("BUDDY_TOOLS_DATA_DIR").or_else(|| env_data_dir("ABV_DATA_DIR"))
    {
        ensure_data_dir(&data_dir, "failed_to_create_custom_data_dir")?;
        return Ok(data_dir);
    }

    #[cfg(test)]
    {
        let data_dir = test_data_dir();
        ensure_data_dir(&data_dir, "failed_to_create_test_data_dir")?;
        return Ok(data_dir);
    }

    #[cfg(not(test))]
    {
        let home = dirs::home_dir().ok_or("failed_to_get_home_dir")?;
        let data_dir = home.join(APP_DATA_DIR);
        let legacy_dir = home.join(LEGACY_APP_DATA_DIR);

        migrate_legacy_data_dir(&legacy_dir, &data_dir)?;
        ensure_data_dir(&data_dir, "failed_to_create_data_dir")?;

        Ok(data_dir)
    }
}

#[cfg(test)]
fn test_data_dir() -> PathBuf {
    let thread = std::thread::current();
    if let Some(name) = thread.name() {
        let dir = test_data_dir_for_name(name);
        if let Ok(mut current) = CURRENT_TEST_DATA_DIR.lock() {
            *current = Some(dir.clone());
        }
        return dir;
    }

    if let Some(test_name) = current_test_name_from_backtrace() {
        let dir = test_data_dir_for_name(&test_name);
        if let Ok(mut current) = CURRENT_TEST_DATA_DIR.lock() {
            *current = Some(dir.clone());
        }
        return dir;
    }

    if let Ok(current) = CURRENT_TEST_DATA_DIR.lock() {
        if let Some(dir) = current.clone() {
            return dir;
        }
    }

    std::env::temp_dir()
        .join("buddy_tools_tests")
        .join(sanitize_test_data_dir_name(&format!("{:?}", thread.id())))
}

#[cfg(test)]
fn test_data_dir_for_name(name: &str) -> PathBuf {
    std::env::temp_dir()
        .join("buddy_tools_tests")
        .join(sanitize_test_data_dir_name(name))
}

#[cfg(test)]
fn current_test_name_from_backtrace() -> Option<String> {
    std::backtrace::Backtrace::force_capture()
        .to_string()
        .lines()
        .find_map(extract_test_name_from_line)
}

#[cfg(test)]
fn extract_test_name_from_line(line: &str) -> Option<String> {
    let prefix = ["antigravity_tools_lib::", "antigravity_tools::"]
        .iter()
        .find(|prefix| line.contains(**prefix))?;
    let crate_index = line.find(prefix)?;
    let line = &line[crate_index + prefix.len()..];
    if !line.contains("::tests::") {
        return None;
    }
    let test_index = line
        .find("::test_")
        .or_else(|| line.find("::stress_test_"))?;
    let end = line[test_index + 2..]
        .find("::")
        .map(|relative_end| test_index + 2 + relative_end)
        .unwrap_or(line.len());
    let test_name = line[..end].trim();
    if test_name.is_empty() {
        None
    } else {
        Some(test_name.to_string())
    }
}

#[cfg(test)]
fn sanitize_test_data_dir_name(name: &str) -> String {
    name.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn env_data_dir(name: &str) -> Option<PathBuf> {
    std::env::var(name).ok().and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    })
}

fn ensure_data_dir(data_dir: &Path, error_key: &str) -> Result<(), String> {
    if !data_dir.exists() {
        fs::create_dir_all(data_dir).map_err(|e| format!("{}: {}", error_key, e))?;
    }
    Ok(())
}

fn migrate_legacy_data_dir(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Ok(());
    }

    let _guard = DATA_DIR_MIGRATION_LOCK
        .lock()
        .map_err(|_| "failed_to_lock_data_dir_migration".to_string())?;
    if !target_missing_or_empty(target)? {
        return Ok(());
    }

    fs::create_dir_all(target).map_err(|e| format!("failed_to_create_data_dir: {}", e))?;
    let lock_path = target.join(MIGRATION_LOCK_FILE);
    let lock_file = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_path)
    {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => return Ok(()),
        Err(err) => return Err(format!("failed_to_create_migration_lock: {}", err)),
    };

    let result = copy_legacy_data_paths(source, target)
        .and_then(|copied_paths| write_migration_marker(source, target, copied_paths));
    drop(lock_file);
    let _ = fs::remove_file(lock_path);
    result
}

fn target_missing_or_empty(target: &Path) -> Result<bool, String> {
    if !target.exists() {
        return Ok(true);
    }
    if !target.is_dir() {
        return Ok(false);
    }
    for entry in fs::read_dir(target).map_err(|e| format!("failed_to_read_data_dir: {}", e))? {
        entry.map_err(|e| format!("failed_to_read_data_dir_entry: {}", e))?;
        return Ok(false);
    }
    Ok(true)
}

fn copy_legacy_data_paths(source: &Path, target: &Path) -> Result<Vec<String>, String> {
    let mut copied_paths = Vec::new();
    for relative in MIGRATION_COPY_PATHS {
        let source_path = source.join(relative);
        if !source_path.exists() {
            continue;
        }
        copy_path(
            &source_path,
            &target.join(relative),
            Path::new(relative),
            &mut copied_paths,
        )?;
    }
    Ok(copied_paths)
}

fn copy_path(
    source: &Path,
    target: &Path,
    relative: &Path,
    copied_paths: &mut Vec<String>,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|e| format!("failed_to_read_legacy_data_metadata: {}", e))?;
    if metadata.is_dir() {
        fs::create_dir_all(target).map_err(|e| format!("failed_to_create_migration_dir: {}", e))?;
        for entry in
            fs::read_dir(source).map_err(|e| format!("failed_to_read_legacy_dir: {}", e))?
        {
            let entry = entry.map_err(|e| format!("failed_to_read_legacy_dir_entry: {}", e))?;
            let file_name = entry.file_name();
            let child_relative = relative.join(&file_name);
            copy_path(
                &entry.path(),
                &target.join(&file_name),
                &child_relative,
                copied_paths,
            )?;
        }
    } else if metadata.is_file() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed_to_create_migration_parent_dir: {}", e))?;
        }
        fs::copy(source, target).map_err(|e| format!("failed_to_copy_legacy_data: {}", e))?;
        copied_paths.push(relative.to_string_lossy().to_string());
    }
    Ok(())
}

fn write_migration_marker(
    source: &Path,
    target: &Path,
    copied_paths: Vec<String>,
) -> Result<(), String> {
    let marker_dir = target.join(MIGRATION_MARKER_DIR);
    fs::create_dir_all(&marker_dir)
        .map_err(|e| format!("failed_to_create_migration_marker_dir: {}", e))?;
    let marker = DataDirMigrationMarker {
        source: source.to_string_lossy().to_string(),
        target: target.to_string_lossy().to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        app_version: option_env!("CARGO_PKG_VERSION")
            .unwrap_or("unknown")
            .to_string(),
        copied_paths,
    };
    let content = serde_json::to_string_pretty(&marker)
        .map_err(|e| format!("failed_to_serialize_migration_marker: {}", e))?;
    fs::write(marker_dir.join(MIGRATION_MARKER_FILE), content)
        .map_err(|e| format!("failed_to_write_migration_marker: {}", e))
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
