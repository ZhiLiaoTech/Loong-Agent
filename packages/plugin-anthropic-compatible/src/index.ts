import type { DragonPlugin, DragonPluginManifest } from "@dragon/plugin-sdk";
import { createAnthropicProvider, type AnthropicProviderOptions } from "@dragon/providers";

const manifest: DragonPluginManifest = {
  name: "dragon.anthropic-compatible",
  version: "0.0.0",
  entry: "dist/index.js",
  description: "Registers an Anthropic Messages API model provider from environment variables.",
  dragonVersion: "0.x",
};

const plugin: DragonPlugin = {
  manifest,
  activate(context) {
    const options = readProviderOptions(process.env);
    if (!options) {
      return;
    }
    context.registerProvider(createAnthropicProvider(options));
  },
};

export default plugin;

function readProviderOptions(env: NodeJS.ProcessEnv): AnthropicProviderOptions | undefined {
  const apiKey = firstNonEmpty(
    env.DRAGON_PLUGIN_ANTHROPIC_API_KEY,
    env.DRAGON_ANTHROPIC_API_KEY,
    env.ANTHROPIC_API_KEY,
  );
  if (!apiKey) {
    return undefined;
  }

  const options: AnthropicProviderOptions = {
    id: firstNonEmpty(env.DRAGON_PLUGIN_ANTHROPIC_PROVIDER_ID) ?? "dragon-anthropic",
    displayName: firstNonEmpty(env.DRAGON_PLUGIN_ANTHROPIC_DISPLAY_NAME) ?? "Dragon Anthropic Compatible",
    apiKey,
    defaultModel: firstNonEmpty(
      env.DRAGON_PLUGIN_ANTHROPIC_MODEL,
      env.DRAGON_ANTHROPIC_MODEL,
      env.ANTHROPIC_MODEL,
    ) ?? "claude-3-5-haiku-latest",
  };

  const baseUrl = firstNonEmpty(
    env.DRAGON_PLUGIN_ANTHROPIC_BASE_URL,
    env.DRAGON_ANTHROPIC_BASE_URL,
    env.ANTHROPIC_BASE_URL,
  );
  if (baseUrl !== undefined) {
    options.baseUrl = baseUrl;
  }

  const maxTokens = parseOptionalInteger(
    firstNonEmpty(
      env.DRAGON_PLUGIN_ANTHROPIC_MAX_TOKENS,
      env.DRAGON_ANTHROPIC_MAX_TOKENS,
      env.ANTHROPIC_MAX_TOKENS,
    ),
    "DRAGON_PLUGIN_ANTHROPIC_MAX_TOKENS",
  );
  if (maxTokens !== undefined) {
    options.maxTokens = maxTokens;
  }

  const apiVersion = firstNonEmpty(
    env.DRAGON_PLUGIN_ANTHROPIC_API_VERSION,
    env.DRAGON_ANTHROPIC_API_VERSION,
    env.ANTHROPIC_API_VERSION,
  );
  if (apiVersion !== undefined) {
    options.apiVersion = apiVersion;
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

function parseOptionalInteger(value: string | undefined, envName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${envName} must be an integer.`);
  }
  return parsed;
}
