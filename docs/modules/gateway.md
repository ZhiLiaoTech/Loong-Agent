# @loong/gateway 技术方案

## 1. 职责边界

**负责**：本地 HTTP/WebSocket 控制面、JSON-RPC、SSE/WS 事件扇出、Run 注册表、Session Lane 串行、Dashboard 静态 UI、直连工具白名单、模型/Agent 配置 RPC。

**不负责**：组装完整 Runtime（由 CLI 注入 `LoongAgentRuntime`）、插件加载、Provider HTTP 实现。

## 2. 对外 API

| 导出 | 说明 |
|------|------|
| `createHttpGateway(options)` | 创建 `HttpLoongGateway` |
| `LoongGateway` | `start` / `stop` / `address` |
| `GatewayRequest` / `GatewayResponse` | RPC 协议联合体 |
| `GatewayModelConfigStore` / `GatewayAgentConfigStore` | 配置持久化端口 |
| `GatewayRunRecord` | 内存 Run 状态 |

Dashboard HTML 由独立包 `@loong/gateway-dashboard` 构建（`dist/index.html`），经 `dashboard-static.ts` 在 `GET /` 提供；`dashboard.ts` 为薄 re-export。支持 Legacy 与 `?ui=v2` React 双入口。

## 3. 内部设计

### 3.1 HTTP 路由

| 路由 | 行为 |
|------|------|
| `GET /` `/dashboard` | 内嵌 SPA（Run/Models/Agents/Observe/System） |
| `GET /health` | 健康 + providerCount/pluginCount |
| `GET /events` | SSE，`?sessionId` `?runId` |
| `GET /ws` | WebSocket RPC + 事件（协议 `loong.gateway.v1`） |
| `POST /rpc` | 主 RPC 入口 |
| `POST /channels/webhook` | 通道消息 → Agent 回合 |

### 3.2 RPC 能力（connect 动态列举）

`health`、`connect`、`agent`、`agent.wait`、`run.status`、`run.cancel`、`runs.list`、`providers.list`、`model.config.*`、`agent.config.*`、`plugins.list`、`tools.catalog`、`tool.invoke`、`memory.candidates.*`、`trajectory.*`、`cron.*`（按注入 store/runner 启用）。

### 3.3 SessionTurnCoordinator

- 模块：`packages/gateway/src/session-coordinator.ts`
- 同 `sessionId` 已有回合在执行时，后续 `agent` RPC 返回 `{ queued: true, queueTurnId, position }`；客户端用 `agent.wait` 等待完成。
- Webhook/Cron 投递在内部对排队回合自动 `agent.wait`，保持通道语义阻塞完成。
- 与 `#runInLane` 配合：队列 drain 仍串行执行，不并发踩踏 transcript。

### 3.4 Query Loop（自动续跑）

- 模块：`packages/gateway/src/query-loop.ts`
- `agent` RPC 参数：`queryLoop: true` 或 `{ enabled, maxTurns }`（默认最多 3 轮）。
- 当 Runtime 在回合结束时标记 `metadata.queryLoopContinue`（例如工具迭代触顶后 finalize），Gateway 在同一 `agent` 请求内自动发起续跑，续跑消息为内置 `QUERY_LOOP_CONTINUE_MESSAGE`，事件聚合到单次 RPC 响应。
- `queryLoop: false` 写入 `LoongTurnInput` 可禁止续跑信号。

### 3.5 Session Lane

```typescript
// packages/gateway/src/index.ts — #runInLane
// 同一 sessionId：previous.catch().then(() => current)
```

保证同会话 Agent 请求不并发，避免 transcript 交错。

### 3.6 直连工具（tool.invoke）

默认白名单：`git_status`、`git_diff`、`git_log`。额外条件：

- 工具声明 `permission: "allow"`
- 能力不含 `write` / `network` / `memory` / `custom`
- 通过注入的 `ToolPermissionEngine`（Gateway 默认 deny 未知工具）

### 3.7 认证与速率限制

- `auth-policy.ts`：绑定 `0.0.0.0` / 非 loopback 时默认要求 `shared-secret`（可自动生成并打日志）；`127.0.0.1` 仍允许 `authMode: none`。
- `rate-limit.ts`：对 `/rpc`、`/channels/webhook`、`/events`、`/ws`、`/health` 按客户端 IP 滑动窗口限流。
- `#isAuthorized`：`shared-secret` 时校验 `Authorization: Bearer` 或 `x-loong-secret`。
- 非 loopback 且无认证时，`tool.invoke` 返回 403。

### 3.8 模型目录与 Channel Webhook

- `model-catalog-bridge.ts`：由 Gateway 启动时的 `providerSummaries` 构建 `LoongModelCatalog`；`#resolveAgentParams` 在 profile/员工路由之后调用 `applyModelCatalogToAgentParams`，将裸别名规范为 `provider:model`。
- `channels-webhook.ts`：`assertLoongGatewayWebhookPayload` 与 `@loong/channels` 的 `LoongGatewayWebhookPayload` 对齐；`/channels/webhook` 解析路径在 `parseGatewayWebhookParams` 中先校验再映射为 `GatewayAgentParams`。

### 3.9 模块拆分（进行中）

- `gateway-http.ts` — `GatewayHttpError`、`badRequest`、`errorToStatusCode`
- `gateway-parse.ts` — RPC 通用校验与文本规范化
- `gateway-agent-types.ts` — Agent/Webhook 参数类型
- `agent-params.ts` — `parseGatewayAgentParams`、`parseGatewayWebhookParams`、`toTurnInput`、`resolveAgentParamsWithProfile`

### 3.10 依赖

- `@loong/core` — Runtime、事件类型
- `@loong/tools` — 工具目录与权限
- `@loong/cron` — 类型与 Runner（由 CLI 注入）
- `@loong/channels` — Webhook payload 类型与出站投递
- `@loong/model-catalog` — 能力/状态类型与 Catalog 解析

## 4. 集成方式

`loong gateway`（CLI）调用 `createHttpGateway`，传入：

- `runtime`、`permissionEngine`、`toolRegistry`
- `modelConfigStore`、`agentConfigStore`、`trajectoryStore`
- `cronStore`、`cronRunner`
- `sharedSecret`（可选）、`host`、`port`

### 4.1 模型超时配置

Gateway 启动时由 CLI 解析并注入 Runtime（默认 **300s**）。优先级：**CLI 参数 > 环境变量 > `.loong/config/gateway.json`**。

| 方式 | 示例 |
|------|------|
| 配置文件 | `.loong/config/gateway.json` → `{ "modelTimeoutMs": 300000 }` |
| 环境变量 | `LOONG_MODEL_TIMEOUT_MS=300000` |
| CLI | `loong gateway --model-timeout-sec 300` 或 `--model-timeout-ms 300000` |
| 自定义路径 | `LOONG_GATEWAY_CONFIG=/path/to/gateway.json` |

启动日志会打印 `Loong model timeout: 300s`。

## 5. Code Review

### 5.1 优点

- 零外部 HTTP 框架依赖，部署简单。
- `connect` 能力协商清晰，便于 Dashboard 功能探测。
- 配置 RPC 对 API Key 脱敏（`sanitizeModelConfig`）。
- 直连工具双层防护（白名单 + 能力 + permission）。
- 手写 WebSocket 子集，攻击面可控（无扩展、无分片）。

### 5.2 问题

| 严重度 | 问题 |
|--------|------|
| P0 | 默认 `authMode: none`，本机任意进程可调用 RPC/Webhook |
| P1 | `GatewayAgentProfileConfig` 的 `toolsEnabled`/`memoryEnabled`/`systemPrompt` 未完整映射到 `runTurn` |
| P1 | CORS 仅 `http://localhost`，`127.0.0.1` Dashboard 可能跨域失败 |
| P2 | Webhook 在无认证时可触发完整 Agent |
| P2 | WS 消息 >1MB 丢弃事件，无背压策略 |
| P2 | Run 历史最多 200 条，无持久化 |
| P3 | 手写 WS 维护成本高 |
| P3 | 无请求速率限制 |

### 5.3 改进建议

1. 未设置 `sharedSecret` 时启动打印安全警告；考虑默认生成随机 secret。
2. `toTurnInput` 落实 Profile 字段；`systemPrompt` 进入 system 层而非拼 user message。
3. CORS 与 bind 地址一致（`127.0.0.1` + `localhost`）。
4. ~~抽取 dashboard 为独立前端构建~~（已完成：`@loong/gateway-dashboard`）。
5. Webhook 与 RPC 共享认证中间件；可选 IP allowlist。
