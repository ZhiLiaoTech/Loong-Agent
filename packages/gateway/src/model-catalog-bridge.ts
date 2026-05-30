import type { LoongModelCapabilities, LoongModelCatalog, LoongModelStatus } from "@loong/model-catalog";
import {
  applyModelCatalogToParams,
  createModelCatalogFromProviders,
  type ModelRefCarrier,
} from "@loong/model-catalog";

export interface GatewayProviderCatalogSource {
  id: string;
  displayName: string;
  supportsToolCalling: boolean;
  defaultModel?: string;
  models?: readonly GatewayProviderModelCatalogSource[];
}

export interface GatewayProviderModelCatalogSource {
  id: string;
  displayName?: string;
  aliases?: readonly string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: LoongModelCapabilities;
  status?: LoongModelStatus;
  default?: boolean;
}

export type AgentParamsWithOptionalModel = ModelRefCarrier;

export function createModelCatalogFromProviderSummaries(
  providers: readonly GatewayProviderCatalogSource[],
): LoongModelCatalog {
  return createModelCatalogFromProviders(providers);
}

export const applyModelCatalogToAgentParams = applyModelCatalogToParams;
