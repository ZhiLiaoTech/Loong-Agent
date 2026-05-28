# @dragon/desktop

Tauri 2 desktop surface for Loong (P4).

## Prerequisites

- Rust toolchain
- Tauri CLI v2: `cargo install tauri-cli --version "^2"`
- Built CLI: `corepack pnpm --filter @dragon/cli build`

## Dev

Terminal 1 (optional if Studio not already running via `beforeDevCommand`):

```bash
corepack pnpm studio:dev
```

Terminal 2:

```bash
corepack pnpm --filter @dragon/desktop dev
```

WebView loads Studio at `http://127.0.0.1:1420`. Start Gateway manually until P4-05 Watchdog lands:

```bash
node packages/cli/dist/index.js gateway
```

## Build

```bash
corepack pnpm studio:build
corepack pnpm --filter @dragon/desktop build
```

## Planned (P4-05+)

- `watchdog.rs` — spawn `dragon gateway`, health poll, backoff restart
- Tray + close-to-tray (`app_preferences.rs`)
- `createTauriHost()` in `@dragon/host`
- Bundled Node + `@dragon/cli` manifest

See [LOONG_PRODUCT_ARCHITECTURE.md](../../docs/LOONG_PRODUCT_ARCHITECTURE.md).
