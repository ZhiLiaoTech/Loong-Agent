import type { LoongEvent } from "../../../api/index.js";
import type { TranslateFn } from "../../events/formatGatewayEvent.js";
import { detailForGatewayEvent } from "../../events/formatGatewayEvent.js";
import { inferActivityStepKind } from "./activityStepKind.js";
import { labelForToolActivity } from "./toolActivityLabels.js";
import type {
  ActivityCategory,
  ActivityGranularity,
  ActivityStepKind,
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

function truncate(value: string, max = 120): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function upsertStep(
  steps: ChatActivityStep[],
  id: string,
  patch: {
    label: string;
    category: ActivityCategory;
    kind?: ActivityStepKind;
    toolName?: string;
    status?: ActivityStepStatus;
    detail?: string;
    sequence?: number;
  },
): ChatActivityStep[] {
  const index = steps.findIndex(step => step.id === id);
  const previous = index === -1 ? undefined : steps[index];
  const kind = patch.kind ?? inferActivityStepKind(patch.category, patch.label, patch.toolName);
  const step: ChatActivityStep = {
    id,
    label: patch.label,
    category: patch.category,
    kind,
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
        kind: "context",
        status: "done",
        ...(sequence !== undefined ? { sequence } : {}),
      });
    }
    return next;
  }

  if (event.type === "model") {
    const payload = isRecord(event.payload) ? event.payload : {};
    const round = readNumber(payload.round) ?? next.filter(step => step.category === "model").length;
    const runId = readString(event.runId) ?? "run";
    const id = `model:${runId}:${round}`;
    const label = t("chat.activity.thinking");

    if (event.phase === "start") {
      return upsertStep(next, id, {
        label,
        category: "model",
        kind: "thinking",
        status: "running",
        ...(sequence !== undefined ? { sequence } : {}),
      });
    }

    const reasoningPreview = readString(payload.reasoningPreview);
    return upsertStep(next, id, {
      label,
      category: "model",
      kind: "thinking",
      status: "done",
      ...(reasoningPreview ? { detail: truncate(reasoningPreview) } : {}),
      ...(sequence !== undefined ? { sequence } : {}),
    });
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
        kind: "context",
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
      kind: "context",
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
    const kind = inferActivityStepKind("tool", label, toolName);

    if (event.phase === "start") {
      return upsertStep(next, id, {
        label,
        ...(detail ? { detail } : {}),
        category: "tool",
        kind,
        toolName,
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
        kind,
        toolName,
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
      kind,
      toolName,
      status,
      ...(sequence !== undefined ? { sequence } : {}),
    });
  }

  if (event.type === "permission") {
    const id = `permission:${event.toolCallId}`;
    const toolName = readString(event.toolName);
    if (event.phase === "request" || event.phase === "queued") {
      const approvalId = isRecord(event.payload) ? readString(event.payload.approvalId) : undefined;
      return upsertStep(next, id, {
        label: event.phase === "queued"
          ? t("chat.activity.awaitingApproval")
          : t("chat.activity.awaitingApproval"),
        ...(toolName ? { detail: approvalId ? `${toolName} · ${approvalId.slice(0, 8)}` : toolName } : {}),
        category: "permission",
        kind: "permission",
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
      kind: "permission",
      status,
      ...(sequence !== undefined ? { sequence } : {}),
    });
  }

  return next;
}

export function isActivityEvent(event: { type?: string; phase?: string }): boolean {
  if (event.type === "tool" || event.type === "permission" || event.type === "context" || event.type === "model") {
    return true;
  }
  return event.type === "lifecycle" && event.phase === "start";
}
