[根目录](../CLAUDE.md) > **src-tauri**

# src-tauri — Rust 后端 / Tauri 桌面壳

## 模块职责

`src-tauri/` 是整个应用的 **Rust 后端 + 桌面容器**：

- 封装 Tauri v2 桌面壳（窗口、托盘、自动启动、单实例、自动更新、深链接 / single-instance OAuth 回调等）
- 启动并托管本地反代服务（Axum 0.7，默认监听 `127.0.0.1:8045`），将 CodeBuddy 会话翻译为 OpenAI / Anthropic / Gemini 兼容协议
- 维护账号池、配额、设备指纹、Token 统计、安全 IP 监控、CLI 同步等业务模块
- 提供 Headless / Docker 模式：以 `--headless` 启动时跳过 GUI，仅运行反代 + Web 管理台
- 通过 `#[tauri::command]` 把上述能力暴露给前端 React UI（约 130+ 命令）

## 入口与启动

| 文件 | 作用 |
| --- | --- |
| `src/main.rs` | 二进制入口（极简，调用 `lib::run()`） |
| `src/lib.rs` | 真正的启动逻辑：参数解析、日志/数据库初始化、Headless 分支、Tauri Builder 编排、`invoke_handler!` 命令注册、生命周期清理 |
| `Cargo.toml` | 依赖与 feature；`name = "antigravity_tools"`，`crate-type = ["staticlib", "cdylib", "rlib"]` |
| `tauri.conf.json` | 桌面壳元数据：1024×700、`titleBarStyle: Overlay`、`transparent: true`、`visible: false`（启动后由前端 `show_main_window` 主动显示，避免黑屏）；插件清单（updater / process / fs / dialog / opener / single-instance） |
| `capabilities/` | Tauri v2 权限清单；声明前端可调用的命令、事件、文件作用域等 |
| `Entitlements.plist` | macOS 权限（沙盒/网络/事件） |
| `icons/` | 多尺寸应用图标 |
| `build.rs` | 调用 `tauri_build::build()` |

启动序列（GUI 模式）：

1. `main.rs` → `lib::run()`
2. macOS 提升 `RLIMIT_NOFILE` 到 4096；Linux 检测 Wayland，必要时回落到 X11 GTK backend
3. `logger::init_logger()` → `tracing` + `tracing-appender` 写文件 + 桥接到前端 Debug Console
4. 初始化 SQLite：`token_stats::init_db()` / `security_db::init_db()` / `user_token_db::init_db()`
5. 注册 Tauri 插件：`dialog`、`fs`、`opener`、`autostart`、`updater`、`process`、`window-state`、`single-instance`
6. `setup` 钩子里：`log_bridge::init_log_bridge` → 创建托盘（条件） → 异步加载 `gui_config.json` → 启动 Admin Server (port 8045) → 若 `auto_start = true` 则启动反代转发
7. `on_window_event` 拦截 `CloseRequested` → 隐藏到托盘
8. `RunEvent::Exit` → `token_manager.graceful_shutdown(2s)` 清理后台任务

Headless 模式分支（`--headless` 参数）：

- 强制 `auth_mode = AllExceptHealth`（保护 Web UI）
- 通过环境变量 `ABV_API_KEY` / `ABV_WEB_PASSWORD` / `ABV_AUTH_MODE` / `ABV_BIND_LOCAL_ONLY` 注入凭据
- 仅启动 `internal_start_proxy_service`，无托盘、无窗口；`tokio::signal::ctrl_c()` 等待退出

## 对外接口

### 1. Tauri Commands（前端 invoke 调用）

在 `lib.rs::run()` 的 `tauri::generate_handler![...]` 中注册，按业务分组：

- **账号管理**：`list_accounts` / `add_account` / `delete_account[s]` / `reorder_accounts` / `switch_account` / `export_accounts` / `get_current_account`
- **设备指纹**：`get_device_profiles` / `bind_device_profile[_with_profile]` / `apply_device_profile` / `restore_original_device` / `list_device_versions` / `restore_device_version` / `delete_device_version` / `open_device_folder` / `preview_generate_profile`
- **配额**：`fetch_account_quota` / `refresh_all_quotas` / `warm_up_all_accounts` / `warm_up_account`
- **配置**：`load_config` / `save_config`（保存时热更新运行中的反代）
- **OAuth**：`prepare_oauth_url` / `start_oauth_login` / `complete_oauth_login` / `cancel_oauth_login` / `submit_oauth_code` / `list/get/set_active_oauth_client`
- **导入迁移**：`import_v1_accounts` / `import_from_db` / `import_custom_db` / `sync_account_from_db`
- **窗口/系统**：`show_main_window` / `set_window_theme` / `open_data_folder` / `get_data_dir_path` / `save/read_text_file`（含 `validate_path` 安全黑名单）
- **更新**：`check_for_updates` / `should_check_updates` / `update_last_check_time` / `check_homebrew_installation` / `brew_upgrade_cask` / `get/save_update_settings`
- **反代控制**：`commands::proxy::*`（30+ 子命令）— 启停、状态、日志、统计、模型映射、调度、限流、固定账号、API Key 生成、健康检查、`fetch_zai_models`
- **CLI 同步**：`proxy::cli_sync::*` / `proxy::opencode_sync::*` / `proxy::droid_sync::*` — 同步 CLI 配置
- **代理池**：`commands::proxy_pool::bind/unbind/get_account_proxy_*`
- **Cloudflared**：`commands::cloudflared::cloudflared_check / install / start / stop / get_status`
- **自动启动**：`commands::autostart::toggle_auto_launch` / `is_auto_launch_enabled`
- **Token 统计**：`commands::get_token_stats_*`（hourly / daily / weekly / by_account / by_model / summary / *_trend_*）
- **安全/IP**：`commands::security::get_ip_access_logs/_stats/_token_stats`、IP 黑/白名单 CRUD、`get/update_security_config`
- **User Token**：`commands::user_token::list/create/update/delete/renew_user_token` / `get_user_token_summary`
- **CodeBuddy CN 账号**：`commands::codebuddy_cn::*`（list / add_with_token / delete[s] / refresh / refresh_all / update_tags / set_current / oauth / checkin / 导入导出）
- **CodeBuddy CN 多实例**：`commands::codebuddy_cn_instance::*`（list / create / update / delete / start / focus / stop / inject_token / get_pid / defaults）
- **HTTP API 设置**：`get/save_http_api_settings`
- **调试控制台**：`modules::log_bridge::enable/disable_debug_console` / `is_*_enabled` / `get/clear_debug_console_logs`

### 2. Axum HTTP API（外部应用接入）

绑定地址 `127.0.0.1:8045`（Headless 默认 0.0.0.0；`ABV_BIND_LOCAL_ONLY=1` 强制本地）。提供：

- OpenAI 兼容：`/v1/chat/completions`、`/v1/models`、`/v1/embeddings`
- Anthropic 兼容：`/v1/messages`、`/v1/messages/count_tokens`
- Gemini 兼容：`/v1beta/models/...`
- MCP 服务（z.ai Vision、Built-in tools）
- Web 管理后台（账号 CRUD / 状态 / 日志 / 设置 / IP 黑白名单），需要 `auth_mode` 鉴权

详见 `src/proxy/CLAUDE.md`。

## 关键依赖与配置

来自 `Cargo.toml`：

- **Tauri v2.2.5**：`tray-icon` + `image-png` features，桌面壳与 IPC
- **HTTP**：`axum 0.7`（含 multipart）+ `hyper 1` + `tower-http`（cors/trace/fs）+ `eventsource-stream`（SSE 解析）
- **HTTP 客户端**：`reqwest 0.12`（rustls-tls + socks + stream + blocking）+ `rquest 5.1` + `rquest-util`（带浏览器指纹的反爬版本）
- **存储**：`rusqlite 0.32` (bundled, 无外部 sqlite 依赖)
- **加密**：`aes-gcm 0.10`、`aes`、`cbc`、`pbkdf2 0.12`、`sha2`、`sha1`、`md5`、`base64`、`machine-uid`（用于 refresh_token 加密 + 设备绑定）
- **异步**：`tokio` (full) + `tokio-stream` + `tokio-util` + `futures` + `async-stream` + `pin-project`
- **并发**：`dashmap 6.1` + `parking_lot 0.12` + `once_cell`
- **日志**：`tracing` + `tracing-subscriber` (env-filter, time) + `tracing-appender` + `tracing-log`
- **错误**：`thiserror 2.0` + `anyhow 1.0`
- **平台特性**：
  - Linux：`gtk 0.18`
  - Windows：`windows 0.58` (Foundation, Cryptography)
- **其他**：`uuid`、`chrono`、`dirs`、`sysinfo`、`url`、`regex`、`bytes`、`rand`、`image`、`plist`、`toml` / `toml_edit`

### Tauri 插件

`tauri-plugin-{dialog, fs, opener, autostart, updater, process, single-instance, window-state}` —— 在 `lib.rs::run()` 中初始化，前端通过 `@tauri-apps/plugin-*` 调用。

## 数据模型

`src/models/`：

- `account.rs` → `Account` / `AccountIndex` / `AccountSummary` / `DeviceProfile` / `DeviceProfileVersion` / `AccountExportItem` / `AccountExportResponse`
- `token.rs` → `TokenData`（access / refresh / expires / scope）
- `quota.rs` → `QuotaData`（订阅 tier、模型剩余配额数组、`is_forbidden`）
- `config.rs` → `AppConfig` / `QuotaProtectionConfig` / `CircuitBreakerConfig` 等顶层配置；与前端 `src/types/config.ts` `serde` 兼容
- `codebuddy.rs` → CodeBuddy CN 账号模型
- `codebuddy_instance.rs` → 多实例配置 `InstanceProfile` / `InstanceLaunchMode` / `DefaultInstanceSettings` / `CreateInstanceParams` / `UpdateInstanceParams`

序列化全部使用 `serde`，新增字段建议加 `#[serde(default)]` 以保持向后兼容。

## 子模块导航

| 路径 | 一句话职责 |
| --- | --- |
| `src/commands/` | Tauri `#[command]` 暴露层（前端 IPC 入口） |
| `src/modules/` | 业务领域模块（账号、配额、OAuth、设备指纹、托盘、调度、缓存、日志桥接、安全 DB） |
| `src/proxy/` | Axum 反代核心（路由、协议转换、调度、限流、上游 HTTP、监控） |
| `src/models/` | 共享数据模型（serde 互通前端） |
| `src/utils/` | 通用工具（命令封装、原子写、格式化等） |
| `src/error.rs` | `AppError` / `AppResult` 统一错误 |
| `src/constants.rs` | 全局常量 |

## 测试与质量

- **单元/集成测试**：`src/proxy/tests/` 包含 7 个测试模块（`comprehensive`、`security_ip_tests`、`security_integration_tests`、`quota_protection`、`ultra_priority_tests`、`retry_strategy_tests`、`rate_limit_404_tests`），通过 `#[cfg(test)] pub mod tests;` 启用。
- **运行**：`cd src-tauri && cargo test --lib`；可加 `RUST_LOG=debug` 查看 trace。
- **手动验证**：Headless 模式 + `curl http://127.0.0.1:8045/v1/chat/completions ...`。
- **静态检查**：建议 `cargo clippy --all-targets`、`cargo fmt -- --check`，CI 暂未发现 `.github/workflows`。
- **编码规范**：`edition = 2021`；错误统一返回 `Result<T, String>`（前端友好）或 `crate::error::AppResult<T>`；外部网络错误经 `AppError` 转换。

## 常见问题 (FAQ)

- **Q：新增 Tauri 命令前端调不到？**  A：必须在 `lib.rs::run()` 的 `invoke_handler![...]` 列表里追加，否则即便函数标了 `#[tauri::command]` 也无效。
- **Q：Linux 启动后窗口冻结/黑屏？**  A：见 `lib.rs::configure_linux_gdk_backend`，Wayland + X11 共存时会强制 `GDK_BACKEND=x11`；可设 `ANTIGRAVITY_FORCE_WAYLAND=1` 覆盖。透明窗口在 WebKitGTK 不稳定，已通过 GTK 视觉降级处理。
- **Q：托盘崩溃 / 不显示？**  A：Wayland 默认禁用托盘，`ANTIGRAVITY_FORCE_TRAY=1` 强开；或 `ANTIGRAVITY_DISABLE_TRAY=1` 关闭。
- **Q：Headless 模式如何注入凭据？**  A：环境变量 `ABV_API_KEY` / `ABV_WEB_PASSWORD` / `ABV_AUTH_MODE`（off / strict / all_except_health / auto）/ `ABV_BIND_LOCAL_ONLY`；首次启动会写入 `gui_config.json`。
- **Q：账号文件怎么落盘？**  A：`modules::app_paths::get_data_dir()` → 各平台 Application Support 目录，`accounts/<id>.json`、`accounts/index.json`、`gui_config.json`、`security.db`、`token_stats.db`、`user_token.db`，写入使用 `modules::atomic_write`。
- **Q：refresh_token 是否加密？**  A：是，`aes-gcm` + `pbkdf2`（结合 `machine-uid`），细节在 `modules::account` / `modules::codebuddy_cn_account`。

## 相关文件清单

- 入口：`src/main.rs`、`src/lib.rs`
- Tauri 配置：`tauri.conf.json`、`Cargo.toml`、`build.rs`、`Entitlements.plist`、`capabilities/*.json`
- 子模块文档：
  - [src/commands/CLAUDE.md](./src/commands/CLAUDE.md)
  - [src/modules/CLAUDE.md](./src/modules/CLAUDE.md)
  - [src/proxy/CLAUDE.md](./src/proxy/CLAUDE.md)
- 共享模型：`src/models/{account,token,quota,config,codebuddy,codebuddy_instance}.rs`
- 错误：`src/error.rs`
- 常量：`src/constants.rs`

## 变更记录 (Changelog)

- 2026-04-29：初始化 src-tauri 模块 CLAUDE.md（基于 v4.1.32 全仓扫描）。
