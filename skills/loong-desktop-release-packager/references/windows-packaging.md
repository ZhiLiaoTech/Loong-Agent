# Windows Packaging Workflow

## Command set

```bash
corepack pnpm desktop:inspect
corepack pnpm desktop:prepare-runtime   # optional; release already prepares runtime
cargo check --manifest-path packages/desktop/src-tauri/Cargo.toml   # optional
corepack pnpm desktop:release
```

## Files that matter

| File / directory | Role |
|------------------|------|
| `scripts/package-desktop-release.mjs` | Inspect, runtime staging, Tauri build, publish to `release/` |
| `release/` | **Canonical deliverables** (installer, portable exe, manifest) |
| `packages/desktop/src-tauri/tauri.conf.json` | Base Tauri config + version |
| `packages/desktop/src-tauri/tauri.bundle.conf.json` | Release-only bundle resources |
| `packages/desktop/src-tauri/resources/runtime` | Bundled Node + CLI staging |
| `packages/desktop/src-tauri/src/watchdog.rs` | Gateway child process |
| `packages/desktop/src-tauri/src/tray.rs` | System tray + close-to-tray |

## Expected runtime shape

After `desktop:prepare-runtime` or `desktop:release`:

- `packages/desktop/src-tauri/resources/runtime/node/node.exe`
- `packages/desktop/src-tauri/resources/runtime/cli/dist/index.js`
- `packages/desktop/src-tauri/resources/runtime/manifest.json`

## Release output

Read version from `packages/desktop/src-tauri/tauri.conf.json`, then expect:

- `release/Loong_<version>_x64-setup.exe`
- `release/loong-desktop.exe`
- `release/manifest.json`

`desktop:inspect` prints both the Tauri build path and the `release/` output path.

## Silent install smoke test

Use a temporary install directory and a stripped-down `PATH` to prove the package is self-contained.

PowerShell pattern (adjust version in the installer file name):

```powershell
$version = (Get-Content packages/desktop/src-tauri/tauri.conf.json | ConvertFrom-Json).version
$installer = Resolve-Path "release/Loong_${version}_x64-setup.exe"
$installDir = Join-Path (Resolve-Path '.').Path '.tmp/desktop-install'
$dataDir = Join-Path (Resolve-Path '.').Path '.tmp/desktop-install-data'

Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

& $installer /S /D=$installDir

$oldPath = $env:PATH
$oldPort = $env:LOONG_GATEWAY_PORT
$oldData = $env:LOONG_DATA_ROOT

try {
  $env:PATH = 'C:\Windows\System32'
  $env:LOONG_GATEWAY_PORT = '17360'
  $env:LOONG_DATA_ROOT = $dataDir

  $app = Start-Process -FilePath (Join-Path $installDir 'loong-desktop.exe') `
    -WorkingDirectory $installDir `
    -WindowStyle Hidden `
    -PassThru

  $healthy = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    try {
      $response = Invoke-WebRequest -Uri 'http://127.0.0.1:17360/health' -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200 -and $response.Content -match '"ok"\s*:\s*true') {
        $healthy = $true
        break
      }
    } catch {}
  }

  if (-not $healthy) { throw 'Gateway did not become healthy' }

  Get-CimInstance Win32_Process |
    Where-Object { $_.ParentProcessId -eq $app.Id } |
    Select-Object ProcessId, ExecutablePath, CommandLine
} finally {
  if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id -Force }
  if ($null -ne $oldPort) { $env:LOONG_GATEWAY_PORT = $oldPort } else { Remove-Item Env:LOONG_GATEWAY_PORT -ErrorAction SilentlyContinue }
  if ($null -ne $oldData) { $env:LOONG_DATA_ROOT = $oldData } else { Remove-Item Env:LOONG_DATA_ROOT -ErrorAction SilentlyContinue }
  $env:PATH = $oldPath
}
```

Successful output should include a child process whose `ExecutablePath` ends with:

`...\desktop-install\runtime\node\node.exe`

## Tray behavior (post-install)

- Closing the main window hides it; Gateway and tray icon remain.
- Double-click tray icon or choose **显示主窗口** to restore.
- Choose **退出 Loong** to exit and stop Gateway.

## Failure modes

### Gateway stays offline after install

1. Installed directory contains `runtime/node/node.exe` and `runtime/cli/dist/index.js`.
2. `packages/desktop/src-tauri/src/lib.rs` checks `resource_dir()/runtime` and `current_exe().parent()/runtime`.
3. `packages/cli/src/runtime-factory.ts` skips missing default plugin roots instead of failing on `realpath(...)`.

### `cargo check` fails because bundle resources are missing

Do not add runtime resources to `tauri.conf.json`. Keep them in `tauri.bundle.conf.json`.

### `pnpm deploy` fails on Windows with an absolute destination

Keep staging under `.tmp/loong-desktop-runtime` (repo-relative).

### Runtime copy explodes into recursive workspace trees

Filter `@loong/*` hoisted packages to the `@loong/cli` workspace closure only.

### Installer missing under `release/`

Run `corepack pnpm desktop:release` (not raw `tauri build`). The wrapper copies artifacts after NSIS succeeds.
