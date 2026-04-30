[根目录](../CLAUDE.md) > **src**

# src — React 前端

## 模块职责

提供桌面应用的 GUI：账号管理、CodeBuddy CN 多账号 / 多实例、API 反代设置、Token 与 IP 安全监控、系统设置、调试控制台。所有 UI 通过 `services/*.ts` 调用后端 Tauri 命令（`@tauri-apps/api/core::invoke` 的薄封装 `utils/request.ts`）；非 Tauri 环境下也能跑 Vite 预览（开发期 `/api/` 反向代理到本地 `8045`）。

## 入口与启动

| 文件 | 作用 |
| --- | --- |
| `main.tsx` | ReactDOM.createRoot；Tauri 环境下启动时调用 `show_main_window` 解决黑屏 |
| `App.tsx` | 创建 `createBrowserRouter`，注入 `AdminAuthGuard` / `ThemeManager` / `DebugConsole` / `UpdateNotification`；启动 2s 后检查更新 |
| `i18n.ts` | i18next 初始化；从 `locales/*.json` 加载 12 种语言（en / zh / zh-TW / ja / tr / vi / pt / ru / ko / ar / es / my） |
| `App.css` | 全局样式 |

启动顺序：`main.tsx` → `<App />` → `useConfigStore.loadConfig()`（拉取后端 `load_config`）→ 同步语言/主题 → 渲染 `<RouterProvider>`。

## 路由

| Path | 组件 | 说明 |
| --- | --- | --- |
| `/`（index） | `pages/CodebuddyCnAccounts` | CodeBuddy CN 账号列表（默认首页） |
| `/api-proxy` | `pages/ApiProxy` | API 反代设置 / 状态 / 日志 |
| `/security` | `pages/Security` | IP 黑白名单 / 访问日志 / 用户 Token 管理 |
| `/settings` | `pages/Settings` | 通用 / 账号 / 反代 / 高级 / 调试 / 关于 |
| `/codebuddy-cn-accounts` | `pages/CodebuddyCnAccounts` | 同首页 |
| `/codebuddy-cn-instances` | `pages/CodebuddyCnInstances` | CodeBuddy CN 多实例（多窗口）管理 |

## 对外接口（前端调用后端的 Tauri 命令）

通过 `src/services/*.ts` 集中封装，主要分组：

- `configService.ts` → `load_config` / `save_config`
- `codebuddyCnService.ts` → `list/add/delete/refresh/update_codebuddy_cn_account*`、`*_oauth_login`、`checkin_codebuddy_cn`、多实例 (`*_codebuddy_cn_instance*`)
- `proxyService.ts`（推断） → `start/stop_proxy_service`、`get_proxy_status` / `_stats` / `_logs*` / `clear_proxy_logs`、`set_preferred_account`、`update_model_mapping`、`fetch_zai_models`
- `accountService.ts` → `list/add/delete/switch/reorder/export_accounts`、`fetch_account_quota` / `refresh_all_quotas`、设备指纹 (`bind/apply/restore_device_*`)
- `securityService.ts` → `get_ip_access_logs` / `_stats`、IP 黑白名单 CRUD、`get/update_security_config`
- `tokenStatsService.ts` → `get_token_stats_*`
- `userTokenService.ts` → `list/create/update/delete/renew_user_token`、`get_user_token_summary`
- `cloudflaredService.ts` → `cloudflared_check / install / start / stop / get_status`

## 状态管理 (zustand)

`src/stores/`：

- `useConfigStore` — 全局 `AppConfig` + 主题/语言
- `useCodebuddyCnAccountStore` — CN 账号列表、当前账号、加载态
- `useViewStore` — Mini View / Full View 切换
- `useDebugConsole` — 调试控制台开关与缓冲
- 其他：`useProxyStore`、`useAccountStore`、`useTokenStatsStore`（按页面需求）

## 关键依赖与配置

- `@tauri-apps/api`、`@tauri-apps/plugin-{dialog,fs,opener,autostart,process,updater}`：与桌面壳交互
- `antd ^5.24` + `@lobehub/ui ^4.33` + `daisyui ^5.5` + `tailwind-merge`：UI 体系
- `framer-motion ^11`：动效
- `recharts ^3.5`：Token/配额图表
- `@dnd-kit/*`：账号拖拽排序
- `i18next` + `react-i18next`：12 语言；`document.dir` 自动切换 RTL（阿语）
- `react-router-dom ^7`：HashRouter/BrowserRouter
- `zustand ^5`：扁平 store

构建/编译：
- `vite.config.ts` — 固定 1420 端口；忽略 `src-tauri/**`；`/api/` 反代到 `127.0.0.1:8045`
- `tsconfig.json` — 严格模式
- `tailwind.config.js` / `postcss.config.js` — 样式管线

## 数据模型 (TypeScript)

`src/types/`：

- `config.ts` — `AppConfig`、`ProxyConfig`、`UpstreamProxyConfig`、`ZaiConfig`、`CodeBuddyCnConfig`、`ThinkingBudgetConfig`、`GlobalSystemPromptConfig`、`StickySessionConfig`、`ProxyPoolConfig`
- `codebuddyCn.ts` — `CodebuddyCnAccount`、`CheckinStatusResponse`、`CheckinResponse`
- `account.ts` / `quota.ts` / `token.ts` / `proxy.ts`（推断）

字段需与后端 `src-tauri/src/models/` 保持 `serde` 兼容。

## 测试与质量

- 当前 `package.json` 未配置 `test` script。
- 无单元测试文件（`*.test.ts/tsx` 未发现）。
- 建议后续引入：Vitest + @testing-library/react + msw。
- ESLint / Prettier：仓库未提交配置，依赖 IDE 默认；TS 严格模式作为最低保障。

## 常见问题 (FAQ)

- **Q：启动后白屏？** A：见 `main.tsx`，已通过 `show_main_window` 命令缓解；若仍出现，关闭 `transparent: true`（`tauri.conf.json`）或检查 Linux Wayland 警告。
- **Q：调用 Tauri 命令失败 "command X not found"？** A：检查后端 `src-tauri/src/lib.rs::invoke_handler!` 是否注册。
- **Q：开发期 API 报跨域 / 404？** A：开发模式下通过 Vite proxy 把 `/api/` 走到 `8045`，确认后端 Headless / Desktop 已启动管理服务器。
- **Q：i18n 缺翻译？** A：在 `src/locales/<lang>.json` 添加同键路径，`i18next` 自动 fallback 到 en。

## 相关文件清单

- 入口：`main.tsx`、`App.tsx`、`i18n.ts`
- 页面：`pages/CodebuddyCnAccounts.tsx`、`pages/CodebuddyCnInstances.tsx`、`pages/ApiProxy.tsx`、`pages/Security.tsx`、`pages/Settings.tsx`
- 布局：`components/layout/Layout.tsx`、`components/layout/MiniView.tsx`、`components/navbar/Navbar.tsx`
- 守卫：`components/common/AdminAuthGuard.tsx`、`components/common/ThemeManager.tsx`、`components/common/ToastContainer.tsx`、`components/common/BackgroundTaskRunner.tsx`
- 调试：`components/debug/DebugConsole.tsx`
- 设置子组件：`components/settings/QuotaProtection.tsx`、`PinnedQuotaModels.tsx`、`ProxyPoolSettings.tsx`、`SmartWarmup.tsx`
- 服务封装：`services/configService.ts`、`services/codebuddyCnService.ts`，etc.
- 工具：`utils/request.ts`（Tauri / HTTP 双模式 invoke）、`utils/env.ts`（`isTauri()`）、`utils/codebuddyQuota.ts`、`utils/windowManager.ts`

## 变更记录 (Changelog)

- 2026-04-29：初始化前端模块 CLAUDE.md。

