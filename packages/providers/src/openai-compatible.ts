import { normalizeProviderModelEntries, type LoongProviderModelCatalogEntry } from "@loong/model-catalog";
import { ProviderError, sanitizeProviderBody } from "./errors.js";
import { fetchProviderWithRetry } from "./fetch.js";
import { readServerSentEvents } from "./sse.js";
import { readThinkingLevel } from "./thinking.js";
import type {
  ModelMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
  ProviderRetryOptions,
} from "./types.js";

export interface OpenAICompatibleProviderOptions {
  id?: string;
  displayName?: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  models?: readonly LoongProviderModelCatalogEntry[];
  supportsToolCalling?: boolean;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  retry?: ProviderRetryOptions;
}

interface ChatCompletionResponse {
  id?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
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
      reasoning_content?: string | null;
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

      const response = await fetchProviderWithRetry(
        fetchImpl,
        `${baseUrl}/chat/completions`,
        requestInit,
        id,
        options.retry,
      );

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
  const apiKey = env.LOONG_OPENAI_API_KEY ?? env.OPENAI_API_KEY;
  if (!apiKey) {
    return undefined;
  }

  const options: OpenAICompatibleProviderOptions = {
    id: env.LOONG_OPENAI_PROVIDER_ID ?? "openai",
    displayName: env.LOONG_OPENAI_DISPLAY_NAME ?? "OpenAI Compatible",
    apiKey,
    defaultModel: env.LOONG_OPENAI_MODEL ?? env.OPENAI_MODEL ?? "gpt-4.1-mini",
  };
  const baseUrl = env.LOONG_OPENAI_BASE_URL ?? env.OPENAI_BASE_URL;
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
  const reasoning = choice?.message?.reasoning_content ?? undefined;
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
  if (reasoning !== undefined && reasoning.length > 0) {
    modelResponse.reasoningContent = reasoning;
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
  let reasoning = "";
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
    if (delta.reasoning_content) {
      reasoning += delta.reasoning_content;
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
  if (reasoning.length > 0) {
    modelResponse.reasoningContent = reasoning;
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
  const thinking = readThinkingLevel(request.metadata);
  return {
    model: request.model,
    messages: request.messages.map(toChatMessage),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.tools !== undefined ? { tools: request.tools } : {}),
    ...(thinking !== undefined ? { reasoning_effort: thinking } : {}),
  };
}

function toChatMessage(message: ModelMessage): Record<string, unknown> {
  const chatMessage: Record<string, unknown> = {
    role: message.role,
  };
  if (message.content !== undefined) {
    chatMessage.content = encodeOpenAIContent(message.content);
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
  // DeepSeek V4 Pro (thinking mode) requires reasoning_content to be echoed
  // back on the next turn. OpenAI ignores this field, so it's safe to pass
  // through whenever the runtime captured it from a prior assistant turn.
  if (message.role === "assistant" && message.reasoningContent !== undefined && message.reasoningContent.length > 0) {
    chatMessage.reasoning_content = message.reasoningContent;
  }
  return chatMessage;
}

// OpenAI multimodal wire format:
//   string → unchanged
//   ContentPart[] → [{type:"text",text}, {type:"image_url",image_url:{url:"data:<mime>;base64,<...>"}}]
function encodeOpenAIContent(content: NonNullable<ModelMessage["content"]>): unknown {
  if (typeof content === "string") {
    return content;
  }
  return content.map(part => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    return {
      type: "image_url",
      image_url: { url: `data:${part.mimeType};base64,${part.dataBase64}` },
    };
  });
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
