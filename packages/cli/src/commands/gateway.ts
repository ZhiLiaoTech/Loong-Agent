import path from "node:path";
import { normalizeTierConfig, type DragonAgentRuntime, type ModelTierConfig } from "@dragon/core";
import { createCronRunner, createFileCronJobStore, createGatewayWebhookCronTarget } from "@dragon/cron";
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
} from "@dragon/org";
import { createHttpGateway, type GatewayConfig } from "@dragon/gateway";
import { createFileTrajectoryStore } from "@dragon/memory";
import {
  loadGatewaySettingsFile,
  mergeGatewayConfigFromFile,
  parseModelTimeoutMsArg,
  parseModelTimeoutMsFromEnv,
  parseModelTimeoutSecArg,
  resolveModelTimeoutMs,
} from "../gateway-settings.js";
import {
  configuredAgentConfigPath,
  configuredModelConfigPath,
  configuredPluginRoots,
  configuredSkillRoots,
  configuredTierConfigPath,
  createAgentConfigStore,
  createBuiltinProviders,
  createModelConfigStore,
  createTierConfigStore,
  loadPersistedTierConfig,
  resolveExistingPluginRoot,
  resolveSkillRoot,
  summarizeLoadedPlugins,
  summarizeProviders,
  uniquePaths,
} from "../cli-impl.js";
import { createRuntime, deactivateLoadedPlugins } from "../runtime-factory.js";
import { gatewayUrlFromConfig } from "../gateway-url.js";
import { parsePort } from "../parse-cli-args.js";
import { waitForShutdown } from "../shutdown.js";

export interface ParsedGatewayArgs {
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

export async function runGateway(args: string[]): Promise<void> {
  const parsed = await parseGatewayArgs(args);
  const modelConfigPath = configuredModelConfigPath();
  const agentConfigPath = configuredAgentConfigPath();
  const tierConfigPath = configuredTierConfigPath();
  const builtinProviders = await createBuiltinProviders();
  const initialTierConfig = await loadPersistedTierConfig(tierConfigPath);
  const trajectoryStore = createFileTrajectoryStore({ rootDir: path.join(parsed.memoryDir, "trajectories") });
  const cronStore = createFileCronJobStore({ filePath: parsed.cronJobsFile });
  const cronRunner = createCronRunner({
    store: cronStore,
    target: createGatewayWebhookCronTarget({
      gatewayUrl: gatewayUrlFromConfig(parsed.config),
      ...(parsed.config.sharedSecret !== undefined ? { sharedSecret: parsed.config.sharedSecret } : {}),
    }),
  });
  const orgStore = createFileOrgStore(defaultOrgConfigPath());
  const employeeStore = createFileEmployeeStore(defaultEmployeeConfigPath());
  const toolPolicyStore = createFileToolPolicyStore(defaultToolPolicyConfigPath());
  const approvalStore = createFileApprovalStore(defaultApprovalConfigPath());
  const ticketStore = createFileTicketStore(defaultTicketConfigPath());
  const approvalService = createGatewayApprovalService({
    store: approvalStore,
    getOrg: () => orgStore.load(),
    getEmployees: () => employeeStore.load(),
    ticketStore,
  });
  const kpiTemplateStore = createFileKpiTemplateStore(defaultKpiTemplateConfigPath());
  const runtimeBundle = await createRuntime({
    mode: "agent",
    allowWrite: parsed.allowWrite,
    sessionDir: parsed.sessionDir,
    memoryDir: parsed.memoryDir,
    ...(parsed.memoryBackendId !== undefined ? { memoryBackendId: parsed.memoryBackendId } : {}),
    noSession: false,
    skillRoots: parsed.skillRoots,
    pluginRoots: parsed.pluginRoots,
    trajectoryStore,
    providers: builtinProviders.providers,
    ...(builtinProviders.defaultProviderId ? { defaultProviderId: builtinProviders.defaultProviderId } : {}),
    tierConfig: initialTierConfig,
    orgStores: { employeeStore, toolPolicyStore },
    permissionHandler: approvalService.handler,
    denyAskWithoutHandler: true,
    ticketLifecycleHook: createTicketLifecycleHook({ ticketStore }),
    modelTimeoutMs: parsed.modelTimeoutMs,
  });
  const gateway = createHttpGateway({
    runtime: runtimeBundle.runtime,
    cronStore,
    cronRunner,
    trajectoryStore,
    pluginSummaries: summarizeLoadedPlugins(runtimeBundle.plugins),
    providerSummaries: summarizeProviders(runtimeBundle.providers),
    modelConfigStore: createModelConfigStore(modelConfigPath),
    agentConfigStore: createAgentConfigStore(agentConfigPath),
    orgStore,
    employeeStore,
    toolPolicyStore,
    approvalService,
    approvalStore,
    ticketStore,
    kpiTemplateStore,
    tierConfigStore: createTierConfigStore(tierConfigPath),
    onTierConfigChange: (saved) => {
      const next = normalizeTierConfig(saved);
      const runtime = runtimeBundle.runtime as DragonAgentRuntime & {
        setTierConfig?: (config: ModelTierConfig | undefined) => void;
      };
      if (typeof runtime.setTierConfig === "function") {
        runtime.setTierConfig(next);
      }
    },
    toolRegistry: runtimeBundle.toolRegistry,
    ...(runtimeBundle.permissionEngine ? { permissionEngine: runtimeBundle.permissionEngine } : {}),
  });
  try {
    await gateway.start(parsed.config);
    const address = gateway.address();
    process.stderr.write(`Dragon gateway listening on ${address?.url ?? "unknown address"}\n`);
    process.stderr.write(`Dragon model timeout: ${Math.round(parsed.modelTimeoutMs / 1000)}s\n`);
    await cronRunner.tick();
    cronRunner.start();
    await waitForShutdown();
  } finally {
    cronRunner.stop();
    try {
      await gateway.stop();
    } finally {
      await deactivateLoadedPlugins(runtimeBundle.plugins);
    }
  }
}

export async function parseGatewayArgs(args: string[]): Promise<ParsedGatewayArgs> {
  const fileSettings = await loadGatewaySettingsFile();
  let modelTimeoutMsCli: number | undefined;
  let config: GatewayConfig = mergeGatewayConfigFromFile({}, fileSettings);
  const envHost = process.env.DRAGON_GATEWAY_HOST?.trim();
  const envPort = process.env.DRAGON_GATEWAY_PORT?.trim();
  const envSecret = process.env.DRAGON_GATEWAY_SECRET?.trim();
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
  let sessionDir = process.env.DRAGON_SESSION_DIR?.trim() || path.join(process.cwd(), ".dragon", "sessions");
  let memoryDir = process.env.DRAGON_MEMORY_DIR?.trim() || path.join(process.cwd(), ".dragon", "memory");
  let cronJobsFile = process.env.DRAGON_CRON_JOBS?.trim() || path.join(process.cwd(), ".dragon", "cron", "jobs.json");
  let memoryBackendId = process.env.DRAGON_MEMORY_BACKEND?.trim() || undefined;
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
        throw new Error("Usage: dragon gateway --host <host>");
      }
      config.host = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--host=")) {
      const value = arg.slice("--host=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --host=<host>");
      }
      config.host = value;
      continue;
    }
    if (arg === "--port") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --port <port>");
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
        throw new Error("Usage: dragon gateway --secret <value>");
      }
      config.authMode = "shared-secret";
      config.sharedSecret = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--secret=")) {
      const value = arg.slice("--secret=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --secret=<value>");
      }
      config.authMode = "shared-secret";
      config.sharedSecret = value;
      continue;
    }
    if (arg === "--session-dir") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --session-dir <path>");
      }
      sessionDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--session-dir=")) {
      const value = arg.slice("--session-dir=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --session-dir=<path>");
      }
      sessionDir = path.resolve(value);
      continue;
    }
    if (arg === "--memory-dir") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --memory-dir <path>");
      }
      memoryDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--memory-dir=")) {
      const value = arg.slice("--memory-dir=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --memory-dir=<path>");
      }
      memoryDir = path.resolve(value);
      continue;
    }
    if (arg === "--memory-backend") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --memory-backend <id>");
      }
      memoryBackendId = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--memory-backend=")) {
      const value = arg.slice("--memory-backend=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --memory-backend=<id>");
      }
      memoryBackendId = value;
      continue;
    }
    if (arg === "--cron-jobs") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --cron-jobs <path>");
      }
      cronJobsFile = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--cron-jobs=")) {
      const value = arg.slice("--cron-jobs=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --cron-jobs=<path>");
      }
      cronJobsFile = path.resolve(value);
      continue;
    }
    if (arg === "--skill-root") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --skill-root <path>");
      }
      skillRoots.push(resolveSkillRoot(value));
      index += 1;
      continue;
    }
    if (arg?.startsWith("--skill-root=")) {
      const value = arg.slice("--skill-root=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --skill-root=<path>");
      }
      skillRoots.push(resolveSkillRoot(value));
      continue;
    }
    if (arg === "--plugin-root") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --plugin-root <path>");
      }
      pluginRoots.push(resolveExistingPluginRoot(value));
      index += 1;
      continue;
    }
    if (arg?.startsWith("--plugin-root=")) {
      const value = arg.slice("--plugin-root=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --plugin-root=<path>");
      }
      pluginRoots.push(resolveExistingPluginRoot(value));
      continue;
    }
    if (arg === "--model-timeout-ms") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --model-timeout-ms <milliseconds>");
      }
      modelTimeoutMsCli = parseModelTimeoutMsArg(value, "--model-timeout-ms");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--model-timeout-ms=")) {
      const value = arg.slice("--model-timeout-ms=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --model-timeout-ms=<milliseconds>");
      }
      modelTimeoutMsCli = parseModelTimeoutMsArg(value, "--model-timeout-ms");
      continue;
    }
    if (arg === "--model-timeout-sec") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --model-timeout-sec <seconds>");
      }
      modelTimeoutMsCli = parseModelTimeoutSecArg(value, "--model-timeout-sec");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--model-timeout-sec=")) {
      const value = arg.slice("--model-timeout-sec=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon gateway --model-timeout-sec=<seconds>");
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
