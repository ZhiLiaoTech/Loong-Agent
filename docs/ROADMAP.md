# Loong Roadmap

> **Loong 桌面一体化**（Host + Studio + Desktop Surface）的详细阶段与任务 ID 见 [LOONG_PRODUCT_ARCHITECTURE.md](./LOONG_PRODUCT_ARCHITECTURE.md)。

## Phase 0: Foundation

Goal: establish the TypeScript workspace and design boundaries.

- Create pnpm workspace.
- Create package boundaries.
- Document architecture.
- Document reuse and license policy.
- Keep all packages minimal but compilable.
- Add TypeScript regression suite for high-risk runtime flows. Initial suite
  covers Gateway direct tools, Gateway WebSocket RPC/events, and memory
  candidate review, runtime tool-call loops, and provider tool-call
  translation/streaming. It also covers CLI skill slash commands, trajectory
  persistence/RPC, Gateway webhook channel delivery, channel adapters, sandbox
  command planning/execution, sandbox policy profiles, cron schedule/delivery
  targets, cron file stores/runners, browser snapshotting, delegation
  planning/running, runtime-backed delegation, the `delegation_run` agent tool,
  model catalog behavior, shared security redaction, and model provider plugin
  loading/routing.

## Phase 1: Minimal Coding Agent

Goal: make Loong useful from the CLI.

- Implement provider registry.
  Initial runtime fallback routing is implemented for retryable provider
  failures, with CLI `--model-fallback` / `LOONG_MODEL_FALLBACKS` support.
- Implement model catalog. Initial `@loong/model-catalog` package is
  implemented with provider-scoped metadata, default model derivation, aliases,
  and Gateway provider list exposure.
- Add one model provider.
- Implement basic session persistence.
- Implement file read/search tools.
- Implement shell execution tool.
- Implement patch editing tool.
- Implement basic permission prompts.
- Add shared security redaction. Initial `@loong/security` package is
  implemented and reused by provider diagnostics, runtime permission summaries,
  and CLI metadata output.
- Implement `loong chat`.
- Implement `loong agent`.

Success criteria:

```bash
loong chat "hello"
loong agent "summarize this repo"
loong agent "edit README and show diff"
```

## Phase 2: Gateway Runtime

Goal: turn Loong from a CLI into a local agent runtime.

- Implement WebSocket/HTTP gateway.
- Add handshake and health RPC.
- Add agent run RPC.
- Add event streaming.
- Add session queue and per-session lane.
- Add `loong gateway`.
- Add simple local dashboard.

Initial Gateway status:

- `GET /health` implemented.
- `POST /rpc` implements `health`, `connect`, and `agent`.
- Agent RPC returns run-scoped events in response.
- `GET /events` implements Server-Sent Events with `sessionId` and `runId`
  filters.
- `GET /ws` implements WebSocket RPC and live event streaming with `sessionId`
  and `runId` filters.
- OpenAI-compatible and Anthropic-compatible providers can emit true streamed
  text deltas into existing Gateway SSE/WebSocket event streams.
- `POST /rpc` implements `run.status`, `run.cancel`, and `runs.list`.
- Per-session lane serialization implemented.
- `loong gateway` implemented.
- Minimal local dashboard served at `/`.
- Dashboard tools panel implemented for `tools.catalog` and conservative
  direct `tool.invoke` actions.
- Dashboard memory review panel implemented for pending candidate
  promote/reject through dedicated Gateway RPCs.
- Dashboard cron panel implemented for listing, editing, removing, and manually
  ticking cron jobs.

## Phase 3: Skills And Memory

Goal: make Loong improve from repeated use.

- Implement `SKILL.md` loader.
- Implement `/skills` command. Initial local CLI slash command is implemented
  for listing and loading configured skills without requiring a model provider.
- Implement Markdown memory files. Initial read-only context injection is
  implemented for `USER.md`, `PROJECT.md`, `MEMORY.md`, and recent
  `notes/YYYY-MM-DD.md` files under the selected memory directory.
- Implement SQLite/FTS search. Initial optional built-in `sqlite` memory backend
  is implemented with Node `node:sqlite` and FTS5.
- Implement memory recall.
- Implement compaction and memory flush. Initial deterministic older-session
  compaction context is implemented. Explicit remember-style requests are
  captured as reviewable pending candidates; `memory_candidates_list`,
  `memory_candidate_promote`, and `memory_candidate_reject` provide an explicit
  review loop before durable long-term promotion.
- Save trajectory records.
- Add skill authoring and improvement workflow. Initial `skill_create` and
  `skill_improve` tools are implemented with reviewable file output.

## Phase 4: Plugin And Provider Ecosystem

Goal: make Loong extensible without editing core.

- Stabilize plugin SDK.
- Add plugin discovery. Initial CLI/gateway discovery is implemented for
  `.loong/plugins`, `LOONG_PLUGIN_ROOTS`, and `--plugin-root`.
- Add plugin observability. Initial gateway RPC and dashboard summary are
  implemented with `plugins.list`.
- Add provider observability. Initial gateway RPC and dashboard summary are
  implemented with `providers.list`, including provider-scoped model catalog
  entries when available.
- Add gateway tool observability and safe direct invocation. Initial
  `tools.catalog` and conservative `tool.invoke` RPCs are implemented with a
  default direct allowlist for read-only Git inspection tools.
- Add tool provider plugins. Initial read-only Git tools plugin is implemented
  as `@loong/plugin-git-tools`.
- Add model provider plugins.
- Add OpenAI-compatible provider plugin example. Initial workspace package is
  implemented as `@loong/plugin-openai-compatible`.
- Add OpenRouter-compatible provider plugin example. Initial workspace package
  is implemented as `@loong/plugin-openrouter-compatible`.
- Add Anthropic-compatible provider plugin example. Initial workspace package
  is implemented as `@loong/plugin-anthropic-compatible` with Messages API
  tool-use translation.
- Add memory backend plugins. Initial explicit-selection memory backend
  registration is implemented with `LOONG_MEMORY_BACKEND` / `--memory-backend`.
- Add hook lifecycle. Initial read-only lifecycle hooks are implemented.
- Migrate selected OpenClaw provider plugins.

## Phase 5: Multi-Surface Agent

Goal: make Loong available wherever the user works.

- IDE integration is out of scope for the current Loong plan.
- Add selected chat channels. Initial authenticated Gateway webhook channel is
  implemented at `POST /channels/webhook`. Initial `@loong/channels`
  adapters normalize Telegram and Slack payloads into that Gateway surface, and
  a Gateway webhook delivery target can forward normalized messages from
  channel bridge workers.
- Add browser automation. Initial `browser_snapshot` tool implements bounded
  HTTP(S) page inspection with title, visible text, links, and form structure
  extraction. Initial `browser_form_submit` handles basic GET and URL-encoded
  POST HTML forms with same-origin protection by default.
- Add Docker and SSH sandbox backends. Initial `sandbox_exec` support routes
  Loong's conservative read-only command allowlist through local, Docker, or
  SSH backends. Sandbox policy profiles are implemented for `versions`,
  `inspect`, `git-read`, `search-read`, and `repo-read`.
- Add cron delivery targets. Initial `@loong/cron` package implements
  five-field schedule parsing, next-run calculation, file-backed job storage,
  due-job runner controls, Gateway webhook delivery, and a `loong cron`
  CLI entrypoint for once-off or long-running execution. Gateway exposes
  `cron.jobs.list`, `cron.job.upsert`, `cron.job.remove`, and `cron.tick`, and
  `loong gateway` starts a local cron runner backed by `.loong/cron/jobs.json`.
- Add multi-agent delegation. Initial `@loong/delegation` package implements
  task plan validation, dependency-aware concurrent execution, failure-aware
  skipping, cycle rejection, and runtime-backed worker execution through a
  provided `LoongAgentRuntime`. The bounded `delegation_run` tool is wired
  into `loong agent` so the model can run independent or dependency-ordered
  subtasks through the same runtime and permission engine.
