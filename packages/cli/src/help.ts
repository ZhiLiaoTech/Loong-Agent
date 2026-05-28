export function printHelp(): void {
  console.log(`Dragon (Qianlong)

Usage:
  dragon chat [--session <id>] [--session-dir <path>] [--no-session] [--model <ref>] [--model-fallback <ref>] [--tier <fast|standard|deep>] [--plugin-root <path>] [--attach <path>]... <message>
  dragon agent [--session <id>] [--session-dir <path>] [--no-session] [--profile <id>] [--allow-write] [--fail-on-ask] [--query-loop] [--finish-task] [--query-loop-max-turns <n>] [--model <ref>] [--model-fallback <ref>] [--tier <fast|standard|deep>] [--skill-root <path>] [--plugin-root <path>] [--memory-dir <path>] [--memory-backend <id>] [--attach <path>]... <message>
  dragon gateway [--host <host>] [--port <port>] [--secret <value>] [--session-dir <path>] [--allow-write] [--skill-root <path>] [--plugin-root <path>] [--memory-dir <path>] [--memory-backend <id>] [--cron-jobs <path>] [--model-timeout-ms <ms>] [--model-timeout-sec <sec>]
  dragon cron [--jobs <path>] [--gateway-url <url>] [--secret <value>] [--once] [--interval-ms <ms>]
  dragon channels serve [--host <host>] [--port <port>] [--gateway-url <url>] [--secret <value>] [--profile <id>] [--workspace <path>]

Provider:
  Set DRAGON_OPENAI_API_KEY or OPENAI_API_KEY for the OpenAI-compatible provider.
  Optional: DRAGON_OPENAI_BASE_URL, DRAGON_OPENAI_MODEL, DRAGON_OPENAI_PROVIDER_ID.
  Set DRAGON_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY for the Anthropic Messages provider.
  Optional: DRAGON_ANTHROPIC_BASE_URL, DRAGON_ANTHROPIC_MODEL, DRAGON_ANTHROPIC_PROVIDER_ID.
  Provider plugins can also be loaded from .dragon/plugins, DRAGON_PLUGIN_ROOTS, or --plugin-root <path>.
  Model refs with a registered provider prefix, such as openai:gpt-4o or anthropic:claude-sonnet-4-5, route explicitly to that provider.
  Durable data defaults to <workspace>/.dragon (walk up to pnpm-workspace.yaml); override root with DRAGON_DATA_ROOT.
  Dashboard model provider config: .dragon/config/providers.json (override with DRAGON_MODEL_CONFIG).
  Dashboard agent profile config: .dragon/config/agents.json (override with DRAGON_AGENT_CONFIG).
  Optional: DRAGON_MODEL, --model <ref>, DRAGON_MODEL_FALLBACKS, --model-fallback <ref>.

Tiers (multi-model scheduling):
  Tier config is stored in .dragon/config/tiers.json by default; override with DRAGON_TIER_CONFIG.
  Heuristic classifier auto-routes to fast/standard/deep based on message length, attachments, keywords, and agent signals.
  Forcing a tier: DRAGON_TIER=fast|standard|deep or --tier <fast|standard|deep>. Explicit --model always wins over tier routing.

Permissions:
  Write tools prompt for approval in an interactive terminal.
  Use --allow-write to allow file_patch, skill_create, skill_improve, and memory candidate promote/reject without prompting.
  Use --fail-on-ask to fail the turn when a tool needs permission but no interactive CLI handler is available (CI/non-TTY).

Session:
  Sessions are stored as JSONL under .dragon/sessions by default.
  Optional: DRAGON_SESSION_ID, DRAGON_SESSION_DIR, --session-dir <path>.

Skills:
  Agent mode loads SKILL.md roots from .dragon/skills and can create that root when needed.
  Local slash commands: dragon agent /skills, dragon agent /skills <query>, dragon agent /skills load <name>.
  Optional: DRAGON_SKILL_ROOTS, --skill-root <path>.

Plugins:
  Plugin roots can point to a plugin directory or a directory containing plugin directories.
  Optional: DRAGON_PLUGIN_ROOTS, --plugin-root <path>.
  Tool plugins are available in agent and gateway mode. Tools that declare permission "allow" can run without an interactive prompt, permission "deny" is always refused, and omitted permission defaults to ask. Ask is skipped when no permission handler is available.

Memory:
  dragon agent and dragon gateway store durable memory records under .dragon/memory with the built-in "file" backend by default.
  Human-readable Markdown memory files can live in .dragon/memory/USER.md, PROJECT.md, MEMORY.md, and notes/YYYY-MM-DD.md.
  Explicit remember requests create pending memory candidates; memory_candidates_list can review them, while promote/reject tools require write permission.
  Use --memory-backend sqlite for the built-in SQLite/FTS backend when node:sqlite is available.
  Optional: DRAGON_MEMORY_DIR, --memory-dir <path>, DRAGON_MEMORY_BACKEND, --memory-backend <id>.
  Memory backend plugins must be selected explicitly; loaded plugins never replace the default file backend by accident.

Gateway:
  Defaults to 127.0.0.1:17357 with no auth.
  Includes a cron runner backed by .dragon/cron/jobs.json.
  Optional: DRAGON_GATEWAY_HOST, DRAGON_GATEWAY_PORT, DRAGON_GATEWAY_SECRET, DRAGON_CRON_JOBS, --cron-jobs <path>.

Cron:
  Runs due jobs from a JSON cron store and delivers them to the Gateway webhook channel.
  Use --once for system cron style execution; omit it for a long-running local runner.
  Optional: DRAGON_CRON_JOBS, DRAGON_GATEWAY_URL, DRAGON_GATEWAY_SECRET.
`);
}
