import type { SessionMessageCompactionOptions } from "./session-message-compaction.js";
import type { LoongTurnInput } from "./types.js";

/**
 * Parses `sessionCompaction` from context.json, agents.json, or turn metadata.
 */
export function parseSessionCompactionValue(
  value: unknown,
): SessionMessageCompactionOptions | false | undefined {
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
  const compaction: SessionMessageCompactionOptions = {};
  if (typeof record.keepRecentTurns === "number" && Number.isFinite(record.keepRecentTurns)) {
    compaction.keepRecentTurns = Math.max(1, Math.min(32, Math.floor(record.keepRecentTurns)));
  }
  if (typeof record.olderToolMaxChars === "number" && Number.isFinite(record.olderToolMaxChars)) {
    compaction.olderToolMaxChars = Math.max(64, Math.min(8_000, Math.floor(record.olderToolMaxChars)));
  }
  if (record.compactionPolicy === "always" || record.compactionPolicy === "whenOverBudget") {
    compaction.compactionPolicy = record.compactionPolicy;
  }
  return compaction;
}

/** Later layers override fields; `false` disables compaction and cannot be re-enabled by later layers. */
export function mergeSessionCompactionLayers(
  ...layers: Array<SessionMessageCompactionOptions | false | undefined>
): SessionMessageCompactionOptions | false | undefined {
  let merged: SessionMessageCompactionOptions | false | undefined;
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

/** Per-turn override from `metadata.sessionCompaction` (e.g. agents.json profile). */
export function resolveSessionCompactionForTurn(
  defaultCompaction: SessionMessageCompactionOptions | false,
  input: LoongTurnInput,
): SessionMessageCompactionOptions | false {
  const parsed = parseSessionCompactionValue(input.metadata?.sessionCompaction);
  if (parsed === undefined) {
    return defaultCompaction;
  }
  if (parsed === false) {
    return false;
  }
  if (defaultCompaction === false) {
    return parsed;
  }
  return { ...defaultCompaction, ...parsed };
}
