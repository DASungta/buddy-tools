# CodeBuddy 反代接入指南

本文档说明如何将 Antigravity Manager 配置为 CodeBuddy（腾讯 AI CLI）的本地反向代理，让 Claude Code 等 OpenAI 兼容客户端通过 CodeBuddy 账号发起请求。

## 环境要求

| 工具 | 版本 |
|------|------|
| Rust / Cargo | >= 1.75 |
| Node.js | >= 18 |
| npm | >= 9 |

安装 Rust（如未安装）：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

## 构建

```bash
# 克隆 / 进入项目目录
cd Antigravity-Manager

# 安装前端依赖
npm install

# 打包（macOS 产物在 src-tauri/target/release/bundle/）
npm run tauri build
```

产物路径：

```
src-tauri/target/release/bundle/
  ├── dmg/     ← macOS 安装包
  └── macos/   ← 直接可运行的 .app
```

## 获取 CodeBuddy Token

CodeBuddy 使用 Keycloak JWT（有效期约 1 年）。通过抓包或 `scripts/probe.mjs` 获取后：

```bash
# 从 JWT 中提取 user_id（即 sub 字段）
echo "<JWT 中间段（payload）>" | base64 -d | python3 -m json.tool | grep '"sub"'
```

## 配置

启动应用后，在**设置 → 代理配置**的 JSON 编辑器里加入 `codebuddy` 段：

```json
{
  "codebuddy": {
    "enabled": true,
    "token": "你的 JWT Token（不含 Bearer 前缀）",
    "user_id": "JWT payload 里的 sub 值",
    "dispatch_mode": "exclusive",
    "model": "glm-5.1"
  }
}
```

### dispatch_mode 说明

| 值 | 行为 |
|----|------|
| `off` | 禁用，不走 CodeBuddy（默认） |
| `exclusive` | 所有 OpenAI 协议请求全部转发到 CodeBuddy |
| `fallback` | 主池不可用时才使用 CodeBuddy |
| `pooled` | CodeBuddy 作为额外槽位加入轮询池 |

### 可用模型（model 字段）

CodeBuddy 支持多个模型，`model` 字段填写对应 ID：

| 类型 | 模型 ID |
|------|---------|
| GLM（推荐） | `glm-5.1` |
| DeepSeek | `deepseek-r1`、`deepseek-v3` |
| Kimi | `moonshot-v1-128k` |
| Claude | `claude-sonnet-4-5` |
| GPT | `gpt-4o` |
| Gemini | `gemini-2.0-flash` |

## 指向本地反代

### Claude Code

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8045
export ANTHROPIC_API_KEY=sk-any-placeholder
claude
```

或在 Claude Code 设置（`~/.claude/settings.json`）中：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8045",
    "ANTHROPIC_API_KEY": "sk-any"
  }
}
```

### 任意 OpenAI 兼容客户端

```
Base URL:  http://127.0.0.1:8045/v1
API Key:   sk-any（任意值）
```

## 验证

```bash
curl http://127.0.0.1:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-any" \
  -d '{
    "model": "glm-5.1",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }'
```

返回正常 JSON 即说明链路通畅。

## Token 刷新

CodeBuddy JWT 有效期约 1 年，到期后调用刷新接口：

```
POST https://copilot.tencent.com/v2/plugin/auth/token/refresh
Authorization: Bearer <旧 token>
```

将返回的新 token 更新到配置中即可。
