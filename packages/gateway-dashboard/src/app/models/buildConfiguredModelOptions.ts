import { canonicalModelRef } from "../agents/buildModelSuggestions.js";
import type { ModelProviderConfig } from "./types.js";

export interface ConfiguredModelOption {
  value: string;
  providerId: string;
  modelId: string;
  providerLabel: string;
  label: string;
}

/** Model refs from saved provider config (`providerId:modelId`). */
export function buildConfiguredModelOptions(
  providers: readonly ModelProviderConfig[],
): ConfiguredModelOption[] {
  const seen = new Set<string>();
  const options: ConfiguredModelOption[] = [];

  for (const provider of providers) {
    if (provider.enabled === false) {
      continue;
    }
    const providerId = provider.id.trim();
    const modelId = provider.defaultModel?.trim();
    if (!providerId || !modelId) {
      continue;
    }
    const value = canonicalModelRef(providerId, modelId);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    const providerLabel = provider.displayName?.trim() || providerId;
    options.push({
      value,
      providerId,
      modelId,
      providerLabel,
      label: `${providerLabel} — ${modelId}`,
    });
  }

  return options.sort((left, right) => left.value.localeCompare(right.value));
}
