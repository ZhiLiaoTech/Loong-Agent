import { mergeAgentProfileIntoTurnInput, type LoongSource, type LoongThinkingLevel, type LoongTurnInput } from "@loong/core";
import { assertLoongGatewayWebhookPayload } from "./channels-webhook.js";
import { badRequest } from "./gateway-http.js";
import {
  isLoongSource,
  isLoongThinking,
  isRecord,
  normalizeBoundedText,
  normalizeShortText,
} from "./gateway-parse.js";
import type {
  GatewayAgentAttachment,
  GatewayAgentConfigStore,
  GatewayAgentParams,
  GatewayTierName,
  GatewayWebhookParams,
} from "./gateway-agent-types.js";

const GATEWAY_MAX_ATTACHMENTS = 10;
const GATEWAY_MAX_ATTACHMENT_BASE64 = 14 * 1024 * 1024; // ~10MB raw

export function parseGatewayAgentParams(value: unknown): GatewayAgentParams {
  if (!isRecord(value)) {
    badRequest("Gateway agent request requires params.");
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    badRequest("Gateway agent request requires non-empty sessionId.");
  }
  if (typeof value.message !== "string" || !value.message.trim()) {
    badRequest("Gateway agent request requires non-empty message.");
  }
  const params: GatewayAgentParams = {
    sessionId: value.sessionId,
    message: value.message,
  };
  if (value.source !== undefined) {
    if (!isLoongSource(value.source)) {
      badRequest(`Invalid gateway agent source: ${String(value.source)}`);
    }
    params.source = value.source;
  }
  if (typeof value.workspace === "string") {
    params.workspace = value.workspace;
  }
  if (typeof value.model === "string") {
    params.model = value.model;
  }
  if (value.thinking !== undefined) {
    if (!isLoongThinking(value.thinking)) {
      badRequest(`Invalid gateway agent thinking: ${String(value.thinking)}`);
    }
    params.thinking = value.thinking;
  }
  if (typeof value.profileId === "string" && value.profileId.trim()) {
    params.profileId = normalizeShortText(value.profileId, "profileId", 200);
  }
  if (typeof value.employeeId === "string" && value.employeeId.trim()) {
    params.employeeId = normalizeShortText(value.employeeId, "employeeId", 200);
  }
  if (typeof value.systemPrompt === "string" && value.systemPrompt.trim()) {
    params.systemPrompt = normalizeBoundedText(value.systemPrompt, "systemPrompt", 16_000);
  }
  if (value.toolsEnabled !== undefined) {
    if (typeof value.toolsEnabled !== "boolean") {
      badRequest("Gateway agent toolsEnabled must be a boolean.");
    }
    params.toolsEnabled = value.toolsEnabled;
  }
  if (value.memoryEnabled !== undefined) {
    if (typeof value.memoryEnabled !== "boolean") {
      badRequest("Gateway agent memoryEnabled must be a boolean.");
    }
    params.memoryEnabled = value.memoryEnabled;
  }
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) {
      badRequest("Gateway agent metadata must be an object.");
    }
    params.metadata = value.metadata;
  }
  if (value.attachments !== undefined) {
    params.attachments = parseGatewayAttachments(value.attachments);
  }
  if (value.tier !== undefined) {
    if (value.tier !== "fast" && value.tier !== "standard" && value.tier !== "deep") {
      badRequest(`Invalid gateway agent tier: ${String(value.tier)}`);
    }
    params.tier = value.tier as GatewayTierName;
  }
  if (value.queryLoop === true) {
    params.queryLoop = true;
  } else if (isRecord(value.queryLoop)) {
    params.queryLoop = value.queryLoop.enabled !== false;
    if (typeof value.queryLoop.maxTurns === "number" && Number.isFinite(value.queryLoop.maxTurns)) {
      params.queryLoopMaxTurns = Math.min(10, Math.max(1, Math.floor(value.queryLoop.maxTurns)));
    }
  }
  if (typeof value.queryLoopMaxTurns === "number" && Number.isFinite(value.queryLoopMaxTurns)) {
    params.queryLoopMaxTurns = Math.min(10, Math.max(1, Math.floor(value.queryLoopMaxTurns)));
  }
  if (value.forceQueryLoop === true) {
    params.metadata = { ...(params.metadata ?? {}), forceQueryLoop: true };
  }
  return params;
}

export function parseGatewayAttachments(value: unknown): GatewayAgentAttachment[] {
  if (!Array.isArray(value)) {
    badRequest("Gateway agent attachments must be an array.");
  }
  if (value.length > GATEWAY_MAX_ATTACHMENTS) {
    badRequest(`Gateway agent attachments exceed cap of ${GATEWAY_MAX_ATTACHMENTS}.`);
  }
  const out: GatewayAgentAttachment[] = [];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) {
      badRequest(`Gateway agent attachment ${index + 1} must be an object.`);
    }
    if (raw.kind !== "image" && raw.kind !== "text" && raw.kind !== "document") {
      badRequest(`Gateway agent attachment ${index + 1} kind must be image, text, or document.`);
    }
    if (typeof raw.mimeType !== "string" || !raw.mimeType.trim()) {
      badRequest(`Gateway agent attachment ${index + 1} requires mimeType.`);
    }
    if (typeof raw.data !== "string" || raw.data.length === 0) {
      badRequest(`Gateway agent attachment ${index + 1} requires base64 data.`);
    }
    if (raw.data.length > GATEWAY_MAX_ATTACHMENT_BASE64) {
      badRequest(`Gateway agent attachment ${index + 1} exceeds size cap.`);
    }
    const att: GatewayAgentAttachment = {
      kind: raw.kind,
      mimeType: raw.mimeType.trim(),
      data: raw.data,
    };
    if (typeof raw.name === "string" && raw.name.trim()) {
      att.name = normalizeShortText(raw.name, "attachment name", 200);
    }
    if (typeof raw.size === "number" && Number.isFinite(raw.size) && raw.size >= 0) {
      att.size = Math.floor(raw.size);
    }
    out.push(att);
  }
  return out;
}

export function parseGatewayWebhookParams(value: unknown): GatewayWebhookParams {
  if (!isRecord(value)) {
    badRequest("Webhook channel request requires a JSON object.");
  }
  try {
    assertLoongGatewayWebhookPayload(value);
  } catch (error) {
    badRequest(error instanceof Error ? error.message : String(error));
  }
  const channel = typeof value.channel === "string" && value.channel.trim()
    ? normalizeShortText(value.channel, "channel", 120)
    : "webhook";
  const params = parseGatewayAgentParams({
    ...value,
    source: (value.source as LoongSource | undefined) ?? "web",
    metadata: mergeWebhookMetadata(value.metadata, channel, value.userId, value.threadId),
  });
  return {
    ...params,
    channel,
    ...(typeof value.userId === "string" && value.userId.trim()
      ? { userId: normalizeShortText(value.userId, "userId", 200) }
      : {}),
    ...(typeof value.threadId === "string" && value.threadId.trim()
      ? { threadId: normalizeShortText(value.threadId, "threadId", 200) }
      : {}),
  };
}

function mergeWebhookMetadata(
  metadata: unknown,
  channel: string,
  userId: unknown,
  threadId: unknown,
): Record<string, unknown> {
  if (metadata !== undefined && !isRecord(metadata)) {
    badRequest("Webhook channel metadata must be an object.");
  }
  const merged: Record<string, unknown> = {
    ...(metadata ?? {}),
    channel,
    channelSurface: "webhook",
  };
  if (typeof userId === "string" && userId.trim()) {
    merged.channelUserId = normalizeShortText(userId, "userId", 200);
  }
  if (typeof threadId === "string" && threadId.trim()) {
    merged.channelThreadId = normalizeShortText(threadId, "threadId", 200);
  }
  return merged;
}

export async function resolveAgentParamsWithProfile(
  params: GatewayAgentParams,
  store: GatewayAgentConfigStore | undefined,
): Promise<GatewayAgentParams> {
  if (!store) {
    return params;
  }
  const config = await store.load();
  const profileId = params.profileId
    ?? (typeof params.metadata?.profileId === "string" ? params.metadata.profileId : undefined)
    ?? config.defaultProfileId;
  if (!profileId) {
    return params;
  }
  const profile = config.profiles.find(entry => entry.id === profileId);
  if (!profile) {
    return params;
  }
  const mergedTurn = mergeAgentProfileIntoTurnInput(
    {
      sessionId: params.sessionId,
      source: params.source ?? "gateway",
      message: params.message,
      ...(params.workspace !== undefined ? { workspace: params.workspace } : {}),
      ...(params.model !== undefined ? { model: params.model } : {}),
      ...(params.thinking !== undefined ? { thinking: params.thinking } : {}),
      ...(params.systemPrompt !== undefined ? { systemPrompt: params.systemPrompt } : {}),
      ...(params.toolsEnabled !== undefined ? { toolsEnabled: params.toolsEnabled } : {}),
      ...(params.memoryEnabled !== undefined ? { memoryEnabled: params.memoryEnabled } : {}),
      ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
    },
    {
      id: profile.id,
      name: profile.name,
      ...(profile.defaultModel !== undefined ? { defaultModel: profile.defaultModel } : {}),
      ...(profile.workspace !== undefined ? { workspace: profile.workspace } : {}),
      ...(profile.thinking !== undefined ? { thinking: profile.thinking } : {}),
      ...(profile.systemPrompt !== undefined ? { systemPrompt: profile.systemPrompt } : {}),
      ...(profile.toolsEnabled !== undefined ? { toolsEnabled: profile.toolsEnabled } : {}),
      ...(profile.memoryEnabled !== undefined ? { memoryEnabled: profile.memoryEnabled } : {}),
      ...(profile.sessionCompaction !== undefined ? { sessionCompaction: profile.sessionCompaction } : {}),
      ...(profile.aiSummarization !== undefined ? { aiSummarization: profile.aiSummarization } : {}),
    },
  );
  return {
    ...params,
    ...(params.model === undefined && mergedTurn.model !== undefined ? { model: mergedTurn.model } : {}),
    ...(params.workspace === undefined && mergedTurn.workspace !== undefined ? { workspace: mergedTurn.workspace } : {}),
    ...(params.thinking === undefined && mergedTurn.thinking !== undefined ? { thinking: mergedTurn.thinking } : {}),
    ...(params.systemPrompt === undefined && mergedTurn.systemPrompt !== undefined ? { systemPrompt: mergedTurn.systemPrompt } : {}),
    ...(params.toolsEnabled === undefined && mergedTurn.toolsEnabled !== undefined ? { toolsEnabled: mergedTurn.toolsEnabled } : {}),
    ...(params.memoryEnabled === undefined && mergedTurn.memoryEnabled !== undefined ? { memoryEnabled: mergedTurn.memoryEnabled } : {}),
    ...(mergedTurn.metadata !== undefined ? { metadata: mergedTurn.metadata } : {}),
  };
}

export function toTurnInput(params: GatewayAgentParams): LoongTurnInput {
  const input: LoongTurnInput = {
    sessionId: params.sessionId,
    source: params.source ?? "gateway",
    message: params.message,
  };
  if (params.workspace !== undefined) {
    input.workspace = params.workspace;
  }
  if (params.model !== undefined) {
    input.model = params.model;
  }
  if (params.thinking !== undefined) {
    input.thinking = params.thinking;
  }
  if (params.systemPrompt !== undefined) {
    input.systemPrompt = params.systemPrompt;
  }
  if (params.toolsEnabled !== undefined) {
    input.toolsEnabled = params.toolsEnabled;
  }
  if (params.memoryEnabled !== undefined) {
    input.memoryEnabled = params.memoryEnabled;
  }
  if (params.attachments !== undefined && params.attachments.length > 0) {
    input.attachments = params.attachments.map(a => ({
      kind: a.kind,
      mimeType: a.mimeType,
      data: a.data,
      ...(a.name !== undefined ? { name: a.name } : {}),
      ...(a.size !== undefined ? { size: a.size } : {}),
    }));
  }
  if (params.tier !== undefined) {
    input.tier = params.tier;
  }
  if (params.queryLoop !== undefined) {
    input.queryLoop = params.queryLoop;
  }
  if (params.metadata !== undefined) {
    input.metadata = params.metadata;
  }
  return input;
}
