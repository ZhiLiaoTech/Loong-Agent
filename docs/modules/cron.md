# @dragon/cron 技术方案

## 1. 职责边界

**负责**：五字段 Cron 表达式解析（UTC）、下次执行时间计算、JSON 文件任务存储、Due Job Runner、向 Gateway `/channels/webhook` 投递（`channel: "cron"`）。

**不负责**：启动 HTTP 服务（由 CLI/Gateway 注入 Runner）。

## 2. 对外 API

| 导出 | 说明 |
|------|------|
| `parseCronSchedule` / `nextCronRun` | 解析与调度 |
| `createFileCronJobStore` | 持久化 |
| `createCronRunner` | tick / start / stop |
| `createGatewayWebhookCronTarget` | HTTP 投递 |
| `toGatewayWebhookCronPayload` | 载荷构造 |

## 3. 内部设计

### 3.1 Cron 语义

- 5 字段：分 时 日 月 周；**仅 UTC**。
- DOM 与 DOW 均非 `*` 时：**OR** 语义（标准 cron）。
- 支持 `@hourly`、`@daily`、`@weekly` 等宏。

### 3.2 Runner

- `tick()`：跳过重叠 tick；执行到期 enabled 任务；更新 `nextRunAt`。
- 长驻：`setInterval` + `unref()`。
- CLI：`dragon cron --once` 供系统 cron 调用；`dragon gateway` 默认内嵌 Runner。

### 3.3 存储

JSON 数组文件；写操作队列 + 临时文件 `rename` 原子写。

### 3.4 依赖

无 workspace 依赖。

## 4. 集成方式

Gateway RPC：`cron.jobs.list`、`cron.job.upsert`、`cron.job.remove`、`cron.tick`（当注入 store/runner）。

Dashboard System 页管理任务；投递体见 Gateway `parseGatewayWebhookParams`。

## 5. Code Review

### 5.1 优点

- 可注入 `now`、`fetchImpl`，易测。
- 与 Gateway Webhook 统一入口，复用 Agent 管道。
- 文件存储简单，适合本地优先部署。

### 5.2 问题

| 严重度 | 问题 |
|--------|------|
| P2 | 仅 UTC，无 IANA 时区 |
| P2 | 长时间停机无 backlog 策略（每 tick 一次） |
| P2 | 与 `@dragon/channels` Webhook 客户端代码重复 |
| P3 | 无秒级字段 |
| P3 | 多 Gateway 实例重复 tick |

### 5.3 改进建议

1. 提取共享 `createGatewayWebhookClient`。
2. Job 增加 `timezone` 可选字段（长期）。
3. 文档说明多实例部署时只应一处启用 Runner。
