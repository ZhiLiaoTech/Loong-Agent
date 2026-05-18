import { normalizeProviderModelEntries, type DragonProviderModelCatalogEntry } from "@dragon/model-catalog";
import { ProviderError, sanitizeProviderBody } from "./errors.js";
import { readServerSentEvents } from "./sse.js";
import type {
  ModelMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
} from "./types.js";

export interface OpenAICompatibleProviderOptions {
  id?: string;
  displayName?: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  models?: readonly DragonProviderModelCatalogEntry[];
  supportsToolCalling?: boolean;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  id?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ModelToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface ChatCompletionStreamChunk {
  id?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export function createOpenAICompatibleProvider(
  options: OpenAICompatibleProviderOptions,
): ModelProvider {
  const id = (options.id ?? "openai").trim();
  const apiKey = options.apiKey.trim();
  if (!id) {
    throw new Error("OpenAI-compatible provider id must not be empty.");
  }
  if (!apiKey) {
    throw new Error(`OpenAI-compatible provider "${id}" requires a non-empty API key.`);
  }

  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://api.openai.com/v1", id);
  if (!baseUrl) {
    throw new Error(`OpenAI-compatible provider "${id}" requires a non-empty base URL.`);
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  const provider: ModelProvider = {
    id,
    displayName: options.displayName ?? "OpenAI Compatible",
    supportsToolCalling: options.supportsToolCalling ?? true,
    canHandleModel: modelRef => modelRef.startsWith(`${id}/`) || modelRef.startsWith(`${id}:`),
    normalizeModel: modelRef => stripProviderPrefix(modelRef, id),
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const body = toChatCompletionBody(request);
      if (request.onTextDelta !== undefined) {
        body.stream = true;
      }
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          ...options.headers,
        },
        body: JSON.stringify(body),
      };
      if (request.signal !== undefined) {
        requestInit.signal = request.signal;
      }

      const response = await fetchProvider(fetchImpl, `${baseUrl}/chat/completions`, requestInit, id);

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

export function createOpenAICompatibleProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ModelProvider | undefined {
  const apiKey = env.DRAGON_OPENAI_API_KEY ?? env.OPENAI_API_KEY;
  if (!apiKey) {
    return undefined;
  }

  const options: OpenAICompatibleProviderOptions = {
    id: env.DRAGON_OPENAI_PROVIDER_ID ?? "openai",
    displayName: env.DRAGON_OPENAI_DISPLAY_NAME ?? "OpenAI Compatible",
    apiKey,
    defaultModel: env.DRAGON_OPENAI_MODEL ?? env.OPENAI_MODEL ?? "gpt-4.1-mini",
  };
  const baseUrl = env.DRAGON_OPENAI_BASE_URL ?? env.OPENAI_BASE_URL;
  if (baseUrl !== undefined) {
    options.baseUrl = baseUrl;
  }
  return createOpenAICompatibleProvider(options);
}

async function parseProviderResponse(response: Response, providerId: string): Promise<ModelResponse> {
  const json = await parseProviderJson(response, providerId);
  const choice = json.choices?.[0];
  if (!choice?.message) {
    throw new ProviderError({
      providerId,
      code: "malformed_response",
      message: `Model provider "${providerId}" returned no message choices.`,
    });
  }

  const text = choice?.message?.content ?? undefined;
  const toolCalls = choice?.message?.tool_calls;
  if ((text === undefined || text.length === 0) && (!toolCalls || toolCalls.length === 0)) {
    throw new ProviderError({
      providerId,
      code: "empty_response",
      message: `Model provider "${providerId}" returned an empty message.`,
    });
  }

  const modelResponse: ModelResponse = {
    id: json.id ?? crypto.randomUUID(),
  };
  if (text !== undefined) {
    modelResponse.text = text;
  }
  if (toolCalls !== undefined) {
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
  let text = "";
  let usage: ModelResponse["usage"];
  const toolCallDeltas = new Map<number, {
    id?: string;
    type?: string;
    name?: string;
    arguments: string;
  }>();

  await readServerSentEvents(response, providerId, (_eventName, data) => {
    if (data === "[DONE]") {
      return;
    }
    const chunk = parseStreamChunk(data, providerId);
    if (chunk.id !== undefined) {
      responseId = chunk.id;
    }
    if (chunk.usage !== undefined) {
      usage = toUsage(chunk.usage);
    }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) {
      return;
    }
    if (delta.content) {
      text += delta.content;
      onTextDelta(delta.content);
    }
    for (const toolCall of delta.tool_calls ?? []) {
      const index = toolCall.index ?? toolCallDeltas.size;
      const current = toolCallDeltas.get(index) ?? { arguments: "" };
      if (toolCall.id !== undefined) {
        current.id = toolCall.id;
      }
      if (toolCall.type !== undefined) {
        current.type = toolCall.type;
      }
      if (toolCall.function?.name !== undefined) {
        current.name = toolCall.function.name;
      }
      if (toolCall.function?.arguments !== undefined) {
        current.arguments += toolCall.function.arguments;
      }
      toolCallDeltas.set(index, current);
    }
  });

  const toolCalls = [...toolCallDeltas.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([index, item]) => item.name
      ? [{
          id: item.id ?? `tool_call_${index}`,
          type: item.type ?? "function",
          function: {
            name: item.name,
            arguments: item.arguments,
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

function parseStreamChunk(data: string, providerId: string): ChatCompletionStreamChunk {
  try {
    return JSON.parse(data) as ChatCompletionStreamChunk;
  } catch (error) {
    throw new ProviderError({
      providerId,
      code: "invalid_stream_json",
      responseBody: sanitizeProviderBody(error instanceof Error ? error.message : String(error)),
      message: `Model provider "${providerId}" returned invalid stream JSON.`,
    });
  }
}

function toUsage(usage: NonNullable<ChatCompletionResponse["usage"]>): NonNullable<ModelResponse["usage"]> {
  const mapped: NonNullable<ModelResponse["usage"]> = {};
  if (usage.prompt_tokens !== undefined) {
    mapped.inputTokens = usage.prompt_tokens;
  }
  if (usage.completion_tokens !== undefined) {
    mapped.outputTokens = usage.completion_tokens;
  }
  return mapped;
}

function toChatCompletionBody(request: ModelRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: request.messages.map(toChatMessage),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.tools !== undefined ? { tools: request.tools } : {}),
  };
}

function toChatMessage(message: ModelMessage): Record<string, unknown> {
  const chatMessage: Record<string, unknown> = {
    role: message.role,
  };
  if (message.content !== undefined) {
    chatMessage.content = message.content;
  }
  if (message.name !== undefined) {
    chatMessage.name = message.name;
  }
  if (message.toolCallId !== undefined) {
    chatMessage.tool_call_id = message.toolCallId;
  }
  if (message.toolCalls !== undefined) {
    chatMessage.tool_calls = message.toolCalls;
  }
  return chatMessage;
}

async function parseProviderJson(response: Response, providerId: string): Promise<ChatCompletionResponse> {
  try {
    return await response.json() as ChatCompletionResponse;
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

function normalizeBaseUrl(value: string, providerId: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error(`OpenAI-compatible provider "${providerId}" requires a non-empty base URL.`);
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
    throw new Error(`OpenAI-compatible provider "${providerId}" has an invalid base URL.`);
  }
}

function stripProviderPrefix(modelRef: string, providerId: string): string {
  if (modelRef.startsWith(`${providerId}/`) || modelRef.startsWith(`${providerId}:`)) {
    return modelRef.slice(providerId.length + 1);
  }
  return modelRef;
}
