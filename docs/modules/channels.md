# @loong/channels 技术方案

## 1. 职责边界

**负责**：将 Telegram / Slack Webhook 载荷解析为统一 `LoongChannelMessage`，并构造 Gateway `POST /channels/webhook` 请求（Bearer 认证）。

**不负责**：在 Gateway 进程内监听平台 Webhook（需**外部 bridge 进程**调用本包）。

## 2. 对外 API

| 导出 | 说明 |
|------|------|
| `parseTelegramWebhook` | message / edited_message / channel_post 等 |
| `parseSlackWebhook` | event callback、slash command |
| `toGatewayWebhookPayload` | 生成 JSON body |
| `createGatewayWebhookChannelTarget` | 可复用投递客户端 |

## 3. 内部设计

### 3.1 Session Id 规则

默认：`{prefix}:{channel}:{threadId|userId|messageId|default}`，保证线程级隔离。

### 3.2 Gateway 载荷字段

`sessionId`、`message`、可选 `channel`、`userId`、`threadId`、`workspace`、`model`、metadata。

Gateway 侧 `parseGatewayWebhookParams` **独立实现**，未 import 本包。

### 3.3 依赖

无 workspace 依赖。

## 4. 集成方式

```text
Telegram/Slack → (bridge) → parse* → toGatewayWebhookPayload
  → createGatewayWebhookChannelTarget.post → Gateway /channels/webhook
  → runInLane → runtime.runTurn
```

仅 `test-suite` 与文档引用；**Gateway 不依赖本包**。

## 5. Code Review

### 5.1 优点

- 平台细节与 Gateway 解耦，bridge 可独立部署与升级。
- 载荷字段与 README 文档一致，便于第三方集成。

### 5.2 问题

| 严重度 | 问题 |
|--------|------|
| P1 | Gateway 与 channels 包 schema 易漂移（双份解析逻辑） |
| P2 | 与 `@loong/cron` 重复的 Webhook HTTP 客户端 |
| P2 | 仅 Telegram + Slack |
| P3 | Slack URL verification challenge 未在本包处理 |

### 5.3 改进建议

1. 将 `LoongGatewayWebhookPayload` 类型抽到 `@loong/gateway` 或共享 `contracts` 包。
2. Gateway 可选 `--enable-telegram-bridge` 内置 adapter（长期）。
3. 合并 Webhook client 模块；补充 Discord 适配器模板。
