import type { GatewayProviderSummary } from "../../api/types.js";

export type ModelProviderType = "openai-compatible" | "anthropic";

export interface ModelProviderConfig {
  id: string;
  type: ModelProviderType;
  displayName?: string;
  apiKey?: string;
  apiKeyConfigured?: boolean;
  baseUrl?: string;
  defaultModel?: string;
  supportsToolCalling?: boolean;
  enabled?: boolean;
}

export interface ModelConfigState {
  providers: readonly ModelProviderConfig[];
  appliesOn: "restart";
  configPath?: string;
}

export interface ModelProviderFormState {
  editingId: string;
  type: ModelProviderType;
  id: string;
  displayName: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  enabled: boolean;
  supportsToolCalling: boolean;
}

export const EMPTY_MODEL_PROVIDER_FORM: ModelProviderFormState = {
  editingId: "",
  type: "openai-compatible",
  id: "",
  displayName: "",
  apiKey: "",
  baseUrl: "",
  defaultModel: "",
  enabled: true,
  supportsToolCalling: true,
};

export type { GatewayProviderSummary };
