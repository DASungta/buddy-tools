[根目录](../../../CLAUDE.md) > [src-tauri](../../CLAUDE.md) > [src](../) > **commands**

# commands — Tauri 命令暴露层

## 模块职责

`commands/` 是后端 → 前端的唯一 IPC 入口。所有 `#[tauri::command]` 函数都集中在此目录，负责：

- 把 `modules/` 中的领域服务包装成可由 React 通过 `@tauri-apps/api/core::invoke` 调用的接口
- 接管命令所需的 Tauri 参数（`AppHandle`、`Window`、`State<T>`），转交给底层模块
- 触发副作用：刷新托盘、广播事件 (`emit("config://updated")` / `accounts://refreshed`) 、重载反代账号池
- 在涉及账号操作后**统一调用** `crate::commands::proxy::reload_proxy_accounts`，保持 GUI / 反代 / 托盘三方状态一致

> 关键：**新增命令必须同时在 `src-tauri/src/lib.rs::run()` 的 `tauri::generate_handler![...]` 列表中注册**，否则前端 `invoke('xxx')` 会报 `command not found`。

## 入口与组织

```
commands/
├── mod.rs                     根命令文件（账号、设备指纹、配额、配置、OAuth、导入、文件、Token 统计…）
├── proxy.rs                   反代服务控制（启停 / 状态 / 日志 / 统计 / 调度 / API Key / 模型映射 …）
├── proxy_pool.rs              代理池绑定（账号 ↔ 出站代理）
├── autostart.rs               自动启动（基于 tauri-plugin-autostart）
├── cloudflared.rs             Cloudflared 隧道安装与启停
├── security.rs                IP 监控、黑/白名单、安全配置
├── user_token.rs              User Token CRUD / 续期 / 摘要 / IP 绑定
├── codebuddy_cn.rs            CodeBuddy CN 单账号管理 + OAuth + Checkin
└── codebuddy_cn_instance.rs   CodeBuddy CN 多实例（多窗口 / 不同设备指纹）
```

`mod.rs` 同时把子模块 `pub mod` 出来供 `lib.rs` 访问。

## 对外接口（按子模块）

### `mod.rs`（无前缀，`commands::xxx`）

- 账号：`list_accounts` / `add_account` / `delete_account` / `delete_accounts` / `reorder_accounts` / `switch_account` / `export_accounts` / `get_current_account` / `update_account_label` / `toggle_proxy_status`
- 配额：`fetch_account_quota` / `refresh_all_quotas`（含内部 `refresh_all_quotas_internal`）/ `warm_up_all_accounts` / `warm_up_account`
- 设备指纹：`get_device_profiles` / `bind_device_profile[_with_profile]` / `preview_generate_profile` / `apply_device_profile` / `restore_original_device` / `list_device_versions` / `restore_device_version` / `delete_device_version` / `open_device_folder`
- 配置：`load_config` / `save_config`（保存后调用 `axum_server.update_*` 系列方法热更新）
- OAuth：`prepare_oauth_url` / `start_oauth_login` / `complete_oauth_login` / `cancel_oauth_login` / `submit_oauth_code` / `list_oauth_clients` / `get/set_active_oauth_client`
- 导入：`import_v1_accounts` / `import_from_db` / `import_custom_db` / `sync_account_from_db`
- 文件：`save_text_file` / `read_text_file`（含 `validate_path()`，黑名单 `/etc/`、`/proc/`、`C:\Windows` 等）
- 缓存：`clear_log_cache` / `clear_antigravity_cache` / `get_antigravity_cache_paths`
- 系统：`open_data_folder` / `get_data_dir_path` / `show_main_window` / `set_window_theme` / `get_antigravity_path` / `get_antigravity_args`
- 更新：`check_for_updates` / `should_check_updates` / `update_last_check_time` / `check_homebrew_installation` / `brew_upgrade_cask` / `get/save_update_settings`
- HTTP API：`get/save_http_api_settings`
- Token 统计：`get_token_stats_{hourly,daily,weekly,by_account,summary,by_model,model_trend_hourly/daily,account_trend_hourly/daily}`

### `proxy.rs`（`commands::proxy::*`）

- `start_proxy_service` / `stop_proxy_service` / `get_proxy_status` / `check_proxy_health`
- `get_proxy_stats` / `get_proxy_logs[_paginated|_count|_filtered|_count_filtered]` / `get_proxy_log_detail` / `export_proxy_logs[_json]` / `clear_proxy_logs` / `set_proxy_monitor_enabled`
- `generate_api_key` / `reload_proxy_accounts` / `update_model_mapping`
- 调度：`get_proxy_scheduling_config` / `update_proxy_scheduling_config` / `clear_proxy_session_bindings` / `set_preferred_account` / `get_preferred_account`
- 限流：`clear_proxy_rate_limit` / `clear_all_proxy_rate_limits`
- z.ai：`fetch_zai_models`、`get_proxy_pool_config`
- 内部 helper：`internal_start_proxy_service` / `ensure_admin_server`（在 `lib.rs::setup` 中被调用）

### `proxy_pool.rs`

- `bind_account_proxy` / `unbind_account_proxy` / `get_account_proxy_binding` / `get_all_account_bindings`

### `security.rs`

- IP 访问日志：`get_ip_access_logs` / `get_ip_stats` / `get_ip_token_stats` / `clear_ip_access_logs`
- IP 黑白名单 CRUD：`get_ip_{black|white}list` / `add_ip_to_*` / `remove_ip_from_*` / `clear_ip_*list` / `check_ip_in_*list`
- 安全配置：`get_security_config` / `update_security_config`

### `user_token.rs`

- `list_user_tokens` / `create_user_token` / `update_user_token` / `delete_user_token` / `renew_user_token` / `get_token_ip_bindings` / `get_user_token_summary`

### `codebuddy_cn.rs`

- 列表/CRUD：`list_codebuddy_cn_accounts` / `add_codebuddy_cn_account_with_token` / `delete_codebuddy_cn_account[s]` / `update_codebuddy_cn_account_tags`
- 刷新：`refresh_codebuddy_cn_token` / `refresh_all_codebuddy_cn_tokens`
- 索引：`get_codebuddy_cn_accounts_index_path` / `set_current_codebuddy_cn_account`
- 导入导出：`import_codebuddy_cn_from_json` / `export_codebuddy_cn_accounts`
- OAuth：`start/complete/cancel_codebuddy_cn_oauth_login`
- 签到：`get_checkin_status_codebuddy_cn` / `checkin_codebuddy_cn`

### `codebuddy_cn_instance.rs`

- 列表：`list_codebuddy_cn_instances` / `get_codebuddy_cn_instance_defaults` / `get_codebuddy_cn_default_settings`
- CRUD：`create_codebuddy_cn_instance` / `update_codebuddy_cn_instance` / `delete_codebuddy_cn_instance`
- 进程：`start_codebuddy_cn_instance` / `focus_codebuddy_cn_instance` / `stop_codebuddy_cn_instance` / `get_codebuddy_cn_instance_pid`
- 注入：`inject_token_for_codebuddy_cn_instance`（向 IDE/CLI 写入运行时 token）

### `autostart.rs`、`cloudflared.rs`

- 自动启动：`toggle_auto_launch` / `is_auto_launch_enabled`
- Cloudflared：`cloudflared_check` / `cloudflared_install` / `cloudflared_start` / `cloudflared_stop` / `cloudflared_get_status`

## 关键依赖与配置

- 命令普遍接收 `tauri::AppHandle` 和 `tauri::State<'_, ProxyServiceState | CloudflaredState>` 以获取共享状态。
- `ProxyServiceState` (`commands::proxy.rs`) 持有 `Arc<RwLock<Option<ProxyServiceInstance>>>`，用 `read().await` 进行只读热更新；销毁时 `RunEvent::Exit` 调用 `token_manager.graceful_shutdown(2s)`。
- `CloudflaredState` (`commands::cloudflared.rs`) 跟踪隧道子进程句柄。
- 错误风格：用户面 API 多返回 `Result<T, String>`；内部基础设施用 `crate::error::AppResult<T>`。
- 副作用约定：
  - 账号变更后调用 `reload_proxy_accounts` + `tray::update_tray_menus`
  - 配置变更后 `app.emit("config://updated")` 并执行 `axum_server.update_{mapping,proxy,security,zai,codebuddy_cn,experimental,debug_logging,user_agent,proxy_pool}`
  - 全局刷新成功后 `app.emit("accounts://refreshed", ())`

## 数据模型

直接复用 `crate::models`（`Account` / `AppConfig` / `QuotaData` / `RefreshStats` / `DeviceProfile` / `AccountExportResponse`）以及 `modules::*` 内部结构（如 `update_checker::UpdateInfo` / `UpdateSettings`、`http_api::HttpApiSettings`、`token_stats::*`、`security::*`）。

## 测试与质量

- 命令层基本无独立单元测试；逻辑放在 `modules/` 与 `proxy/` 中分别覆盖。
- 建议补充：以 `tauri::test::mock_app()` 为基础写命令冒烟测试；至少覆盖 `validate_path`、`save_config` 热更新分支、`switch_account` 联动 token_manager。

## 常见问题 (FAQ)

- **新命令前端调不到** → 检查 `lib.rs::run()` 的 `invoke_handler![]`。
- **跨命令同步状态丢失** → 看是否漏调 `reload_proxy_accounts` 或 `tray::update_tray_menus`。
- **保存配置后反代未生效** → 必须经 `save_config`（自动 hot-reload），不要直接落盘 `gui_config.json`。
- **路径写入被拒** → `validate_path` 阻止 `..` 和系统目录；如确需读写，请用 `app_paths::get_data_dir()` 派生路径。

## 相关文件清单

- `mod.rs`（约 1000+ 行的总命令文件）
- `proxy.rs`、`proxy_pool.rs`
- `security.rs`、`user_token.rs`
- `codebuddy_cn.rs`、`codebuddy_cn_instance.rs`
- `cloudflared.rs`、`autostart.rs`
- 上层注册：`../lib.rs::run()` 中的 `invoke_handler!` 列表

## 变更记录 (Changelog)

- 2026-04-29：初始化 commands 模块 CLAUDE.md（基于 v4.1.32 全仓扫描）。
