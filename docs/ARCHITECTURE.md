# Dragon Architecture

Dragon is a TypeScript-native, local-first agent framework. The design goal is
to combine a strong coding-agent runtime, a long-lived local gateway, and a
self-improving skills and memory system without adding a second language
runtime.

## Product Positioning

Dragon is not only a terminal coding assistant and not only a chat bot gateway.
It is an agent framework with a stable runtime core:

```text
Interfaces  ->  Gateway  ->  Session/Event Bus  ->  Agent Runtime
CLI             HTTP/WS      Queue + persistence     Context + model + tools
Web             RPC          Lifecycle stream        Memory + skills
IDE             Auth         Locks                   Permissions
Channels        Pairing      Observability           Trajectory
```

## Architectural Principles

- TypeScript only. No Python runtime is required by core Dragon.
- Local-first. The default deployment is a local workspace and local gateway.
- Protocol-first. Gateway, tools, plugins, and providers use typed contracts.
- Auditable memory. Durable knowledge is visible as files or queryable records.
- Permission by design. Tool execution is mediated by a dedicated policy layer.
- Incremental reuse. OpenClaw modules are migrated into Dragon boundaries one at
  a time, with attribution preserved.

## Package Responsibilities

### `@dragon/core`

Owns the agent turn lifecycle:

- input normalization
- session resolution
- queue and lane locking
- context assembly
- model call orchestration
- tool-call loop
- event emission
- persistence hooks
- final turn result

### `@dragon/gateway`

Owns the long-lived control plane:

- WebSocket and HTTP server
- client handshake
- health/status RPC
- agent run RPC
- authenticated webhook channel ingress
- cron job management RPC and manual tick
- device/client pairing
- event fanout
- future node and channel integration

### `@dragon/channels`

Owns chat-channel adapter primitives:

- Telegram webhook payload normalization
- Slack event and slash-command normalization
- stable Gateway webhook payload generation
- channel metadata projection without coupling platform details into Gateway

### `@dragon/tools`

Owns tool definitions and execution contracts:

- tool registry
- input schema
- execution result shape
- permission hints
- built-ins: file, shell, patch, sandbox command execution, browser page
  snapshots, git, memory, skills; future built-ins include richer browser
  automation, web, and MCP

### `@dragon/providers`

Owns model provider contracts:

- provider registry
- model reference resolution
- request/response shape
- tool-call compatibility
- OpenAI-compatible and Anthropic Messages API provider adapters
- future provider plugins

Provider prefixes are explicit routing namespaces. If `openai` or `anthropic`
is registered, `openai:gpt-4o`, `openai/gpt-4o`, or
`anthropic:claude-sonnet-4-5` route to that provider; if a raw model name
collides with a provider id, callers should use an explicit provider prefix for
the intended target.

### `@dragon/memory`

Owns memory abstractions:

- Markdown memory files
- optional SQLite/FTS search layer via the built-in `sqlite` memory backend
- session recall
- deterministic older-session compaction for bounded context
- reviewable pending memory candidates for explicit remember-style requests
- explicit memory candidate list/promote/reject tools; compaction and candidate
  capture do not automatically write durable memory records

### `@dragon/skills`

Owns `SKILL.md` runtime:

- progressive disclosure
- slash-command exposure
- reference loading
- skill creation
- skill improvement from evidence

### `@dragon/cron`

Owns cron scheduling and delivery primitives:

- five-field cron expression parsing
- next-run calculation in UTC
- file-backed job storage for local deployments
- due-job runner with tick/start/stop controls
- Gateway webhook delivery target
- cron metadata projection into channel messages

### `@dragon/delegation`

Owns multi-agent orchestration primitives:

- delegated task plan validation
- dependency graph cycle detection
- bounded concurrent execution
- failure-aware dependent task skipping
- runtime-backed worker execution through a provided `DragonAgentRuntime`

### `@dragon/plugin-sdk`

Owns public extension contracts:

- plugin manifest
- secure local plugin loader
- tool registration
- provider registration
- memory backend registration for durable recall stores
- lifecycle hook registration for read-only turn observability
- future hooks, channels, and memory backends

### `@dragon/cli`

Owns the command-line entrypoint:

- `dragon chat`
- `dragon agent`
- `dragon gateway`
- `dragon cron`
- Gateway-hosted cron runner backed by `.dragon/cron/jobs.json`
- local plugin discovery from `.dragon/plugins`, `DRAGON_PLUGIN_ROOTS`, and
  `--plugin-root`
- plugin tools join agent/gateway tool registries and keep Dragon's permission
  contract: explicit `allow` can run unattended, explicit `deny` is refused,
  and omitted permission asks; ask is skipped when no handler is available
- reference read-only Git tool plugin for status, diff, and log inspection
- `sandbox_exec` for routing the conservative read-only command allowlist
  through local, Docker, or SSH backends when a target is explicitly provided
- Markdown memory files in the selected memory dir are injected as read-only
  context when present
- older session messages beyond the recent history window are injected as
  bounded deterministic compaction context when session storage is enabled
- memory backend plugins are selected explicitly with `DRAGON_MEMORY_BACKEND`
  or `--memory-backend`; the built-in `file` backend remains the default, and
  the built-in `sqlite` backend can be selected for local FTS search
- future interactive TUI

## Turn Lifecycle

```text
1. Receive input
2. Resolve session and workspace
3. Acquire session lane
4. Load bootstrap context
5. Recall memory
6. Select relevant skills
7. Resolve model provider
8. Call model
9. Handle tool calls
10. Apply permission policy
11. Execute tools
12. Stream lifecycle/tool/assistant events
13. Persist transcript and trajectory
14. Persist observability; future hooks may trigger reviewed memory flush or skill learning
15. Return final result
```

## Event Model

Dragon events should stay stable even as internals change:

- `lifecycle`: run start, end, error, cancelled
- `assistant_delta`: streamed assistant text
- `tool`: tool start, update, end
- `permission`: bounded approval request and resolution events
- later: `memory`, `skill`, `compaction`, `trajectory`

## Current Gateway RPC

The initial gateway is dependency-free and exposes HTTP, SSE, and WebSocket
surfaces:

- `GET /health`
- `GET /` for a minimal local dashboard
- `GET /events` for Server-Sent Events
- `GET /ws` for WebSocket RPC and live events
- `POST /channels/webhook` for authenticated JSON chat-channel delivery into
  the same agent lane, event stream, and trajectory pipeline
- `POST /rpc` with `health`, `connect`, `agent`, run, provider, plugin, tool,
  memory review, and trajectory request types
- per-session agent lane serialization
- run-scoped event collection returned with the `agent` response
- live SSE/WebSocket event stream filters by `sessionId` or `runId`
- model providers can emit true text deltas through the unified
  `onTextDelta` callback; Gateway SSE/WebSocket clients receive those as
  `assistant_delta` events
- run status, cancellation, and recent run listing
- loaded plugin summary listing for dashboard and operators
- `connect` capabilities include `events.websocket`, `providers.list`,
  `plugins.list`, `tools.catalog`, `tool.invoke`, and `channels.webhook` when
  the surfaces are available
- `GET /health` includes `providerCount` and `pluginCount`
- `providers.list` returns configured provider ids, display names, default
  models, and whether the provider advertises tool calling
- `plugins.list` returns plugin name, version, description, tool summaries, and
  provider/memory backend/hook summaries; it intentionally does not expose
  plugin filesystem paths
- `tools.catalog` returns runtime tool summaries and can include input schemas
- `tool.invoke` executes only explicit direct-invoke tools. The default direct
  allowlist is `git_status`, `git_diff`, and `git_log`; the tool must still
  declare `permission: "allow"`, avoid write/network/memory/custom
  capabilities, and pass the configured permission engine.

Run records expose bounded summaries for status/list views. Full turn results
remain in the direct `agent` RPC response for that request, not in retained run
history.

When shared-secret auth is enabled, the dashboard HTML shell remains reachable
so a browser can load it and submit the secret through request headers. Runtime
data endpoints (`/health`, `/events`, `/ws`, `/rpc`) remain protected.

## First Implementation Target

The first useful milestone is:

```bash
dragon chat "hello"
dragon agent "summarize this repository"
dragon agent "edit README and show the diff"
```

To reach that milestone, implement only:

- one provider path
- file read/search
- shell command execution
- patch editing
- session persistence
- basic permission prompts
