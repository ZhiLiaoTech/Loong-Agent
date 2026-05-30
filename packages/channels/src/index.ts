export interface LoongChannelMessage {
  channel: string;
  text: string;
  userId?: string;
  threadId?: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
}

export type LoongGatewayThinkingLevel = "none" | "low" | "medium" | "high";

export interface LoongGatewayWebhookPayload {
  sessionId: string;
  message: string;
  channel: string;
  userId?: string;
  threadId?: string;
  workspace?: string;
  model?: string;
  profileId?: string;
  thinking?: LoongGatewayThinkingLevel;
  toolsEnabled?: boolean;
  memoryEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface LoongChannelGatewayOptions {
  sessionPrefix?: string;
  sessionId?: string | ((message: Readonly<LoongChannelMessage>) => string);
  workspace?: string;
  model?: string;
  profileId?: string;
  thinking?: LoongGatewayThinkingLevel;
  toolsEnabled?: boolean;
  memoryEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface LoongChannelDeliveryResult {
  ok: boolean;
  status: number;
  payload?: unknown;
  error?: string;
}

export interface LoongChannelDeliveryTarget {
  deliver(
    message: LoongChannelMessage,
    options?: LoongChannelGatewayOptions,
  ): Promise<LoongChannelDeliveryResult>;
}

export interface GatewayWebhookChannelTargetOptions {
  gatewayUrl: string;
  sharedSecret?: string;
  fetchImpl?: typeof fetch;
  defaults?: LoongChannelGatewayOptions;
}

export function parseTelegramWebhook(payload: unknown): LoongChannelMessage | undefined {
  if (!isRecord(payload)) {
    throw new Error("Telegram webhook payload must be an object.");
  }
  const event = readTelegramEvent(payload);
  if (event === undefined) {
    return undefined;
  }
  const { type, message } = event;
  const text = firstNonBlankString(message.text, message.caption);
  if (text === undefined || !text.trim()) {
    return undefined;
  }
  const chat = isRecord(message.chat) ? message.chat : undefined;
  const from = isRecord(message.from) ? message.from : undefined;
  const senderChat = isRecord(message.sender_chat) ? message.sender_chat : undefined;
  const userId = firstId(from?.id, senderChat?.id);
  const threadId = firstId(chat?.id);
  const messageId = firstId(message.message_id);
  const metadata: Record<string, unknown> = {
    telegramEventType: type,
    ...(payload.update_id !== undefined ? { telegramUpdateId: payload.update_id } : {}),
    ...(chat?.type !== undefined ? { telegramChatType: chat.type } : {}),
    ...(from?.username !== undefined ? { telegramUsername: from.username } : {}),
    ...(message.date !== undefined ? { telegramMessageDate: message.date } : {}),
  };
  return {
    channel: "telegram",
    text: text.trim(),
    ...(userId !== undefined ? { userId } : {}),
    ...(threadId !== undefined ? { threadId } : {}),
    ...(messageId !== undefined ? { messageId } : {}),
    metadata,
  };
}

export function parseSlackWebhook(payload: unknown): LoongChannelMessage | undefined {
  if (!isRecord(payload)) {
    throw new Error("Slack webhook payload must be an object.");
  }
  if (typeof payload.command === "string") {
    const text = firstNonBlankString(payload.text, payload.command);
    if (text === undefined) {
      return undefined;
    }
    const userId = firstId(payload.user_id);
    const threadId = firstId(payload.channel_id);
    const messageId = firstId(payload.trigger_id);
    return {
      channel: "slack",
      text: text.trim(),
      ...(userId !== undefined ? { userId } : {}),
      ...(threadId !== undefined ? { threadId } : {}),
      ...(messageId !== undefined ? { messageId } : {}),
      metadata: {
        slackPayloadType: "slash_command",
        slackCommand: payload.command,
        ...(payload.team_id !== undefined ? { slackTeamId: payload.team_id } : {}),
        ...(payload.channel_name !== undefined ? { slackChannelName: payload.channel_name } : {}),
      },
    };
  }

  const event = isRecord(payload.event) ? payload.event : undefined;
  if (event === undefined) {
    return undefined;
  }
  const text = firstNonBlankString(event.text);
  if (text === undefined) {
    return undefined;
  }
  const channelId = firstId(event.channel);
  const userId = firstId(event.user, event.bot_id);
  const threadId = firstId(event.thread_ts, channelId);
  const messageId = firstId(event.ts);
  return {
    channel: "slack",
    text: text.trim(),
    ...(userId !== undefined ? { userId } : {}),
    ...(threadId !== undefined ? { threadId } : {}),
    ...(messageId !== undefined ? { messageId } : {}),
    metadata: {
      slackPayloadType: firstString(payload.type) ?? "event_callback",
      ...(payload.team_id !== undefined ? { slackTeamId: payload.team_id } : {}),
      ...(event.type !== undefined ? { slackEventType: event.type } : {}),
      ...(channelId !== undefined ? { slackChannelId: channelId } : {}),
    },
  };
}

export interface PostGatewayWebhookOptions {
  gatewayUrl: string;
  sharedSecret?: string;
  body: unknown;
  fetchImpl?: typeof fetch;
}

export interface PostGatewayWebhookResult {
  ok: boolean;
  status: number;
  error?: string;
  payload?: unknown;
}

export async function postGatewayWebhook(options: PostGatewayWebhookOptions): Promise<PostGatewayWebhookResult> {
  const gatewayUrl = normalizeGatewayUrl(options.gatewayUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${gatewayUrl}/channels/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.sharedSecret !== undefined ? { authorization: `Bearer ${options.sharedSecret}` } : {}),
      },
      body: JSON.stringify(options.body),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: readResponseError(payload) ?? `Gateway webhook delivery failed with HTTP ${response.status}.`,
      ...(payload !== undefined ? { payload } : {}),
    };
  }
  return {
    ok: true,
    status: response.status,
    ...(payload !== undefined ? { payload } : {}),
  };
}

export function createGatewayWebhookChannelTarget(options: GatewayWebhookChannelTargetOptions): LoongChannelDeliveryTarget {
  const gatewayUrl = normalizeGatewayUrl(options.gatewayUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async deliver(message, deliveryOptions = {}) {
      const payload = toGatewayWebhookPayload(message, mergeGatewayOptions(options.defaults, deliveryOptions));
      return await postGatewayWebhook({
        gatewayUrl,
        ...(options.sharedSecret !== undefined ? { sharedSecret: options.sharedSecret } : {}),
        body: payload,
        fetchImpl,
      });
    },
  };
}

export function toGatewayWebhookPayload(
  message: LoongChannelMessage,
  options: LoongChannelGatewayOptions = {},
): LoongGatewayWebhookPayload {
  const normalized = normalizeChannelMessage(message);
  const sessionId = typeof options.sessionId === "function"
    ? options.sessionId(normalized)
    : options.sessionId ?? defaultSessionId(normalized, options.sessionPrefix);
  return {
    sessionId: normalizeText(sessionId, "Gateway webhook sessionId", 200),
    message: normalized.text,
    channel: normalized.channel,
    ...(normalized.userId !== undefined ? { userId: normalized.userId } : {}),
    ...(normalized.threadId !== undefined ? { threadId: normalized.threadId } : {}),
    ...(options.workspace !== undefined ? { workspace: normalizeText(options.workspace, "Gateway webhook workspace", 1000) } : {}),
    ...(options.model !== undefined ? { model: normalizeText(options.model, "Gateway webhook model", 200) } : {}),
    ...(options.profileId !== undefined ? { profileId: normalizeText(options.profileId, "Gateway webhook profileId", 120) } : {}),
    ...(options.thinking !== undefined ? { thinking: options.thinking } : {}),
    ...(options.toolsEnabled !== undefined ? { toolsEnabled: options.toolsEnabled } : {}),
    ...(options.memoryEnabled !== undefined ? { memoryEnabled: options.memoryEnabled } : {}),
    metadata: {
      ...(options.metadata ?? {}),
      ...(normalized.metadata ?? {}),
      ...(normalized.messageId !== undefined ? { channelMessageId: normalized.messageId } : {}),
    },
  };
}

function readTelegramEvent(payload: Record<string, unknown>): { type: string; message: Record<string, unknown> } | undefined {
  for (const key of ["message", "edited_message", "channel_post", "edited_channel_post"]) {
    const value = payload[key];
    if (isRecord(value)) {
      return { type: key, message: value };
    }
  }
  return undefined;
}

function mergeGatewayOptions(
  defaults: LoongChannelGatewayOptions | undefined,
  options: LoongChannelGatewayOptions,
): LoongChannelGatewayOptions {
  const merged: LoongChannelGatewayOptions = {};
  const sessionPrefix = options.sessionPrefix ?? defaults?.sessionPrefix;
  const sessionId = options.sessionId ?? defaults?.sessionId;
  const workspace = options.workspace ?? defaults?.workspace;
  const model = options.model ?? defaults?.model;
  const profileId = options.profileId ?? defaults?.profileId;
  const thinking = options.thinking ?? defaults?.thinking;
  const toolsEnabled = options.toolsEnabled ?? defaults?.toolsEnabled;
  const memoryEnabled = options.memoryEnabled ?? defaults?.memoryEnabled;
  const metadata = defaults?.metadata !== undefined || options.metadata !== undefined
    ? { ...(defaults?.metadata ?? {}), ...(options.metadata ?? {}) }
    : undefined;
  if (sessionPrefix !== undefined) {
    merged.sessionPrefix = sessionPrefix;
  }
  if (sessionId !== undefined) {
    merged.sessionId = sessionId;
  }
  if (workspace !== undefined) {
    merged.workspace = workspace;
  }
  if (model !== undefined) {
    merged.model = model;
  }
  if (profileId !== undefined) {
    merged.profileId = profileId;
  }
  if (thinking !== undefined) {
    merged.thinking = thinking;
  }
  if (toolsEnabled !== undefined) {
    merged.toolsEnabled = toolsEnabled;
  }
  if (memoryEnabled !== undefined) {
    merged.memoryEnabled = memoryEnabled;
  }
  if (metadata !== undefined) {
    merged.metadata = metadata;
  }
  return merged;
}

function normalizeChannelMessage(message: LoongChannelMessage): LoongChannelMessage {
  const normalized: LoongChannelMessage = {
    channel: normalizeText(message.channel, "channel", 80),
    text: normalizeText(message.text, "channel text", 16_000),
    ...(message.userId !== undefined ? { userId: normalizeText(message.userId, "channel userId", 200) } : {}),
    ...(message.threadId !== undefined ? { threadId: normalizeText(message.threadId, "channel threadId", 200) } : {}),
    ...(message.messageId !== undefined ? { messageId: normalizeText(message.messageId, "channel messageId", 200) } : {}),
    ...(message.metadata !== undefined ? { metadata: readMetadata(message.metadata) } : {}),
  };
  return normalized;
}

function defaultSessionId(message: LoongChannelMessage, prefix = "channel"): string {
  const stablePart = message.threadId ?? message.userId ?? message.messageId ?? "default";
  return `${prefix}:${message.channel}:${stablePart}`;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function firstNonBlankString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function firstId(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function normalizeText(value: string, label: string, maxChars: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxChars) {
    throw new Error(`${label} must be ${maxChars} characters or fewer.`);
  }
  return trimmed;
}

function readMetadata(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Channel metadata must be an object.");
  }
  return { ...value };
}

function normalizeGatewayUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Gateway URL cannot be empty.");
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Gateway URL must use http or https.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function readResponseError(payload: unknown): string | undefined {
  if (typeof payload === "string") {
    return payload;
  }
  if (isRecord(payload) && typeof payload.error === "string") {
    return payload.error;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export {
  createGatewayBridgeHandler,
  startGatewayBridgeServer,
  type GatewayBridgeServerHandle,
  type GatewayBridgeServerOptions,
} from "./gateway-bridge-server.js";
