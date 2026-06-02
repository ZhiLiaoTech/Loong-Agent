# @loong/desktop

Tauri 2 desktop surface for Loong (P4).

## Prerequisites

- Rust toolchain
- Tauri CLI v2: `cargo install tauri-cli --version "^2"`

## Dev

Terminal 1 (optional if Studio is not already running via `beforeDevCommand`):

```bash
corepack pnpm studio:dev
```

Terminal 2:

```bash
corepack pnpm --filter @loong/desktop dev
```

WebView loads Studio at `http://127.0.0.1:1420`.

Browser mode still needs a manual Gateway:

```bash
node packages/cli/dist/index.js gateway
```

Desktop mode auto-starts and supervises the Gateway through the Tauri host.
In-repo desktop builds fall back to the workspace CLI output plus a system `node` binary.

## Inspect Packaging

```bash
corepack pnpm desktop:inspect
```

This reports the current bundled runtime state, bundle-resource wiring, and expected installer path.

## Prepare Runtime

```bash
corepack pnpm desktop:prepare-runtime
```

This rebuilds the Loong CLI dependency graph, stages a portable runtime under
`packages/desktop/src-tauri/resources/runtime`, and smoke-tests:

- bundled `node.exe`
- bundled `runtime/cli/dist/index.js`
- CLI command execution without relying on `node` from `PATH`

## Build

```bash
corepack pnpm desktop:build
```

This refreshes the bundled runtime and produces the desktop executable at
`packages/desktop/src-tauri/target/release/loong-desktop.exe`.

## Release

```bash
corepack pnpm desktop:release
```

This enables Tauri bundling through `src-tauri/tauri.bundle.conf.json`, packages the
bundled Node + CLI runtime, and publishes deliverables to the repo `release/` folder:

- `release/Loong_<version>_x64-setup.exe` — NSIS installer
- `release/loong-desktop.exe` — portable binary
- `release/manifest.json` — build metadata

## Current capabilities

- Desktop launch auto-starts the local Gateway through the Tauri host.
- `watchdog.rs` health-checks `/health`, restarts exited or unhealthy Gateway children, and exposes lifecycle IPC.
- Windows builds attach the managed Gateway child to a Job Object so the child is reaped when the desktop app exits or is force-terminated.
- Studio auto-detects the Tauri runtime and uses `createTauriHost()` for `get_gateway_health`, `start_gateway`, `stop_gateway`, `restart_gateway`, and `force_restart_gateway`.
- Release builds bundle `runtime/node/node.exe` and `runtime/cli/**`, so the installed desktop app can launch Gateway without a system Node installation.
- System tray with close-to-tray: closing the window hides it; Gateway keeps running. Use the tray menu or double-click the icon to show the window again. Choose **退出 Loong** to quit.

### Gateway IPC (dev)

From Studio, invoke:

- `get_gateway_health`
- `start_gateway` / `stop_gateway` / `restart_gateway`

Repo development still requires a usable local `node` binary. Release installers do not.

See [LOONG_PRODUCT_ARCHITECTURE.md](../../docs/LOONG_PRODUCT_ARCHITECTURE.md).
