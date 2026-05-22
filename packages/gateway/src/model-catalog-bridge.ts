import type { DragonModelCapabilities, DragonModelCatalog, DragonModelStatus } from "@dragon/model-catalog";
import {
  applyModelCatalogToParams,
  createModelCatalogFromProviders,
  type ModelRefCarrier,
} from "@dragon/model-catalog";

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
  capabilities?: DragonModelCapabilities;
  status?: DragonModelStatus;
  default?: boolean;
}

export type AgentParamsWithOptionalModel = ModelRefCarrier;

export function createModelCatalogFromProviderSummaries(
  providers: readonly GatewayProviderCatalogSource[],
): DragonModelCatalog {
  return createModelCatalogFromProviders(providers);
}

export const applyModelCatalogToAgentParams = applyModelCatalogToParams;
