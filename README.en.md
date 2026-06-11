<div align="center">

<img src="docs/images/banner.png" alt="Loong — Chinese loong banner" width="100%" />

<br />

<img src="docs/images/logo.png" alt="Loong logo — traditional Chinese loong" width="160" />

# Loong

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

Loong (**Qianlong / 潜龙**) is a **TypeScript-native, local-first** agent framework. The loong in our name is the **Chinese loong (中国龙)** — a symbol of wisdom, adaptability, and command from the depths (*潜龙在渊*).

We align with proven patterns from mainstream local and coding agents, implemented in a **single TypeScript runtime**—no Python/Node split:

| Source | What we take | How Loong implements it |
|--------|----------------|---------------------------|
| **Loong native runtime** | Gateway, plugins, sessions, headless deployment | `@loong/gateway` (HTTP/WS/SSE RPC), Suite materialization, plugin discovery, per-session lanes, Dashboard |
| **Hermes Agent** | Skill evolution, memory, routing, trajectories | `SKILL.md` + skill tools, reviewable memory candidates, tier routing & fallback, trajectory store |
| **Claude Code** | Coding UX, permissions, engineering toolchain | file/patch/shell/sandbox tools, interactive `ask` approvals, turn-level tool loop & events |

Hermes concepts are **reimplemented in TypeScript** where they fit — no Python in the runtime.

### Strengths already in the codebase

Compared with “CLI-only coding assistants” or “chat-only gateways,” Loong wires **control plane + runtime core + extensible tools** into one auditable local stack:

- **Clear boundaries, embeddable core**: `@loong/core` does not depend on Gateway/Memory; `runTurn` runs in CLI, Gateway, and delegation workers; unified `LoongEvent` streams power Dashboard and trajectory replay.
- **Complete local control plane**: Gateway exposes `agent`, `run.cancel`, `runs.list`, and observability RPCs for cron/plugins/providers; per-`sessionId` lanes prevent concurrent turn corruption.
- **Resilient model layer**: provider plugins (OpenAI / Anthropic / OpenRouter compatible), retryable fallback chains, tier heuristics, streaming deltas; in-turn **Turn Prep** with reactive retry on context overflow.
- **Safe tool defaults**: workspace constraints, shell allowlists, sandbox backends (local/Docker/SSH), secret redaction; writes default to `ask` with pluggable permission handlers.
- **Hardened tool loop**: graceful cap handling (`tool_iteration_limit` + tool-free summary) and cancel-safe tool protocol (`turn_cancelled` synthetic results) so providers never see dangling `tool_use` ids.
- **Auditable memory & skills**: Markdown + optional SQLite/FTS; “remember” flows go through **pending candidates** before promotion; `skill_create` / `skill_improve` support iteration.
- **Multi-agent & automation**: `@loong/delegation` dependency graphs + `delegation_run`; cron file store & Gateway tick; `@loong/channels` for Telegram/Slack webhooks; optional `@loong/org` routing and approvals.
- **Broad regression coverage**: `@loong/test-suite` exercises Gateway WS, provider tool translation/streaming, memory review, delegation, cron, sandbox, and cancel protocol paths.

### Technical challenges to tackle next

Relative to the depth expected from a production headless agent runtime, these are the main gaps to close:

| Priority | Challenge | Notes |
|----------|-----------|-------|
| **P0** | **Session-level query loop** | Claude Code drives sessions via `queryLoop`; Loong still uses one `runTurn` per user message. A **SessionTurnCoordinator** in Gateway (queue, resume, cross-turn state) should unify CLI/Gateway/delegation semantics. |
| **P0** | **Cross-turn tool context** | Long sessions fill context with tool outputs. Session-level summarization/compaction (Hermes-style + Claude-style prep) must complement per-call Turn Prep. |
| **P0** | **Gateway hardening for production** | Default `authMode: none` is fine for localhost; shared/remote deploys need auth-by-default, rate limits, and tighter direct-tool allowlists. |
| **P1** | **First-class MCP** | The ecosystem is converging on MCP; `@loong/tools` needs protocol adapters, discovery, and permission mapping—not only built-ins. |
| **P1** | **End-to-end config wiring** | Agent profiles, `thinking` levels, `toolsEnabled`/`memoryEnabled` must flow through `runTurn` and Gateway `toTurnInput` so Dashboard settings actually apply. |
| **P1** | **Channels & nodes** | Channel adapters exist but Gateway still expects an external bridge; multi-node pairing and remote workers remain on the roadmap. |
| **P2** | **Browser & parallel tools** | Today’s `browser_snapshot` / `browser_form_submit` are lightweight; Playwright-class automation and parallel read-only tool execution need more work. |
| **P2** | **Native IDE integration** | Claude Code is deeply tied to terminal/IDE workflows; Loong is CLI + Gateway Dashboard first. |
| **P2** | **Modularity & CI speed** | Large `memory`/`cli`/`gateway` modules should split; the test suite can shard for faster CI. |

> [!TIP]
> Deep dives: [Architecture](docs/ARCHITECTURE.md) · [Technical architecture](docs/TECHNICAL_ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md) · [Modules](docs/modules/README.md) · [Plugins](docs/PLUGINS.md) · [Deployment](docs/DEPLOYMENT.md)
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
loong chat "Hello from the depths."

# Agent with tools (interactive write approval by default)
loong agent "Summarize this repository."

# Local gateway + dashboard
loong gateway
```

Open `http://127.0.0.1:17357/` after `loong gateway` (default port `17357`; override with `--port`).

---

## 📦 Packages

| Package | Role |
|---------|------|
| `@loong/core` | Agent turn runtime, lifecycle events, sessions, queues |
| `@loong/gateway` | WebSocket/HTTP control plane |
| `@loong/channels` | Chat-channel webhooks and Gateway delivery |
| `@loong/tools` | Tool registry, permissions, built-in contracts |
| `@loong/security` | Sensitive-key detection and secret redaction |
| `@loong/providers` | Model provider routing |
| `@loong/model-catalog` | Provider-scoped model metadata |
| `@loong/memory` | Markdown, SQLite, and search memory |
| `@loong/skills` | `SKILL.md` runtime and authoring |
| `@loong/cron` | Cron parsing, file-backed jobs, runner |
| `@loong/delegation` | Multi-agent plans, `delegation_run` tool |
| `@loong/plugin-sdk` | Public plugin API |
| `@loong/plugin-openai-compatible` | OpenAI-compatible provider plugin |
| `@loong/plugin-openrouter-compatible` | OpenRouter provider plugin |
| `@loong/plugin-anthropic-compatible` | Anthropic Messages + tool translation |
| `@loong/plugin-git-tools` | Read-only Git inspection tools |
| `@loong/test-suite` | TypeScript regression tests |
| `@loong/cli` | Command-line entrypoint |

---

## 🖥️ CLI

```bash
loong chat [--session <id>] [--session-dir <path>] [--no-session] \
  [--model <ref>] [--model-fallback <ref>] [--plugin-root <path>] <message>

loong agent [--session <id>] [--session-dir <path>] [--no-session] [--allow-write] \
  [--model <ref>] [--model-fallback <ref>] [--skill-root <path>] [--plugin-root <path>] \
  [--memory-dir <path>] [--memory-backend <id>] <message>

loong gateway [--host <host>] [--port <port>] [--secret <value>] \
  [--session-dir <path>] [--allow-write] [--skill-root <path>] [--plugin-root <path>] \
  [--memory-dir <path>] [--memory-backend <id>] [--cron-jobs <path>]

loong cron [--jobs <path>] [--gateway-url <url>] [--secret <value>] \
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

- Model refs: `openai:gpt-4o`, `anthropic:claude-sonnet-4-5`, etc. Config: `.loong/config/providers.json`
- Agent profiles: `.loong/config/agents.json`
- Fallbacks: `--model-fallback` or `LOONG_MODEL_FALLBACKS`
- Plugins: `.loong/plugins`, `LOONG_PLUGIN_ROOTS`, `--plugin-root`
- Memory: `file` (default), `sqlite`, Markdown under `USER.md` / `PROJECT.md` / `MEMORY.md` / `notes/`
- Candidates: `.loong/memory/candidates/` — promote before search/injection

</details>

---

## 🌐 Gateway

`loong gateway` serves a minimal dashboard at `/` with workspaces **Run**, **Models**, **Agents**, **Observe**, and **System**.

| Surface | Purpose |
|---------|---------|
| `GET /health` | Health check |
| `GET /events` | SSE stream (`sessionId` / `runId` filters) |
| `GET /ws` | WebSocket RPC + events |
| `POST /rpc` | `connect`, `health`, `agent`, `run.status`, `run.cancel`, `runs.list`, config, plugins, tools, memory, trajectory, cron, … |
| `POST /channels/webhook` | Authenticated channel ingress (Telegram/Slack adapters in `@loong/channels`) |

<details>
<summary><strong>RPC highlights</strong></summary>

- `providers.list` — provider ids, models, tool-calling capability (no raw API keys returned)
- `plugins.list` — names, tools, providers, memory backends, hooks (no filesystem paths)
- `tools.catalog` / `tool.invoke` — direct invoke is stricter than the agent loop (read-only allowlist by default)
- OpenAI/Anthropic-compatible plugins can stream true text deltas via `assistant_delta` events
- Cron: `.loong/cron/jobs.json`, `loong cron --once` or long-running runner (also started by gateway by default)

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

[MIT License](./LICENSE) — Copyright (c) 2026 Loong Authors

---

<div align="center">

<p>
  <a href="./README.md">简体中文</a> ·
  <a href="./README.en.md"><strong>English</strong></a>
</p>

<sub>🐉 Built with TypeScript · Local-first · 潜龙在渊，智驭八方</sub>

</div>
