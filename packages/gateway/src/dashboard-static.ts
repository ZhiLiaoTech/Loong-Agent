import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname, resolve, relative } from "node:path";

const require = createRequire(import.meta.url);

let cachedHtml: string | undefined;
let dashboardRoot: string | undefined;

export function getDashboardRoot(): string {
  if (!dashboardRoot) {
    const pkgJson = require.resolve("@dragon/gateway-dashboard/package.json");
    dashboardRoot = join(dirname(pkgJson), "dist");
  }
  return dashboardRoot;
}

export function getDashboardHtml(): string {
  if (!cachedHtml) {
    const indexPath = join(getDashboardRoot(), "index.html");
    if (!existsSync(indexPath)) {
      throw new Error(
        "Dashboard bundle missing. Run: corepack pnpm --filter @dragon/gateway-dashboard build",
      );
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
  return "application/octet-stream";
}
