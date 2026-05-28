# @dragon/studio

Loong workbench UI (Browser surface). Replaces standalone `@dragon/gateway-dashboard` for day-to-day development.

## Dev

```bash
# Terminal 1 — Gateway
node packages/cli/dist/index.js gateway

# Terminal 2 — Studio (http://127.0.0.1:1420)
corepack pnpm studio:dev
```

Set the Gateway shared secret under **Settings** when auth is enabled (`dragon.gateway.secret` in sessionStorage).

## Build

```bash
corepack pnpm --filter @dragon/studio build
```

Output: `packages/studio/dist/` (multi-file Vite bundle).

## Serve via Gateway

```bash
corepack pnpm --filter @dragon/studio build
set LOONG_UI=studio
node packages/cli/dist/index.js gateway
```

Open `http://127.0.0.1:17357/` — Gateway serves the Studio bundle instead of legacy dashboard.

Default remains `gateway-dashboard` for compatibility with existing smoke tests.

## Routes

See [docs/studio-routes.md](../../docs/studio-routes.md).

## Architecture

- `@dragon/client` — Gateway RPC/SSE
- `@dragon/host` — browser host (no process lifecycle in dev)
- `@dragon/ui` — Loong tokens + shell components
- `gateway-dashboard` workspaces — imported via `@dashboard` alias (Run, Models, Agents)
