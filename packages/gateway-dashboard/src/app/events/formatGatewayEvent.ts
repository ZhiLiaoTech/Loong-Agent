import type { LoongEvent } from "../../api/index.js";

export type TranslateFn = (key: string) => string;

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function labelForGatewayEvent(event: LoongEvent, t: TranslateFn = key => key): string {
  if (event.type === "lifecycle") {
    return `${t("events.lifecycle")}:${event.phase ?? ""}`;
  }
  if (event.type === "context") {
    const providerName = readString(event.providerName) ?? "unknown";
    const key = `events.context.${providerName}`;
    const translated = t(key);
    return translated !== key ? translated : `context:${providerName}`;
  }
  if (event.type === "tool") {
    const toolName = readString(event.toolName);
    return toolName ? `${t("events.tool")}:${toolName}` : t("events.tool");
  }
  if (event.type === "assistant_delta") {
    return t("events.assistantDelta");
  }
  if (event.type === "assistant_replace") {
    return t("events.assistantReplace");
  }
  if (event.type === "permission") {
    return `${t("events.permission")}:${event.phase ?? ""}`;
  }
  return readString(event.type) ?? t("events.unknown");
}

export function detailForGatewayEvent(event: LoongEvent, t: TranslateFn = key => key): string {
  if (event.type === "context") {
    return formatContextEventDetail(event, t);
  }
  const text = readString(event.text) ?? readString(event.message) ?? readString(event.toolName);
  return text ?? "";
}

function formatContextEventDetail(event: LoongEvent, t: TranslateFn): string {
  if (event.type !== "context") {
    return "";
  }
  const payload = readRecord(event.payload);
  const providerName = readString(event.providerName) ?? "";

  if (providerName === "ai_summarization") {
    if (payload?.skipped === true) {
      return t("events.aiSummarizationSkipped");
    }
    const summarizedTurns = readNumber(payload?.summarizedTurns);
    const summaryLength = readNumber(payload?.summaryLength);
    const durationMs = readNumber(payload?.durationMs);
    const model = readString(payload?.model);
    const error = readString(payload?.error);
    if (error) {
      return t("events.aiSummarizationFailed").replace("{error}", error);
    }
    const parts: string[] = [];
    if (summarizedTurns !== undefined) {
      parts.push(t("events.aiSummarizationTurns").replace("{count}", String(summarizedTurns)));
    }
    if (summaryLength !== undefined) {
      parts.push(t("events.aiSummarizationChars").replace("{count}", String(summaryLength)));
    }
    if (durationMs !== undefined) {
      parts.push(t("events.aiSummarizationDuration").replace("{ms}", String(durationMs)));
    }
    if (model) {
      parts.push(model);
    }
    return parts.join(" · ") || t("events.aiSummarizationDone");
  }

  if (providerName === "session_message_compaction") {
    const compacted = readNumber(payload?.compactedToolMessages);
    const kept = readNumber(payload?.keptRecentTurns);
    const parts: string[] = [];
    if (compacted !== undefined) {
      parts.push(t("events.compactedTools").replace("{count}", String(compacted)));
    }
    if (kept !== undefined) {
      parts.push(t("events.keptTurns").replace("{count}", String(kept)));
    }
    return parts.join(" · ");
  }

  if (providerName === "session_history_prep" || providerName === "turn_prep") {
    const truncatedTools = readNumber(payload?.truncatedToolResults);
    const truncatedAssistant = readNumber(payload?.truncatedAssistantMessages);
    const parts: string[] = [];
    if (truncatedTools !== undefined && truncatedTools > 0) {
      parts.push(t("events.truncatedTools").replace("{count}", String(truncatedTools)));
    }
    if (truncatedAssistant !== undefined && truncatedAssistant > 0) {
      parts.push(t("events.truncatedAssistant").replace("{count}", String(truncatedAssistant)));
    }
    const before = readNumber(payload?.estimatedCharsBefore);
    const after = readNumber(payload?.estimatedCharsAfter);
    if (before !== undefined && after !== undefined) {
      parts.push(`${after}/${before} ${t("events.chars")}`);
    }
    return parts.join(" · ");
  }

  if (payload) {
    try {
      return JSON.stringify(payload);
    } catch {
      return "";
    }
  }
  return "";
}

export function cssClassForGatewayEvent(event: LoongEvent): string {
  if (event.type === "context") {
    const providerName = readString(event.providerName);
    if (providerName) {
      return `type-context-${providerName.replace(/[^a-z0-9_-]/gi, "_")}`;
    }
    return "type-context";
  }
  return event.type ? `type-${event.type}` : "";
}
