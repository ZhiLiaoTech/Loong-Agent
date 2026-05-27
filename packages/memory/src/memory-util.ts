import path from "node:path";

export const DEFAULT_MAX_HISTORY_MESSAGES = 80;
export const ABSOLUTE_MAX_HISTORY_MESSAGES = 500;

export function clampPositiveInteger(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(1, Math.floor(value)), max);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function sameFileStat(
  left: Awaited<ReturnType<typeof import("node:fs/promises").stat>>,
  right: Awaited<ReturnType<typeof import("node:fs/promises").stat>>,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export function stringifyJson(value: unknown): string {
  const json = JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") {
      return item.toString();
    }
    return item;
  });
  if (!json) {
    throw new Error("Session record could not be serialized.");
  }
  return json;
}

export function isIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value.slice(0, 10);
}
