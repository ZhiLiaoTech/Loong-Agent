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

// --- Tier scheduling ---------------------------------------------------------

export type TierName = "fast" | "standard" | "deep";

export type TierClassifierMode = "heuristic" | "fixed";

export interface TierSpec {
  model?: string;
  modelFallbacks?: readonly string[];
  thinking?: "none" | "low" | "medium" | "high";
  maxContextChars?: number;
  toolsEnabled?: boolean;
  memoryEnabled?: boolean;
  systemPromptAddendum?: string;
}

export interface TierKeywordHint {
  tier: TierName;
  words: readonly string[];
}

export interface TierConfigState {
  enabled: boolean;
  tiers: {
    fast?: TierSpec;
    standard?: TierSpec;
    deep?: TierSpec;
  };
  classifier: {
    mode: TierClassifierMode;
    fixedTier?: TierName;
    keywordHints?: readonly TierKeywordHint[];
  };
  appliesOn?: "next-turn";
  configPath?: string;
}

export interface TierClassifyResult {
  tier: TierName;
  source: "heuristic" | "fixed" | "inherited" | "explicit-input";
  score: number;
  reason: string;
  resolvedModel?: string;
  resolvedThinking?: "none" | "low" | "medium" | "high";
  resolvedMaxContextChars?: number;
  resolvedToolsEnabled?: boolean;
  resolvedMemoryEnabled?: boolean;
}

export const EMPTY_TIER_CONFIG: TierConfigState = {
  enabled: false,
  tiers: {
    fast: { thinking: "none", maxContextChars: 4000, toolsEnabled: false, memoryEnabled: false },
    standard: { thinking: "low", maxContextChars: 16000 },
    deep: { thinking: "high", maxContextChars: 64000 },
  },
  classifier: { mode: "heuristic" },
};
