# ClawWorks → Loong 迁移：禁止原样带入

从 `ClawWorks-Client` 迁入 Loong 时，下列内容**不**进入 Loong 内核或默认路径：

| 排除项 | 原因 | Loong 替代 |
|--------|------|------------|
| `runtime/openclaw/openclaw.mjs` 捆绑树 | 内核不同 | `dragon gateway` 子进程 / 捆绑 `@dragon/cli` |
| `openclaw.json` 作为主配置根 | 数据模型不同 | `.dragon/config/*.json` |
| OpenClaw ACP 协议假设（端口 18789） | 默认端口与 RPC 不同 | Gateway HTTP RPC + SSE（17357） |
| `clawworks-model-gateway` 插件 | 云代理专用 | Dragon providers + 可选云端下发 |
| ClawWorks 云端 API 硬编码 | 产品后端不同 | 可配置 `LOONG_CLOUD_URL`（P5） |
| Suite 安装器 / `instances/` 全量逻辑 | 路线图 P6 | 分期迁入 |
| Tauri 内 `invoke` 散落调用 | 应经 `@dragon/host` | Host 能力接口 |

可迁入：**视觉 tokens**、**Watchdog 模式**、**托盘/更新/密钥** 模式、**网关就绪状态机** 思路。
