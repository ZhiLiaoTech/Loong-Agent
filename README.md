<div align="center">

<img src="docs/images/banner.png" alt="Loong — 中国龙主题横幅" width="100%" />

<br />

<img src="docs/images/logo.png" alt="Loong 标志 — 中国龙" width="160" />

# Loong

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
  --><img src="https://img.shields.io/badge/架构-本地优先-C41E3A?style=flat-square" alt="本地优先">
</p>

<p align="center">
  <a href="#-项目简介">项目简介</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-软件包">软件包</a> •
  <a href="#-命令行">命令行</a> •
  <a href="#-网关">网关</a> •
  <a href="#-文档">文档</a> •
  <a href="#-验证">验证</a> •
  <a href="docs/CHANNELS.md">渠道桥接</a>
</p>

</div>

---

## 📝 项目简介

**Loong（潜龙 / Qianlong）** 是 **原生 TypeScript、本地优先** 的智能体框架。名称中的「龙」指 **中国龙（🐉）** —— 象征深潜蓄势、审时度势、终而智驭八方（*潜龙在渊，智驭八方*）。


### 已实现的优势

> **一句话**：潜龙让您在自家环境里，用得上、管得住、换得了模型的 AI 帮手——少踩「演示很美、上线很惨」的坑。

相对「只有聊天页的 Bot」或「只能在终端里用的编码助手」，潜龙把能力连成一条**在您掌控下、可审计**的本地链路。下面说明**对您意味着什么**（实现细节见 [模块文档](docs/modules/README.md)）。

#### 客户最容易感受到的三点

1. **该省的钱省下来，该花的钱花在关键任务上。** 潜龙支持按任务复杂度做多模型分级调度：简单任务优先走更快、更省的模型，复杂任务再切到更强的模型，并可配置失败回退。对您来说，结果就是整体成本更低、响应更快，但关键任务质量依然稳得住。
2. **不是只会回答问题，而是真的能把事情一步步做完。** 潜龙不是停留在“给建议”的层面，而是会围绕任务持续收集上下文、执行动作、检查结果，必要时继续推进。对您来说，这意味着很多需求可以从“问答”升级为“交付”，减少人工反复盯过程、补步骤、催结果。
3. **越用越懂业务，但又不会乱记、乱用。** 潜龙支持持续记忆与长会话压缩，同时把长期记忆做成可审核、可晋升的机制。对您来说，一方面能减少重复解释、重复交代背景，另一方面也更容易满足内部合规和风险控制要求。

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



> **产品定位**：潜龙是**通用 AI Agent**（命令行、网关控制台、聊天渠道、多智能体分工），**不以 IDE/编辑器深度绑定为目标**（见 [路线图](docs/ROADMAP.md) Phase 5）。
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
loong chat "潜龙试爪。"

# 带工具的智能体（默认：写入操作需交互审批）
loong agent "概括本仓库的结构与模块。"

# 启动本地网关与控制台
loong gateway
```

执行 `loong gateway` 后，在浏览器打开 `http://127.0.0.1:17357/`（默认端口 `17357`，可用 `--port` 修改）。

---

## 📦 软件包

| 包名 | 说明 |
|------|------|
| `@loong/core` | 智能体回合运行时、生命周期事件、会话、队列 |
| `@loong/gateway` | WebSocket / HTTP 控制平面 |
| `@loong/channels` | 聊天渠道 Webhook 与 Gateway 消息投递 |
| `@loong/tools` | 工具注册表、权限控制、内置工具契约 |
| `@loong/security` | 敏感键检测与密钥脱敏 |
| `@loong/providers` | 模型提供商路由 |
| `@loong/model-catalog` | 按提供商划分的模型元数据 |
| `@loong/memory` | Markdown、SQLite 与搜索型记忆 |
| `@loong/skills` | `SKILL.md` 技能运行时与编写 |
| `@loong/cron` | Cron 表达式解析、文件任务存储与执行器 |
| `@loong/delegation` | 多智能体任务编排与 `delegation_run` 工具 |
| `@loong/plugin-sdk` | 对外公开的插件 API |
| `@loong/plugin-openai-compatible` | OpenAI 兼容协议提供商插件 |
| `@loong/plugin-openrouter-compatible` | OpenRouter 提供商插件 |
| `@loong/plugin-anthropic-compatible` | Anthropic Messages API 与工具调用翻译 |
| `@loong/plugin-git-tools` | 只读 Git 仓库检查工具 |
| `@loong/test-suite` | TypeScript 回归测试套件 |
| `@loong/cli` | 命令行入口 |

---

## 🖥️ 命令行

```bash
loong chat [--session <id>] [--session-dir <path>] [--no-session] \
  [--model <ref>] [--model-fallback <ref>] [--plugin-root <path>] <message>

loong agent [--session <id>] [--session-dir <path>] [--no-session] [--allow-write] \
  [--profile <id>] [--query-loop] [--finish-task] [--query-loop-max-turns <n>] \
  [--model <ref>] [--model-fallback <ref>] [--skill-root <path>] [--plugin-root <path>] \
  [--memory-dir <path>] [--memory-backend <id>] <message>

loong gateway [--host <host>] [--port <port>] [--secret <value>] \
  [--session-dir <path>] [--allow-write] [--skill-root <path>] [--plugin-root <path>] \
  [--memory-dir <path>] [--memory-backend <id>] [--cron-jobs <path>]

loong cron [--jobs <path>] [--gateway-url <url>] [--secret <value>] \
  [--once] [--interval-ms <ms>]

loong channels serve [--port <port>] [--gateway-url <url>] [--secret <value>]
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

- 模型引用示例：`openai:gpt-4o`、`anthropic:claude-sonnet-4-5`；配置文件 `.loong/config/providers.json`
- 智能体配置：`.loong/config/agents.json`
- 失败回退：`--model-fallback` 或环境变量 `LOONG_MODEL_FALLBACKS`
- 插件目录：`.loong/plugins`、`LOONG_PLUGIN_ROOTS`、`--plugin-root`
- 记忆后端：默认 `file`，可选 `sqlite`；Markdown 记忆包括 `USER.md`、`PROJECT.md`、`MEMORY.md`、`notes/` 等
- 候选记忆位于 `.loong/memory/candidates/`，须经晋升后才参与检索与注入

</details>

---

## 🌐 网关

`loong gateway` 在 `/` 提供轻量控制台，包含 **运行、模型、智能体、观测、系统** 五个工作区。

| 接口 | 说明 |
|------|------|
| `GET /health` | 健康检查 |
| `GET /events` | SSE 事件流（支持 `sessionId` / `runId` 过滤） |
| `GET /ws` | WebSocket RPC 与事件推送 |
| `POST /rpc` | 连接、健康检查、智能体调用、运行状态、配置、插件、工具、记忆、轨迹、定时任务等 |
| `POST /channels/webhook` | 经认证的聊天渠道入站（`@loong/channels` 提供 Telegram / Slack 适配） |

<details>
<summary><strong>RPC 要点</strong></summary>

- `providers.list`：列出提供商、模型及工具调用能力（不返回原始 API Key）
- `plugins.list`：插件名、工具、提供商、记忆后端、钩子摘要（不含文件系统路径）
- `tools.catalog` / `tool.invoke`：直连调用比智能体循环更严格（默认仅只读白名单）
- 兼容 OpenAI / Anthropic 的插件可通过 `assistant_delta` 事件推送真实文本增量
- 定时任务：任务文件 `.loong/cron/jobs.json`；`loong cron --once` 单次执行或常驻运行（网关默认也会启动定时任务）

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

本项目采用 [MIT 许可证](./LICENSE)，Copyright (c) 2026 Loong Authors。

---

<div align="center">

<p>
  <a href="./README.md"><strong>简体中文</strong></a> ·
  <a href="./README.en.md">English</a>
</p>

<sub>🐉 以 TypeScript 构建 · 本地优先 · 潜龙在渊，智驭八方</sub>

</div>
