import type { ModelProvider, ProviderRegistry, ProviderResolution } from "./types.js";

export interface ProviderRegistryOptions {
  defaultProviderId?: string;
}

export class DefaultProviderRegistry implements ProviderRegistry {
  readonly #providers = new Map<string, ModelProvider>();
  #defaultProviderId: string | undefined;

  constructor(providers: ModelProvider[] = [], options: ProviderRegistryOptions = {}) {
    for (const provider of providers) {
      this.register(provider);
    }
    if (options.defaultProviderId !== undefined) {
      const defaultProviderId = normalizeProviderId(options.defaultProviderId);
      if (!this.#providers.has(defaultProviderId)) {
        throw new Error(`Default provider "${defaultProviderId}" is not registered.`);
      }
      this.#defaultProviderId = defaultProviderId;
    }
  }

  register(provider: ModelProvider): void {
    const id = normalizeProviderId(provider.id);
    if (!id) {
      throw new Error("Provider id must not be empty.");
    }
    if (this.#providers.has(id)) {
      throw new Error(`Provider "${id}" is already registered.`);
    }
    const registered: ModelProvider = {
      ...provider,
      id,
    };
    this.#providers.set(id, Object.freeze(registered));
    this.#defaultProviderId ??= id;
  }

  resolve(modelRef: string): ModelProvider | undefined {
    return this.resolveModel(modelRef)?.provider;
  }

  resolveModel(modelRef?: string): ProviderResolution | undefined {
    const requestedModel = modelRef?.trim();

    if (requestedModel) {
      const explicit = this.#resolveExplicitProvider(requestedModel);
      if (explicit === "invalid") {
        return undefined;
      }
      if (explicit !== undefined) {
        return explicit;
      }

      for (const provider of this.#providers.values()) {
        if (provider.canHandleModel?.(requestedModel)) {
          return {
            provider,
            model: provider.normalizeModel?.(requestedModel) ?? requestedModel,
            requestedModel,
          };
        }
      }
    }

    const defaultProvider = this.#defaultProviderId
      ? this.#providers.get(this.#defaultProviderId)
      : this.#providers.values().next().value as ModelProvider | undefined;

    if (!defaultProvider) {
      return undefined;
    }

    const model = requestedModel ?? defaultProvider.defaultModel;
    if (!model) {
      return undefined;
    }

    return {
      provider: defaultProvider,
      model: defaultProvider.normalizeModel?.(model) ?? model,
      requestedModel: requestedModel ?? model,
    };
  }

  list(): ModelProvider[] {
    return [...this.#providers.values()];
  }

  #resolveExplicitProvider(modelRef: string): ProviderResolution | "invalid" | undefined {
    const separatorIndex = findProviderSeparator(modelRef);
    if (separatorIndex <= 0) {
      return undefined;
    }

    const providerId = modelRef.slice(0, separatorIndex);
    const model = modelRef.slice(separatorIndex + 1);
    const provider = this.#providers.get(providerId);
    if (!provider) {
      return undefined;
    }
    if (!model) {
      return "invalid";
    }

    return {
      provider,
      model: provider.normalizeModel?.(model) ?? model,
      requestedModel: modelRef,
    };
  }
}

export function createProviderRegistry(
  providers: ModelProvider[] = [],
  options: ProviderRegistryOptions = {},
): ProviderRegistry {
  return new DefaultProviderRegistry(providers, options);
}

function findProviderSeparator(modelRef: string): number {
  const slash = modelRef.indexOf("/");
  const colon = modelRef.indexOf(":");

  if (slash === -1) {
    return colon;
  }
  if (colon === -1) {
    return slash;
  }
  return Math.min(slash, colon);
}

function normalizeProviderId(value: string): string {
  return value.trim();
}
