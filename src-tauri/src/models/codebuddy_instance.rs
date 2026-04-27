use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InstanceLaunchMode {
    App,
    Cli,
}

impl Default for InstanceLaunchMode {
    fn default() -> Self {
        InstanceLaunchMode::App
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceProfile {
    pub id: String,
    pub name: String,
    pub user_data_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub extra_args: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bind_account_id: Option<String>,
    #[serde(default)]
    pub launch_mode: InstanceLaunchMode,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_launched_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefaultInstanceSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bind_account_id: Option<String>,
    #[serde(default)]
    pub extra_args: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub launch_mode: InstanceLaunchMode,
    #[serde(default)]
    pub follow_local_account: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_pid: Option<u32>,
}

impl Default for DefaultInstanceSettings {
    fn default() -> Self {
        Self {
            bind_account_id: None,
            extra_args: String::new(),
            working_dir: None,
            launch_mode: InstanceLaunchMode::App,
            follow_local_account: false,
            last_pid: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceStore {
    #[serde(default)]
    pub instances: Vec<InstanceProfile>,
    #[serde(default)]
    pub default_settings: DefaultInstanceSettings,
}

impl InstanceStore {
    pub fn new() -> Self {
        Self {
            instances: Vec::new(),
            default_settings: DefaultInstanceSettings::default(),
        }
    }
}

impl Default for InstanceStore {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceProfileView {
    pub id: String,
    pub name: String,
    pub user_data_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub extra_args: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bind_account_id: Option<String>,
    #[serde(default)]
    pub launch_mode: InstanceLaunchMode,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_launched_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_pid: Option<u32>,
    pub running: bool,
    pub initialized: bool,
    pub is_default: bool,
    pub follow_local_account: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceDefaults {
    pub root_dir: String,
    pub default_user_data_dir: String,
}

#[derive(Debug, Clone)]
pub struct CreateInstanceParams {
    pub name: String,
    pub user_data_dir: String,
    pub working_dir: Option<String>,
    pub extra_args: String,
    pub bind_account_id: Option<String>,
    pub copy_source_instance_id: Option<String>,
    pub init_mode: Option<String>,
}

impl InstanceProfileView {
    pub fn from_profile(
        profile: &InstanceProfile,
        running: bool,
        initialized: bool,
        is_default: bool,
        follow_local_account: bool,
    ) -> Self {
        Self {
            id: profile.id.clone(),
            name: profile.name.clone(),
            user_data_dir: profile.user_data_dir.clone(),
            working_dir: profile.working_dir.clone(),
            extra_args: profile.extra_args.clone(),
            bind_account_id: profile.bind_account_id.clone(),
            launch_mode: profile.launch_mode.clone(),
            created_at: profile.created_at,
            last_launched_at: profile.last_launched_at,
            last_pid: profile.last_pid,
            running,
            initialized,
            is_default,
            follow_local_account,
        }
    }
}

#[derive(Debug, Clone)]
pub struct UpdateInstanceParams {
    pub instance_id: String,
    pub name: Option<String>,
    pub working_dir: Option<String>,
    pub extra_args: Option<String>,
    pub bind_account_id: Option<Option<String>>,
}
