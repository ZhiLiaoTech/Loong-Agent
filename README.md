# Dragon (Qianlong / 潜龙)  潜龙在渊，智驭八方

Dragon is a TypeScript-native, local-first agent framework.

It aims to combine:

- OpenClaw's gateway, plugin, session, and local-first architecture.
- Hermes Agent's self-improving skills, memory, provider routing, and trajectory ideas.
- Claude Code's coding-agent interaction model, permission experience, and engineering workflow.

Dragon does not mix Python into the runtime. Hermes concepts are reimplemented
in TypeScript where they fit the framework.

## Initial Packages

- `@dragon/core`: agent turn runtime, lifecycle events, sessions, queues.
- `@dragon/gateway`: WebSocket/HTTP control plane.
- `@dragon/channels`: chat-channel webhook adapters and Gateway delivery
  targets.
- `@dragon/tools`: tool registry, permissions, and built-in tool contracts.
- `@dragon/providers`: model provider routing contracts.
- `@dragon/model-catalog`: provider-scoped model metadata and model reference
  lookup helpers.
- `@dragon/memory`: Markdown, SQLite, and search memory contracts.
- `@dragon/skills`: `SKILL.md` runtime and skill authoring contracts.
- `@dragon/cron`: cron schedule parsing, file-backed jobs, runner, and Gateway
  webhook delivery targets.
- `@dragon/delegation`: multi-agent task planning, dependency-aware runner,
  Dragon runtime executor, and agent-facing `delegation_run` tool.
- `@dragon/plugin-sdk`: public plugin API.
- `@dragon/plugin-openai-compatible`: reference OpenAI-compatible provider plugin.
- `@dragon/plugin-openrouter-compatible`: reference OpenRouter provider plugin.
- `@dragon/plugin-anthropic-compatible`: reference Anthropic Messages API provider plugin with tool-use translation.
- `@dragon/plugin-git-tools`: reference read-only Git inspection tool plugin.
- `@dragon/test-suite`: TypeScript regression tests for high-risk runtime flows.
- `@dragon/cli`: command-line entrypoint.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/REUSE_PLAN.md](docs/REUSE_PLAN.md) for the implementation plan.
See [docs/PLUGINS.md](docs/PLUGINS.md) for the plugin authoring and loading
notes.

## Current CLI Shape

```bash
dragon chat [--session <id>] [--session-dir <path>] [--no-session] [--model <ref>] [--model-fallback <ref>] [--plugin-root <path>] <message>
dragon agent [--session <id>] [--session-dir <path>] [--no-session] [--allow-write] [--model <ref>] [--model-fallback <ref>] [--skill-root <path>] [--plugin-root <path>] [--memory-dir <path>] [--memory-backend <id>] <message>
dragon gateway [--host <host>] [--port <port>] [--secret <value>] [--session-dir <path>] [--allow-write] [--skill-root <path>] [--plugin-root <path>] [--memory-dir <path>] [--memory-backend <id>] [--cron-jobs <path>]
dragon cron [--jobs <path>] [--gateway-url <url>] [--secret <value>] [--once] [--interval-ms <ms>]
```

`dragon agent` can read/search workspace files, run a conservative read-only
shell allowlist, run the same read-only allowlist through `sandbox_exec` local,
Docker, or SSH backends, inspect bounded HTTP(S) page snapshots with
`browser_snapshot` including links and form structure, submit basic GET/POST
HTML forms with `browser_form_submit`, and use `file_patch` for exact text
replacements. Write tools ask for approval in an interactive terminal;
`--allow-write` skips that prompt.
`sandbox_exec` keeps the default `inspect` profile narrow and supports explicit
`versions`, `git-read`, `search-read`, and `repo-read` profiles for broader
read-only sandbox inspection.
`dragon agent /skills`, `dragon agent /skills <query>`, and
`dragon agent /skills load <name>` run locally against configured skill roots
without requiring a model provider.

`dragon gateway` starts the local HTTP/WebSocket control plane and serves a
minimal dashboard at `/`. The first API endpoints are `GET /health`,
`GET /events`, `GET /ws`, `POST /channels/webhook`, and `POST /rpc` for
`connect`, `health`, `agent`, `run.status`, `run.cancel`, `runs.list`,
`providers.list`, `plugins.list`, `tools.catalog`, `tool.invoke`,
`memory.candidates.list`, `memory.candidate.promote`,
`memory.candidate.reject`, `trajectory.list`, `trajectory.get`,
`cron.jobs.list`, `cron.job.upsert`, `cron.job.remove`, and `cron.tick`
requests.
`GET /events` is a Server-Sent Events stream and `GET /ws` is a WebSocket
RPC/event stream; both support `sessionId` / `runId` query filters.
`POST /channels/webhook` is the first selected chat-channel surface: it accepts
a simple authenticated JSON body with `sessionId`, `message`, optional
`channel`, `userId`, `threadId`, `workspace`, `model`, and metadata, then
routes the message through the same agent lane and event pipeline.
`@dragon/channels` provides Telegram and Slack webhook adapters that normalize
platform payloads into this Gateway webhook body, plus a reusable Gateway
webhook delivery target for chat-channel bridges.
`@dragon/cron` can compute next runs for five-field cron expressions, persist
jobs in a JSON store, run due jobs with a bounded runner, and deliver scheduled
jobs to this webhook surface with `channel: "cron"`.
`dragon cron --once` runs due jobs once for system schedulers; without
`--once`, it starts a local long-running cron runner.
`dragon gateway` also starts a local cron runner by default, backed by
`.dragon/cron/jobs.json` or `--cron-jobs <path>`.
`@dragon/delegation` provides dependency-aware delegated task plans and a
bounded concurrent runner. Its runtime executor can run delegated tasks through
any `DragonAgentRuntime`, preserving dependency summaries for downstream
tasks. In `dragon agent`, the bounded `delegation_run` tool exposes that runner
to the model for independent or dependency-ordered subtasks.
OpenAI-compatible and Anthropic-compatible providers can emit true text deltas
into those streams through Dragon `assistant_delta` events.
The dashboard keeps the surface minimal: run composer, runs/events, plugins,
providers, safe direct tools, memory candidate review, trajectories, and
cron jobs, and gateway health.

Plugins can be loaded from `.dragon/plugins`, `DRAGON_PLUGIN_ROOTS`, or
`--plugin-root <path>`. A plugin root can be either one plugin directory or a
directory containing plugin directories. Tool plugins are available in agent and
gateway mode; tools that declare `permission: "allow"` can run without an
interactive prompt, `permission: "deny"` is always refused, and omitted
permission defaults to ask. An ask decision is skipped when no interactive or
installed permission handler is available.

Model refs with a registered provider prefix, such as `openai:gpt-4o` or
`anthropic:claude-sonnet-4-5`, route explicitly to that provider. Use this form
with `--model <ref>`, `DRAGON_MODEL`, or the dashboard Model field when a model
name such as `owner/model` collides with a loaded provider id.
CLI turns can also provide retryable model fallback candidates with
`--model-fallback <ref>` or comma-separated `DRAGON_MODEL_FALLBACKS`; Dragon
buffers fallback attempts so failed streamed output is not shown before the
successful model response.

Agent mode exposes `delegation_run` as an allowlisted orchestration tool.
Delegated turns run through the same runtime, tools, and permission engine as
ordinary agent turns. Agent mode also exposes `skill_create`, `skill_improve`,
memory candidate promotion, and memory candidate rejection as write tools for
reviewable updates. `--allow-write` allows those tools alongside `file_patch`;
otherwise they require interactive approval.

`providers.list` returns configured provider ids, display names, default models,
provider-scoped model catalog entries, and tool-calling capability.
`plugins.list` returns plugin name/version, tool summaries, provider summaries,
memory backend summaries, and hook names. It intentionally omits plugin
filesystem paths.

`tools.catalog` returns the runtime tool catalog. `tool.invoke` is deliberately
stricter than the agent tool loop: direct Gateway invocation only runs explicit
allowlisted, read-only tools that also pass the same permission engine. The
default direct allowlist is the read-only Git inspection tools.

`@dragon/plugin-git-tools` is a reference tool plugin. It registers read-only
`git_status`, `git_diff`, and `git_log` tools when loaded with
`--plugin-root packages/plugin-git-tools`.

`@dragon/plugin-openrouter-compatible` registers an OpenRouter provider when
`DRAGON_OPENROUTER_API_KEY` or `OPENROUTER_API_KEY` is set. It uses
`https://openrouter.ai/api/v1` by default and forwards optional
`DRAGON_OPENROUTER_REFERER` / `DRAGON_OPENROUTER_TITLE` attribution headers.

Memory backend plugins can register durable memory stores. Dragon keeps the
built-in `file` backend as the default. A built-in `sqlite` backend is also
available for local SQLite/FTS search on Node runtimes that provide
`node:sqlite`. Select any non-default backend explicitly with
`--memory-backend <id>` or `DRAGON_MEMORY_BACKEND`.

`dragon agent` and `dragon gateway` also read human-maintained Markdown memory
from the selected memory directory when present: `USER.md`, `PROJECT.md`,
`MEMORY.md`, and recent `notes/YYYY-MM-DD.md` files.

When session storage is enabled, older user/assistant messages beyond the
recent history window can be injected as bounded compacted context instead of
being silently lost.

Explicit remember-style requests are also captured as reviewable pending
memory candidates under `.dragon/memory/candidates/YYYY-MM-DD.jsonl`. These
candidates are not searched or injected until `memory_candidate_promote`
promotes them into durable memory; `memory_candidate_reject` records an
auditable rejection without storing the content.

## Verification

```bash
corepack pnpm check
corepack pnpm build
corepack pnpm test
```

`corepack pnpm test` builds the workspace and runs the TypeScript regression
suite for CLI skill slash commands, Gateway direct tools, Gateway WebSocket
RPC/events, Gateway webhook channel delivery, Gateway cron RPC, channel
adapters, memory candidate review, trajectory persistence/RPC, runtime
tool-call loops, sandbox command planning/execution and policy profiles, cron
schedule/delivery targets, browser snapshotting with form extraction,
basic browser form submission,
cron file stores/runners, delegation planning/running, runtime-backed
delegation, the `delegation_run` agent tool, model catalog behavior, model
provider plugin loading/routing, and provider translation/streaming.
