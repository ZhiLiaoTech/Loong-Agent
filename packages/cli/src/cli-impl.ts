import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createLoongRuntime,
  mergeSessionCompactionLayers,
  parseAiSummarizationValue,
  parseSessionCompactionValue,
  normalizeTierConfig,
  TIER_DEFAULTS,
  type LoongAgentRuntime,
  type LoongLifecycleHook,
  type LoongPermissionHandler,
  type ModelTierConfig,
} from "@loong/core";
import {
  loadGatewaySettingsFile,
  mergeGatewayConfigFromFile,
  parseModelTimeoutMsArg,
  parseModelTimeoutMsFromEnv,
  parseModelTimeoutSecArg,
  resolveModelTimeoutMs,
} from "./gateway-settings.js";
import { loongConfigDir, resolveLoongDataRoot } from "./loong-paths.js";
import { parsePort } from "./parse-cli-args.js";
import { bootstrapAgentToolRegistry } from "./bootstrap-agent-tool-registry.js";
import { loadContextConfig } from "./context-config.js";
import { createCronRunner, createFileCronJobStore, createGatewayWebhookCronTarget } from "@loong/cron";
import {
  createToolRegistry,
  type ToolRegistry,
} from "@loong/tools";
import {
  createFileApprovalStore,
  createFileEmployeeStore,
  createFileKpiTemplateStore,
  createFileOrgStore,
  createFileTicketStore,
  createFileToolPolicyStore,
  createGatewayApprovalService,
  createTicketLifecycleHook,
  defaultApprovalConfigPath,
  defaultEmployeeConfigPath,
  defaultKpiTemplateConfigPath,
  defaultOrgConfigPath,
  defaultTicketConfigPath,
  defaultToolPolicyConfigPath,
  evaluateOrgAwarePermission,
  type EmployeeStore,
  type ToolPolicyStore,
} from "@loong/org";
import {
  createHttpGateway,
  type GatewayAgentConfig,
  type GatewayAgentConfigSaveParams,
  type GatewayAgentConfigStore,
  type GatewayAgentProfileConfig,
  type GatewayConfig,
  type GatewayModelConfig,
  type GatewayModelConfigSaveParams,
  type GatewayModelConfigStore,
  type GatewayModelProviderConfig,
  type GatewayPluginSummary,
  type GatewayProviderSummary,
  type GatewayTierConfig,
  type GatewayTierConfigSaveParams,
  type GatewayTierConfigStore,
} from "@loong/gateway";
import {
  createFileMemoryStore,
  createFileSessionStore,
  createFileTrajectoryStore,
  createMemoryCandidateLifecycleHook,
  createMarkdownMemoryContextProvider,
  createMemoryContextProvider,
  createSessionCompactionContextProvider,
  createSqliteMemoryStore,
  type MemoryRecord,
  type MemorySearchResult,
  type MemoryStore,
  type TrajectoryStore,
} from "@loong/memory";
import { loadLoongPlugin, type LoongPluginMemoryBackend, type LoadedLoongPlugin } from "@loong/plugin-sdk";
import {
  catalogEntriesFromProviders,
  createModelCatalog,
  type LoongModelCatalog,
} from "@loong/model-catalog";
import {
  createAnthropicProvider,
  createAnthropicProviderFromEnv,
  createOpenAICompatibleProvider,
  createOpenAICompatibleProviderFromEnv,
  createProviderRegistry,
  type ModelProvider,
} from "@loong/providers";
import { DEFAULT_REDACTION } from "@loong/security";
import { createFileSkillRuntime, createSkillTools, type LoadedSkill, type SkillSummary } from "@loong/skills";
import {
  createFilePatchTool,
  createBrowserFormSubmitTool,
  createBrowserPlaywrightSnapshotTool,
  createBrowserSnapshotTool,
  createFileReadTool,
  createFileSearchTool,
  createShellExecTool,
  createSandboxExecTool,
  createToolPermissionEngine,
  type ToolDefinition,
  type ToolPermissionEngine,
  type ToolPermissionRule,
} from "@loong/tools";

export async function createBuiltinProviders(): Promise<{ providers: ModelProvider[]; defaultProviderId?: string }> {
  const modelConfigPath = configuredModelConfigPath();
  const modelConfig = await loadPersistedModelConfig(modelConfigPath);
  const configuredProviders = createProvidersFromModelConfig(modelConfig.providers);
  const configuredProviderIds = new Set(configuredProviders.map(provider => provider.id));
  const disabledProviderIds = new Set(
    modelConfig.providers
      .filter(provider => provider.enabled === false)
      .map(provider => provider.id),
  );
  const envProviders = [
    createOpenAICompatibleProviderFromEnv(),
    createAnthropicProviderFromEnv(),
  ].filter((provider): provider is ModelProvider =>
    provider !== undefined
    && !configuredProviderIds.has(provider.id)
    && !disabledProviderIds.has(provider.id)
  );
  const providers = [...configuredProviders, ...envProviders];
  return {
    providers,
    ...(providers[0] ? { defaultProviderId: providers[0].id } : {}),
  };
}

export function isHelpArgs(args: string[]): boolean {
  return args.length === 0
    ? false
    : args.every(arg => arg === "--help" || arg === "-h");
}

interface ParsedGatewayArgs {
  config: GatewayConfig;
  allowWrite: boolean;
  sessionDir: string;
  memoryDir: string;
  cronJobsFile: string;
  memoryBackendId?: string;
  skillRoots: string[];
  pluginRoots: string[];
  modelTimeoutMs: number;
}

async function parseGatewayArgs(args: string[]): Promise<ParsedGatewayArgs> {
  const fileSettings = await loadGatewaySettingsFile();
  let modelTimeoutMsCli: number | undefined;
  let config: GatewayConfig = mergeGatewayConfigFromFile({}, fileSettings);
  const envHost = process.env.LOONG_GATEWAY_HOST?.trim();
  const envPort = process.env.LOONG_GATEWAY_PORT?.trim();
  const envSecret = process.env.LOONG_GATEWAY_SECRET?.trim();
  if (envHost) {
    config.host = envHost;
  }
  if (envPort) {
    config.port = parsePort(envPort);
  }
  if (envSecret) {
    config.authMode = "shared-secret";
    config.sharedSecret = envSecret;
  }

  let allowWrite = false;
  const dataRoot = resolveLoongDataRoot();
  let sessionDir = process.env.LOONG_SESSION_DIR?.trim() || path.join(dataRoot, "sessions");
  let memoryDir = process.env.LOONG_MEMORY_DIR?.trim() || path.join(dataRoot, "memory");
  let cronJobsFile = process.env.LOONG_CRON_JOBS?.trim() || path.join(dataRoot, "cron", "jobs.json");
  let memoryBackendId = process.env.LOONG_MEMORY_BACKEND?.trim() || undefined;
  const defaultSkillRoots = configuredSkillRoots();
  const skillRoots: string[] = [];
  const pluginRoots = configuredPluginRoots();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--allow-write") {
      allowWrite = true;
      continue;
    }
    if (arg === "--host") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: loong gateway --host <host>");
      }
      config.host = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--host=")) {
      const value = arg.slice("--host=".length).trim();
      if (!value) {
        throw new Error("Usage: loong gateway --host=<host>");
      }
      config.host = value;
      continue;
    }
    if (arg === "--port") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: loong gateway --port <port>");
      }
      config.port = parsePort(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--port=")) {
      config.port = parsePort(arg.slice("--port=".length).trim());
      continue;
    }
    if (arg === "--secret") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: loong gateway --secret <value>");
      }
      config.authMode = "shared-secret";
      config.sharedSecret = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--secret=")) {
      const value = arg.slice("--secret=".length).trim();
      if (!value) {
        throw new Error("Usage: loong gateway --secret=<value>");
      }
      config.authMode = "shared-secret";
      config.sharedSecret = value;
      continue;
    }
    if (arg === "--session-dir") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: loong gateway --session-dir <path>");
      }
      sessionDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--session-dir=")) {
      const value = arg.slice("--session-dir=".length).trim();
      if (!value) {
        throw new Error("Usage: loong gateway --session-dir=<path>");
      }
      sessionDir = path.resolve(value);
      continue;
    }
    if (arg === "--memory-dir") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: loong gateway --memory-dir <path>");
      }
      memoryDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--memory-dir=")) {
      const value = arg.slice("--memory-dir=".length).trim();
      if (!value) {
        throw new Error("Usage: loong gateway --memory-dir=<path>");
      }
      memoryDir = path.resolve(value);
      continue;
    }
    if (arg === "--memory-backend") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: loong gateway --memory-backend <id>");
      }
      memoryBackendId = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--memory-backend=")) {
      const value = arg.slice("--memory-backend=".length).trim();
      if (!value) {
        throw new Error("Usage: loong gateway --memory-backend=<id>");
      }
      memoryBackendId = value;
      continue;
    }
    if (arg === "--cron-jobs") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: loong gateway --cron-jobs <path>");
      }
      cronJobsFile = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--cron-jobs=")) {
      const value = arg.slice("--cron-jobs=".length).trim();
      if (!value) {
        throw new Error("Usage: loong gateway --cron-jobs=<path>");
      }
      cronJobsFile = path.resolve(value);
      continue;
    }
    if (arg === "--skill-root") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: loong gateway --skill-root <path>");
      }
      skillRoots.push(resolveSkillRoot(value));
      index += 1;
      continue;
    }
    if (arg?.startsWith("--skill-root=")) {
      const value = arg.slice("--skill-root=".length).trim();
      if (!value) {
        throw new Error("Usage: loong gateway --skill-root=<path>");
      }
      skillRoots.push(resolveSkillRoot(value));
      continue;
    }
    if (arg === "--plugin-root") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: loong gateway --plugin-root <path>");
      }
      pluginRoots.push(resolveExistingPluginRoot(value));
      index += 1;
      continue;
    }
    if (arg?.startsWith("--plugin-root=")) {
      const value = arg.slice("--plugin-root=".length).trim();
      if (!value) {
        throw new Error("Usage: loong gateway --plugin-root=<path>");
      }
      pluginRoots.push(resolveExistingPluginRoot(value));
      continue;
    }
    if (arg === "--model-timeout-ms") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: loong gateway --model-timeout-ms <milliseconds>");
      }
      modelTimeoutMsCli = parseModelTimeoutMsArg(value, "--model-timeout-ms");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--model-timeout-ms=")) {
      const value = arg.slice("--model-timeout-ms=".length).trim();
      if (!value) {
        throw new Error("Usage: loong gateway --model-timeout-ms=<milliseconds>");
      }
      modelTimeoutMsCli = parseModelTimeoutMsArg(value, "--model-timeout-ms");
      continue;
    }
    if (arg === "--model-timeout-sec") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: loong gateway --model-timeout-sec <seconds>");
      }
      modelTimeoutMsCli = parseModelTimeoutSecArg(value, "--model-timeout-sec");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--model-timeout-sec=")) {
      const value = arg.slice("--model-timeout-sec=".length).trim();
      if (!value) {
        throw new Error("Usage: loong gateway --model-timeout-sec=<seconds>");
      }
      modelTimeoutMsCli = parseModelTimeoutSecArg(value, "--model-timeout-sec");
      continue;
    }
    throw new Error(`Unknown gateway option: ${arg}`);
  }

  const envModelTimeoutMs = parseModelTimeoutMsFromEnv();
  const modelTimeoutMs = resolveModelTimeoutMs({
    ...(modelTimeoutMsCli !== undefined ? { cliMs: modelTimeoutMsCli } : {}),
    ...(envModelTimeoutMs !== undefined ? { envMs: envModelTimeoutMs } : {}),
    ...(fileSettings.modelTimeoutMs !== undefined ? { fileMs: fileSettings.modelTimeoutMs } : {}),
  });

  return {
    config,
    allowWrite,
    sessionDir: path.resolve(sessionDir),
    memoryDir: path.resolve(memoryDir),
    cronJobsFile: path.resolve(cronJobsFile),
    ...(memoryBackendId !== undefined ? { memoryBackendId } : {}),
    skillRoots: uniquePaths([...skillRoots, ...defaultSkillRoots]),
    pluginRoots: uniquePaths(pluginRoots),
    modelTimeoutMs,
  };
}

export function configuredModelConfigPath(): string {
  const configured = process.env.LOONG_MODEL_CONFIG?.trim();
  return path.resolve(configured || path.join(loongConfigDir(), "providers.json"));
}

export function configuredTierConfigPath(): string {
  const configured = process.env.LOONG_TIER_CONFIG?.trim();
  return path.resolve(configured || path.join(loongConfigDir(), "tiers.json"));
}

export function createModelConfigStore(filePath: string): GatewayModelConfigStore {
  return {
    async load() {
      return toSafeModelConfig(await loadPersistedModelConfig(filePath), filePath);
    },
    async save(config: GatewayModelConfigSaveParams) {
      return await savePersistedModelConfig(filePath, config);
    },
  };
}

async function loadPersistedModelConfig(filePath: string): Promise<{ providers: GatewayModelProviderConfig[] }> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { providers: [] };
    }
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid model config JSON at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return normalizePersistedModelConfig(json, filePath);
}

async function savePersistedModelConfig(
  filePath: string,
  config: GatewayModelConfigSaveParams,
): Promise<GatewayModelConfig> {
  const existing = await loadPersistedModelConfig(filePath);
  const existingById = new Map(existing.providers.map(provider => [provider.id, provider]));
  const providers = config.providers.map((provider, index) =>
    normalizeModelProviderForSave(provider, index, existingById.get(provider.id))
  );
  assertUniqueModelConfigProviderIds(providers);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({ providers }, null, 2)}\n`, "utf8");
  return toSafeModelConfig({ providers }, filePath);
}

export function createTierConfigStore(filePath: string): GatewayTierConfigStore {
  return {
    async load() {
      return toGatewayTierConfig(await loadPersistedTierConfig(filePath), filePath);
    },
    async save(config: GatewayTierConfigSaveParams) {
      return savePersistedTierConfig(filePath, config);
    },
  };
}

export async function loadPersistedTierConfig(filePath: string): Promise<ModelTierConfig> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // No tiers.json on disk → ship the adaptive default (enabled) rather than
      // the inert empty config, so installs get token-saving routing for free.
      return { ...TIER_DEFAULTS, tiers: { ...TIER_DEFAULTS.tiers }, classifier: { ...TIER_DEFAULTS.classifier } };
    }
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid tier config JSON at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return normalizeTierConfig(json);
}

async function savePersistedTierConfig(
  filePath: string,
  config: GatewayTierConfigSaveParams,
): Promise<GatewayTierConfig> {
  const normalized = normalizeTierConfig(config);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return toGatewayTierConfig(normalized, filePath);
}

function toGatewayTierConfig(config: ModelTierConfig, filePath: string): GatewayTierConfig {
  const out: GatewayTierConfig = {
    enabled: config.enabled,
    tiers: { ...config.tiers },
    classifier: {
      mode: config.classifier.mode,
      ...(config.classifier.fixedTier !== undefined ? { fixedTier: config.classifier.fixedTier } : {}),
      ...(config.classifier.keywordHints !== undefined ? { keywordHints: config.classifier.keywordHints } : {}),
    },
    appliesOn: "next-turn",
    configPath: filePath,
  };
  return out;
}

function normalizePersistedModelConfig(value: unknown, source: string): { providers: GatewayModelProviderConfig[] } {
  if (!isRecord(value)) {
    throw new Error(`Model config at ${source} must be a JSON object.`);
  }
  const providers = value.providers ?? [];
  if (!Array.isArray(providers)) {
    throw new Error(`Model config at ${source} must contain a providers array.`);
  }
  return {
    providers: providers.map((provider, index) => normalizePersistedModelProvider(provider, index, source)),
  };
}

function normalizePersistedModelProvider(value: unknown, index: number, source: string): GatewayModelProviderConfig {
  if (!isRecord(value)) {
    throw new Error(`Model config provider ${index + 1} in ${source} must be an object.`);
  }
  const id = readConfigString(value, "id", 120, `Model config provider ${index + 1}`);
  const type = readModelProviderType(value.type, `Model config provider ${id}`);
  const provider: GatewayModelProviderConfig = { id, type };
  assignOptionalConfigString(provider, value, "displayName", 160, `Model config provider ${id}`);
  assignOptionalConfigString(provider, value, "apiKey", 4000, `Model config provider ${id}`);
  assignOptionalConfigString(provider, value, "baseUrl", 1000, `Model config provider ${id}`);
  assignOptionalConfigString(provider, value, "defaultModel", 200, `Model config provider ${id}`);
  assignOptionalConfigBoolean(provider, value, "supportsToolCalling", `Model config provider ${id}`);
  assignOptionalConfigBoolean(provider, value, "enabled", `Model config provider ${id}`);
  return provider;
}

function normalizeModelProviderForSave(
  value: GatewayModelProviderConfig,
  index: number,
  existing: GatewayModelProviderConfig | undefined,
): GatewayModelProviderConfig {
  const id = normalizeConfigString(value.id, "id", 120, `Model config provider ${index + 1}`);
  const type = readModelProviderType(value.type, `Model config provider ${id}`);
  const provider: GatewayModelProviderConfig = { id, type };
  copyOptionalString(provider, "displayName", value.displayName, 160, `Model config provider ${id}`);
  copyOptionalString(provider, "baseUrl", value.baseUrl, 1000, `Model config provider ${id}`);
  copyOptionalString(provider, "defaultModel", value.defaultModel, 200, `Model config provider ${id}`);
  if (typeof value.supportsToolCalling === "boolean") {
    provider.supportsToolCalling = value.supportsToolCalling;
  }
  if (typeof value.enabled === "boolean") {
    provider.enabled = value.enabled;
  }
  const incomingApiKey = typeof value.apiKey === "string" ? value.apiKey.trim() : "";
  if (incomingApiKey && incomingApiKey !== DEFAULT_REDACTION) {
    provider.apiKey = normalizeConfigString(incomingApiKey, "apiKey", 4000, `Model config provider ${id}`);
  } else if (existing?.apiKey) {
    provider.apiKey = existing.apiKey;
  }
  return provider;
}

function createProvidersFromModelConfig(configs: readonly GatewayModelProviderConfig[]): ModelProvider[] {
  return configs
    .filter(config => config.enabled !== false)
    .map(createProviderFromModelConfig)
    .filter((provider): provider is ModelProvider => provider !== undefined);
}

function createProviderFromModelConfig(config: GatewayModelProviderConfig): ModelProvider | undefined {
  const apiKey = config.apiKey?.trim();
  if (!apiKey || apiKey === DEFAULT_REDACTION) {
    return undefined;
  }
  if (config.type === "openai-compatible") {
    const options: Parameters<typeof createOpenAICompatibleProvider>[0] = {
      id: config.id,
      apiKey,
    };
    if (config.displayName !== undefined) {
      options.displayName = config.displayName;
    }
    if (config.baseUrl !== undefined) {
      options.baseUrl = config.baseUrl;
    }
    if (config.defaultModel !== undefined) {
      options.defaultModel = config.defaultModel;
    }
    if (config.supportsToolCalling !== undefined) {
      options.supportsToolCalling = config.supportsToolCalling;
    }
    return createOpenAICompatibleProvider(options);
  }
  const options: Parameters<typeof createAnthropicProvider>[0] = {
    id: config.id,
    apiKey,
  };
  if (config.displayName !== undefined) {
    options.displayName = config.displayName;
  }
  if (config.baseUrl !== undefined) {
    options.baseUrl = config.baseUrl;
  }
  if (config.defaultModel !== undefined) {
    options.defaultModel = config.defaultModel;
  }
  if (config.supportsToolCalling !== undefined) {
    options.supportsToolCalling = config.supportsToolCalling;
  }
  return createAnthropicProvider(options);
}

function toSafeModelConfig(config: { providers: readonly GatewayModelProviderConfig[] }, filePath: string): GatewayModelConfig {
  return {
    providers: config.providers.map(provider => {
      const safe: GatewayModelProviderConfig = {
        id: provider.id,
        type: provider.type,
        apiKeyConfigured: Boolean(provider.apiKey),
      };
      if (provider.displayName !== undefined) {
        safe.displayName = provider.displayName;
      }
      if (provider.baseUrl !== undefined) {
        safe.baseUrl = provider.baseUrl;
      }
      if (provider.defaultModel !== undefined) {
        safe.defaultModel = provider.defaultModel;
      }
      if (provider.supportsToolCalling !== undefined) {
        safe.supportsToolCalling = provider.supportsToolCalling;
      }
      if (provider.enabled !== undefined) {
        safe.enabled = provider.enabled;
      }
      return safe;
    }),
    appliesOn: "next-turn",
    configPath: filePath,
  };
}

function assertUniqueModelConfigProviderIds(providers: readonly GatewayModelProviderConfig[]): void {
  const seen = new Set<string>();
  for (const provider of providers) {
    if (seen.has(provider.id)) {
      throw new Error(`Model provider "${provider.id}" is configured more than once.`);
    }
    seen.add(provider.id);
  }
}

function readConfigString(value: Record<string, unknown>, key: string, maxChars: number, source: string): string {
  return normalizeConfigString(value[key], key, maxChars, source);
}

function assignOptionalConfigString(
  target: GatewayModelProviderConfig,
  source: Record<string, unknown>,
  key: "displayName" | "apiKey" | "baseUrl" | "defaultModel",
  maxChars: number,
  label: string,
): void {
  const value = source[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string" || !value.trim()) {
    return;
  }
  target[key] = normalizeConfigString(value, key, maxChars, label);
}

function assignOptionalConfigBoolean(
  target: GatewayModelProviderConfig,
  source: Record<string, unknown>,
  key: "supportsToolCalling" | "enabled",
  label: string,
): void {
  const value = source[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} ${key} must be a boolean.`);
  }
  target[key] = value;
}

function copyOptionalString(
  target: GatewayModelProviderConfig,
  key: "displayName" | "baseUrl" | "defaultModel",
  value: string | undefined,
  maxChars: number,
  label: string,
): void {
  if (value === undefined || !value.trim()) {
    return;
  }
  target[key] = normalizeConfigString(value, key, maxChars, label);
}

function normalizeConfigString(value: unknown, key: string, maxChars: number, source: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${source} ${key} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxChars) {
    throw new Error(`${source} ${key} must be ${maxChars} characters or fewer.`);
  }
  return trimmed;
}

function readModelProviderType(value: unknown, source: string): GatewayModelProviderConfig["type"] {
  if (value === "openai-compatible" || value === "anthropic") {
    return value;
  }
  throw new Error(`${source} type must be openai-compatible or anthropic.`);
}

export function configuredAgentConfigPath(): string {
  const configured = process.env.LOONG_AGENT_CONFIG?.trim();
  return path.resolve(configured || path.join(loongConfigDir(), "agents.json"));
}

export function createAgentConfigStore(filePath: string): GatewayAgentConfigStore {
  // Gateway #resolveAgentParams loads the agent config more than once per turn;
  // cache the parsed+normalized result keyed by file mtime so repeated loads in
  // the same turn don't re-read and re-normalize agents.json. A save() bumps the
  // mtime, so the next load() misses the cache and reloads.
  let cached: { mtimeMs: number; value: GatewayAgentConfig } | undefined;
  return {
    async load() {
      let mtimeMs = -1;
      try {
        mtimeMs = (await stat(filePath)).mtimeMs;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (cached !== undefined && cached.mtimeMs === mtimeMs) {
        return cached.value;
      }
      const value = toSafeAgentConfig(await loadPersistedAgentConfig(filePath), filePath);
      cached = { mtimeMs, value };
      return value;
    },
    async save(config: GatewayAgentConfigSaveParams) {
      const saved = await savePersistedAgentConfig(filePath, config);
      cached = undefined;
      return saved;
    },
  };
}

export async function loadPersistedAgentConfig(filePath: string): Promise<GatewayAgentConfigSaveParams> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { profiles: [] };
    }
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid agent config JSON at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return normalizePersistedAgentConfig(json, filePath);
}

async function savePersistedAgentConfig(
  filePath: string,
  config: GatewayAgentConfigSaveParams,
): Promise<GatewayAgentConfig> {
  const profiles = config.profiles.map((profile, index) => normalizePersistedAgentProfile(profile, index, filePath));
  assertUniqueAgentProfileIds(profiles);
  const defaultProfileId = config.defaultProfileId?.trim();
  if (defaultProfileId && !profiles.some(profile => profile.id === defaultProfileId)) {
    throw new Error(`Default agent profile "${defaultProfileId}" is not configured.`);
  }
  const persisted: GatewayAgentConfigSaveParams = {
    profiles,
    ...(defaultProfileId ? { defaultProfileId } : {}),
    ...(config.sessionCompaction !== undefined ? { sessionCompaction: config.sessionCompaction } : {}),
    ...(config.aiSummarization !== undefined ? { aiSummarization: config.aiSummarization } : {}),
  };
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  return toSafeAgentConfig(persisted, filePath);
}

function normalizePersistedAgentConfig(value: unknown, source: string): GatewayAgentConfigSaveParams {
  if (!isRecord(value)) {
    throw new Error(`Agent config at ${source} must be a JSON object.`);
  }
  const profiles = value.profiles ?? [];
  if (!Array.isArray(profiles)) {
    throw new Error(`Agent config at ${source} must contain a profiles array.`);
  }
  const config: GatewayAgentConfigSaveParams = {
    profiles: profiles.map((profile, index) => normalizePersistedAgentProfile(profile, index, source)),
  };
  if (typeof value.defaultProfileId === "string" && value.defaultProfileId.trim()) {
    config.defaultProfileId = normalizeConfigString(value.defaultProfileId, "defaultProfileId", 120, "Agent config");
  }
  const rootCompaction = parseSessionCompactionValue(value.sessionCompaction);
  if (rootCompaction !== undefined) {
    config.sessionCompaction = rootCompaction;
  }
  const rootAiSummarization = parseAiSummarizationValue(value.aiSummarization);
  if (rootAiSummarization !== undefined) {
    config.aiSummarization = rootAiSummarization;
  }
  return config;
}

function normalizePersistedAgentProfile(value: unknown, index: number, source: string): GatewayAgentProfileConfig {
  if (!isRecord(value)) {
    throw new Error(`Agent profile ${index + 1} in ${source} must be an object.`);
  }
  const id = readConfigString(value, "id", 120, `Agent profile ${index + 1}`);
  const name = readConfigString(value, "name", 160, `Agent profile ${id}`);
  const profile: GatewayAgentProfileConfig = { id, name };
  assignOptionalAgentString(profile, value, "description", 1000, `Agent profile ${id}`);
  assignOptionalAgentString(profile, value, "defaultModel", 200, `Agent profile ${id}`);
  assignOptionalAgentString(profile, value, "workspace", 4000, `Agent profile ${id}`);
  assignOptionalAgentString(profile, value, "systemPrompt", 16_000, `Agent profile ${id}`);
  assignOptionalAgentBoolean(profile, value, "memoryEnabled", `Agent profile ${id}`);
  assignOptionalAgentBoolean(profile, value, "toolsEnabled", `Agent profile ${id}`);
  if (value.thinking !== undefined) {
    if (!["none", "low", "medium", "high"].includes(String(value.thinking))) {
      throw new Error(`Agent profile ${id} thinking is invalid.`);
    }
    profile.thinking = value.thinking as NonNullable<GatewayAgentProfileConfig["thinking"]>;
  }
  const profileCompaction = parseSessionCompactionValue(value.sessionCompaction);
  if (profileCompaction !== undefined) {
    profile.sessionCompaction = profileCompaction;
  }
  const profileAiSummarization = parseAiSummarizationValue(value.aiSummarization);
  if (profileAiSummarization !== undefined) {
    profile.aiSummarization = profileAiSummarization;
  }
  return profile;
}

function toSafeAgentConfig(config: GatewayAgentConfigSaveParams, filePath: string): GatewayAgentConfig {
  return {
    profiles: config.profiles.map(profile => ({ ...profile })),
    ...(config.defaultProfileId !== undefined ? { defaultProfileId: config.defaultProfileId } : {}),
    ...(config.sessionCompaction !== undefined ? { sessionCompaction: config.sessionCompaction } : {}),
    ...(config.aiSummarization !== undefined ? { aiSummarization: config.aiSummarization } : {}),
    configPath: filePath,
  };
}

function assertUniqueAgentProfileIds(profiles: readonly GatewayAgentProfileConfig[]): void {
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (seen.has(profile.id)) {
      throw new Error(`Agent profile "${profile.id}" is configured more than once.`);
    }
    seen.add(profile.id);
  }
}

function assignOptionalAgentString(
  target: GatewayAgentProfileConfig,
  source: Record<string, unknown>,
  key: "description" | "defaultModel" | "workspace" | "systemPrompt",
  maxChars: number,
  label: string,
): void {
  const value = source[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string" || !value.trim()) {
    return;
  }
  target[key] = normalizeConfigString(value, key, maxChars, label);
}

function assignOptionalAgentBoolean(
  target: GatewayAgentProfileConfig,
  source: Record<string, unknown>,
  key: "memoryEnabled" | "toolsEnabled",
  label: string,
): void {
  const value = source[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} ${key} must be a boolean.`);
  }
  target[key] = value;
}

type SkillsSlashCommand =
  | { action: "list"; query?: string }
  | { action: "load"; name: string };

export function parseSkillsSlashCommand(message: string): SkillsSlashCommand | undefined {
  const trimmed = message.trim();
  if (trimmed !== "/skills" && !trimmed.startsWith("/skills ")) {
    return undefined;
  }

  const rest = trimmed.slice("/skills".length).trim();
  if (!rest || rest === "list") {
    return { action: "list" };
  }
  if (rest.startsWith("list ")) {
    const query = rest.slice("list ".length).trim();
    return query ? { action: "list", query } : { action: "list" };
  }
  if (rest.startsWith("load ")) {
    const name = rest.slice("load ".length).trim();
    if (!name) {
      throw new Error("Usage: loong agent /skills load <name>");
    }
    return { action: "load", name };
  }
  return { action: "list", query: rest };
}

export async function runSkillsSlashCommand(skillRoots: string[], command: SkillsSlashCommand): Promise<void> {
  const runtime = createFileSkillRuntime({ roots: skillRoots });
  if (command.action === "load") {
    const skill = await runtime.load(command.name);
    if (!skill) {
      throw new Error(`Skill not found: ${command.name}`);
    }
    process.stdout.write(formatLoadedSkill(skill));
    return;
  }

  const allSkills = await runtime.list();
  const query = command.query?.toLowerCase();
  const skills = query
    ? allSkills.filter(skill =>
        skill.name.toLowerCase().includes(query)
        || skill.description.toLowerCase().includes(query)
        || skill.category?.toLowerCase().includes(query) === true
      )
    : allSkills;
  process.stdout.write(formatSkillList(skills, command.query, skillRoots));
}

function formatSkillList(skills: SkillSummary[], query: string | undefined, skillRoots: string[]): string {
  const lines = [
    query ? `Loong skills matching "${query}":` : "Loong skills:",
  ];
  if (skills.length === 0) {
    lines.push("No skills found.");
    lines.push(`Roots: ${skillRoots.join(path.delimiter)}`);
    return `${lines.join("\n")}\n`;
  }
  for (const skill of skills) {
    const category = skill.category ? ` [${skill.category}]` : "";
    lines.push(`- ${skill.name}${category}: ${skill.description}`);
    lines.push(`  path: ${skill.path}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatLoadedSkill(skill: LoadedSkill): string {
  const lines = [
    `# ${skill.name}`,
    "",
    skill.description,
    "",
    `Path: ${skill.path}`,
  ];
  if (skill.category !== undefined) {
    lines.push(`Category: ${skill.category}`);
  }
  lines.push("", skill.content.trim());
  if (skill.references !== undefined && skill.references.length > 0) {
    lines.push("", "References:");
    for (const reference of skill.references) {
      lines.push(`- ${reference.path} (${Buffer.byteLength(reference.content, "utf8")} bytes)`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function configuredSkillRoots(): string[] {
  const envRoots = parseRootList(process.env.LOONG_SKILL_ROOTS);
  const defaultRoot = path.join(resolveLoongDataRoot(), "skills");
  if (envRoots.length > 0) {
    return [...envRoots.map(resolveSkillRoot), path.resolve(defaultRoot)];
  }
  return [path.resolve(defaultRoot)];
}

export function configuredPluginRoots(): string[] {
  const envRoots = parseRootList(process.env.LOONG_PLUGIN_ROOTS);
  const defaultRoot = path.join(resolveLoongDataRoot(), "plugins");
  if (envRoots.length > 0) {
    return [...envRoots.map(resolveExistingPluginRoot), path.resolve(defaultRoot)];
  }
  return [path.resolve(defaultRoot)];
}

export { resolveLoongDataRoot } from "./loong-paths.js";

function parseRootList(value: string | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed
    .split(path.delimiter)
    .flatMap(part => part.split(","))
    .map(part => part.trim())
    .filter(Boolean);
}

export function resolveSkillRoot(value: string): string {
  const root = path.resolve(value);
  if (existsSync(root) && !isExistingDirectory(root)) {
    throw new Error(`Skill root must be a directory: ${root}`);
  }
  return root;
}

export function resolveExistingPluginRoot(value: string): string {
  const root = path.resolve(value);
  if (!existsSync(root)) {
    throw new Error(`Plugin root does not exist: ${root}`);
  }
  return root;
}

function isExistingDirectory(value: string): boolean {
  try {
    return statSync(value).isDirectory();
  } catch {
    return false;
  }
}

export function uniquePaths(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = path.resolve(value);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}


export function summarizeLoadedPlugins(plugins: LoadedLoongPlugin[]): GatewayPluginSummary[] {
  return plugins.map(plugin => {
    const summary: GatewayPluginSummary = {
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      tools: plugin.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        ...(tool.permission !== undefined ? { permission: tool.permission } : {}),
        ...(tool.capabilities !== undefined ? { capabilities: [...tool.capabilities] } : {}),
      })),
      providers: plugin.providers.map(provider => ({
        id: provider.id,
        displayName: provider.displayName,
        supportsToolCalling: provider.supportsToolCalling,
        ...(provider.defaultModel !== undefined ? { defaultModel: provider.defaultModel } : {}),
        ...(provider.models !== undefined ? { models: provider.models.map(model => ({ ...model })) } : {}),
      })),
      memoryBackends: plugin.memoryBackends.map(backend => ({
        id: backend.id,
        displayName: backend.displayName,
      })),
    };
    if (plugin.lifecycleHooks.length > 0) {
      summary.lifecycleHooks = plugin.lifecycleHooks.map(hook => hook.name);
    }
    if (plugin.manifest.description !== undefined) {
      summary.description = plugin.manifest.description;
    }
    if (plugin.manifest.loongVersion !== undefined) {
      summary.loongVersion = plugin.manifest.loongVersion;
    }
    return summary;
  });
}

export function summarizeProviders(providers: ModelProvider[]): GatewayProviderSummary[] {
  return providers.map(provider => ({
    id: provider.id,
    displayName: provider.displayName,
    supportsToolCalling: provider.supportsToolCalling,
    ...(provider.defaultModel !== undefined ? { defaultModel: provider.defaultModel } : {}),
    ...(provider.models !== undefined ? { models: provider.models.map(model => ({ ...model })) } : {}),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export {
  createRuntime,
  deactivateLoadedPlugins,
  type RuntimeFactoryOptions,
  type RuntimeFactoryResult,
} from "./runtime-factory.js";


