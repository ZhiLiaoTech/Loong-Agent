import { normalizeProviderModelEntries, type LoongProviderModelCatalogEntry } from "@loong/model-catalog";
import { ProviderError, sanitizeProviderBody } from "./errors.js";
import { readServerSentEvents } from "./sse.js";
import type { ModelMessage, ModelProvider, ModelRequest, ModelResponse, ModelToolCall } from "./types.js";

export interface AnthropicProviderOptions {
  id?: string;
  displayName?: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  models?: readonly LoongProviderModelCatalogEntry[];
  maxTokens?: number;
  apiVersion?: string;
  supportsToolCalling?: boolean;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

interface AnthropicMessagesResponse {
  id?: string;
  content?: Array<{
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  message?: {
    id?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  content_block?: {
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-3-5-haiku-latest";
const DEFAULT_MAX_TOKENS = 4096;

export function createAnthropicProvider(options: AnthropicProviderOptions): ModelProvider {
  const id = (options.id ?? "anthropic").trim();
  const apiKey = options.apiKey.trim();
  if (!id) {
    throw new Error("Anthropic provider id must not be empty.");
  }
  if (!apiKey) {
    throw new Error(`Anthropic provider "${id}" requires a non-empty API key.`);
  }

  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL, id);
  const maxTokens = normalizeMaxTokens(options.maxTokens, id);
  const apiVersion = options.apiVersion?.trim() || DEFAULT_API_VERSION;
  const fetchImpl = options.fetchImpl ?? fetch;

  const provider: ModelProvider = {
    id,
    displayName: options.displayName ?? "Anthropic Compatible",
    supportsToolCalling: options.supportsToolCalling ?? true,
    canHandleModel: modelRef => modelRef.startsWith(`${id}/`) || modelRef.startsWith(`${id}:`),
    normalizeModel: modelRef => stripProviderPrefix(modelRef, id),
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const body = toAnthropicBody(request, maxTokens);
      if (request.onTextDelta !== undefined) {
        body.stream = true;
      }
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": apiVersion,
          ...options.headers,
        },
        body: JSON.stringify(body),
      };
      if (request.signal !== undefined) {
        requestInit.signal = request.signal;
      }

      const response = await fetchProvider(fetchImpl, `${baseUrl}/messages`, requestInit, id);
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const errorOptions = {
          providerId: id,
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
          message: `Model provider "${id}" failed with HTTP ${response.status}.`,
        };
        throw new ProviderError(
          body
            ? { ...errorOptions, responseBody: sanitizeProviderBody(body) }
            : errorOptions,
        );
      }

      return request.onTextDelta !== undefined
        ? await parseProviderStream(response, id, request.onTextDelta)
        : await parseProviderResponse(response, id);
    },
  };

  if (options.defaultModel !== undefined) {
    provider.defaultModel = options.defaultModel;
  }
  if (options.models !== undefined || provider.defaultModel !== undefined) {
    provider.models = normalizeProviderModelEntries(options.models ?? [], {
      ...(provider.defaultModel !== undefined ? { defaultModel: provider.defaultModel } : {}),
      supportsToolCalling: provider.supportsToolCalling,
    });
  }

  return provider;
}

async function parseProviderResponse(response: Response, providerId: string): Promise<ModelResponse> {
  const json = await parseProviderJson(response, providerId);
  const text = extractResponseText(json);
  const toolCalls = extractResponseToolCalls(json);
  if (!text && toolCalls.length === 0) {
    throw new ProviderError({
      providerId,
      code: "empty_response",
      message: `Model provider "${providerId}" returned an empty message.`,
    });
  }

  const modelResponse: ModelResponse = {
    id: json.id ?? crypto.randomUUID(),
  };
  if (text) {
    modelResponse.text = text;
  }
  if (toolCalls.length > 0) {
    modelResponse.toolCalls = toolCalls;
  }
  if (json.usage) {
    modelResponse.usage = toUsage(json.usage);
  }
  return modelResponse;
}

async function parseProviderStream(
  response: Response,
  providerId: string,
  onTextDelta: (delta: string) => void,
): Promise<ModelResponse> {
  let responseId: string = crypto.randomUUID();
  let usage: ModelResponse["usage"];
  const blocks = new Map<number, {
    type: "text" | "tool_use";
    text: string;
    id?: string;
    name?: string;
    inputJson: string;
  }>();

  await readServerSentEvents(response, providerId, (_eventName, data) => {
    const event = parseStreamEvent(data, providerId);
    if (event.type === "message_start") {
      if (event.message?.id !== undefined) {
        responseId = event.message.id;
      }
      if (event.message?.usage !== undefined) {
        usage = toUsage(event.message.usage);
      }
      return;
    }
    if (event.type === "message_delta") {
      if (event.usage !== undefined) {
        usage = {
          ...(usage ?? {}),
          ...toUsage(event.usage),
        };
      }
      return;
    }
    if (event.type === "content_block_start" && event.index !== undefined) {
      const block = event.content_block;
      if (block?.type === "tool_use") {
        const toolBlock: {
          type: "tool_use";
          text: string;
          id?: string;
          name?: string;
          inputJson: string;
        } = {
          type: "tool_use",
          text: "",
          inputJson: stringifyToolInput(block.input),
        };
        if (block.id !== undefined) {
          toolBlock.id = block.id;
        }
        if (block.name !== undefined) {
          toolBlock.name = block.name;
        }
        blocks.set(event.index, toolBlock);
      } else {
        const initialText = block?.type === "text" && typeof block.text === "string" ? block.text : "";
        if (initialText) {
          onTextDelta(initialText);
        }
        blocks.set(event.index, {
          type: "text",
          text: initialText,
          inputJson: "",
        });
      }
      return;
    }
    if (event.type === "content_block_delta" && event.index !== undefined) {
      const block = blocks.get(event.index) ?? { type: "text", text: "", inputJson: "" };
      if (event.delta?.type === "text_delta" && event.delta.text !== undefined) {
        block.text += event.delta.text;
        onTextDelta(event.delta.text);
      }
      if (event.delta?.type === "input_json_delta" && event.delta.partial_json !== undefined) {
        block.inputJson = block.inputJson === "{}"
          ? event.delta.partial_json
          : `${block.inputJson}${event.delta.partial_json}`;
      }
      blocks.set(event.index, block);
    }
  });

  const orderedBlocks = [...blocks.entries()].sort(([left], [right]) => left - right).map(([, block]) => block);
  const text = orderedBlocks
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("");
  const toolCalls = orderedBlocks.flatMap((block, index) => block.type === "tool_use" && block.name
    ? [{
        id: block.id ?? `toolu_${index}`,
        type: "function",
        function: {
          name: block.name,
          arguments: normalizeJsonText(block.inputJson),
        },
      } satisfies ModelToolCall]
    : []);

  if (!text && toolCalls.length === 0) {
    throw new ProviderError({
      providerId,
      code: "empty_response",
      message: `Model provider "${providerId}" returned an empty streamed message.`,
    });
  }

  const modelResponse: ModelResponse = {
    id: responseId,
    streamedText: text.length > 0,
  };
  if (text) {
    modelResponse.text = text;
  }
  if (toolCalls.length > 0) {
    modelResponse.toolCalls = toolCalls;
  }
  if (usage !== undefined) {
    modelResponse.usage = usage;
  }
  return modelResponse;
}

function parseStreamEvent(data: string, providerId: string): AnthropicStreamEvent {
  try {
    return JSON.parse(data) as AnthropicStreamEvent;
  } catch (error) {
    throw new ProviderError({
      providerId,
      code: "invalid_stream_json",
      responseBody: sanitizeProviderBody(error instanceof Error ? error.message : String(error)),
      message: `Model provider "${providerId}" returned invalid stream JSON.`,
    });
  }
}

export function createAnthropicProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ModelProvider | undefined {
  const apiKey = firstNonEmpty(env.LOONG_ANTHROPIC_API_KEY, env.ANTHROPIC_API_KEY);
  if (!apiKey) {
    return undefined;
  }

  const options: AnthropicProviderOptions = {
    id: firstNonEmpty(env.LOONG_ANTHROPIC_PROVIDER_ID) ?? "anthropic",
    displayName: firstNonEmpty(env.LOONG_ANTHROPIC_DISPLAY_NAME) ?? "Anthropic Compatible",
    apiKey,
    defaultModel: firstNonEmpty(env.LOONG_ANTHROPIC_MODEL, env.ANTHROPIC_MODEL) ?? DEFAULT_MODEL,
  };

  const baseUrl = firstNonEmpty(env.LOONG_ANTHROPIC_BASE_URL, env.ANTHROPIC_BASE_URL);
  if (baseUrl !== undefined) {
    options.baseUrl = baseUrl;
  }
  const maxTokens = parseOptionalInteger(firstNonEmpty(env.LOONG_ANTHROPIC_MAX_TOKENS, env.ANTHROPIC_MAX_TOKENS), "LOONG_ANTHROPIC_MAX_TOKENS");
  if (maxTokens !== undefined) {
    options.maxTokens = maxTokens;
  }
  const apiVersion = firstNonEmpty(env.LOONG_ANTHROPIC_API_VERSION, env.ANTHROPIC_API_VERSION);
  if (apiVersion !== undefined) {
    options.apiVersion = apiVersion;
  }

  return createAnthropicProvider(options);
}

function toAnthropicBody(request: ModelRequest, maxTokens: number): Record<string, unknown> {
  const prompt = toAnthropicPrompt(request.messages);
  const tools = toAnthropicTools(request.tools);
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: maxTokens,
    messages: prompt.messages,
  };
  if (prompt.system !== undefined) {
    body.system = prompt.system;
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  if (tools.length > 0) {
    body.tools = tools;
  }
  return body;
}

function toAnthropicPrompt(messages: ModelMessage[]): { system?: string; messages: AnthropicMessage[] } {
  const systemParts: string[] = [];
  const anthropicMessages: AnthropicMessage[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      const text = modelMessageToText(message);
      if (!text) {
        continue;
      }
      systemParts.push(text);
      continue;
    }
    const content = modelMessageToAnthropicContent(message);
    if (content.length === 0) {
      continue;
    }
    const targetRole: AnthropicMessage["role"] = message.role === "assistant" ? "assistant" : "user";
    if (message.role === "tool") {
      // tool_result blocks must follow the assistant's tool_use. Multiple
      // consecutive tool_result blocks belong in a single user message (one
      // assistant turn can issue multiple tool_use blocks, each with a
      // matching tool_result). Do not merge tool_result into a user message
      // that already carries non-tool_result content (e.g. plain text).
      // modelMessageToAnthropicContent for a tool message always returns
      // only tool_result blocks; assert the narrower type for the merge path.
      const toolResultBlocks = content as Array<Extract<AnthropicContentBlock, { type: "tool_result" }>>;
      const previous = anthropicMessages[anthropicMessages.length - 1];
      if (previous?.role === "user" && previous.content.every(block => block.type === "tool_result")) {
        previous.content.push(...toolResultBlocks);
      } else {
        anthropicMessages.push({ role: "user", content });
      }
      continue;
    }
    appendAnthropicMessage(anthropicMessages, targetRole, content);
  }

  if (anthropicMessages.length === 0) {
    appendAnthropicMessage(anthropicMessages, "user", [{ type: "text", text: "Continue." }]);
  }

  const result: { system?: string; messages: AnthropicMessage[] } = {
    messages: anthropicMessages,
  };
  const system = systemParts.join("\n\n").trim();
  if (system) {
    result.system = system;
  }
  return result;
}

function appendAnthropicMessage(messages: AnthropicMessage[], role: AnthropicMessage["role"], content: AnthropicContentBlock[]): void {
  const previous = messages[messages.length - 1];
  if (previous?.role === role) {
    previous.content.push(...content);
    return;
  }
  messages.push({ role, content });
}

function modelMessageToAnthropicContent(message: ModelMessage): AnthropicContentBlock[] {
  const content: AnthropicContentBlock[] = [];
  if (message.role === "tool" && message.toolCallId !== undefined) {
    content.push({
      type: "tool_result",
      tool_use_id: message.toolCallId,
      content: extractMessageText(message.content) ?? "",
    });
    return content;
  }
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "text") {
        if (part.text.trim()) {
          content.push({ type: "text", text: part.text });
        }
      } else if (part.type === "image") {
        content.push({
          type: "image",
          source: { type: "base64", media_type: part.mimeType, data: part.dataBase64 },
        });
      }
    }
  } else if (typeof message.content === "string" && message.content.trim()) {
    content.push({ type: "text", text: message.content });
  }
  if (message.role === "assistant" && message.toolCalls !== undefined) {
    for (const toolCall of message.toolCalls) {
      const name = toolCall.function?.name?.trim();
      if (!toolCall.id.trim() || !name) {
        continue;
      }
      content.push({
        type: "tool_use",
        id: toolCall.id,
        name,
        input: parseToolArguments(toolCall.function?.arguments ?? "{}"),
      });
    }
  }
  return content;
}

function extractMessageText(content: ModelMessage["content"]): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(part => part.type === "text")
      .map(part => (part as { type: "text"; text: string }).text)
      .join("\n") || undefined;
  }
  return undefined;
}

function modelMessageToText(message: ModelMessage): string | undefined {
  const parts: string[] = [];
  const text = extractMessageText(message.content);
  if (text && text.trim()) {
    parts.push(text);
  }
  if (message.toolCallId !== undefined && message.role === "tool") {
    parts.unshift(`Tool result ${message.toolCallId}:`);
  }
  const combined = parts.join("\n").trim();
  return combined || undefined;
}

function toAnthropicTools(tools: unknown[] | undefined): Array<Record<string, unknown>> {
  if (tools === undefined) {
    return [];
  }
  const anthropicTools: Array<Record<string, unknown>> = [];
  for (const tool of tools) {
    const normalized = toAnthropicTool(tool);
    if (normalized !== undefined) {
      anthropicTools.push(normalized);
    }
  }
  return anthropicTools;
}

function toAnthropicTool(tool: unknown): Record<string, unknown> | undefined {
  if (!isRecord(tool)) {
    return undefined;
  }
  const directName = typeof tool.name === "string" ? tool.name.trim() : "";
  const directInputSchema = tool.input_schema;
  if (directName && directInputSchema !== undefined) {
    return {
      name: directName,
      ...(typeof tool.description === "string" ? { description: tool.description } : {}),
      input_schema: directInputSchema,
    };
  }

  const fn = isRecord(tool.function) ? tool.function : undefined;
  const name = typeof fn?.name === "string" ? fn.name.trim() : "";
  if (!name) {
    return undefined;
  }
  return {
    name,
    ...(typeof fn?.description === "string" ? { description: fn.description } : {}),
    input_schema: fn?.parameters ?? { type: "object" },
  };
}

async function parseProviderJson(response: Response, providerId: string): Promise<AnthropicMessagesResponse> {
  try {
    return await response.json() as AnthropicMessagesResponse;
  } catch (error) {
    const errorOptions = {
      providerId,
      status: response.status,
      code: "invalid_json",
      message: `Model provider "${providerId}" returned invalid JSON.`,
    };
    throw new ProviderError(
      error instanceof Error
        ? { ...errorOptions, responseBody: sanitizeProviderBody(error.message) }
        : errorOptions,
    );
  }
}

async function fetchProvider(
  fetchImpl: typeof fetch,
  url: string,
  requestInit: RequestInit,
  providerId: string,
): Promise<Response> {
  try {
    return await fetchImpl(url, requestInit);
  } catch (error) {
    const errorOptions = {
      providerId,
      code: "network_error",
      retryable: true,
      message: `Model provider "${providerId}" request failed.`,
    };
    throw new ProviderError(
      error instanceof Error
        ? { ...errorOptions, responseBody: sanitizeProviderBody(error.message) }
        : errorOptions,
    );
  }
}

function extractResponseText(json: AnthropicMessagesResponse): string | undefined {
  const text = json.content
    ?.filter(block => block.type === "text" && typeof block.text === "string")
    .map(block => block.text)
    .join("");
  return text?.length ? text : undefined;
}

function extractResponseToolCalls(json: AnthropicMessagesResponse): ModelToolCall[] {
  const calls: ModelToolCall[] = [];
  for (const block of json.content ?? []) {
    if (block.type !== "tool_use" || typeof block.id !== "string" || typeof block.name !== "string") {
      continue;
    }
    calls.push({
      id: block.id,
      type: "function",
      function: {
        name: block.name,
        arguments: stringifyToolInput(block.input),
      },
    });
  }
  return calls;
}

function parseToolArguments(value: string): unknown {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : { value: parsed };
  } catch {
    return { value };
  }
}

function stringifyToolInput(value: unknown): string {
  const json = JSON.stringify(value ?? {});
  return json && json !== "null" ? json : "{}";
}

function normalizeJsonText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "{}";
  }
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    return stringifyToolInput({ value: trimmed });
  }
}

function toUsage(usage: NonNullable<AnthropicMessagesResponse["usage"]>): NonNullable<ModelResponse["usage"]> {
  const mapped: NonNullable<ModelResponse["usage"]> = {};
  if (usage.input_tokens !== undefined) {
    mapped.inputTokens = usage.input_tokens;
  }
  if (usage.output_tokens !== undefined) {
    mapped.outputTokens = usage.output_tokens;
  }
  return mapped;
}

function normalizeBaseUrl(value: string, providerId: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error(`Anthropic provider "${providerId}" requires a non-empty base URL.`);
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    if (url.username || url.password || trimmed.includes("?") || trimmed.includes("#")) {
      throw new Error("unsupported URL component");
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new Error(`Anthropic provider "${providerId}" has an invalid base URL.`);
  }
}

function normalizeMaxTokens(value: number | undefined, providerId: string): number {
  if (value === undefined) {
    return DEFAULT_MAX_TOKENS;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Anthropic provider "${providerId}" maxTokens must be a positive safe integer.`);
  }
  return value;
}

function stripProviderPrefix(modelRef: string, providerId: string): string {
  if (modelRef.startsWith(`${providerId}/`) || modelRef.startsWith(`${providerId}:`)) {
    return modelRef.slice(providerId.length + 1);
  }
  return modelRef;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function parseOptionalInteger(value: string | undefined, envName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${envName} must be an integer.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
