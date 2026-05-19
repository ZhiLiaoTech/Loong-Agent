import type { GatewayProviderSummary } from "../../api/types.js";

export function buildModelSuggestions(providers: readonly GatewayProviderSummary[]): string[] {
  const values: string[] = [];
  for (const provider of providers) {
    if (provider.defaultModel) {
      values.push(provider.defaultModel);
      values.push(`${provider.id}:${provider.defaultModel}`);
    }
    for (const model of provider.models ?? []) {
      values.push(model.id);
      values.push(`${provider.id}:${model.id}`);
      values.push(`${provider.id}/${model.id}`);
      for (const alias of model.aliases ?? []) {
        values.push(alias);
        values.push(`${provider.id}:${alias}`);
      }
    }
  }
  return [...new Set(values)];
}
