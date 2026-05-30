# @loong/desktop

Tauri 2 desktop surface for Loong (P4).

## Prerequisites

- Rust toolchain
- Tauri CLI v2: `cargo install tauri-cli --version "^2"`
- Built CLI: `corepack pnpm --filter @loong/cli build`

## Dev

Terminal 1 (optional if Studio not already running via `beforeDevCommand`):

```bash
corepack pnpm studio:dev
```

Terminal 2:

```bash
corepack pnpm --filter @loong/desktop dev
```

WebView loads Studio at `http://127.0.0.1:1420`. Start Gateway manually until P4-05 Watchdog lands:

```bash
node packages/cli/dist/index.js gateway
```

## Build

```bash
corepack pnpm studio:build
corepack pnpm --filter @loong/desktop build
```

## Planned (P4-05+)

- `watchdog.rs` — **POC implemented**: spawn `node packages/cli/dist/index.js gateway`, HTTP `/health` poll
- IPC: `get_gateway_health`, `start_gateway`, `stop_gateway`, `restart_gateway`, `force_restart_gateway`
- Tray + close-to-tray (`app_preferences.rs`)
- `createTauriHost()` in `@loong/host`
- Bundled Node + `@loong/cli` manifest

### Gateway IPC (dev)

From Studio (future `createTauriHost`), invoke:

- `get_gateway_health`
- `start_gateway` / `stop_gateway` / `restart_gateway`

Requires `node` on PATH and built CLI (`pnpm --filter @loong/cli build`), or `LOONG_CLI_ENTRY`.

See [LOONG_PRODUCT_ARCHITECTURE.md](../../docs/LOONG_PRODUCT_ARCHITECTURE.md).
