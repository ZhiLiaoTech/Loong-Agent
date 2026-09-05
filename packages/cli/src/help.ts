export function printHelp(): void {
  console.log(`Loong

Usage:
  loong chat [--session <id>] [--session-dir <path>] [--no-session] [--model <ref>] [--model-fallback <ref>] [--tier <fast|standard|deep>] [--plugin-root <path>] [--attach <path>]... <message>
  loong agent [--session <id>] [--session-dir <path>] [--no-session] [--profile <id>] [--allow-write] [--allow-exec] [--fail-on-ask] [--query-loop] [--finish-task] [--query-loop-max-turns <n>] [--model <ref>] [--model-fallback <ref>] [--tier <fast|standard|deep>] [--skill-root <path>] [--plugin-root <path>] [--memory-dir <path>] [--memory-backend <id>] [--attach <path>]... <message>
  loong gateway [--host <host>] [--port <port>] [--secret <value>] [--session-dir <path>] [--allow-write] [--allow-exec] [--skill-root <path>] [--plugin-root <path>] [--memory-dir <path>] [--memory-backend <id>] [--cron-jobs <path>] [--model-timeout-ms <ms>] [--model-timeout-sec <sec>] [--cooking-video-concurrency <1-8>]
  loong cron [--jobs <path>] [--gateway-url <url>] [--secret <value>] [--once] [--interval-ms <ms>]
  loong plugins list
  loong plugins install [-l|--link] <plugin-path>
  loong channels serve [--host <host>] [--port <port>] [--gateway-url <url>] [--secret <value>] [--profile <id>] [--workspace <path>]
  loong cooking-video <scan-inbox|consume-inbox|process-inbox|create|status|ingest|sync|prepare-vision|import-vision|detect|select|edit|render|review|validate-gold|run|resume> [...]

Provider:
  Set LOONG_OPENAI_API_KEY or OPENAI_API_KEY for the OpenAI-compatible provider.
  Optional: LOONG_OPENAI_BASE_URL, LOONG_OPENAI_MODEL, LOONG_OPENAI_PROVIDER_ID.
  Set LOONG_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY for the Anthropic Messages provider.
  Optional: LOONG_ANTHROPIC_BASE_URL, LOONG_ANTHROPIC_MODEL, LOONG_ANTHROPIC_PROVIDER_ID.
  Provider plugins can also be loaded from .loong/plugins, LOONG_PLUGIN_ROOTS, or --plugin-root <path>.
  Model refs with a registered provider prefix, such as openai:gpt-4o or anthropic:claude-sonnet-4-5, route explicitly to that provider.
  Durable data defaults to <workspace>/.loong (walk up to pnpm-workspace.yaml); override root with LOONG_DATA_ROOT.
  Dashboard model provider config: .loong/config/providers.json (override with LOONG_MODEL_CONFIG).
  Dashboard agent profile config: .loong/config/agents.json (override with LOONG_AGENT_CONFIG).
  Optional: LOONG_MODEL, --model <ref>, LOONG_MODEL_FALLBACKS, --model-fallback <ref>.

Tiers (multi-model scheduling):
  Tier config is stored in .loong/config/tiers.json by default; override with LOONG_TIER_CONFIG.
  Heuristic classifier auto-routes to fast/standard/deep based on message length, attachments, keywords, and agent signals.
  Forcing a tier: LOONG_TIER=fast|standard|deep or --tier <fast|standard|deep>. Explicit --model always wins over tier routing.

Permissions:
  Write tools prompt for approval in an interactive terminal.
  Use --allow-write to allow file_patch, file_write, skill_create, skill_improve, and memory candidate promote/reject without prompting.
  Use --allow-exec (or LOONG_ALLOW_EXEC=1) to register shell_run for arbitrary commands (build/test/install/scripts), confined to the workspace and still approved per call. Off by default; without it only the read-only shell_exec/sandbox_exec allowlist is available.
  Use --fail-on-ask to fail the turn when a tool needs permission but no interactive CLI handler is available (CI/non-TTY).

Web search:
  web_search is available in agent mode and resolves its backend from the environment.
  Set LOONG_SEARXNG_URL for a self-hosted SearXNG, LOONG_TAVILY_API_KEY for Tavily, or LOONG_BRAVE_API_KEY for Brave.
  Pin a backend with LOONG_WEB_SEARCH_PROVIDER=searxng|tavily|brave; otherwise the first configured one is used.

Session:
  Sessions are stored as JSONL under .loong/sessions by default.
  Optional: LOONG_SESSION_ID, LOONG_SESSION_DIR, --session-dir <path>.

Skills:
  Agent mode loads SKILL.md roots from .loong/skills and can create that root when needed.
  Local slash commands: loong agent /skills, loong agent /skills <query>, loong agent /skills load <name>.
  Optional: LOONG_SKILL_ROOTS, --skill-root <path>.

Plugins:
  Plugin roots can point to a plugin directory or a directory containing plugin directories.
  Default install dir: .loong/plugins (loaded automatically by loong gateway via Loong Channel Plugin Host).
  Optional: LOONG_PLUGIN_ROOTS, --plugin-root <path>.
  Tool plugins are available in agent and gateway mode. Tools that declare permission "allow" can run without an interactive prompt, permission "deny" is always refused, and omitted permission defaults to ask. Ask is skipped when no permission handler is available.

Memory:
  loong agent and loong gateway store durable memory records under .loong/memory with the built-in "file" backend by default.
  Human-readable Markdown memory files can live in .loong/memory/USER.md, PROJECT.md, MEMORY.md, and notes/YYYY-MM-DD.md.
  Explicit remember requests create pending memory candidates; memory_candidates_list can review them, while promote/reject tools require write permission.
  Use --memory-backend sqlite for the built-in SQLite/FTS backend when node:sqlite is available.
  Optional: LOONG_MEMORY_DIR, --memory-dir <path>, LOONG_MEMORY_BACKEND, --memory-backend <id>.
  Memory backend plugins must be selected explicitly; loaded plugins never replace the default file backend by accident.

Gateway:
  Defaults to 127.0.0.1:17357 with no auth.
  Includes a cron runner backed by .loong/cron/jobs.json.
  Optional: LOONG_GATEWAY_HOST, LOONG_GATEWAY_PORT, LOONG_GATEWAY_SECRET, LOONG_CRON_JOBS, --cron-jobs <path>.

Cron:
  Runs due jobs from a JSON cron store and delivers them to the Gateway webhook channel.
  Use --once for system cron style execution; omit it for a long-running local runner.
  Optional: LOONG_CRON_JOBS, LOONG_GATEWAY_URL, LOONG_GATEWAY_SECRET.
`);
}
