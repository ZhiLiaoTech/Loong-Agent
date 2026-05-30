import { existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Resolves the durable `.loong` data directory.
 *
 * Order: `LOONG_DATA_ROOT` → nearest existing `.loong` walking up from cwd →
 * monorepo root (`pnpm-workspace.yaml`) → `cwd/.loong`.
 */
export function resolveLoongDataRoot(cwd = process.cwd()): string {
  const fromEnv = process.env.LOONG_DATA_ROOT?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  let current = path.resolve(cwd);
  const fsRoot = path.parse(current).root;
  let workspaceAnchor: string | undefined;

  while (true) {
    const loongDir = path.join(current, ".loong");
    if (existsSync(loongDir) && statSync(loongDir).isDirectory()) {
      return loongDir;
    }
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      workspaceAnchor = current;
    }
    const parent = path.dirname(current);
    if (parent === current || current === fsRoot) {
      break;
    }
    current = parent;
  }

  if (workspaceAnchor) {
    return path.join(workspaceAnchor, ".loong");
  }
  return path.join(path.resolve(cwd), ".loong");
}

export function loongConfigDir(dataRoot = resolveLoongDataRoot()): string {
  return path.join(dataRoot, "config");
}
