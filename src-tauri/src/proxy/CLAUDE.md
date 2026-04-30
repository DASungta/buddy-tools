[根目录](../../../CLAUDE.md) > [src-tauri](../../CLAUDE.md) > [src](../) > **proxy**

# proxy — 反代核心 (Axum HTTP 网关)

## 模块职责

`proxy/` 是 buddy-tools 的核心：把 CodeBuddy 账号会话以 **OpenAI / Anthropic / Gemini 兼容 API** 的形式暴露给本地（或局域网）AI 工具（Claude Code、Cherry Studio、Kilo Code、Cline、Continue 等）。

主要能力：

- **协议转换**（双向）：OpenAI ↔ CodeBuddy / Anthropic ↔ CodeBuddy / Gemini ↔ CodeBuddy；处理 streaming / tool use / vision / thinking_budget / system prompt
- **账号调度**：`TokenManager` 维护账号池，按健康分 / Tier (Ultra/Pro/Free) / 配额 / 限流 / 粘性会话选择；429 / 401 / 403 自动轮换 + 重试 + 熔断
- **限流与缓存**：每账号 + 每模型限流；签名缓存避免重复签名 / 重复鉴权
- **代理池**：每个账号可绑定独立的出站 HTTP / SOCKS 代理（防关联）
- **多上游 Provider**：除主流 CodeBuddy 外内置 z.ai (GLM)、CodeBuddy CN
- **安全中间件**：API Key / Web Password 鉴权（4 种 auth_mode）、IP 黑白名单、CORS
- **可观测**：请求日志（SQLite）、IP 访问日志、Token 用量统计、监控接口
- **管理后台**：内置 Web UI（账号 CRUD / 状态 / 设置 / 日志），与反代共用 Axum 端口 (8045)
- **CLI 同步**：把 buddy-tools 当前的反代地址 / API key 写入第三方 CLI 配置（Claude Code / OpenCode / Droid）

## 入口与启动

| 文件 | 作用 |
| --- | --- |
| `mod.rs` | 子模块声明 + 关键 re-export（`AxumServer` / `TokenManager` / `ProxyConfig` / `update_*_config` 全局函数） |
| `server.rs` | `AppState` 共享状态（持有 token_manager / 配置 / 监控 / 账号服务 / 上游代理 / 安全 / 集成层）；`AxumServer` 启动器；`trigger_account_reload` / `trigger_account_delete` 全局信号；管理后台 + 反代的统一 Router |
| `config.rs` | `ProxyConfig` / `ProxyAuthMode` (`Off` / `Strict` / `AllExceptHealth` / `Auto`) / `ProxyPoolConfig` / `ZaiConfig` / `ZaiDispatchMode` / `CodeBuddyConfig` / `CodeBuddyDispatchMode` / `ExperimentalConfig` / `DebugLoggingConfig`；`update_thinking_budget_config` / `update_global_system_prompt_config` / `update_image_thinking_mode` 全局函数 |
| `security.rs` | `ProxySecurityConfig`（auth_mode + black/whitelist 状态，热更新支持） |
| `token_manager.rs` | 账号池调度器：选择 token、Tier 优先级、限流 / 熔断 / 健康分计数、`graceful_shutdown` |
| `session_manager.rs` | 会话指纹（粘性会话：相同 session_id → 同一账号） |
| `proxy_pool.rs` | 出站代理池管理（按账号绑定） |
| `rate_limit.rs` | 限流跟踪（per-account / per-model 滑动窗口） |
| `signature_cache.rs` | CodeBuddy 签名缓存（避免每次重签） |
| `sticky_config.rs` | 粘性会话策略与开关 |
| `model_specs.rs` | 模型规格映射表（`v4.1.29` 引入；归一化复杂模型 ID 到 `family/spec`） |
| `project_resolver.rs` | CodeBuddy `project_id` 推断（mock 项目机制） |

## 子模块结构

```
proxy/
├── server.rs            主入口 + Router + AppState
├── config.rs            配置定义
├── security.rs          安全配置
├── token_manager.rs     账号调度
├── session_manager.rs   粘性会话
├── proxy_pool.rs        出站代理池
├── rate_limit.rs        限流
├── signature_cache.rs   签名缓存
├── sticky_config.rs     粘性配置
├── model_specs.rs       模型规格
├── project_resolver.rs  project_id 解析
├── debug_logger.rs      调试日志（按 token / 路径细粒度过滤）
├── monitor.rs           ProxyMonitor（请求统计 / 状态汇总）
├── audio.rs             音频转录预处理
├── common.rs            公共工具（响应构建、SSE 帧组装）
├── zai_vision_mcp.rs    z.ai Vision MCP server 状态
├── zai_vision_tools.rs  Vision MCP tools（图像/截图理解）
├── handlers/            HTTP endpoint 处理器
│   ├── claude.rs        /v1/messages、/v1/messages/count_tokens
│   ├── openai.rs        /v1/chat/completions、/v1/embeddings
│   ├── gemini.rs        /v1beta/models/...
│   ├── mcp.rs           MCP server endpoint
│   ├── audio.rs         /v1/audio/transcriptions
│   ├── warmup.rs        预热端点
│   └── common.rs        共享 helper
├── mappers/             协议转换器
│   ├── claude.rs        Anthropic Messages ↔ CodeBuddy
│   ├── openai.rs        OpenAI Chat ↔ CodeBuddy
│   ├── gemini.rs        Gemini ↔ CodeBuddy
│   ├── common_utils.rs  通用映射工具
│   ├── context_manager.rs       上下文裁剪
│   ├── error_classifier.rs      上游错误分类（429 / 401 / 403 / 5xx）
│   ├── estimation_calibrator.rs Token 估算校准
│   ├── model_limits.rs  模型上下文限制
│   ├── signature_store.rs       思维链签名存储
│   └── tool_result_compressor.rs 工具结果压缩
├── middleware/          Axum 中间件
│   ├── auth.rs          auth_middleware + admin_auth_middleware（API Key / Web Password）
│   ├── cors.rs          cors_layer
│   ├── logging.rs       请求/响应日志
│   ├── monitor.rs       monitor_middleware（统计计数）
│   ├── ip_filter.rs     ip_filter_middleware（黑白名单）
│   └── service_status.rs service_status_middleware（运行状态守卫）
├── upstream/            上游 HTTP 客户端
│   ├── client.rs        UpstreamClient（reqwest + rquest 双客户端，带重试/超时/SOCKS）
│   ├── retry.rs         重试策略（指数退避 + jitter）
│   └── models.rs        上游响应模型
├── providers/           额外上游 Provider
│   ├── codebuddy_cn.rs  CodeBuddy CN（腾讯 copilot）专用上游
│   └── zai_anthropic.rs z.ai 转 Anthropic 兼容
├── cli_sync.rs          Claude Code CLI 配置同步（command 接口）
├── opencode_sync.rs     OpenCode CLI 同步
├── droid_sync.rs        Droid (Factory) CLI 同步
└── tests/               集成 / 边界测试
    ├── comprehensive.rs
    ├── security_ip_tests.rs
    ├── security_integration_tests.rs
    ├── quota_protection.rs
    ├── ultra_priority_tests.rs
    ├── retry_strategy_tests.rs
    └── rate_limit_404_tests.rs
```

## 对外接口（HTTP API）

监听 `127.0.0.1:8045`（Headless `0.0.0.0`），路由由 `server.rs::AxumServer::start` 注册：

### 推理（OpenAI 兼容）

- `POST /v1/chat/completions` — chat/completions（支持 stream / tool_calls / vision / thinking）
- `POST /v1/embeddings` — embeddings
- `GET  /v1/models` — 模型列表（合并自 mapping + provider）

### 推理（Anthropic 兼容）

- `POST /v1/messages` — Anthropic Messages（含 tools / streaming / thinking）
- `POST /v1/messages/count_tokens` — token 计数

### 推理（Gemini 兼容）

- `POST /v1beta/models/{model}:generateContent`
- `POST /v1beta/models/{model}:streamGenerateContent`

### 音频

- `POST /v1/audio/transcriptions`

### MCP / Vision

- `POST /mcp/...` — Built-in z.ai Vision MCP（图像理解工具）

### 管理后台（`admin_auth_middleware` 保护）

- `GET /api/accounts` / `POST /api/accounts/...` — 账号 CRUD（与 Tauri 命令镜像）
- `GET /api/proxy/status` / `/stats` / `/logs?...` — 状态与日志
- `GET/POST /api/config` — 配置读写
- `GET/POST /api/security/*` — IP 黑白名单
- `GET /api/health` — 健康检查（不需要鉴权）
- 静态资源 `/admin/*` — Web UI 内嵌（`tower-http::services::ServeDir`）

### 鉴权模式 (`ProxyAuthMode`)

- `Off`：完全开放（仅本地建议）
- `Strict`：所有路径都要 API Key
- `AllExceptHealth`：除 `/api/health` 外都鉴权（Headless 默认强制）
- `Auto`：智能判断（推理路径 API Key、管理路径 Web Password）

## 关键依赖与配置

- **运行时**：`axum 0.7` + `tokio` + `tower 0.4` + `tower-http`（cors / trace / fs）+ `hyper 1`
- **HTTP 客户端**：`reqwest 0.12`（rustls-tls）+ `rquest 5.1`（带浏览器指纹反爬，用于 CodeBuddy / z.ai 等强校验上游）
- **流式**：`eventsource-stream`、`tokio-stream`、`async-stream`、`bytes`、`pin-project`
- **并发**：`dashmap`（账号池查找）、`parking_lot::RwLock`、`once_cell::sync::Lazy`
- **数据**：`serde_json`（preserve_order）、`base64`、`url`、`regex`、`rand`
- **配置入口**：`AppConfig.proxy: ProxyConfig` 由 `gui_config.json` 持久化；通过 `commands::save_config` → `axum_server.update_*` 系列 hot-reload，无需重启服务

## 数据模型

- `config::ProxyConfig`：端口、`api_key`、`admin_password`、`auth_mode`、`allow_lan_access`、`auto_start`、`upstream_proxy`、`zai`、`codebuddy_cn`、`thinking_budget`、`global_system_prompt`、`image_thinking_mode`、`proxy_pool`、`preferred_account_id`、`experimental`、`debug_logging`、`user_agent`、模型映射等
- `server::AppState`：运行时共享状态（见 `server.rs:91`）
- `token_manager::AccountToken`：账号选择候选（quota / tier / health / 限流状态）
- `monitor::ProxyMonitor`：原子计数 + 滑动窗口
- `model_specs::ModelSpec`：归一化后的 `(family, spec, provider)`
- 上游模型：`upstream::models::*`

## 测试与质量

- **集成测试**（`tests/`，`#[cfg(test)] pub mod tests;` 启用）：
  - `comprehensive.rs` — 端到端协议转换 + 流式（基础冒烟）
  - `security_ip_tests.rs` / `security_integration_tests.rs` — IP 黑白名单 + auth_mode 组合
  - `quota_protection.rs` — 高级模型保护降级（`protected_models`）
  - `ultra_priority_tests.rs` — Ultra Tier 优先调度
  - `retry_strategy_tests.rs` — 401 / 429 / 5xx 重试与熔断
  - `rate_limit_404_tests.rs` — 限流 + 404 错误处理
- **运行**：`cd src-tauri && cargo test --lib proxy::tests`
- **手动联调**：Headless + `curl -H "Authorization: Bearer sk-buddy" -X POST http://127.0.0.1:8045/v1/chat/completions -d '...'`
- **建议补充**：sticky_session 重连场景、proxy_pool failover、Gemini 流式工具调用、MCP 工具链端到端

## 常见问题 (FAQ)

- **Q：所有账号都被禁用？**  A：检查 `account.disabled` / `proxy_disabled` / `validation_blocked`；403 反爬会进入 `validation_blocked_until` 临时挂起。`token_manager.reload_account` 可强制刷新。
- **Q：流式响应卡住？**  A：升级上游客户端到带 `eventsource-stream`，留意 `experimental.disable_event_id` 等选项；查看 `debug_logging` 是否开启 SSE dump。
- **Q：每次都连同一账号？**  A：粘性会话生效（`sticky_config.enabled = true`）；前端可调 `clear_proxy_session_bindings` 命令重置。
- **Q：429 立刻熔断？**  A：调高 `circuit_breaker.failure_threshold`，或检查 `rate_limit.rs` 的窗口；429 会被 `error_classifier` 标记并按权重降权。
- **Q：客户端以 OpenAI 调用 Anthropic 模型？**  A：靠 `model mapping` + `model_specs` 自动重写；新增模型请同步 `update_model_mapping` 命令的入参。

## 相关文件清单

- 入口与状态：`mod.rs`、`server.rs`、`config.rs`、`security.rs`
- 调度核心：`token_manager.rs`、`session_manager.rs`、`rate_limit.rs`、`signature_cache.rs`、`sticky_config.rs`、`model_specs.rs`、`project_resolver.rs`、`monitor.rs`、`debug_logger.rs`、`audio.rs`、`common.rs`
- 上游：`upstream/{client,retry,models}.rs`、`providers/{codebuddy_cn,zai_anthropic}.rs`、`zai_vision_{mcp,tools}.rs`
- HTTP 层：`handlers/{claude,openai,gemini,mcp,audio,warmup,common}.rs`、`mappers/*.rs`、`middleware/*.rs`
- 代理池：`proxy_pool.rs`
- CLI 同步：`cli_sync.rs`、`opencode_sync.rs`、`droid_sync.rs`
- 测试：`tests/{comprehensive,security_ip_tests,security_integration_tests,quota_protection,ultra_priority_tests,retry_strategy_tests,rate_limit_404_tests}.rs`

## 变更记录 (Changelog)

- 2026-04-29：初始化 proxy 模块 CLAUDE.md（基于 v4.1.32 全仓扫描）。
