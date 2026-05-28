import { existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Resolves the durable `.dragon` data directory.
 *
 * Order: `DRAGON_DATA_ROOT` → nearest existing `.dragon` walking up from cwd →
 * monorepo root (`pnpm-workspace.yaml`) → `cwd/.dragon`.
 */
export function resolveDragonDataRoot(cwd = process.cwd()): string {
  const fromEnv = process.env.DRAGON_DATA_ROOT?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  let current = path.resolve(cwd);
  const fsRoot = path.parse(current).root;
  let workspaceAnchor: string | undefined;

  while (true) {
    const dragonDir = path.join(current, ".dragon");
    if (existsSync(dragonDir) && statSync(dragonDir).isDirectory()) {
      return dragonDir;
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
    return path.join(workspaceAnchor, ".dragon");
  }
  return path.join(path.resolve(cwd), ".dragon");
}

export function dragonConfigDir(dataRoot = resolveDragonDataRoot()): string {
  return path.join(dataRoot, "config");
}
