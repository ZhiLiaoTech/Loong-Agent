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

export interface ModelMessage {
  role: ModelMessageRole;
  content?: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ModelToolCall[];
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
