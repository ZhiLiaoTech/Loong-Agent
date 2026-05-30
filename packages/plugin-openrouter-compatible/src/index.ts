import type { LoongPlugin, LoongPluginManifest } from "@loong/plugin-sdk";
import { createOpenAICompatibleProvider, type OpenAICompatibleProviderOptions } from "@loong/providers";

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4.1-mini";

const manifest: LoongPluginManifest = {
  name: "loong.openrouter-compatible",
  version: "0.0.0",
  entry: "dist/index.js",
  description: "Registers an OpenRouter OpenAI-compatible model provider from environment variables.",
  loongVersion: "0.x",
};

const plugin: LoongPlugin = {
  manifest,
  activate(context) {
    const options = readProviderOptions(process.env);
    if (!options) {
      return;
    }
    context.registerProvider(createOpenAICompatibleProvider(options));
  },
};

export default plugin;

function readProviderOptions(env: NodeJS.ProcessEnv): OpenAICompatibleProviderOptions | undefined {
  const apiKey = firstNonEmpty(env.LOONG_OPENROUTER_API_KEY, env.OPENROUTER_API_KEY);
  if (!apiKey) {
    return undefined;
  }

  const options: OpenAICompatibleProviderOptions = {
    id: firstNonEmpty(env.LOONG_OPENROUTER_PROVIDER_ID) ?? "openrouter",
    displayName: firstNonEmpty(env.LOONG_OPENROUTER_DISPLAY_NAME) ?? "OpenRouter",
    apiKey,
    baseUrl: firstNonEmpty(env.LOONG_OPENROUTER_BASE_URL, env.OPENROUTER_BASE_URL) ?? DEFAULT_OPENROUTER_BASE_URL,
    defaultModel: firstNonEmpty(env.LOONG_OPENROUTER_MODEL, env.OPENROUTER_MODEL) ?? DEFAULT_OPENROUTER_MODEL,
    supportsToolCalling: parseBoolean(env.LOONG_OPENROUTER_SUPPORTS_TOOL_CALLING, true),
    headers: openRouterHeaders(env),
  };

  return options;
}

function openRouterHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const headers: Record<string, string> = {};
  const referer = firstNonEmpty(env.LOONG_OPENROUTER_REFERER, env.OPENROUTER_REFERER);
  if (referer !== undefined) {
    headers["HTTP-Referer"] = referer;
  }
  headers["X-OpenRouter-Title"] = firstNonEmpty(
    env.LOONG_OPENROUTER_TITLE,
    env.OPENROUTER_TITLE,
  ) ?? "Loong";
  return headers;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return defaultValue;
  }
  if (["1", "true", "yes", "on"].includes(trimmed)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(trimmed)) {
    return false;
  }
  throw new Error(`Invalid LOONG_OPENROUTER_SUPPORTS_TOOL_CALLING value: ${value}`);
}
