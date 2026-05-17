# Dragon Reuse Plan

Dragon has two goals:

1. Reuse high-quality source code where license and architecture allow it.
2. Reimplement ideas where direct reuse is unsafe or would make Dragon messy.

## Reuse Matrix

| Source | License status | Dragon action |
| --- | --- | --- |
| OpenClaw | MIT | Primary TypeScript source for gateway, plugins, tools, sessions, cron, memory, providers, and security. |
| Hermes Agent | MIT | Study and reimplement selected ideas in TypeScript. Direct code copying is allowed by license, but Python code should not be imported into Dragon runtime. |
| Claude Code sourcemap | All rights reserved / research-only reconstruction | Do not copy source. Use only as product and architecture research. |

## OpenClaw Modules To Migrate First

High priority:

- `src/gateway`
- `src/agents`
- `src/sessions`
- `src/tools`
- `src/plugins`
- `src/plugin-sdk`
- `src/cron`
- `src/provider-runtime`
- `src/model-catalog`
- `src/mcp`
- `src/security`
- `src/pairing`

Medium priority:

- `src/context-engine`
- `src/memory`
- `src/hooks`
- `src/secrets`
- `src/web`
- `src/tui`

Later:

- selected `extensions/*`
- selected `channels/*`
- selected `skills/*`

Avoid initially:

- platform-specific apps
- all mobile/mac companion code
- every channel adapter at once
- every provider plugin at once

## Hermes Ideas To Reimplement In TypeScript

- `SKILL.md` as a first-class runtime asset.
- Progressive skill loading: list, load main skill, load references.
- Agent-created and agent-improved skills.
- SQLite + FTS5 session and memory search.
- Provider routing that stays outside the agent loop.
- Trajectory recording for evaluation and future training.
- Tool backend abstraction for local, Docker, SSH, browser, and MCP.
- Cron jobs that can deliver to multiple surfaces.

## Claude Code Ideas To Reimplement

- Permission-first file and shell workflow.
- Patch-based code editing.
- Strong terminal UX.
- Git-aware review and commit workflows.
- MCP as a native extension surface.
- Context compaction before token limits become failure points.
- Tool-use summaries that are concise but auditable.

## Migration Rules

Every copied or substantially derived OpenClaw file must keep attribution.

Recommended header:

```ts
// Derived from OpenClaw, MIT License.
// Upstream path: openclaw/src/...
// Dragon changes: renamed interfaces, simplified dependencies, adapted package boundary.
```

Every migrated package or folder should include `MIGRATION.md` with:

- upstream path
- license
- reason for migration
- important changes
- known gaps

Do not migrate large directories blindly. Bring over the smallest slice that
compiles inside a Dragon package boundary.

## Clean-Room Rule For Claude Code

Claude Code may be used for behavioral comparison and design notes only.

Allowed:

- describe workflows in Dragon docs
- build equivalent interfaces from observed behavior
- implement original code based on Dragon requirements

Not allowed:

- copy source files
- translate source files
- preserve unique internal structure or identifiers from reconstructed code

