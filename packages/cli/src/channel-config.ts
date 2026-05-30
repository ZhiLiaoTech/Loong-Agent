import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveLoongDataRoot } from "./loong-paths.js";

export function defaultChannelConfigPath(): string {
  return path.join(resolveLoongDataRoot(), "config", "channels.json");
}

export async function loadChannelConfig(configPath = defaultChannelConfigPath()): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
