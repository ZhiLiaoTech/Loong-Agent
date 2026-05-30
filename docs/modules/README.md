# Loong 分模块技术方案索引

本目录包含各 `@loong/*` 包的**技术方案**与 **Code Review**，作为 [TECHNICAL_ARCHITECTURE.md](../TECHNICAL_ARCHITECTURE.md) 的分册。

每个模块文档统一包含：

1. **职责边界** — 包做什么、不做什么  
2. **对外 API** — 主要导出与契约  
3. **内部设计** — 关键类/函数、数据流、依赖  
4. **配置与集成** — CLI/Gateway 如何装配  
5. **Code Review** — 优点、问题、改进建议  

---

## 核心链路

| 文档 | 包名 | 一句话 |
|------|------|--------|
| [core.md](./core.md) | `@loong/core` | Agent 回合运行时内核 |
| [gateway.md](./gateway.md) | `@loong/gateway` | HTTP/WS 控制面与 Dashboard |
| [cli.md](./cli.md) | `@loong/cli` | 组合根与 `loong` 命令 |

## 模型与工具

| 文档 | 包名 | 一句话 |
|------|------|--------|
| [providers.md](./providers.md) | `@loong/providers` | LLM Provider 注册与 HTTP 适配 |
| [model-catalog.md](./model-catalog.md) | `@loong/model-catalog` | 模型元数据规范化与解析 |
| [tools.md](./tools.md) | `@loong/tools` | 工具注册表、内置工具、权限引擎 |
| [security.md](./security.md) | `@loong/security` | 日志与错误中的密钥脱敏 |

## 能力与扩展

| 文档 | 包名 | 一句话 |
|------|------|--------|
| [memory.md](./memory.md) | `@loong/memory` | 记忆、会话、轨迹、候选审核 |
| [skills.md](./skills.md) | `@loong/skills` | SKILL.md 运行时与技能工具 |
| [delegation.md](./delegation.md) | `@loong/delegation` | 多任务 DAG 编排与委托工具 |
| [cron.md](./cron.md) | `@loong/cron` | Cron 解析、存储、Runner、Webhook 投递 |
| [channels.md](./channels.md) | `@loong/channels` | Telegram/Slack → Gateway Webhook |
| [plugin-sdk.md](./plugin-sdk.md) | `@loong/plugin-sdk` | 插件加载与注册宿主 |
| [plugins-reference.md](./plugins-reference.md) | `plugin-*` | 参考 Provider/Tool 插件 |

## 质量保障

| 文档 | 包名 | 一句话 |
|------|------|--------|
| [test-suite.md](./test-suite.md) | `@loong/test-suite` | 集成回归测试 harness |
