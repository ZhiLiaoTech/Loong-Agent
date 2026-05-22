# @dragon/core 技术方案

## 1. 职责边界

**负责**：单次 Agent 回合（Turn）的完整生命周期——会话加载、上下文组装、模型调用、工具循环、事件发射、持久化钩子。

**不负责**：HTTP 服务、插件发现、CLI 参数解析、具体 LLM HTTP 实现（委托 `@dragon/providers`）、具体工具实现（委托 `@dragon/tools`）。

## 2. 对外 API

| 导出 | 说明 |
|------|------|
| `DragonAgentRuntime` | 契约：`runTurn`、`subscribe` |
| `DefaultDragonAgentRuntime` | 默认实现 |
| `createDragonRuntime(options?)` | 工厂函数 |
| `DragonTurnInput` / `DragonTurnResult` | 回合入参/结果 |
| `DragonEvent` | `lifecycle` \| `assistant_delta` \| `tool` \| `permission` |
| `DragonSessionStore` / `DragonTrajectoryStore` | 可选持久化端口 |
| `DragonContextProvider` | 可插拔上下文注入 |
| `DragonPermissionHandler` | 交互式权限回调 |
| `DragonLifecycleHook` | 回合生命周期观察者 |

源码入口：`packages/core/src/index.ts`、`runtime.ts`、`types.ts`。

## 3. 内部设计

### 3.1 Turn 执行流程

```text
runTurn
  ├─ lifecycle:start + hooks
  ├─ loadSession(history)
  ├─ contextProviders → composeSystemPrompt
  ├─ completeModelWithFallback (provider 链)
  └─ while toolCalls && iterations < maxToolIterations (默认 20)
        ├─ for each toolCall (串行)
        │     ├─ permissionEngine.evaluate
        │     ├─ permissionHandler (可选)
        │     └─ tool.invoke → modelMessages.push(tool result)
        └─ completeModelWithFallback again
  ├─ persist session + trajectory
  └─ lifecycle:end | error | cancelled | timeout (result.status)
```

### 3.2 模型超时

- 默认 **300s**（`DEFAULT_MODEL_TIMEOUT_MS = 300_000`），每次 `provider.complete` 共享合并后的 `AbortSignal`。
- `createDragonRuntime({ modelTimeoutMs })` 可覆盖；`0` 表示禁用超时。
- 超时后 `DragonTurnResult.status === "timeout"`，并中止进行中的模型 HTTP 请求。

### 3.3 依赖

- `@dragon/providers` — `ProviderRegistry`、`ModelProvider.complete`
- `@dragon/tools` — `ToolRegistry`、`ToolPermissionEngine`
- `@dragon/security` — `isSensitiveKey`（权限/事件摘要）

### 3.4 设计模式

| 模式 | 应用 |
|------|------|
| 端口适配器 | Session/Trajectory/Context/Permission 可注入 |
| 观察者 | `subscribe` + 内部 `#emit` |
| Fail-soft 观察者 | Provider/Hook/订阅者异常不中断主流程 |
| Fail-hard 持久化 | 成功路径下 `appendTurn` 失败抛 `DragonPersistenceError` |
| 模型 Fallback | `ProviderError.retryable` 或未知错误触发下一 ref |

### 3.4 关键常量

- `maxToolIterations`: 20
- `maxContextChars`: 12_000
- `maxToolResultChars`: 64_000
- `lifecycleHookTimeoutMs`: 500

## 4. 集成方式

CLI/Gateway 通过 `createDragonRuntime` 注入：

- `providerRegistry`、`toolRegistry`、`permissionEngine`
- `sessionStore`、`trajectoryStore`、`contextProviders`、`lifecycleHooks`
- `permissionHandler`（CLI TTY 时）
- `defaultModel`、`modelFallbacks`、`systemPrompt`

Gateway 在 `#runInLane(sessionId)` 内调用 `runtime.runTurn`，并订阅事件转发 SSE/WS。

## 5. Code Review

### 5.1 优点

- 内核纯净，无网络/文件系统硬编码，适合嵌入测试与第三方宿主。
- 工具结果与权限事件经摘要/脱敏，降低密钥泄漏面。
- Fallback 缓冲失败尝试，避免流式场景先展示错误再切换模型。
- Hook 请求 `deepCloneAndFreeze`，防止插件篡改运行时状态。

### 5.2 问题

| 严重度 | 问题 | 位置/表现 |
|--------|------|-----------|
| P1 | `DragonTurnInput.thinking` 未传入 Provider | 仅写入 session metadata |
| P1 | `status: "timeout"` 类型存在但未赋值 | `types.ts` vs `runtime.ts` |
| P1 | `ask` 无 Handler 时工具静默跳过 | `#resolvePermission` 返回 ask → `#runToolCall` 非 allow 则 JSON 错误 |
| P2 | 同轮多 tool call 串行 | `for (const toolCall ...)` |
| P2 | 未知非 ProviderError 也触发 fallback | `isFallbackEligible` 偏激进 |
| P2 | `costUsd` 未填充 | `toDragonUsage` |
| P3 | 无内置 session 级并发锁 | 由 Gateway `#runInLane` 承担 |

### 5.3 改进建议

1. 将 `thinking` 映射到 Provider 请求参数（各 Provider 适配层实现）。
2. 实现 `AbortSignal` + 超时策略，或移除 `timeout` 状态。
3. 无 Handler 且决策为 `ask` 时返回明确 `permission_denied` 工具结果。
4. 对只读、无副作用工具评估并行 `invoke`。
5. 将 runtime 拆为 `turn-loop.ts`、`tool-runner.ts`、`model-fallback.ts` 便于单测。
