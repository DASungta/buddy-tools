use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use chrono::Utc;
use uuid::Uuid;

use crate::models::{
    CreateInstanceParams, DefaultInstanceSettings, InstanceDefaults, InstanceLaunchMode,
    InstanceProfile, InstanceStore, UpdateInstanceParams,
};
use crate::modules;

static CODEBUDDY_CN_INSTANCE_STORE_LOCK: LazyLock<Mutex<()>> =
    LazyLock::new(|| Mutex::new(()));

const CODEBUDDY_CN_INSTANCES_FILE: &str = "codebuddy_cn_instances.json";

fn instances_path() -> Result<PathBuf, String> {
    let data_dir = modules::app_paths::get_data_dir()?;
    Ok(data_dir.join(CODEBUDDY_CN_INSTANCES_FILE))
}

pub fn load_instance_store() -> Result<InstanceStore, String> {
    let path = instances_path()?;
    if !path.exists() {
        return Ok(InstanceStore::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取 CN 实例配置失败: {}", e))?;
    if content.trim().is_empty() {
        return Ok(InstanceStore::new());
    }
    serde_json::from_str(&content)
        .map_err(|e| format!("解析 CN 实例配置失败 ({}): {}", CODEBUDDY_CN_INSTANCES_FILE, e))
}

pub fn save_instance_store(store: &InstanceStore) -> Result<(), String> {
    let path = instances_path()?;
    let data_dir = path.parent().ok_or("无法获取 CN 实例配置目录")?;
    let temp_path = data_dir.join(format!("{}.tmp", CODEBUDDY_CN_INSTANCES_FILE));
    let content =
        serde_json::to_string_pretty(store).map_err(|e| format!("序列化 CN 实例配置失败: {}", e))?;
    fs::write(&temp_path, content).map_err(|e| format!("写入 CN 实例配置失败: {}", e))?;
    fs::rename(&temp_path, &path).map_err(|e| format!("保存 CN 实例配置失败: {}", e))?;
    Ok(())
}

fn normalize_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("实例名称不能为空".to_string());
    }
    Ok(trimmed.to_string())
}

fn display_path(path: &Path) -> String {
    if path.is_absolute() {
        return path.to_string_lossy().to_string();
    }
    match std::env::current_dir() {
        Ok(cwd) => cwd.join(path).to_string_lossy().to_string(),
        Err(_) => path.to_string_lossy().to_string(),
    }
}

fn ensure_unique(
    store: &InstanceStore,
    name: &str,
    user_data_dir: &str,
    current_id: Option<&str>,
) -> Result<(), String> {
    let mut names = HashSet::new();
    let mut dirs = HashSet::new();
    for instance in &store.instances {
        if let Some(id) = current_id {
            if instance.id == id {
                continue;
            }
        }
        names.insert(instance.name.to_lowercase());
        dirs.insert(instance.user_data_dir.to_lowercase());
    }
    if names.contains(&name.to_lowercase()) {
        return Err("实例名称已存在".to_string());
    }
    if dirs.contains(&user_data_dir.to_lowercase()) {
        return Err("实例目录已存在".to_string());
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.exists() {
        return Err(format!("源目录不存在: {}", src.to_string_lossy()));
    }
    if dst.exists() {
        let mut has_entries = false;
        if let Ok(mut iter) = fs::read_dir(dst) {
            if iter.next().is_some() {
                has_entries = true;
            }
        }
        if has_entries {
            return Err("目标目录已存在且不为空".to_string());
        }
    }
    fs::create_dir_all(dst).map_err(|e| format!("创建目标目录失败: {}", e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("读取源目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|e| format!("获取文件类型失败: {}", e))?;
        if file_type.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else if file_type.is_file() {
            fs::copy(&path, &target).map_err(|e| format!("复制文件失败: {}", e))?;
        }
    }
    Ok(())
}

fn delete_instance_directory(dir_path: &Path) -> Result<(), String> {
    if !dir_path.exists() {
        return Ok(());
    }
    fs::remove_dir_all(dir_path).map_err(|e| format!("删除实例目录失败: {}", e))
}

pub fn get_default_codebuddy_cn_user_data_dir() -> Result<PathBuf, String> {
    if let Some(path) = modules::codebuddy_cn_account::get_default_codebuddy_cn_data_dir() {
        return Ok(path);
    }
    crate::modules::vscode_paths::resolve_preferred_vscode_data_root()
}

pub fn get_default_instances_root_dir() -> Result<PathBuf, String> {
    let data_dir = modules::app_paths::get_data_dir()?;
    Ok(data_dir.join("codebuddy_cn_instances"))
}

pub fn get_instance_defaults() -> Result<InstanceDefaults, String> {
    let root_dir = get_default_instances_root_dir()?;
    let default_user_data_dir = get_default_codebuddy_cn_user_data_dir()?;
    Ok(InstanceDefaults {
        root_dir: root_dir.to_string_lossy().to_string(),
        default_user_data_dir: default_user_data_dir.to_string_lossy().to_string(),
    })
}

pub fn load_default_settings() -> Result<DefaultInstanceSettings, String> {
    let store = load_instance_store()?;
    Ok(store.default_settings)
}

pub fn update_default_settings(
    bind_account_id: Option<Option<String>>,
    extra_args: Option<String>,
    follow_local_account: Option<bool>,
) -> Result<DefaultInstanceSettings, String> {
    let _lock = CODEBUDDY_CN_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取 CN 实例锁")?;
    let mut store = load_instance_store()?;
    let settings = &mut store.default_settings;

    if follow_local_account == Some(true) {
        settings.follow_local_account = false;
    }
    if let Some(bind) = bind_account_id {
        settings.bind_account_id = bind;
        settings.follow_local_account = false;
    }
    if let Some(args) = extra_args {
        settings.extra_args = args.trim().to_string();
    }

    let updated = settings.clone();
    save_instance_store(&store)?;
    Ok(updated)
}

pub fn create_instance(params: CreateInstanceParams) -> Result<InstanceProfile, String> {
    let _lock = CODEBUDDY_CN_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取 CN 实例锁")?;
    let mut store = load_instance_store()?;

    let name = normalize_name(&params.name)?;
    let user_data_dir = params.user_data_dir.trim().to_string();
    if user_data_dir.is_empty() {
        return Err("实例目录不能为空".to_string());
    }

    ensure_unique(&store, &name, &user_data_dir, None)?;

    let user_dir_path = PathBuf::from(&user_data_dir);
    let init_mode = params
        .init_mode
        .as_deref()
        .unwrap_or("copy")
        .to_ascii_lowercase();
    let create_empty = init_mode == "empty";
    let use_existing_dir = init_mode == "existingdir" || init_mode == "existing_dir";

    if use_existing_dir {
        if !user_dir_path.exists() {
            return Err(format!("所选目录不存在: {}", display_path(&user_dir_path)));
        }
        if !user_dir_path.is_dir() {
            return Err("所选路径不是目录".to_string());
        }
    } else if create_empty {
        if user_dir_path.exists() {
            let mut has_entries = false;
            if let Ok(mut iter) = fs::read_dir(&user_dir_path) {
                if iter.next().is_some() {
                    has_entries = true;
                }
            }
            if has_entries {
                return Err(format!(
                    "空白实例需要目标目录为空: {}",
                    display_path(&user_dir_path)
                ));
            }
        }
        fs::create_dir_all(&user_dir_path).map_err(|e| format!("创建实例目录失败: {}", e))?;
    } else {
        let source_dir = match params.copy_source_instance_id.as_deref() {
            Some("__default__") | None => get_default_codebuddy_cn_user_data_dir()?,
            Some(source_id) => {
                let source_instance = store
                    .instances
                    .iter()
                    .find(|item| item.id == source_id)
                    .ok_or("复制来源实例不存在")?;
                PathBuf::from(&source_instance.user_data_dir)
            }
        };

        if user_dir_path.exists() {
            let mut has_entries = false;
            if let Ok(mut iter) = fs::read_dir(&user_dir_path) {
                if iter.next().is_some() {
                    has_entries = true;
                }
            }
            if has_entries {
                return Err(format!(
                    "复制来源实例需要目标目录为空: {}",
                    display_path(&user_dir_path)
                ));
            }
        }

        if !source_dir.exists() {
            return Err("未找到复制来源目录，请先确保来源实例已初始化".to_string());
        }

        copy_dir_recursive(&source_dir, &user_dir_path)?;
    }

    let instance = InstanceProfile {
        id: Uuid::new_v4().to_string(),
        name,
        user_data_dir,
        working_dir: params.working_dir,
        extra_args: params.extra_args.trim().to_string(),
        bind_account_id: if create_empty {
            None
        } else {
            params.bind_account_id
        },
        launch_mode: InstanceLaunchMode::App,
        created_at: Utc::now().timestamp_millis(),
        last_launched_at: None,
        last_pid: None,
    };

    store.instances.push(instance.clone());
    save_instance_store(&store)?;
    Ok(instance)
}

pub fn update_instance(params: UpdateInstanceParams) -> Result<InstanceProfile, String> {
    let _lock = CODEBUDDY_CN_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取 CN 实例锁")?;
    let mut store = load_instance_store()?;
    let index = store
        .instances
        .iter()
        .position(|i| i.id == params.instance_id)
        .ok_or("实例不存在")?;

    let current_id = store.instances[index].id.clone();
    let current_dir = store.instances[index].user_data_dir.clone();
    let next_name = params
        .name
        .as_ref()
        .map(|name| normalize_name(name))
        .transpose()?;

    if let Some(ref normalized) = next_name {
        ensure_unique(&store, normalized, &current_dir, Some(&current_id))?;
    }

    let instance = &mut store.instances[index];
    if let Some(normalized) = next_name {
        instance.name = normalized;
    }
    if let Some(ref extra_args) = params.extra_args {
        instance.extra_args = extra_args.trim().to_string();
    }
    if let Some(bind) = params.bind_account_id {
        instance.bind_account_id = bind;
    }

    let updated = instance.clone();
    save_instance_store(&store)?;
    Ok(updated)
}

pub fn delete_instance(instance_id: &str) -> Result<(), String> {
    let _lock = CODEBUDDY_CN_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取 CN 实例锁")?;
    let mut store = load_instance_store()?;
    let index = store
        .instances
        .iter()
        .position(|i| i.id == instance_id)
        .ok_or("实例不存在")?;
    let user_data_dir = store.instances[index].user_data_dir.clone();

    if !user_data_dir.trim().is_empty() {
        let dir_path = PathBuf::from(&user_data_dir);
        delete_instance_directory(&dir_path)?;
    }

    store.instances.remove(index);
    save_instance_store(&store)?;
    Ok(())
}

pub fn update_instance_after_start(
    instance_id: &str,
    pid: u32,
) -> Result<InstanceProfile, String> {
    let _lock = CODEBUDDY_CN_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取 CN 实例锁")?;
    let mut store = load_instance_store()?;
    let mut updated = None;
    for instance in &mut store.instances {
        if instance.id == instance_id {
            instance.last_launched_at = Some(Utc::now().timestamp_millis());
            instance.last_pid = Some(pid);
            updated = Some(instance.clone());
            break;
        }
    }
    let updated = updated.ok_or("实例不存在")?;
    save_instance_store(&store)?;
    Ok(updated)
}

pub fn update_instance_pid(
    instance_id: &str,
    pid: Option<u32>,
) -> Result<InstanceProfile, String> {
    let _lock = CODEBUDDY_CN_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取 CN 实例锁")?;
    let mut store = load_instance_store()?;
    let mut updated = None;
    for instance in &mut store.instances {
        if instance.id == instance_id {
            instance.last_pid = pid;
            updated = Some(instance.clone());
            break;
        }
    }
    let updated = updated.ok_or("实例不存在")?;
    save_instance_store(&store)?;
    Ok(updated)
}

pub fn update_default_pid(pid: Option<u32>) -> Result<DefaultInstanceSettings, String> {
    let _lock = CODEBUDDY_CN_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取 CN 实例锁")?;
    let mut store = load_instance_store()?;
    store.default_settings.last_pid = pid;
    let updated = store.default_settings.clone();
    save_instance_store(&store)?;
    Ok(updated)
}

pub fn clear_all_pids() -> Result<(), String> {
    let _lock = CODEBUDDY_CN_INSTANCE_STORE_LOCK
        .lock()
        .map_err(|_| "无法获取 CN 实例锁")?;
    let mut store = load_instance_store()?;
    store.default_settings.last_pid = None;
    for instance in &mut store.instances {
        instance.last_pid = None;
    }
    save_instance_store(&store)?;
    Ok(())
}

pub fn inject_token_for_instance(instance: &InstanceProfile) -> Result<(), String> {
    let account_id = instance
        .bind_account_id
        .as_deref()
        .ok_or("实例未绑定账号")?;
    let account = modules::codebuddy_cn_account::load_account(account_id)
        .ok_or_else(|| format!("绑定账号不存在: {}", account_id))?;
    let db_path = crate::modules::vscode_inject::state_db_path_for_user_data_dir(
        &PathBuf::from(&instance.user_data_dir),
    );
    crate::modules::vscode_inject::inject_codebuddy_cn_access_token(&db_path, &account.access_token)
}
