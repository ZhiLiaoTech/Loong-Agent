import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseSessionCompactionValue, type SessionMessageCompactionOptions } from "@dragon/core";
import { dragonConfigDir } from "./dragon-paths.js";

export interface DragonContextConfigFile {
  sessionCompaction?: SessionMessageCompactionOptions | false;
}

export function contextConfigPath(): string {
  const fromEnv = process.env.DRAGON_CONTEXT_CONFIG?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.join(dragonConfigDir(), "context.json");
}

export async function loadContextConfig(): Promise<DragonContextConfigFile> {
  const filePath = contextConfigPath();
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
