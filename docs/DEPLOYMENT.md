# Dragon Deployment

Dragon currently supports local deployment testing through the CLI Gateway and
Docker Compose.

## Local Smoke Test

Build the workspace and start a temporary Gateway:

```bash
corepack pnpm build
corepack pnpm smoke:gateway
```

To test an already running Gateway:

```bash
DRAGON_SMOKE_GATEWAY_URL=http://127.0.0.1:8787 DRAGON_GATEWAY_SECRET=test corepack pnpm smoke:gateway
```

PowerShell:

```powershell
$env:DRAGON_SMOKE_GATEWAY_URL = "http://127.0.0.1:8787"
$env:DRAGON_GATEWAY_SECRET = "test"
corepack pnpm smoke:gateway
```

## Docker Compose

Create a local `.env` from `.env.example`, then run:

```bash
docker compose up --build
```

The Gateway dashboard is available at:

```text
http://127.0.0.1:8787
```

Runtime endpoints such as `/health`, `/rpc`, `/events`, and `/ws` require the
shared secret when `DRAGON_GATEWAY_SECRET` is configured.

The dashboard Models tab writes provider config to
`DRAGON_MODEL_CONFIG` when set. In the Docker Compose profile this defaults to
`/data/config/providers.json`, so model provider settings survive container
restarts through the `dragon-data` volume. Saved provider changes apply after
the Gateway process restarts.
The dashboard Agents tab writes profile config to `DRAGON_AGENT_CONFIG`; Docker
Compose defaults it to `/data/config/agents.json`.

## Gateway config file

Optional `.dragon/config/gateway.json` (override path with `DRAGON_GATEWAY_CONFIG`):

```json
{
  "host": "127.0.0.1",
  "port": 17357,
  "authMode": "shared-secret",
  "sharedSecret": "replace-me",
  "requireExplicitSecret": true,
  "toolInvokeAllowlist": ["git_status", "git_diff", "git_log"],
  "modelTimeoutMs": 120000
}
```

- `requireExplicitSecret`: when `true`, binding beyond loopback without `sharedSecret` fails at startup (no auto-generated secret).
- `toolInvokeAllowlist`: tools allowed for direct `tool.invoke` RPC (agent turns use the full runtime registry, including MCP).

## Context compaction (`.dragon/config/context.json`)

Optional file to tune long-session context (L2 compaction before model calls):

```json
{
  "sessionCompaction": {
    "keepRecentTurns": 4,
    "olderToolMaxChars": 400
  }
}
```

Set `"sessionCompaction": false` to disable. Override path with `DRAGON_CONTEXT_CONFIG`.

The same `sessionCompaction` object can live in `.dragon/config/agents.json` (global or per profile). Precedence: `context.json` → agents.json root → profile on each turn (profile wins for fields it sets).

```json
{
  "defaultProfileId": "default",
  "sessionCompaction": { "keepRecentTurns": 6 },
  "profiles": [
    {
      "id": "long-research",
      "name": "Long research",
      "sessionCompaction": { "keepRecentTurns": 8, "olderToolMaxChars": 800 }
    }
  ]
}
```

## Channels bridge

See [CHANNELS.md](./CHANNELS.md) for `dragon channels serve` (Telegram/Slack → Gateway).

## Agent profile (CLI)

```bash
dragon agent --profile my-coder "review the API layer"
```

Uses `.dragon/config/agents.json` (same as Dashboard Agents tab). `DRAGON_AGENT_PROFILE` env overrides default when `--profile` is omitted.

## Agent query loop (CLI)

```bash
dragon agent --query-loop "summarize this repo"
dragon agent --finish-task --query-loop-max-turns 5 "complete the migration checklist"
```

- `--query-loop`: auto-continue when the model hits the tool-iteration cap.
- `--finish-task`: same as query loop plus `forceQueryLoop` until `queryLoopDone` or max turns.

## Browser automation (optional Playwright)

Lightweight `browser_snapshot` / `browser_form_submit` work without extra dependencies (HTTP fetch + SSRF guards).

For JavaScript-heavy pages (SPAs), install Playwright Chromium in the environment that runs the agent:

```bash
pnpm exec playwright install chromium
```

If Playwright is missing, `browser_playwright_snapshot` returns a clear error; agent turns can still use the lightweight browser tools. See the capability matrix in [modules/tools.md](./modules/tools.md#33-browser-capability-matrix).

## Device pairing

See [PAIRING.md](./PAIRING.md) for `pairing.token.create` / `pairing.device.register` RPC (file-backed under `.dragon/pairing/`).

## Test suite sharding

For faster CI, shard the integration suite:

```bash
# Shard 0 of 4
DRAGON_TEST_SHARD=0 DRAGON_TEST_SHARDS=4 corepack pnpm test

# Run only tests whose name includes "gateway"
DRAGON_TEST_ONLY=gateway corepack pnpm test
```

## Production Notes

This is a deployment-test profile, not a hardened production chart. Before
production use, add TLS termination, secret management, image publishing,
resource limits, log retention, backup policy for `/data`, and live model
provider smoke checks.
