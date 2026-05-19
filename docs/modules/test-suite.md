# @dragon/test-suite 技术方案

## 1. 职责边界

**负责**：跨包集成回归测试（非单元测试框架）；通过子进程调用 `dragon` CLI、启动 loopback HTTP/WS mock、临时目录验证文件副作用。

**不负责**：替代各包内部单测（当前多数包无独立单测）。

## 2. 运行方式

```bash
corepack pnpm test
# → build workspace → tsx packages/test-suite/src/index.ts
```

入口：`packages/test-suite/src/index.ts`（约 2600+ 行），顺序执行 ~27 个命名测试，失败 `process.exit(1)`。

## 3. 覆盖范围（分类）

| 类别 | 示例测试 |
|------|----------|
| CLI | `/skills` 斜杠、Cron once、动态插件加载 |
| Gateway | Webhook channel、WS RPC/事件、direct tools、cron RPC |
| Channels | Telegram/Slack parse + delivery |
| Cron | 表达式、file store、runner、webhook |
| Delegation | Planner、runner、runtime executor、`delegation_run` 限制 |
| Core/Providers | Tool loop、fallback、流式、Anthropic/OpenAI 翻译 |
| Memory | 候选 list/promote/reject |
| Security | `isSensitiveKey`、redaction |
| Model catalog | normalize、resolve |

**未直接导入**：`@dragon/plugin-sdk`、`@dragon/skills`（skills 经 CLI 子进程测）。

## 4. 测试基础设施

| 辅助 | 用途 |
|------|------|
| `runCli()` | spawn `dragon` |
| `rpc()` / `postJson()` | Gateway HTTP |
| Mock HTTP server | Provider/Webhook |
| Raw WebSocket client | Gateway `/ws` |
| `WORKSPACE_ROOT` | 定位 monorepo 与 plugin dist |

`TEST_TIMEOUT_MS = 5000` 定义但未全局强制。

## 5. Code Review

### 5.1 优点

- 覆盖高风险路径：WS、Webhook、权限、流式 Provider、Delegation。
- 真实子进程 + 网络栈，接近用户实际使用。
- 与 `pnpm test` 一键集成 CI。

### 5.2 问题

| 严重度 | 问题 |
|--------|------|
| P1 | 单体文件，无法 `pnpm test --grep` 单测 |
| P1 | 顺序执行，套件变长后 CI 变慢 |
| P2 | 无覆盖率报告 |
| P2 | plugin-sdk 边界校验无专属用例 |
| P3 | 超时未统一应用 |

### 5.3 改进建议

1. 迁移到 Vitest：保留集成项目，按文件分片并行。
2. 为 `tools`、`providers`、`model-catalog` 增加包级单元测试。
3. 每个测试独立 `describe` + 超时；失败输出 artifact 路径。
