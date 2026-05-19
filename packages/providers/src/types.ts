import type { DragonProviderModelCatalogEntry } from "@dragon/model-catalog";

export type ModelMessageRole = "system" | "user" | "assistant" | "tool";

export interface ModelToolCallFunction {
  name: string;
  arguments: string;
}

export interface ModelToolCall {
  id: string;
  type: "function" | string;
  function?: ModelToolCallFunction;
}

export interface ModelTextContentPart {
  type: "text";
  text: string;
}

export interface ModelImageContentPart {
  type: "image";
  mimeType: string;
  /** base64-encoded image bytes (no `data:` prefix) */
  dataBase64: string;
}

export type ModelContentPart = ModelTextContentPart | ModelImageContentPart;

export interface ModelMessage {
  role: ModelMessageRole;
  /**
   * For text-only messages this stays a string (back-compat). For multimodal
   * user/assistant messages (image input, etc.) callers pass an array of
   * content parts. Provider adapters translate to their wire format.
   */
  content?: string | ModelContentPart[];
  name?: string;
  toolCallId?: string;
  toolCalls?: ModelToolCall[];
  /**
   * Thinking-mode chain-of-thought tokens emitted by reasoning models
   * (DeepSeek V4 Pro, OpenAI o1, etc.). Some providers require this to be
   * echoed back on the next turn — providers that don't, ignore it.
   */
  reasoningContent?: string;
}

export interface ModelRequest {
  model: string;
  messages: ModelMessage[];
  tools?: unknown[];
  temperature?: number;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
  metadata?: Record<string, unknown>;
}

export interface ModelResponse {
  id: string;
  text?: string;
  toolCalls?: ModelToolCall[];
  streamedText?: boolean;
  /**
   * Chain-of-thought tokens emitted by reasoning models. The runtime preserves
   * this on the assistant message so providers that require it on follow-up
   * turns (DeepSeek V4 Pro thinking mode) get it echoed back.
   */
  reasoningContent?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface ModelProvider {
  id: string;
  displayName: string;
  supportsToolCalling: boolean;
  defaultModel?: string;
  models?: readonly DragonProviderModelCatalogEntry[];
  canHandleModel?(modelRef: string): boolean;
  normalizeModel?(modelRef: string): string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export interface ProviderResolution {
  provider: ModelProvider;
  model: string;
  requestedModel: string;
}

export interface ProviderRegistry {
  register(provider: ModelProvider): void;
  resolve(modelRef: string): ModelProvider | undefined;
  resolveModel(modelRef?: string): ProviderResolution | undefined;
  list(): ModelProvider[];
}
