import type { ModelProviderConfig } from "./types.js";

/** Strip accidental apiKey echoes; only send apiKey when the user entered one in the draft form. */
export function sanitizeProvidersForSave(
  providers: readonly ModelProviderConfig[],
): ModelProviderConfig[] {
  return providers.map(provider => {
    const { apiKey, ...rest } = provider;
    const sanitized: ModelProviderConfig = {
      id: rest.id,
      type: rest.type,
      ...(rest.displayName !== undefined ? { displayName: rest.displayName } : {}),
      ...(rest.apiKeyConfigured !== undefined ? { apiKeyConfigured: rest.apiKeyConfigured } : {}),
      ...(rest.baseUrl !== undefined ? { baseUrl: rest.baseUrl } : {}),
      ...(rest.defaultModel !== undefined ? { defaultModel: rest.defaultModel } : {}),
      ...(rest.supportsToolCalling !== undefined
        ? { supportsToolCalling: rest.supportsToolCalling }
        : {}),
      ...(rest.enabled !== undefined ? { enabled: rest.enabled } : {}),
    };
    if (apiKey) {
      sanitized.apiKey = apiKey;
    }
    return sanitized;
  });
}
