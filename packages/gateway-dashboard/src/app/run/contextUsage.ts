/**
 * Keep message-budget math aligned with @loong/core turn-prep.ts
 * (browser bundle does not import core directly).
 */
export const TURN_MESSAGE_BUDGET_MULTIPLIER = 8;
export const MIN_TURN_MESSAGE_BUDGET_CHARS = 32_000;

export interface ContextUsageSnapshot {
  /** Estimated chars in the message list sent to the model (turn_prep). */
  usedChars?: number;
  /** Message-list char budget (totalEstimatedMaxChars). */
  limitChars?: number;
  /** Tier injection cap for memory/skills context (tierMaxContextChars). */
  injectedContextLimitChars?: number;
  tier?: "fast" | "standard" | "deep";
  truncatedToolResults?: number;
  truncatedAssistant?: number;
  estimatedCharsBefore?: number;
  modelContextWindow?: number;
  runId?: string;
}

export function computeTurnMessageBudgetChars(turnMaxContextChars: number): number {
  const base = Math.floor(turnMaxContextChars);
  if (!Number.isFinite(base) || base <= 0) {
    return MIN_TURN_MESSAGE_BUDGET_CHARS;
  }
  return Math.max(base * TURN_MESSAGE_BUDGET_MULTIPLIER, MIN_TURN_MESSAGE_BUDGET_CHARS);
}

export function formatCompactCount(value: number): string {
  const n = Math.max(0, Math.floor(value));
  if (n >= 1_000_000) {
    const scaled = n / 1_000_000;
    return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1000) {
    const scaled = n / 1000;
    return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}

/** @deprecated Use formatCompactCount */
export const formatCompactChars = formatCompactCount;

export function contextUsagePercent(used?: number, limit?: number): number | undefined {
  if (used === undefined || limit === undefined || limit <= 0) {
    return undefined;
  }
  return Math.round((used / limit) * 100);
}

export function contextUsageBarWidth(percent: number | undefined): number {
  if (percent === undefined) {
    return 0;
  }
  return Math.min(100, Math.max(0, percent));
}

export function contextUsageTone(percent: number | undefined): "normal" | "warn" | "danger" {
  if (percent === undefined) {
    return "normal";
  }
  if (percent >= 85) {
    return "danger";
  }
  if (percent >= 70) {
    return "warn";
  }
  return "normal";
}

export function readContextPayloadNumber(payload: unknown, key: string): number | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function resolveModelContextWindow(
  modelId: string,
  providers: readonly { id: string; models?: readonly { id: string; contextWindow?: number }[] }[],
): number | undefined {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return undefined;
  }
  const colon = trimmed.indexOf(":");
  if (colon > 0) {
    const providerId = trimmed.slice(0, colon);
    const localId = trimmed.slice(colon + 1);
    const provider = providers.find(entry => entry.id === providerId);
    const model = provider?.models?.find(entry => entry.id === localId);
    if (model?.contextWindow !== undefined && model.contextWindow > 0) {
      return model.contextWindow;
    }
  }
  for (const provider of providers) {
    for (const model of provider.models ?? []) {
      if (model.id === trimmed || `${provider.id}:${model.id}` === trimmed) {
        if (model.contextWindow !== undefined && model.contextWindow > 0) {
          return model.contextWindow;
        }
      }
    }
  }
  return undefined;
}

export function resetContextUsageForNewRun(current: ContextUsageSnapshot | null): ContextUsageSnapshot | null {
  if (!current) {
    return null;
  }
  const next: ContextUsageSnapshot = {};
  if (current.limitChars !== undefined) {
    next.limitChars = current.limitChars;
  }
  if (current.injectedContextLimitChars !== undefined) {
    next.injectedContextLimitChars = current.injectedContextLimitChars;
  }
  if (current.tier !== undefined) {
    next.tier = current.tier;
  }
  if (current.modelContextWindow !== undefined) {
    next.modelContextWindow = current.modelContextWindow;
  }
  return next;
}
