import type { LoongAgentRuntime } from "@loong/core";
import { catalogEntriesFromProviders, createModelCatalog } from "@loong/model-catalog";
import { createProviderRegistry, type ModelProvider, type ProviderRegistry } from "@loong/providers";
import type { GatewayProviderSummary } from "@loong/gateway";
import { createBuiltinProviders, summarizeProviders } from "./cli-impl.js";

function assertUniqueProviderIds(providers: ModelProvider[]): void {
  const seen = new Set<string>();
  for (const provider of providers) {
    const id = provider.id.trim();
    if (!id) {
      throw new Error("Provider id must not be empty.");
    }
    if (seen.has(id)) {
      throw new Error(`Provider "${id}" is registered more than once.`);
    }
    seen.add(id);
  }
}

export async function rebuildProviderRegistryFromDisk(
  pluginProviders: readonly ModelProvider[],
): Promise<{
  registry: ProviderRegistry;
  providers: ModelProvider[];
  summaries: GatewayProviderSummary[];
  defaultProviderId?: string;
}> {
  const builtin = await createBuiltinProviders();
  const providers = [...builtin.providers, ...pluginProviders];
  assertUniqueProviderIds(providers);
  const modelCatalog = createModelCatalog(catalogEntriesFromProviders(providers));
  const registry = createProviderRegistry(providers, {
    ...(builtin.defaultProviderId ? { defaultProviderId: builtin.defaultProviderId } : {}),
    modelCatalog,
  });
  return {
    registry,
    providers,
    summaries: summarizeProviders(providers),
    ...(builtin.defaultProviderId ? { defaultProviderId: builtin.defaultProviderId } : {}),
  };
}

export async function applyGatewayProviderHotReload(options: {
  runtime: LoongAgentRuntime;
  pluginProviders: readonly ModelProvider[];
  replaceSummaries: (summaries: readonly GatewayProviderSummary[]) => void;
}): Promise<void> {
  const rebuilt = await rebuildProviderRegistryFromDisk(options.pluginProviders);
  const runtime = options.runtime as LoongAgentRuntime & {
    setProviderRegistry?: (registry: ProviderRegistry) => void;
  };
  if (typeof runtime.setProviderRegistry !== "function") {
    throw new Error("Runtime does not support provider hot reload.");
  }
  runtime.setProviderRegistry(rebuilt.registry);
  options.replaceSummaries(rebuilt.summaries);
}
