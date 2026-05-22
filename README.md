<div align="center">

<img src="docs/images/banner.png" alt="Dragon — 中国龙主题横幅" width="100%" />

<br />

<img src="docs/images/logo.png" alt="Dragon 标志 — 中国龙" width="160" />

# Dragon · 潜龙

🐉 **潜龙在渊，智驭八方** — 原生 TypeScript、本地优先的智能体框架

<p align="center">
  <a href="./README.md" title="简体中文（默认）">
    <img src="https://img.shields.io/badge/简体中文-当前-C41E3A?style=for-the-badge" alt="简体中文" />
  </a>
  &nbsp;
  <a href="./README.en.md" title="English">
    <img src="https://img.shields.io/badge/English-README-D4AF37?style=for-the-badge" alt="English" />
  </a>
</p>

<p align="center">
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/许可证-MIT-D4AF37?style=flat-square" alt="许可证">
  </a><!--
  --><a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  </a><!--
  --><a href="https://pnpm.io/">
    <img src="https://img.shields.io/badge/pnpm-10.11-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm">
  </a><!--
  --><img src="https://img.shields.io/badge/架构-本地优先-C41E3A?style=flat-square" alt="本地优先"><!--
  --><img src="https://img.shields.io/badge/运行时-无%20Python-2E8B57?style=flat-square" alt="无 Python 运行时">
</p>

<p align="center">
  <a href="#-项目简介">项目简介</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-软件包">软件包</a> •
  <a href="#-命令行">命令行</a> •
  <a href="#-网关">网关</a> •
  <a href="#-文档">文档</a> •
  <a href="#-验证">验证</a>
</p>

</div>

---

## 📝 项目简介

**Dragon（潜龙 / Qianlong）** 是 **原生 TypeScript、本地优先** 的智能体框架。名称中的「龙」指 **中国龙（🐉）** —— 象征深潜蓄势、审时度势、终而智驭八方（*潜龙在渊，智驭八方*）。

我们在工程上对标并吸收业界主流本地/编码智能体的成熟做法，在 **单一 TypeScript 运行时** 内落地，避免 Python 与 Node 双栈割裂：

| 来源 | 借鉴能力 | Dragon 中的对应实现 |
|------|----------|---------------------|
| **OpenClaw** | 网关、插件、会话、本地优先 | `@dragon/gateway`（HTTP/WS/SSE RPC）、插件发现、按会话队列（Lane）、Dashboard |
| **Hermes Agent** | 技能进化、记忆、模型路由、轨迹 | `SKILL.md` 与技能工具、可审核记忆候选、Tier 路由与 Fallback、Trajectory 持久化 |
| **Claude Code** | 编码交互、权限、工程化工具链 | 文件/补丁/Shell/Sandbox、交互式 `ask` 审批、回合级工具循环与事件流 |

与 Hermes 相关的概念在合适处 **用 TypeScript 重新实现**；运行时 **不引入 Python**。

### 已实现的优势

相对「只有 CLI 的编码助手」或「只有聊天网关的 Bot」，Dragon 已经把 **控制面 + 运行时内核 + 可扩展工具链** 连成一条可审计的本地链路：

- **架构清晰、可嵌入**：`@dragon/core` 不依赖 Gateway/Memory，单回合 `runTurn` 可嵌入 CLI、Gateway、委托 Worker；统一 `DragonEvent`（lifecycle / assistant_delta / tool / permission）便于 Dashboard 与轨迹回放。
- **本地控制面完整**：Gateway 提供 `agent`、`run.cancel`、`runs.list`、Cron/插件/Provider 观测 RPC；按 `sessionId` 串行 Lane，避免同会话并发踩踏。
- **模型层韧性强**：多 Provider 插件（OpenAI / Anthropic / OpenRouter 兼容）、可重试 Fallback 链、Tier 启发式选模、流式增量转发；回合内 **Turn Prep** 控制上下文体积，溢出时可 reactive 重试。
- **工具与安全默认值**：工作区约束、Shell 白名单、Sandbox（本地/Docker/SSH）策略档、密钥脱敏；写操作默认 `ask`，Gateway/CLI 可挂接权限 Handler。
- **工具循环工程化**：达到迭代上限时 **优雅收尾**（合成 `tool_iteration_limit` + 无工具总结），取消时 **补齐 tool 协议**（`turn_cancelled`），避免 Provider 400 与悬空 `tool_use`。
- **记忆与技能可进化且可审计**：Markdown + 可选 SQLite/FTS；「记住」先入 **待审核候选**，经 promote/reject 再落盘；`skill_create` / `skill_improve` 支持技能迭代。
- **多智能体与自动化**：`@dragon/delegation` 依赖图编排 + `delegation_run`；Cron 文件存储与 Gateway Tick；`@dragon/channels` 适配 Telegram/Slack Webhook；可选 `@dragon/org` 员工路由与审批工单。
- **回归覆盖广**：`@dragon/test-suite` 覆盖 Gateway WS、Provider 工具翻译/流式、记忆审核、委托、Cron、Sandbox、取消协议等高风险路径。

### 待突破的技术难点

对照 OpenClaw / Hermes / Claude Code 的纵深能力，Dragon 下一阶段应优先攻克：

| 优先级 | 难点 | 说明 |
|--------|------|------|
| **P0** | **会话级 Query Loop** | Claude Code 以 `queryLoop` 驱动整段会话；Dragon 目前是「每用户消息一次 `runTurn`」。需在 Gateway 引入 **SessionTurnCoordinator**（排队、续跑、跨轮状态），统一 CLI/Gateway/委托的会话语义。 |
| **P0** | **跨轮 Tool 上下文治理** | 长会话中历史 tool 结果占满上下文。需会话级摘要/压缩策略（类似 Hermes compaction + Claude 的 prep），并与 Turn Prep 分层协作。 |
| **P0** | **Gateway 生产化硬化** | 默认 `authMode: none` 适合本机开发，共享/远程部署需默认认证、速率限制与更严格的直连工具白名单。 |
| **P1** | **MCP 一等公民** | 业界工具生态正向 MCP 汇聚；需在 `@dragon/tools` 增加协议适配、发现与权限映射，而不是仅内置工具。 |
| **P1** | **配置与能力贯通** | Agent Profile、`thinking` 档位、`toolsEnabled`/`memoryEnabled` 等需在 `runTurn` 与 Gateway `toTurnInput` 全链路生效，避免 Dashboard 配置「看得见用不了」。 |
| **P1** | **通道与节点一体化** | Channels 适配器已存在，但 Gateway 仍依赖外部 bridge；多节点配对、远程 Worker 尚未落地（见 Roadmap）。 |
| **P2** | **浏览器与并行工具** | 现有 `browser_snapshot` / `browser_form_submit` 偏轻量；Rich Browser（Playwright 级）与 **只读工具并行**、流式并行读仍需加强。 |
| **P2** | **IDE 原生集成** | Claude Code 深度绑定终端/IDE；Dragon 暂以 CLI + Gateway Dashboard 为主，缺少编辑器侧无缝嵌入。 |
| **P2** | **模块化与 CI 效率** | `memory`/`cli`/`gateway` 大文件待拆分；test-suite 可并行分片以缩短 CI。 |

> [!TIP]
> 延伸阅读：[架构说明](docs/ARCHITECTURE.md) · [技术架构](docs/TECHNICAL_ARCHITECTURE.md) · [路线图](docs/ROADMAP.md) · [模块文档](docs/modules/README.md) · [插件指南](docs/PLUGINS.md) · [部署说明](docs/DEPLOYMENT.md)
>
> 文档语言：[简体中文](README.md)（本页）· [English](README.en.md)

---

## 🚀 快速开始

```bash
# 安装依赖
corepack pnpm install

# 构建与检查
corepack pnpm check
corepack pnpm build
corepack pnpm test

# 单次对话
dragon chat "潜龙试爪。"

# 带工具的智能体（默认：写入操作需交互审批）
dragon agent "概括本仓库的结构与模块。"

# 启动本地网关与控制台
dragon gateway
```

执行 `dragon gateway` 后，在浏览器打开 `http://127.0.0.1:17357/`（默认端口 `17357`，可用 `--port` 修改）。

---

## 📦 软件包

| 包名 | 说明 |
|------|------|
| `@dragon/core` | 智能体回合运行时、生命周期事件、会话、队列 |
| `@dragon/gateway` | WebSocket / HTTP 控制平面 |
| `@dragon/channels` | 聊天渠道 Webhook 与 Gateway 消息投递 |
| `@dragon/tools` | 工具注册表、权限控制、内置工具契约 |
| `@dragon/security` | 敏感键检测与密钥脱敏 |
| `@dragon/providers` | 模型提供商路由 |
| `@dragon/model-catalog` | 按提供商划分的模型元数据 |
| `@dragon/memory` | Markdown、SQLite 与搜索型记忆 |
| `@dragon/skills` | `SKILL.md` 技能运行时与编写 |
| `@dragon/cron` | Cron 表达式解析、文件任务存储与执行器 |
| `@dragon/delegation` | 多智能体任务编排与 `delegation_run` 工具 |
| `@dragon/plugin-sdk` | 对外公开的插件 API |
| `@dragon/plugin-openai-compatible` | OpenAI 兼容协议提供商插件 |
| `@dragon/plugin-openrouter-compatible` | OpenRouter 提供商插件 |
| `@dragon/plugin-anthropic-compatible` | Anthropic Messages API 与工具调用翻译 |
| `@dragon/plugin-git-tools` | 只读 Git 仓库检查工具 |
| `@dragon/test-suite` | TypeScript 回归测试套件 |
| `@dragon/cli` | 命令行入口 |

---

## 🖥️ 命令行

```bash
dragon chat [--session <id>] [--session-dir <path>] [--no-session] \
  [--model <ref>] [--model-fallback <ref>] [--plugin-root <path>] <message>

dragon agent [--session <id>] [--session-dir <path>] [--no-session] [--allow-write] \
  [--model <ref>] [--model-fallback <ref>] [--skill-root <path>] [--plugin-root <path>] \
  [--memory-dir <path>] [--memory-backend <id>] <message>

dragon gateway [--host <host>] [--port <port>] [--secret <value>] \
  [--session-dir <path>] [--allow-write] [--skill-root <path>] [--plugin-root <path>] \
  [--memory-dir <path>] [--memory-backend <id>] [--cron-jobs <path>]

dragon cron [--jobs <path>] [--gateway-url <url>] [--secret <value>] \
  [--once] [--interval-ms <ms>]
```

<details>
<summary><strong>智能体能力</strong></summary>

- 读取、搜索工作区文件；保守的只读 Shell 命令白名单
- `sandbox_exec`：支持本地、Docker、SSH 沙箱；配置档 `inspect`、`versions`、`git-read`、`search-read`、`repo-read`
- `browser_snapshot`、`browser_form_submit`、`file_patch`（写入默认需审批；`--allow-write` 可跳过）
- `/skills`、`/skills <query>`、`/skills load <name>`：本地技能命令，无需连接模型
- `delegation_run`、`skill_create`、`skill_improve`、记忆候选晋升 / 拒绝

</details>

<details>
<summary><strong>模型、插件与记忆</strong></summary>

- 模型引用示例：`openai:gpt-4o`、`anthropic:claude-sonnet-4-5`；配置文件 `.dragon/config/providers.json`
- 智能体配置：`.dragon/config/agents.json`
- 失败回退：`--model-fallback` 或环境变量 `DRAGON_MODEL_FALLBACKS`
- 插件目录：`.dragon/plugins`、`DRAGON_PLUGIN_ROOTS`、`--plugin-root`
- 记忆后端：默认 `file`，可选 `sqlite`；Markdown 记忆包括 `USER.md`、`PROJECT.md`、`MEMORY.md`、`notes/` 等
- 候选记忆位于 `.dragon/memory/candidates/`，须经晋升后才参与检索与注入

</details>

---

## 🌐 网关

`dragon gateway` 在 `/` 提供轻量控制台，包含 **运行、模型、智能体、观测、系统** 五个工作区。

| 接口 | 说明 |
|------|------|
| `GET /health` | 健康检查 |
| `GET /events` | SSE 事件流（支持 `sessionId` / `runId` 过滤） |
| `GET /ws` | WebSocket RPC 与事件推送 |
| `POST /rpc` | 连接、健康检查、智能体调用、运行状态、配置、插件、工具、记忆、轨迹、定时任务等 |
| `POST /channels/webhook` | 经认证的聊天渠道入站（`@dragon/channels` 提供 Telegram / Slack 适配） |

<details>
<summary><strong>RPC 要点</strong></summary>

- `providers.list`：列出提供商、模型及工具调用能力（不返回原始 API Key）
- `plugins.list`：插件名、工具、提供商、记忆后端、钩子摘要（不含文件系统路径）
- `tools.catalog` / `tool.invoke`：直连调用比智能体循环更严格（默认仅只读白名单）
- 兼容 OpenAI / Anthropic 的插件可通过 `assistant_delta` 事件推送真实文本增量
- 定时任务：任务文件 `.dragon/cron/jobs.json`；`dragon cron --once` 单次执行或常驻运行（网关默认也会启动定时任务）

</details>

---

## 📚 文档

| 主题 | 链接 |
|------|------|
| 架构与复用计划 | [ARCHITECTURE.md](docs/ARCHITECTURE.md) · [REUSE_PLAN.md](docs/REUSE_PLAN.md) |
| 技术设计 | [TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md) |
| 各模块规格 | [modules/README.md](docs/modules/README.md) |
| 插件开发 | [PLUGINS.md](docs/PLUGINS.md) |
| 部署与冒烟测试 | [DEPLOYMENT.md](docs/DEPLOYMENT.md) |

---

## ✅ 验证

```bash
corepack pnpm check
corepack pnpm build
corepack pnpm test
corepack pnpm smoke:gateway
```

`corepack pnpm test` 覆盖：CLI 技能命令、Gateway RPC / WebSocket / Webhook / Cron、渠道适配、记忆候选、运行轨迹、沙箱执行、浏览器工具、任务委派、模型目录、提供商插件与安全脱敏等。

---

## 📜 许可证

本项目采用 [MIT 许可证](./LICENSE)，Copyright (c) 2026 Dragon Authors。

---

<div align="center">

<p>
  <a href="./README.md"><strong>简体中文</strong></a> ·
  <a href="./README.en.md">English</a>
</p>

<sub>🐉 以 TypeScript 构建 · 本地优先 · 潜龙在渊，智驭八方</sub>

</div>
