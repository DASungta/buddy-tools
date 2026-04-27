use crate::models::{
    CreateInstanceParams, DefaultInstanceSettings, InstanceDefaults, InstanceProfile,
    InstanceProfileView, InstanceStore, UpdateInstanceParams,
};
use crate::modules::codebuddy_cn_instance as instance_mod;
use crate::modules::process;

fn is_instance_running(profile: &InstanceProfile) -> bool {
    profile
        .last_pid
        .map(|p| process::is_pid_running(p))
        .unwrap_or(false)
}

fn is_instance_initialized(profile: &InstanceProfile) -> bool {
    let p = std::path::Path::new(&profile.user_data_dir);
    p.exists()
}

fn to_view(
    profile: &InstanceProfile,
    is_default: bool,
    follow_local_account: bool,
) -> InstanceProfileView {
    InstanceProfileView::from_profile(
        profile,
        is_instance_running(profile),
        is_instance_initialized(profile),
        is_default,
        follow_local_account,
    )
}

#[tauri::command]
pub async fn list_codebuddy_cn_instances() -> Result<Vec<InstanceProfileView>, String> {
    let store = instance_mod::load_instance_store()?;
    let settings = &store.default_settings;
    let views: Vec<InstanceProfileView> = store
        .instances
        .iter()
        .map(|p| to_view(p, false, settings.follow_local_account))
        .collect();
    Ok(views)
}

#[tauri::command]
pub async fn get_codebuddy_cn_instance_defaults() -> Result<InstanceDefaults, String> {
    instance_mod::get_instance_defaults()
}

#[tauri::command]
pub async fn get_codebuddy_cn_default_settings() -> Result<DefaultInstanceSettings, String> {
    instance_mod::load_default_settings()
}

#[tauri::command]
pub async fn create_codebuddy_cn_instance(
    name: String,
    user_data_dir: String,
    working_dir: Option<String>,
    extra_args: String,
    bind_account_id: Option<String>,
    copy_source_instance_id: Option<String>,
    init_mode: Option<String>,
) -> Result<InstanceProfileView, String> {
    let params = CreateInstanceParams {
        name,
        user_data_dir,
        working_dir,
        extra_args,
        bind_account_id,
        copy_source_instance_id,
        init_mode,
    };
    let profile = instance_mod::create_instance(params)?;
    let store = instance_mod::load_instance_store()?;
    Ok(to_view(
        &profile,
        false,
        store.default_settings.follow_local_account,
    ))
}

#[tauri::command]
pub async fn update_codebuddy_cn_instance(
    instance_id: String,
    name: Option<String>,
    working_dir: Option<String>,
    extra_args: Option<String>,
    bind_account_id: Option<Option<String>>,
) -> Result<InstanceProfileView, String> {
    let params = UpdateInstanceParams {
        instance_id,
        name,
        working_dir,
        extra_args,
        bind_account_id,
    };
    let profile = instance_mod::update_instance(params)?;
    let store = instance_mod::load_instance_store()?;
    Ok(to_view(
        &profile,
        false,
        store.default_settings.follow_local_account,
    ))
}

#[tauri::command]
pub async fn delete_codebuddy_cn_instance(instance_id: String) -> Result<(), String> {
    instance_mod::delete_instance(&instance_id)
}

#[tauri::command]
pub async fn start_codebuddy_cn_instance(instance_id: String) -> Result<u32, String> {
    let store = instance_mod::load_instance_store()?;
    let profile = store
        .instances
        .iter()
        .find(|p| p.id == instance_id)
        .ok_or_else(|| format!("实例 {} 不存在", instance_id))?
        .clone();

    let extra_args: Vec<String> = profile
        .extra_args
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();

    let pid = process::start_codebuddy_with_args_with_new_window(
        &profile.user_data_dir,
        &extra_args,
        true,
    )?;

    instance_mod::update_instance_after_start(&instance_id, pid)?;
    Ok(pid)
}

#[tauri::command]
pub async fn focus_codebuddy_cn_instance(instance_id: String) -> Result<u32, String> {
    let store = instance_mod::load_instance_store()?;
    let profile = store
        .instances
        .iter()
        .find(|p| p.id == instance_id)
        .ok_or_else(|| format!("实例 {} 不存在", instance_id))?
        .clone();

    let pid = profile.last_pid.unwrap_or(0);
    let resolved = process::resolve_codebuddy_pid(Some(pid), Some(&profile.user_data_dir))
        .or(if pid != 0 { Some(pid) } else { None })
        .ok_or_else(|| "实例未运行".to_string())?;

    process::focus_process_pid(resolved)
}

#[tauri::command]
pub async fn stop_codebuddy_cn_instance(instance_id: String) -> Result<(), String> {
    let store = instance_mod::load_instance_store()?;
    let profile = store
        .instances
        .iter()
        .find(|p| p.id == instance_id)
        .ok_or_else(|| format!("实例 {} 不存在", instance_id))?
        .clone();

    let pid = profile.last_pid.unwrap_or(0);
    if pid == 0 {
        return Ok(());
    }
    process::close_pid(pid, 10)?;
    instance_mod::update_instance_pid(&instance_id, None)?;
    Ok(())
}

#[tauri::command]
pub async fn get_codebuddy_cn_instance_pid(instance_id: String) -> Result<u32, String> {
    let store = instance_mod::load_instance_store()?;
    let profile = store
        .instances
        .iter()
        .find(|p| p.id == instance_id)
        .ok_or_else(|| format!("实例 {} 不存在", instance_id))?
        .clone();

    let last_pid = profile.last_pid.unwrap_or(0);
    let resolved =
        process::resolve_codebuddy_pid(Some(last_pid), Some(&profile.user_data_dir)).unwrap_or(0);
    Ok(resolved)
}

#[tauri::command]
pub async fn inject_token_for_codebuddy_cn_instance(instance_id: String) -> Result<(), String> {
    let store = instance_mod::load_instance_store()?;
    let profile = store
        .instances
        .iter()
        .find(|p| p.id == instance_id)
        .ok_or_else(|| format!("实例 {} 不存在", instance_id))?
        .clone();
    instance_mod::inject_token_for_instance(&profile)
}
