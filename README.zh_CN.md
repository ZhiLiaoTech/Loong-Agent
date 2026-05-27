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

> **一句话**：潜龙让您在自家环境里，用得上、管得住、换得了模型的 AI 帮手——少踩「演示很美、上线很惨」的坑。

相对「只有聊天页的 Bot」或「只能在终端里用的编码助手」，潜龙把能力连成一条**在您掌控下、可审计**的本地链路。下面说明**对您意味着什么**（实现细节见 [模块文档](docs/modules/README.md)）。

| 您关心的 | 潜龙带来的价值 |
|----------|----------------|
| 怕数据出去、怕乱动 | 主要在自己环境跑；谁在干活、干到哪一步，看得见、停得住 |
| 怕被一家 AI 绑死 | 换模型、换厂商不用推倒重来；一家不稳还能自动换，业务少停摆 |
| 怕 AI 删错改错 | 动您的东西前先问人；敏感信息尽量不露在记录里，过内审更有底 |
| 怕只会聊、干不了活 | 能查资料、能执行步骤，忙完会收尾；中途叫停也不把后面聊废 |
| 怕 AI 记错、记歪 | 说要「记住」的须您点头才进知识库，避免错话变成「官方记忆」 |
| 怕只能一个人用 | 复杂事可分工协作，能定时跑，能在群里接活，从个人玩具变团队帮手 |
| 怕买回去演示行、上线崩 | 关键能力有反复自检，降低「验收好看、真用就跪」的采购风险 |

1. **一次投入，多处能用** — 不必为聊天页、管理台、内部系统各买一套助手，省采购、省对接、省培训。
2. **掌控感在自己手里** — 任务进度、何时停止您说了算；同一件事不会两头同时乱改。
3. **选型自由，少被卡脖子** — 今天用哪家模型、明天换哪家，业务不用大改；长对话也不容易突然断档。
4. **默认当「谨慎员工」** — 改文件、跑命令先请示；日志尽量不裸奔密钥，更像守规矩的实习生。
5. **能收尾、能叫停** — 不会无限查资料烧额度；您喊停后还能接着谈，少白烧钱。
6. **记忆可信、可管** — AI 不会悄悄把胡话写进公司长期记忆；该记的您批，不该记的您拦。
7. **从聊天升级到办事** — 大活能拆、能定时、能在常用聊天软件里接需求，少靠人盯。
8. **敢签、敢上线** — 核心流程有自检，买的不是 Demo，而是能长期用的底气。

### 待补齐的能力

> **产品定位**：潜龙是**通用 AI Agent**（命令行、网关控制台、聊天渠道、多智能体分工），**不以 IDE/编辑器深度绑定为目标**（见 [路线图](docs/ROADMAP.md) Phase 5）。

对照当前代码库，与「能长期跑在生产环境里的通用助手」相比，大致 **六成底座已具备、四成需补齐或拉通**（P0 多为「有雏形、未贯通」，P1/P2 为生态与工程效率）。下表按**工程现状**核对，避免把已实现能力误写成缺口。

| 优先级 | 能力缺口 | 代码里已有 | 仍须补齐 |
|--------|----------|------------|----------|
| **P0** | **一件事办完（会话续跑）** | 网关：`SessionTurnCoordinator` 排队 + `agent.wait`；`queryLoop` 可在工具触顶后续跑（`gateway/query-loop.ts`） | CLI、`delegation` 与网关**同一套**会话语义；用户一句「帮我把这事办完」的跨轮续跑（不限于工具触顶） |
| **P0** | **长聊不爆上下文** | 单轮 `Turn Prep` 截断（`core/turn-prep.ts`）；`session_compaction` 注入较早会话摘要（`memory`） | 历史 **tool 结果** 跨轮压缩/摘要并写回模型消息，与 Turn Prep **分层**协作 |
| **P0** | **对外部署敢开** | `shared-secret` 认证、按路由限速（`gateway/rate-limit.ts`）、非本机监听告警 | 共享/远程部署**默认要求认证**；直连 `tool.invoke` 策略可配置且默认更严 |
| **P1** | **接上 MCP 工具生态** | stdio/HTTP 客户端、`mcp.json`、`registerMcpTools`（`tools/mcp/*`）；**CLI 启动时已加载** | **网关 / Dashboard 智能体默认加载 MCP**；服务发现、权限与运行观测一体化 |
| **P1** | **控制台配置真生效** | 网关侧 Profile 合并进 `toTurnInput`（`thinking` / `toolsEnabled` / `memoryEnabled` 等） | **`dragon agent` CLI** 走同一套 Profile；Tier / Dashboard 开关在全链路无遗漏 |
| **P1** | **渠道与多机协同** | Telegram/Slack 适配、`POST /channels/webhook`、Cron 投递 | 减少对外部 bridge 的硬依赖；设备配对、远程 Worker（见 Roadmap） |
| **P2** | **浏览器与读并行** | 轻量 `browser_*`；可选 `browser_playwright_snapshot`；只读工具**同轮并行**（`core/tool-parallel.ts`） | Playwright 可选依赖的安装与文档；富交互浏览器、流式并行读加强 |
| **P2** | **工程可维护 / CI** | 功能可用但 `gateway` / `cli` / `memory` 单文件约 2.4k–3.4k 行 | 模块拆分；`test-suite` 分片并行以缩短 CI |

**不在范围内**：IDE 插件、编辑器无缝嵌入（对标 Claude Code 终端/IDE 体验）——与通用 Agent 定位无关，**不纳入路线图**。

**落地与任务清单**：[能力补齐技术方案](docs/GAP_CLOSURE_PLAN.md)（分 Epic、验收标准、可跟踪任务 ID）。

> [!TIP]
> 延伸阅读：[能力补齐方案](docs/GAP_CLOSURE_PLAN.md) · [架构说明](docs/ARCHITECTURE.md) · [技术架构](docs/TECHNICAL_ARCHITECTURE.md) · [路线图](docs/ROADMAP.md) · [模块文档](docs/modules/README.md) · [插件指南](docs/PLUGINS.md) · [部署说明](docs/DEPLOYMENT.md)
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
  [--profile <id>] [--query-loop] [--finish-task] [--query-loop-max-turns <n>] \
  [--model <ref>] [--model-fallback <ref>] [--skill-root <path>] [--plugin-root <path>] \
  [--memory-dir <path>] [--memory-backend <id>] <message>

dragon gateway [--host <host>] [--port <port>] [--secret <value>] \
  [--session-dir <path>] [--allow-write] [--skill-root <path>] [--plugin-root <path>] \
  [--memory-dir <path>] [--memory-backend <id>] [--cron-jobs <path>]

dragon cron [--jobs <path>] [--gateway-url <url>] [--secret <value>] \
  [--once] [--interval-ms <ms>]

dragon channels serve [--port <port>] [--gateway-url <url>] [--secret <value>]
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
