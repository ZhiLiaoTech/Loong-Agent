<div align="center">

<img src="docs/images/banner.png" alt="Dragon — Chinese dragon banner" width="100%" />

<br />

<img src="docs/images/logo.png" alt="Dragon logo — traditional Chinese dragon" width="160" />

# Dragon · 潜龙

🐉 **潜龙在渊，智驭八方** — TypeScript-native, local-first agent framework

<p align="center">
  <a href="./README.md" title="简体中文">
    <img src="https://img.shields.io/badge/简体中文-README-C41E3A?style=for-the-badge" alt="简体中文" />
  </a>
  &nbsp;
  <a href="./README.en.md" title="English (current)">
    <img src="https://img.shields.io/badge/English-current-D4AF37?style=for-the-badge" alt="English" />
  </a>
</p>

<p align="center">
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-D4AF37?style=flat-square" alt="license">
  </a><!--
  --><a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="typescript">
  </a><!--
  --><a href="https://pnpm.io/">
    <img src="https://img.shields.io/badge/pnpm-10.11-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm">
  </a><!--
  --><img src="https://img.shields.io/badge/architecture-local--first-C41E3A?style=flat-square" alt="local-first"><!--
  --><img src="https://img.shields.io/badge/runtime-no%20Python-2E8B57?style=flat-square" alt="no python runtime">
</p>

<p align="center">
  <a href="#-about">About</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-packages">Packages</a> •
  <a href="#-cli">CLI</a> •
  <a href="#-gateway">Gateway</a> •
  <a href="#-documentation">Docs</a> •
  <a href="#-verification">Verify</a>
</p>

</div>

---

## 📝 About

Dragon (**Qianlong / 潜龙**) is a **TypeScript-native, local-first** agent framework. The dragon in our name is the **Chinese dragon (中国龙)** — a symbol of wisdom, adaptability, and command from the depths (*潜龙在渊*).

Dragon aims to combine:

| Source | What we take |
|--------|----------------|
| **OpenClaw** | Gateway, plugins, sessions, local-first architecture |
| **Hermes Agent** | Self-improving skills, memory, provider routing, trajectories |
| **Claude Code** | Coding-agent interaction, permissions, engineering workflow |

Hermes concepts are **reimplemented in TypeScript** where they fit — no Python in the runtime.

> [!TIP]
> Deep dives: [Architecture](docs/ARCHITECTURE.md) · [Technical architecture](docs/TECHNICAL_ARCHITECTURE.md) · [Modules](docs/modules/README.md) · [Plugins](docs/PLUGINS.md) · [Deployment](docs/DEPLOYMENT.md)
>
> Languages: [简体中文](README.md) · [English](README.en.md) (this page)

---

## 🚀 Quick Start

```bash
# Install dependencies
corepack pnpm install

# Build & verify
corepack pnpm check
corepack pnpm build
corepack pnpm test

# Chat once
dragon chat "Hello from the depths."

# Agent with tools (interactive write approval by default)
dragon agent "Summarize this repository."

# Local gateway + dashboard
dragon gateway
```

Open `http://127.0.0.1:17357/` after `dragon gateway` (default port `17357`; override with `--port`).

---

## 📦 Packages

| Package | Role |
|---------|------|
| `@dragon/core` | Agent turn runtime, lifecycle events, sessions, queues |
| `@dragon/gateway` | WebSocket/HTTP control plane |
| `@dragon/channels` | Chat-channel webhooks and Gateway delivery |
| `@dragon/tools` | Tool registry, permissions, built-in contracts |
| `@dragon/security` | Sensitive-key detection and secret redaction |
| `@dragon/providers` | Model provider routing |
| `@dragon/model-catalog` | Provider-scoped model metadata |
| `@dragon/memory` | Markdown, SQLite, and search memory |
| `@dragon/skills` | `SKILL.md` runtime and authoring |
| `@dragon/cron` | Cron parsing, file-backed jobs, runner |
| `@dragon/delegation` | Multi-agent plans, `delegation_run` tool |
| `@dragon/plugin-sdk` | Public plugin API |
| `@dragon/plugin-openai-compatible` | OpenAI-compatible provider plugin |
| `@dragon/plugin-openrouter-compatible` | OpenRouter provider plugin |
| `@dragon/plugin-anthropic-compatible` | Anthropic Messages + tool translation |
| `@dragon/plugin-git-tools` | Read-only Git inspection tools |
| `@dragon/test-suite` | TypeScript regression tests |
| `@dragon/cli` | Command-line entrypoint |

---

## 🖥️ CLI

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
<summary><strong>Agent capabilities</strong></summary>

- Read/search workspace files; conservative read-only shell allowlist
- `sandbox_exec` (local, Docker, or SSH) with `inspect`, `versions`, `git-read`, `search-read`, `repo-read` profiles
- `browser_snapshot`, `browser_form_submit`, `file_patch` (writes need approval unless `--allow-write`)
- `/skills`, `/skills <query>`, `/skills load <name>` — local, no model required
- `delegation_run`, `skill_create`, `skill_improve`, memory candidate promote/reject

</details>

<details>
<summary><strong>Models, plugins, memory</strong></summary>

- Model refs: `openai:gpt-4o`, `anthropic:claude-sonnet-4-5`, etc. Config: `.dragon/config/providers.json`
- Agent profiles: `.dragon/config/agents.json`
- Fallbacks: `--model-fallback` or `DRAGON_MODEL_FALLBACKS`
- Plugins: `.dragon/plugins`, `DRAGON_PLUGIN_ROOTS`, `--plugin-root`
- Memory: `file` (default), `sqlite`, Markdown under `USER.md` / `PROJECT.md` / `MEMORY.md` / `notes/`
- Candidates: `.dragon/memory/candidates/` — promote before search/injection

</details>

---

## 🌐 Gateway

`dragon gateway` serves a minimal dashboard at `/` with workspaces **Run**, **Models**, **Agents**, **Observe**, and **System**.

| Surface | Purpose |
|---------|---------|
| `GET /health` | Health check |
| `GET /events` | SSE stream (`sessionId` / `runId` filters) |
| `GET /ws` | WebSocket RPC + events |
| `POST /rpc` | `connect`, `health`, `agent`, `run.status`, `run.cancel`, `runs.list`, config, plugins, tools, memory, trajectory, cron, … |
| `POST /channels/webhook` | Authenticated channel ingress (Telegram/Slack adapters in `@dragon/channels`) |

<details>
<summary><strong>RPC highlights</strong></summary>

- `providers.list` — provider ids, models, tool-calling capability (no raw API keys returned)
- `plugins.list` — names, tools, providers, memory backends, hooks (no filesystem paths)
- `tools.catalog` / `tool.invoke` — direct invoke is stricter than the agent loop (read-only allowlist by default)
- OpenAI/Anthropic-compatible plugins can stream true text deltas via `assistant_delta` events
- Cron: `.dragon/cron/jobs.json`, `dragon cron --once` or long-running runner (also started by gateway by default)

</details>

---

## 📚 Documentation

| Topic | Link |
|-------|------|
| Architecture & reuse plan | [ARCHITECTURE.md](docs/ARCHITECTURE.md) · [REUSE_PLAN.md](docs/REUSE_PLAN.md) |
| Technical design | [TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md) |
| Per-module specs | [modules/README.md](docs/modules/README.md) |
| Plugins | [PLUGINS.md](docs/PLUGINS.md) |
| Deploy & smoke test | [DEPLOYMENT.md](docs/DEPLOYMENT.md) |

---

## ✅ Verification

```bash
corepack pnpm check
corepack pnpm build
corepack pnpm test
corepack pnpm smoke:gateway
```

`corepack pnpm test` covers CLI skills, Gateway RPC/WS/webhook/cron, channels, memory candidates, trajectories, sandbox, browser tools, delegation, model catalog, provider plugins, and security redaction.

---

## 📜 License

[MIT License](./LICENSE) — Copyright (c) 2026 Dragon Authors

---

<div align="center">

<p>
  <a href="./README.md">简体中文</a> ·
  <a href="./README.en.md"><strong>English</strong></a>
</p>

<sub>🐉 Built with TypeScript · Local-first · 潜龙在渊，智驭八方</sub>

</div>
