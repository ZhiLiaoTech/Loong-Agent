import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseSessionCompactionValue, type SessionMessageCompactionOptions } from "@dragon/core";

export interface DragonContextConfigFile {
  sessionCompaction?: SessionMessageCompactionOptions | false;
}

export function contextConfigPath(cwd = process.cwd()): string {
  const fromEnv = process.env.DRAGON_CONTEXT_CONFIG?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.join(cwd, ".dragon", "config", "context.json");
}

export async function loadContextConfig(cwd = process.cwd()): Promise<DragonContextConfigFile> {
  const filePath = contextConfigPath(cwd);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const out: DragonContextConfigFile = {};
    const compaction = parseSessionCompactionValue(record.sessionCompaction);
    if (compaction !== undefined) {
      out.sessionCompaction = compaction;
    }
    return out;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}
