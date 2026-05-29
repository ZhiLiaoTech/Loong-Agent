import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname, resolve, relative } from "node:path";

const require = createRequire(import.meta.url);

let cachedHtml: string | undefined;
let dashboardRoot: string | undefined;

/** Test-only: clear cached UI root when `LOONG_UI` changes between cases. */
export function resetDashboardStaticCache(): void {
  cachedHtml = undefined;
  dashboardRoot = undefined;
}

/** Prefer studio when built; override with LOONG_UI=dashboard|studio. */
function resolveUiMode(): "studio" | "dashboard" {
  const raw = (process.env.LOONG_UI ?? process.env.DRAGON_UI ?? "").trim().toLowerCase();
  if (raw === "dashboard" || raw === "legacy") {
    return "dashboard";
  }
  if (raw === "studio" || raw === "loong") {
    return "studio";
  }
  return resolveStudioDist() ? "studio" : "dashboard";
}

function resolveStudioDist(): string | undefined {
  try {
    const pkgJson = require.resolve("@dragon/studio/package.json");
    const dist = join(dirname(pkgJson), "dist");
    if (existsSync(join(dist, "index.html"))) {
      return dist;
    }
  } catch {
    // studio package not installed
  }
  return undefined;
}

function resolveDashboardDist(): string {
  const pkgJson = require.resolve("@dragon/gateway-dashboard/package.json");
  return join(dirname(pkgJson), "dist");
}

export function getDashboardRoot(): string {
  if (!dashboardRoot) {
    const mode = resolveUiMode();
    if (mode === "studio") {
      const studioDist = resolveStudioDist();
      if (studioDist) {
        dashboardRoot = studioDist;
        return dashboardRoot;
      }
      console.warn(
        "[dragon-gateway] LOONG_UI=studio but @dragon/studio dist is missing. " +
          "Run: corepack pnpm --filter @dragon/studio build. Falling back to gateway-dashboard.",
      );
    }
    dashboardRoot = resolveDashboardDist();
  }
  return dashboardRoot;
}

export function getDashboardHtml(): string {
  if (!cachedHtml) {
    const indexPath = join(getDashboardRoot(), "index.html");
    if (!existsSync(indexPath)) {
      const mode = resolveUiMode();
      const buildHint =
        mode === "studio"
          ? "corepack pnpm --filter @dragon/studio build"
          : "corepack pnpm --filter @dragon/gateway-dashboard build";
      throw new Error(`Dashboard bundle missing. Run: ${buildHint}`);
    }
    cachedHtml = readFileSync(indexPath, "utf8");
  }
  return cachedHtml;
}

export function readDashboardAsset(
  pathname: string,
): { body: Buffer; contentType: string } | undefined {
  const normalized = pathname.replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    return undefined;
  }
  const root = resolve(getDashboardRoot());
  const filePath = resolve(root, normalized);
  const rel = relative(root, filePath);
  if (!rel || rel === ".." || rel.startsWith("..")) {
    return undefined;
  }
  if (!existsSync(filePath)) {
    return undefined;
  }
  return {
    body: readFileSync(filePath),
    contentType: contentTypeForPath(normalized),
  };
}

function contentTypeForPath(pathname: string): string {
  const ext = extname(pathname).toLowerCase();
  if (ext === ".js") {
    return "application/javascript; charset=utf-8";
  }
  if (ext === ".css") {
    return "text/css; charset=utf-8";
  }
  if (ext === ".html") {
    return "text/html; charset=utf-8";
  }
  if (ext === ".svg") {
    return "image/svg+xml";
  }
  if (ext === ".woff2") {
    return "font/woff2";
  }
  if (ext === ".map") {
    return "application/json; charset=utf-8";
  }
  return "application/octet-stream";
}
