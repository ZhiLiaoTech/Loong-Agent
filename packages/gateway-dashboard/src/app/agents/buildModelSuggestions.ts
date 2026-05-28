import type { GatewayProviderSummary } from "../../api/index.js";

/** Canonical runtime model ref: `providerId:modelId`. */
export function canonicalModelRef(providerId: string, modelRef: string): string {
  const provider = providerId.trim();
  const model = modelRef.trim();
  if (!provider || !model) {
    return "";
  }
  const slash = model.indexOf("/");
  if (slash > 0) {
    const left = model.slice(0, slash).trim();
    const right = model.slice(slash + 1).trim();
    if (left && right) {
      return `${left}:${right}`;
    }
  }
  if (model.includes(":")) {
    return model;
  }
  return `${provider}:${model}`;
}

/** One suggestion per loaded model (`provider:model`). */
export function buildModelSuggestions(providers: readonly GatewayProviderSummary[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const provider of providers) {
    const providerId = provider.id.trim();
    if (!providerId) {
      continue;
    }
    const add = (modelRef: string | undefined) => {
      if (!modelRef) {
        return;
      }
      const canonical = canonicalModelRef(providerId, modelRef);
      if (!canonical || seen.has(canonical)) {
        return;
      }
      seen.add(canonical);
      values.push(canonical);
    };
    add(provider.defaultModel);
    for (const model of provider.models ?? []) {
      add(model.id);
    }
  }
  return values.sort((left, right) => left.localeCompare(right));
}
