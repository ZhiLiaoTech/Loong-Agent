import type { DragonPlugin, DragonPluginManifest } from "@dragon/plugin-sdk";
import { createOpenAICompatibleProvider, type OpenAICompatibleProviderOptions } from "@dragon/providers";

const manifest: DragonPluginManifest = {
  name: "dragon.openai-compatible",
  version: "0.0.0",
  entry: "dist/index.js",
  description: "Registers an OpenAI-compatible model provider from environment variables.",
  dragonVersion: "0.x",
};

const plugin: DragonPlugin = {
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
  const apiKey = firstNonEmpty(
    env.DRAGON_PLUGIN_OPENAI_API_KEY,
    env.DRAGON_OPENAI_API_KEY,
    env.OPENAI_API_KEY,
  );
  if (!apiKey) {
    return undefined;
  }

  const options: OpenAICompatibleProviderOptions = {
    id: firstNonEmpty(env.DRAGON_PLUGIN_OPENAI_PROVIDER_ID) ?? "dragon-openai",
    displayName: firstNonEmpty(env.DRAGON_PLUGIN_OPENAI_DISPLAY_NAME) ?? "Dragon OpenAI Compatible",
    apiKey,
    defaultModel: firstNonEmpty(
      env.DRAGON_PLUGIN_OPENAI_MODEL,
      env.DRAGON_OPENAI_MODEL,
      env.OPENAI_MODEL,
    ) ?? "gpt-4.1-mini",
    supportsToolCalling: parseBoolean(env.DRAGON_PLUGIN_OPENAI_SUPPORTS_TOOL_CALLING, true),
  };

  const baseUrl = firstNonEmpty(
    env.DRAGON_PLUGIN_OPENAI_BASE_URL,
    env.DRAGON_OPENAI_BASE_URL,
    env.OPENAI_BASE_URL,
  );
  if (baseUrl !== undefined) {
    options.baseUrl = baseUrl;
  }

  return options;
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
  throw new Error(`Invalid DRAGON_PLUGIN_OPENAI_SUPPORTS_TOOL_CALLING value: ${value}`);
}
