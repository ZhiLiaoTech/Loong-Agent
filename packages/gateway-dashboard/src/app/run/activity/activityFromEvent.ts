import type { LoongEvent } from "../../../api/index.js";
import type { TranslateFn } from "../../events/formatGatewayEvent.js";
import { detailForGatewayEvent } from "../../events/formatGatewayEvent.js";
import { labelForToolActivity } from "./toolActivityLabels.js";
import type {
  ActivityCategory,
  ActivityGranularity,
  ActivityStepStatus,
  ChatActivityStep,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function upsertStep(
  steps: ChatActivityStep[],
  id: string,
  patch: {
    label: string;
    category: ActivityCategory;
    status?: ActivityStepStatus;
    detail?: string;
    sequence?: number;
  },
): ChatActivityStep[] {
  const index = steps.findIndex(step => step.id === id);
  const previous = index === -1 ? undefined : steps[index];
  const step: ChatActivityStep = {
    id,
    label: patch.label,
    category: patch.category,
    status: patch.status ?? previous?.status ?? "running",
  };
  const detail = patch.detail ?? previous?.detail;
  if (detail) {
    step.detail = detail;
  }
  const sequenceValue = patch.sequence ?? previous?.sequence;
  if (sequenceValue !== undefined) {
    step.sequence = sequenceValue;
  }
  if (index === -1) {
    return [...steps, step];
  }
  const next = [...steps];
  next[index] = step;
  return next;
}

function isContextVisible(providerName: string, granularity: ActivityGranularity): boolean {
  if (granularity === "detailed") {
    return true;
  }
  return [
    "ai_summarization",
    "session_message_compaction",
    "memory",
    "tier",
  ].includes(providerName);
}

function labelForContextProvider(providerName: string, t: TranslateFn): string {
  const key = `events.context.${providerName}`;
  const translated = t(key);
  return translated !== key ? translated : providerName;
}

function formatAiSummarizationDetail(payload: Record<string, unknown> | undefined, t: TranslateFn): string {
  if (!payload) {
    return "";
  }
  if (payload.skipped === true) {
    return t("events.aiSummarizationSkipped");
  }
  const error = readString(payload.error);
  if (error) {
    return t("events.aiSummarizationFailed").replace("{error}", error);
  }
  const summarizedTurns = readNumber(payload.summarizedTurns);
  const summaryLength = readNumber(payload.summaryLength);
  const parts: string[] = [];
  if (summarizedTurns !== undefined) {
    parts.push(t("events.aiSummarizationTurns").replace("{count}", String(summarizedTurns)));
  }
  if (summaryLength !== undefined) {
    parts.push(t("events.aiSummarizationChars").replace("{count}", String(summaryLength)));
  }
  return parts.join(" · ");
}

function formatTierDetail(metadata: Record<string, unknown> | undefined, t: TranslateFn): string | undefined {
  if (!metadata) {
    return undefined;
  }
  const tier = readString(metadata.tier);
  if (!tier) {
    return undefined;
  }
  const parts = [tier];
  const source = readString(metadata.tierSource);
  if (source) {
    parts.push(source);
  }
  const score = readNumber(metadata.tierScore);
  if (score !== undefined) {
    parts.push(String(score));
  }
  const reason = readString(metadata.tierReason);
  if (reason) {
    parts.push(reason);
  }
  return parts.join(" · ");
}

export function applyActivityEvent(
  steps: readonly ChatActivityStep[],
  event: LoongEvent,
  options: {
    granularity: ActivityGranularity;
    translate: TranslateFn;
    sequence?: number;
  },
): ChatActivityStep[] {
  const { granularity, translate: t, sequence } = options;
  let next = [...steps];

  if (event.type === "lifecycle" && event.phase === "start") {
    const tierDetail = formatTierDetail(
      isRecord(event.metadata) ? event.metadata : undefined,
      t,
    );
    if (tierDetail) {
      next = upsertStep(next, "lifecycle:tier", {
        label: t("chat.activity.tierSelected"),
        detail: tierDetail,
        category: "lifecycle",
        status: "done",
        ...(sequence !== undefined ? { sequence } : {}),
      });
    }
    return next;
  }

  if (event.type === "context") {
    const providerName = readString(event.providerName) ?? "unknown";
    if (!isContextVisible(providerName, granularity)) {
      return next;
    }
    const id = `context:${providerName}`;
    const label = labelForContextProvider(providerName, t);
    if (event.phase === "start") {
      return upsertStep(next, id, {
        label,
        category: "context",
        status: "running",
        ...(sequence !== undefined ? { sequence } : {}),
      });
    }
    const payload = isRecord(event.payload) ? event.payload : undefined;
    const detail = providerName === "ai_summarization"
      ? formatAiSummarizationDetail(payload, t)
      : detailForGatewayEvent(event, t);
    const status: ActivityStepStatus = payload?.error || payload?.skipped === true && providerName === "ai_summarization"
      ? "skipped"
      : "done";
    return upsertStep(next, id, {
      label,
      category: "context",
      status,
      ...(detail ? { detail } : {}),
      ...(sequence !== undefined ? { sequence } : {}),
    });
  }

  if (event.type === "tool") {
    const toolName = readString(event.toolName) ?? "tool";
    const payload = isRecord(event.payload) ? event.payload : {};
    const toolCallId = readString(payload.toolCallId) ?? `${toolName}:${sequence ?? next.length}`;
    const id = `tool:${toolCallId}`;
    const backendLabel = readString(payload.displayLabel);
    const backendDetail = readString(payload.displayDetail);
    const { label, detail } = labelForToolActivity(
      toolName,
      payload.inputSummary ?? payload,
      t,
      backendLabel,
      backendDetail,
    );

    if (event.phase === "start") {
      return upsertStep(next, id, {
        label,
        ...(detail ? { detail } : {}),
        category: "tool",
        status: "running",
        ...(sequence !== undefined ? { sequence } : {}),
      });
    }

    if (event.phase === "update") {
      const completed = readNumber(payload.completed);
      const total = readNumber(payload.total);
      const parallelDetail = completed !== undefined && total !== undefined
        ? t("chat.activity.parallelProgress").replace("{done}", String(completed)).replace("{total}", String(total))
        : detail;
      return upsertStep(next, id, {
        label,
        ...(parallelDetail ? { detail: parallelDetail } : {}),
        category: "tool",
        status: "running",
        ...(sequence !== undefined ? { sequence } : {}),
      });
    }

    const skipped = payload.skipped === true;
    const permission = isRecord(payload.permission) ? payload.permission : undefined;
    const denied = permission?.decision === "deny";
    const resultSummary = payload.resultSummary;
    const failed = isRecord(resultSummary) && resultSummary.ok === false;
    const status: ActivityStepStatus = skipped
      ? "skipped"
      : denied || failed || payload.ok === false
        ? "error"
        : "done";

    return upsertStep(next, id, {
      label,
      ...(detail ? { detail } : {}),
      category: "tool",
      status,
      ...(sequence !== undefined ? { sequence } : {}),
    });
  }

  if (event.type === "permission") {
    const id = `permission:${event.toolCallId}`;
    const toolName = readString(event.toolName);
    if (event.phase === "request") {
      return upsertStep(next, id, {
        label: t("chat.activity.awaitingApproval"),
        ...(toolName ? { detail: toolName } : {}),
        category: "permission",
        status: "running",
        ...(sequence !== undefined ? { sequence } : {}),
      });
    }
    const decision = isRecord(event.payload) ? readString(event.payload.decision) : undefined;
    const status: ActivityStepStatus = decision === "deny" ? "error" : "done";
    return upsertStep(next, id, {
      label: decision === "deny"
        ? t("chat.activity.approvalDenied")
        : t("chat.activity.approvalGranted"),
      ...(toolName ? { detail: toolName } : {}),
      category: "permission",
      status,
      ...(sequence !== undefined ? { sequence } : {}),
    });
  }

  return next;
}

export function isActivityEvent(event: { type?: string; phase?: string }): boolean {
  if (event.type === "tool" || event.type === "permission" || event.type === "context") {
    return true;
  }
  return event.type === "lifecycle" && event.phase === "start";
}
