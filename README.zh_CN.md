<div align="center">

<img src="docs/images/banner.png" alt="Dragon — 中国龙主题横幅" width="100%" />

<br />

<img src="docs/images/logo.png" alt="Dragon 标志 — 中国龙" width="160" />

# Dragon · 潜龙

🐉 **潜龙在渊，智驭八方** — 原生 TypeScript、本地优先的智能体框架

<p align="center">
  <strong>简体中文</strong> |
  <a href="./README.md">English</a>
</p>

<p align="center">
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/许可证-MIT-D4AF37?style=flat-square" alt="license">
  </a><!--
  --><a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="typescript">
  </a><!--
  --><a href="https://pnpm.io/">
    <img src="https://img.shields.io/badge/pnpm-10.11-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm">
  </a><!--
  --><img src="https://img.shields.io/badge/架构-本地优先-C41E3A?style=flat-square" alt="local-first"><!--
  --><img src="https://img.shields.io/badge/运行时-无%20Python-2E8B57?style=flat-square" alt="no python">
</p>

<p align="center">
  <a href="#-项目简介">简介</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-软件包">软件包</a> •
  <a href="#-命令行">CLI</a> •
  <a href="#-网关">网关</a> •
  <a href="#-文档">文档</a> •
  <a href="#-验证">验证</a>
</p>

</div>

---

## 📝 项目简介

**Dragon（潜龙 / Qianlong）** 是 **原生 TypeScript、本地优先** 的智能体框架。项目中的「龙」指 **中国龙（🐉）** —— 象征深潜蓄势、智慧驭势（*潜龙在渊，智驭八方*）。

Dragon 借鉴业界优秀Agent框架的精髓，取其精华，融合：

| 来源 | 借鉴能力 |
|------|----------|
| **OpenClaw** | 网关、插件、会话、本地优先架构 |
| **Hermes Agent** | 可进化技能、记忆、模型路由、轨迹 |
| **Claude Code** | 编码智能体交互、权限体验、工程工作流 |

> [!TIP]
> 深入阅读：[架构](docs/ARCHITECTURE.md) · [技术架构](docs/TECHNICAL_ARCHITECTURE.md) · [模块说明](docs/modules/README.md) · [插件](docs/PLUGINS.md) · [部署](docs/DEPLOYMENT.md)

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

# 带工具的智能体（默认交互式写入需审批）
dragon agent "概括本仓库结构。"

# 本地网关 + 控制台
dragon gateway
```

启动 `dragon gateway` 后访问 `http://127.0.0.1:17357/`（默认端口 `17357`，可用 `--port` 覆盖）。

---

## 📦 软件包

| 包名 | 职责 |
|------|------|
| `@dragon/core` | 智能体回合运行时、生命周期事件、会话、队列 |
| `@dragon/gateway` | WebSocket/HTTP 控制平面 |
| `@dragon/channels` | 聊天渠道 Webhook 与 Gateway 投递 |
| `@dragon/tools` | 工具注册、权限、内置契约 |
| `@dragon/security` | 敏感键检测与密钥脱敏 |
| `@dragon/providers` | 模型提供商路由 |
| `@dragon/model-catalog` | 按提供商划分的模型元数据 |
| `@dragon/memory` | Markdown、SQLite、搜索记忆 |
| `@dragon/skills` | `SKILL.md` 运行时与编写 |
| `@dragon/cron` | Cron 解析、文件任务、运行器 |
| `@dragon/delegation` | 多智能体编排、`delegation_run` 工具 |
| `@dragon/plugin-sdk` | 公开插件 API |
| `@dragon/plugin-openai-compatible` | OpenAI 兼容提供商插件 |
| `@dragon/plugin-openrouter-compatible` | OpenRouter 插件 |
| `@dragon/plugin-anthropic-compatible` | Anthropic Messages + 工具翻译 |
| `@dragon/plugin-git-tools` | 只读 Git 检查工具 |
| `@dragon/test-suite` | TypeScript 回归测试 |
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

- 读写/搜索工作区；保守的只读 Shell 白名单
- `sandbox_exec`（本地 / Docker / SSH），配置 `inspect`、`versions`、`git-read` 等
- `browser_snapshot`、`browser_form_submit`、`file_patch`（写入需审批，除非 `--allow-write`）
- `/skills`、`/skills <query>`、`/skills load <name>` — 本地执行，无需模型
- `delegation_run`、`skill_create`、`skill_improve`、记忆候选晋升/拒绝

</details>

<details>
<summary><strong>模型、插件、记忆</strong></summary>

- 模型引用：`openai:gpt-4o`、`anthropic:claude-sonnet-4-5` 等；配置 `.dragon/config/providers.json`
- 智能体配置：`.dragon/config/agents.json`
- 回退：`--model-fallback` 或 `DRAGON_MODEL_FALLBACKS`
- 插件：`.dragon/plugins`、`DRAGON_PLUGIN_ROOTS`、`--plugin-root`
- 记忆：默认 `file`，可选 `sqlite`；`USER.md` / `PROJECT.md` / `MEMORY.md` / `notes/`
- 候选记忆在 `.dragon/memory/candidates/`，需晋升后才参与检索

</details>

---

## 🌐 网关

`dragon gateway` 在 `/` 提供控制台，包含 **运行、模型、智能体、观测、系统** 五个工作区。

| 接口 | 说明 |
|------|------|
| `GET /health` | 健康检查 |
| `GET /events` | SSE 事件流（可按 `sessionId` / `runId` 过滤） |
| `GET /ws` | WebSocket RPC + 事件 |
| `POST /rpc` | 连接、健康、智能体、运行、配置、插件、工具、记忆、轨迹、定时任务等 |
| `POST /channels/webhook` | 认证后的渠道入站（`@dragon/channels` 含 Telegram/Slack 适配） |

<details>
<summary><strong>RPC 要点</strong></summary>

- `providers.list` — 提供商与模型能力（不返回原始 API Key）
- `plugins.list` — 插件、工具、记忆后端摘要（不含路径）
- `tools.catalog` / `tool.invoke` — 直连调用比智能体循环更严格（默认只读白名单）
- 兼容 OpenAI/Anthropic 的插件可通过 `assistant_delta` 推送真实文本增量
- 定时任务：`.dragon/cron/jobs.json`；`dragon cron --once` 或常驻运行（网关默认也会启动）

</details>

---

## 📚 文档

| 主题 | 链接 |
|------|------|
| 架构与复用计划 | [ARCHITECTURE.md](docs/ARCHITECTURE.md) · [REUSE_PLAN.md](docs/REUSE_PLAN.md) |
| 技术设计 | [TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md) |
| 模块规格 | [modules/README.md](docs/modules/README.md) |
| 插件 | [PLUGINS.md](docs/PLUGINS.md) |
| 部署与冒烟 | [DEPLOYMENT.md](docs/DEPLOYMENT.md) |

---

## ✅ 验证

```bash
corepack pnpm check
corepack pnpm build
corepack pnpm test
corepack pnpm smoke:gateway
```

`corepack pnpm test` 覆盖 CLI 技能、Gateway RPC/WS/Webhook/Cron、渠道、记忆候选、轨迹、沙箱、浏览器工具、委派、模型目录、提供商插件与安全脱敏等。

---

## 📜 许可证

[MIT License](./LICENSE) — Copyright (c) 2026 Dragon Authors

---

<div align="center">

<sub>🐉 TypeScript 构建 · 本地优先 · 潜龙在渊，智驭八方</sub>

</div>
