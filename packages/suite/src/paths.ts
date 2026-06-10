import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Resolve the Loong data root (the `.loong` directory).
 *
 * Mirrors the resolution order used by `@loong/cli` (`resolveLoongDataRoot`):
 *   1. `LOONG_DATA_ROOT` env var (absolute path to the `.loong` dir itself)
 *   2. Nearest existing `.loong/` directory walking up from `cwd`
 *   3. Monorepo root (directory containing `pnpm-workspace.yaml`) → `<root>/.loong`
 *   4. Fallback: `<cwd>/.loong`
 */
export function resolveLoongDataRoot(cwd: string = process.cwd()): string {
  const env = process.env.LOONG_DATA_ROOT?.trim();
  if (env) {
    return path.resolve(env);
  }

  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, ".loong");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  dir = path.resolve(cwd);
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return path.join(dir, ".loong");
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return path.join(path.resolve(cwd), ".loong");
}

export function loongConfigDir(dataRoot: string): string {
  return path.join(dataRoot, "config");
}

export function loongSuitesDir(dataRoot: string): string {
  return path.join(dataRoot, "suites");
}
