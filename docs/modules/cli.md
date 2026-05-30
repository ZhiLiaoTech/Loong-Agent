# @loong/cli 技术方案

## 1. 职责边界

**负责**：`loong` 可执行入口、子命令解析、**Composition Root**（装配 Runtime/Gateway/插件/工具/记忆/技能/Cron）、本地配置读写、TTY 权限提示。

**不负责**：回合逻辑（core）、HTTP 协议（gateway）、具体工具/Provider 实现。

## 2. 对外 API

本包以 **CLI 二进制** 为主，非库导向：

```json
"bin": { "loong": "./dist/index.js" }
```

命令：

| 命令 | 模式 | 说明 |
|------|------|------|
| `loong chat` | 轻量对话 | 无工具/记忆 |
| `loong agent` | 完整 Agent | 工具+记忆+权限+技能 |
| `loong gateway` | 控制面 | HTTP Gateway + 内嵌 Cron Runner |
| `loong cron` | 定时 | `--once` 或长驻 Runner |

## 3. 内部设计

### 3.1 核心函数

| 函数 | 职责 |
|------|------|
| `createRuntime()` | 加载插件 → Provider Registry → Session/Trajectory/Memory → Tools → Context Providers → `createLoongRuntime` |
| `createBuiltinProviders()` | `.loong/config/providers.json` + 环境变量 OpenAI/Anthropic |
| `runChat()` | 单回合 + 事件 stderr 输出 + 可选 CLI 权限 Handler |
| `runGateway()` | `createHttpGateway` + Cron + Config Stores |
| `runCron()` | File store + Webhook delivery target |
| `loadConfiguredPlugins()` | `.loong/plugins`、`LOONG_PLUGIN_ROOTS`、`--plugin-root` |
| `createAgentTools()` | file/shell/sandbox/browser/memory/delegation/trajectory/skills |
| `createCliPermissionHandler()` | TTY `[y/N]` 提示 |

### 3.2 Agent 工具权限策略（默认）

- 工作区内只读：`allow`（`file_read`、`file_search`、部分 git 等）
- 写操作：`ask`（`file_patch`、技能创建、记忆候选）
- `--allow-write`：显式 allow patch 与记忆/技能写工具
- `delegation_run`：`allow`（子回合仍受同一权限引擎约束）

### 3.3 环境变量（节选）

| 变量 | 用途 |
|------|------|
| `LOONG_MODEL` / `LOONG_MODEL_FALLBACKS` | 模型与 fallback |
| `LOONG_PLUGIN_ROOTS` | 插件搜索路径 |
| `LOONG_MEMORY_BACKEND` | 记忆后端 id |
| `LOONG_MODEL_CONFIG` / `LOONG_AGENT_CONFIG` | 配置路径覆盖 |
| `LOONG_OPENAI_*` / `LOONG_ANTHROPIC_*` | Provider 密钥 |

### 3.4 依赖（workspace 最全）

`core`、`gateway`、`cron`、`delegation`、`memory`、`plugin-sdk`、`providers`、`security`、`skills`、`tools`。

## 4. 数据流（agent 命令）

```text
argv → parseChatArgs → createRuntime → runTurn
  ├─ plugins activate (finally deactivate 逆序)
  ├─ /skills 斜杠命令可短路（不调用模型）
  └─ permissionHandler (TTY only)
```

## 5. Code Review

### 5.1 优点

- 单一组合点，产品行为集中可调。
- 插件路径 `realpath` + `isPathInside` 防目录穿越。
- 插件记忆后端经 `createValidatingMemoryStore` 严格校验。
- Gateway 与 Agent 共享同一 `createRuntime` 装配逻辑（gateway 模式固定 agent）。

### 5.2 问题

| 严重度 | 问题 |
|--------|------|
| P1 | `index.ts` ~2100 行单体，难以测试与复用 |
| P1 | 非 TTY 无权限 Handler → 与 core 相同静默跳过 `ask` |
| P1 | `providers.json` 明文存 API Key |
| P2 | `chat` vs `agent` 易混淆 |
| P2 | Gateway 进程内嵌 Cron，多实例会重复 tick |
| P2 | 插件无沙箱，等同主进程权限 |
| P3 | 无 turn 级 `--timeout` CLI 暴露 |

### 5.3 改进建议

1. 拆分子命令模块：`commands/agent.ts`、`commands/gateway.ts`、`wiring/runtime.ts`。
2. 增加 `--fail-on-ask`、`--yes`（非交互 CI 模式）。
3. API Key 支持环境变量引用或 OS keychain，文件内仅存引用 id。
4. 文档强调 `loong agent` 为默认开发入口；`chat` 标注为无工具对话。
