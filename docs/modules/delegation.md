# @dragon/delegation 技术方案

## 1. 职责边界

**负责**：委托任务计划校验（DAG）、依赖感知并发执行、通过 `DragonAgentRuntime.runTurn` 执行子任务、Agent 工具 `delegation_run`。

**不负责**：子回合内的工具定义（使用父 Runtime 注入的同一 registry）。

## 2. 对外 API

| 导出 | 说明 |
|------|------|
| `createDelegationPlan` | 校验 id、依赖、环检测（最多 100 任务） |
| `runDelegationPlan` | 并发 Runner（默认 maxConcurrency 4，上限 16） |
| `createRuntimeDelegatedTaskExecutor` | 每任务 → `runtime.runTurn` |
| `createRuntimeDelegationTool` | `delegation_run` 工具 |

## 3. 内部设计

### 3.1 任务状态机

`pending` → `running` → `completed` | `error` | `skipped`（依赖失败时）。

### 3.2 Runtime 执行器

- 派生 `sessionId`（含父 session/task 元数据）。
- 可选将上游任务输出摘要注入 prompt（4k 字符上限）。
- `throwOnRuntimeError` 默认 true：子回合 error 使整个任务失败。

### 3.3 delegation_run 工具

- `permission: "allow"`
- 默认最多 8 任务（绝对上限 32），并发 3。
- 通过 factory 获取当前 Runtime。

### 3.4 依赖

- `@dragon/core`
- `@dragon/tools`

## 4. 集成方式

CLI `createRuntime()` 注册 `createRuntimeDelegationTool({ getRuntime: () => runtime })`；仅 `dragon agent` / Gateway agent 模式。

## 5. Code Review

### 5.1 优点

- 显式 DAG + 环检测，避免死锁计划。
- 子回合共享权限与工作区策略，行为可预测。
- 失败依赖任务自动 skip，结果可审计。

### 5.2 问题

| 严重度 | 问题 |
|--------|------|
| P1 | 嵌套 delegation 可指数级增加 runTurn |
| P2 | 依赖上下文为纯文本摘要，无结构化 schema |
| P2 | 计划/结果无跨重启持久化 |
| P3 | 与 core 工具迭代上限叠加，总调用深度难估 |

### 5.3 改进建议

1. 限制嵌套深度或禁止子回合再调 `delegation_run`。
2. 暴露 `maxTotalTurns` 预算。
3. 可选将 `DelegationRunResult` 写入 trajectory。
