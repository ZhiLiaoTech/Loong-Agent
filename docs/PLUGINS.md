# Loong Plugins

Loong plugins are TypeScript-first ESM modules with a `loong.plugin.json`
manifest. A plugin can register tools and model providers through
`@loong/plugin-sdk`. It can also register memory backends and lifecycle hooks.

## Lifecycle Hooks

Plugins can call `context.registerLifecycleHook()` during `activate()`.
Lifecycle hooks receive bounded turn metadata for `start`, `end`, `error`, and
`cancelled` phases. Hook failures, rejected promises, and async hooks that do
not settle before the runtime timeout are ignored, so async observers cannot
change the user-facing turn result.

Lifecycle hooks run in the Loong process. Plugins must keep synchronous hook
work small and avoid CPU-bound loops or blocking I/O, because JavaScript cannot
preempt synchronous code on the same event loop. A future worker/process hook
backend can add stronger isolation without changing the read-only hook payload.

Hook names appear in `plugins.list` and the dashboard plugin summary.

## Memory Backends

Plugins can call `context.registerMemoryBackend()` during `activate()` to
expose a durable memory store. A memory backend has an `id`, `displayName`, and
an object implementing `remember()`, `get()`, and `search()`.

The built-in `file` backend remains the default, and the built-in `sqlite`
backend provides optional local SQLite/FTS search. Loaded plugin backends never
replace built-ins automatically; select a plugin backend explicitly:

```bash
loong agent --plugin-root path/to/plugin --memory-backend plugin-memory "recall project notes"
loong gateway --plugin-root path/to/plugin --memory-backend plugin-memory
```

`LOONG_MEMORY_BACKEND` provides the same selection for agent and gateway mode.
Plugin backend ids `file` and `sqlite` are reserved.

Loong validates records returned by plugin memory backends before they are
used for context or tool output. Record content is bounded, search results are
bounded, `source` and `reason` text may be truncated, and `metadata` must be a
small JSON-safe object. Invalid plugin records fail safely instead of being sent
to the model.

## Git Tools

`@loong/plugin-git-tools` is a reference read-only tool plugin. It registers:

- `git_status`
- `git_diff`
- `git_log`

Build it before loading directly from the workspace:

```bash
corepack pnpm --filter @loong/plugin-git-tools build
loong agent --plugin-root packages/plugin-git-tools "review recent git changes"
loong gateway --plugin-root packages/plugin-git-tools
```

The plugin invokes `git` without a shell, uses fixed command allowlists,
scrubs dangerous `GIT_*` environment variables, disables prompts/pagers,
external diff/textconv helpers, and optional locks, bounds stdout/stderr, and
rejects absolute or parent directory path filters. It does not register commit,
checkout, reset, or other write-capable Git operations.

When the plugin is loaded in `loong gateway`, `tools.catalog` lists the Git
tools and the default `tool.invoke` direct allowlist permits `git_status`,
`git_diff`, and `git_log` after normal permission checks. Generic read tools,
memory tools, network tools, and write tools are not directly invokable by
default.

## OpenAI-Compatible Provider

`@loong/plugin-openai-compatible` is a reference provider plugin. It registers
an OpenAI-compatible provider when an API key is available.

Build it before loading directly from the workspace:

```bash
corepack pnpm --filter @loong/plugin-openai-compatible build
loong chat --plugin-root packages/plugin-openai-compatible "hello"
```

Environment variables:

- `LOONG_PLUGIN_OPENAI_API_KEY`
- `LOONG_PLUGIN_OPENAI_BASE_URL`
- `LOONG_PLUGIN_OPENAI_MODEL`
- `LOONG_PLUGIN_OPENAI_PROVIDER_ID` defaults to `loong-openai`
- `LOONG_PLUGIN_OPENAI_DISPLAY_NAME`
- `LOONG_PLUGIN_OPENAI_SUPPORTS_TOOL_CALLING` defaults to `true`

The plugin falls back to `LOONG_OPENAI_*` / `OPENAI_*` values for API key,
base URL, and model, but keeps its default provider id separate from the
built-in CLI provider to avoid accidental duplicate ids.

Provider base URLs must be clean HTTP(S) endpoint roots. Loong rejects base
URLs that contain username/password credentials, query strings, or URL
fragments.

If no API key is configured, the plugin still loads but registers no provider;
`plugins.list` will show the plugin with `0` providers. This keeps optional
plugin roots from breaking startup.

If only `LOONG_OPENAI_API_KEY` or `OPENAI_API_KEY` is set, the built-in CLI
`openai` provider and this plugin's `loong-openai` provider can coexist. The
CLI default provider remains the built-in provider unless a request explicitly
uses the plugin provider id, for example `loong-openai:gpt-4o`.

If `LOONG_PLUGIN_OPENAI_PROVIDER_ID=openai`, startup fails when the built-in
provider is also configured, because Loong rejects duplicate provider ids.

## Anthropic-Compatible Provider

`@loong/plugin-anthropic-compatible` is a reference Claude/Anthropic provider
plugin. It registers an Anthropic Messages API provider when an API key is
available.

Build it before loading directly from the workspace:

```bash
corepack pnpm --filter @loong/plugin-anthropic-compatible build
loong chat --plugin-root packages/plugin-anthropic-compatible "hello"
```

Environment variables:

- `LOONG_PLUGIN_ANTHROPIC_API_KEY`
- `LOONG_PLUGIN_ANTHROPIC_BASE_URL`
- `LOONG_PLUGIN_ANTHROPIC_MODEL`
- `LOONG_PLUGIN_ANTHROPIC_PROVIDER_ID` defaults to `loong-anthropic`
- `LOONG_PLUGIN_ANTHROPIC_DISPLAY_NAME`
- `LOONG_PLUGIN_ANTHROPIC_MAX_TOKENS` defaults to `4096`
- `LOONG_PLUGIN_ANTHROPIC_API_VERSION` defaults to `2023-06-01`

The plugin falls back to `LOONG_ANTHROPIC_*` / `ANTHROPIC_*` values for API
key, base URL, model, max tokens, and API version. Its default provider id is
separate from any future built-in provider, so callers should route explicitly,
for example `loong-anthropic:claude-3-5-sonnet-latest`.

Provider base URLs must be clean HTTP(S) endpoint roots. Loong rejects base
URLs that contain username/password credentials, query strings, or URL
fragments.

Anthropic tool-use translation is enabled. Loong translates its normalized
OpenAI-shaped tool definitions into Anthropic `tools`, converts assistant tool
calls into `tool_use` content blocks, and returns tool outputs as user
`tool_result` content blocks on the next provider turn. Anthropic `tool_use`
response blocks are normalized back into Loong `ModelToolCall` records.
Streaming is enabled through Anthropic's Server-Sent Events response format:
text deltas are forwarded as Loong `assistant_delta` events, and streamed
`tool_use` input JSON is accumulated before Loong invokes the tool.

`LOONG_PLUGIN_ANTHROPIC_MAX_TOKENS` is forwarded as Anthropic `max_tokens`.
Loong only checks that it is a positive safe integer; the Anthropic API remains
the source of truth for model-specific output limits.

## OpenRouter-Compatible Provider

`@loong/plugin-openrouter-compatible` is a reference OpenRouter provider
plugin. It reuses Loong's OpenAI-compatible adapter with OpenRouter defaults.

Build it before loading directly from the workspace:

```bash
corepack pnpm --filter @loong/plugin-openrouter-compatible build
loong chat --plugin-root packages/plugin-openrouter-compatible --model openrouter:openai/gpt-4.1-mini "hello"
```

Environment variables:

- `LOONG_OPENROUTER_API_KEY` or `OPENROUTER_API_KEY`
- `LOONG_OPENROUTER_BASE_URL` defaults to `https://openrouter.ai/api/v1`
- `LOONG_OPENROUTER_MODEL` defaults to `openai/gpt-4.1-mini`
- `LOONG_OPENROUTER_PROVIDER_ID` defaults to `openrouter`
- `LOONG_OPENROUTER_DISPLAY_NAME`
- `LOONG_OPENROUTER_SUPPORTS_TOOL_CALLING` defaults to `true`
- `LOONG_OPENROUTER_REFERER` forwards the optional `HTTP-Referer` header
- `LOONG_OPENROUTER_TITLE` forwards the optional `X-OpenRouter-Title` header
  and defaults to `Loong`

OpenRouter's public API is OpenAI-compatible at the `/api/v1/chat/completions`
surface, and its docs list `HTTP-Referer` and `X-OpenRouter-Title` as optional
app attribution headers. Loong keeps these details in the plugin so the core
provider contract stays provider-neutral.
