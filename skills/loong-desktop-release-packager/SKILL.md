---
name: loong-desktop-release-packager
description: Package and validate the Loong desktop installer on Windows. Use when Codex needs to inspect the desktop packaging state, refresh the bundled Node + CLI runtime, run a Tauri release build, publish installers to the repo release folder, or verify that the installed app can auto-start Gateway without relying on a system Node installation.
---

# Loong Desktop Release Packager

Use the repo wrapper instead of ad-hoc Tauri commands. The wrapper keeps the bundled runtime, Tauri bundle overrides, smoke tests, and **release output staging** in one place.

## Quick release

```bash
corepack pnpm desktop:inspect
corepack pnpm desktop:release
```

After a successful release build, deliverables are copied to **`release/`** at the repo root (not only under `src-tauri/target/`).

If Tauri already built and you only need to refresh `release/`:

```bash
corepack pnpm desktop:publish
```

## Workflow

1. **Inspect** packaging state and expected output paths:

```bash
corepack pnpm desktop:inspect
```

2. **(Optional)** Refresh the bundled runtime before a full build when debugging runtime staging:

```bash
corepack pnpm desktop:prepare-runtime
```

`desktop:release` already refreshes the runtime; use `prepare-runtime` only when you want to fail fast on runtime issues.

3. **(Optional)** Verify the Rust host compiles without a prepared bundle:

```bash
cargo check --manifest-path packages/desktop/src-tauri/Cargo.toml
```

4. **Build and publish** the installer:

```bash
corepack pnpm desktop:release
```

5. **Validate** the installed app (not just the raw executable). Read `references/windows-packaging.md` for the silent-install smoke test.

## Release output layout

Canonical artifacts (after `desktop:release`):

| Path | Description |
|------|-------------|
| `release/Loong_<version>_x64-setup.exe` | NSIS installer (primary deliverable) |
| `release/loong-desktop.exe` | Portable desktop binary (copied from Tauri `target/release/`) |
| `release/manifest.json` | Build metadata (version, sizes, source paths) |

Tauri still writes intermediate outputs under `packages/desktop/src-tauri/target/release/`. Treat **`release/`** as the hand-off directory for distribution and QA.

## Version bumps

Bump the desktop version in these files before release:

- `packages/desktop/src-tauri/tauri.conf.json` → `version`
- `packages/desktop/src-tauri/Cargo.toml` → `version`
- `packages/desktop/package.json` → `version`

The installer file name follows `Loong_<version>_x64-setup.exe`.

## Repo rules

- Prefer `scripts/package-desktop-release.mjs` for `inspect`, `prepare-runtime`, and `build --profile release`.
- Keep release-only bundle resources in `packages/desktop/src-tauri/tauri.bundle.conf.json` so plain `cargo check` does not depend on a prepared runtime.
- Bundled runtime staging: `packages/desktop/src-tauri/resources/runtime`.
- Installed app runtime: next to `loong-desktop.exe` under `runtime/`.
- Desktop shell: auto-starts Gateway, system tray, close-to-tray (window close hides UI; Gateway keeps running until **退出 Loong** from tray).
- If Gateway stays offline after install, check `packages/desktop/src-tauri/src/lib.rs` and `packages/cli/src/runtime-factory.ts` first.

## Success criteria

- `desktop:inspect` reports a prepared runtime and both Tauri + `release/` installer paths.
- `runtime/manifest.json` exists under `resources/runtime` with bundled Node + CLI entry.
- `corepack pnpm desktop:release` finishes without error.
- `release/Loong_<version>_x64-setup.exe` exists and matches `release/manifest.json`.
- Silent-installed app reaches `http://127.0.0.1:<port>/health` with `ok: true` while `PATH` has no `node`.

## Resources

- `references/windows-packaging.md` — verification commands and failure modes.
