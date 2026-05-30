import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseSessionCompactionValue, parseAiSummarizationValue, type SessionMessageCompactionOptions, type AISummarizationConfig } from "@loong/core";
import { loongConfigDir } from "./loong-paths.js";

export interface LoongContextConfigFile {
  sessionCompaction?: SessionMessageCompactionOptions | false;
  aiSummarization?: AISummarizationConfig | false;
}

export function contextConfigPath(): string {
  const fromEnv = process.env.LOONG_CONTEXT_CONFIG?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.join(loongConfigDir(), "context.json");
}

export async function loadContextConfig(): Promise<LoongContextConfigFile> {
  const filePath = contextConfigPath();
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const out: LoongContextConfigFile = {};
    const compaction = parseSessionCompactionValue(record.sessionCompaction);
    if (compaction !== undefined) {
      out.sessionCompaction = compaction;
    }
    const aiSummarization = parseAiSummarizationValue(record.aiSummarization);
    if (aiSummarization !== undefined) {
      out.aiSummarization = aiSummarization;
    }
    return out;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}
