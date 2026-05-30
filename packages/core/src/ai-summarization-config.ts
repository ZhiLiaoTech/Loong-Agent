import type { AISummarizationConfig } from "./ai-summarization.js";
import type { LoongTurnInput } from "./types.js";

export function parseAiSummarizationValue(
  value: unknown,
): AISummarizationConfig | false | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === false) {
    return false;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const config: AISummarizationConfig = {};
  if (record.enabled === true) {
    config.enabled = true;
  } else if (record.enabled === false) {
    config.enabled = false;
  }
  if (typeof record.model === "string" && record.model.trim()) {
    config.model = record.model.trim();
  }
  if (typeof record.keepRecentTurns === "number" && Number.isFinite(record.keepRecentTurns)) {
    config.keepRecentTurns = Math.max(1, Math.min(32, Math.floor(record.keepRecentTurns)));
  }
  if (typeof record.maxSummaryChars === "number" && Number.isFinite(record.maxSummaryChars)) {
    config.maxSummaryChars = Math.max(256, Math.min(16_000, Math.floor(record.maxSummaryChars)));
  }
  if (typeof record.summaryPrompt === "string" && record.summaryPrompt.trim()) {
    config.summaryPrompt = record.summaryPrompt.trim();
  }
  if (typeof record.timeoutMs === "number" && Number.isFinite(record.timeoutMs)) {
    config.timeoutMs = Math.max(1_000, Math.min(300_000, Math.floor(record.timeoutMs)));
  }
  return config;
}

export function mergeAiSummarizationLayers(
  ...layers: Array<AISummarizationConfig | false | undefined>
): AISummarizationConfig | false | undefined {
  let merged: AISummarizationConfig | false | undefined;
  for (const layer of layers) {
    if (layer === undefined) {
      continue;
    }
    if (layer === false) {
      merged = false;
      continue;
    }
    if (merged === false) {
      continue;
    }
    merged = merged === undefined ? { ...layer } : { ...merged, ...layer };
  }
  return merged;
}

export function resolveAiSummarizationForTurn(
  defaultConfig: AISummarizationConfig | false,
  input: LoongTurnInput,
): AISummarizationConfig | false {
  const parsed = parseAiSummarizationValue(input.metadata?.aiSummarization);
  if (parsed === undefined) {
    return defaultConfig;
  }
  if (parsed === false) {
    return false;
  }
  if (defaultConfig === false) {
    return parsed;
  }
  return { ...defaultConfig, ...parsed };
}
