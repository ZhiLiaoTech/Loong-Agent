#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  createDragonRuntime,
  type DragonAgentRuntime,
  type DragonEvent,
  type DragonLifecycleHook,
  type DragonPermissionHandler,
  type DragonPermissionRequest,
} from "@dragon/core";
import { createCronRunner, createFileCronJobStore, createGatewayWebhookCronTarget } from "@dragon/cron";
import { createRuntimeDelegationTool } from "@dragon/delegation";
import { createHttpGateway, type GatewayConfig, type GatewayPluginSummary, type GatewayProviderSummary } from "@dragon/gateway";
import {
  createFileMemoryStore,
  createFileSessionStore,
  createFileTrajectoryStore,
  createMemoryCandidateLifecycleHook,
  createMemoryCandidateTools,
  createMarkdownMemoryContextProvider,
  createMemoryContextProvider,
  createSessionCompactionContextProvider,
  createMemoryTools,
  createSqliteMemoryStore,
  createTrajectoryTools,
  type MemoryRecord,
  type MemorySearchResult,
  type MemoryStore,
  type TrajectoryStore,
} from "@dragon/memory";
import { loadDragonPlugin, type DragonPluginMemoryBackend, type LoadedDragonPlugin } from "@dragon/plugin-sdk";
import {
  createAnthropicProviderFromEnv,
  createOpenAICompatibleProviderFromEnv,
  createProviderRegistry,
  sanitizeProviderBody,
  type ModelProvider,
} from "@dragon/providers";
import { createFileSkillRuntime, createSkillTools, type LoadedSkill, type SkillSummary } from "@dragon/skills";
import {
  createFilePatchTool,
  createBrowserFormSubmitTool,
  createBrowserSnapshotTool,
  createFileReadTool,
  createFileSearchTool,
  createShellExecTool,
  createSandboxExecTool,
  createToolPermissionEngine,
  type ToolDefinition,
  type ToolPermissionEngine,
  type ToolPermissionRule,
} from "@dragon/tools";

const [, , command = "help", ...args] = process.argv;
const MAX_PLUGIN_MEMORY_RESULTS = 50;
const MAX_PLUGIN_MEMORY_CONTENT_CHARS = 16_000;
const MAX_PLUGIN_MEMORY_METADATA_BYTES = 4096;
const MAX_PLUGIN_MEMORY_METADATA_DEPTH = 8;
const MAX_PLUGIN_MEMORY_METADATA_ARRAY_ITEMS = 100;
const MAX_PLUGIN_MEMORY_METADATA_OBJECT_KEYS = 100;

try {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    process.exitCode = 0;
  }

  else if (command === "chat") {
    if (isHelpArgs(args)) {
      printHelp();
    } else {
      await runChat("chat", args);
    }
    process.exitCode = 0;
  }

  else if (command === "agent") {
    if (isHelpArgs(args)) {
      printHelp();
    } else {
      await runChat("agent", args);
    }
    process.exitCode = 0;
  }

  else if (command === "gateway") {
    if (isHelpArgs(args)) {
      printHelp();
    } else {
      await runGateway(args);
    }
    process.exitCode = 0;
  }

  else if (command === "cron") {
    if (isHelpArgs(args)) {
      printHelp();
    } else {
      await runCron(args);
    }
    process.exitCode = 0;
  }

  else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function isHelpArgs(args: string[]): boolean {
  return args.length === 0
    ? false
    : args.every(arg => arg === "--help" || arg === "-h");
}

function createBuiltinProvidersFromEnv(): { providers: ModelProvider[]; defaultProviderId?: string } {
  const providers = [
    createOpenAICompatibleProviderFromEnv(),
    createAnthropicProviderFromEnv(),
  ].filter((provider): provider is ModelProvider => provider !== undefined);
  return {
    providers,
    ...(providers[0] ? { defaultProviderId: providers[0].id } : {}),
  };
}

async function runChat(mode: "chat" | "agent", args: string[]): Promise<void> {
  const parsed = parseChatArgs(mode, args);
  const skillSlashCommand = mode === "agent" ? parseSkillsSlashCommand(parsed.message) : undefined;
  if (skillSlashCommand) {
    await runSkillsSlashCommand(parsed.skillRoots ?? configuredSkillRoots(), skillSlashCommand);
    return;
  }

  const builtinProviders = createBuiltinProvidersFromEnv();
  const permissionHandler = mode === "agent" ? createCliPermissionHandler() : undefined;
  const runtimeBundle = await createRuntime({
    mode,
    allowWrite: parsed.allowWrite,
    sessionDir: parsed.sessionDir,
    memoryDir: parsed.memoryDir,
    ...(parsed.memoryBackendId !== undefined ? { memoryBackendId: parsed.memoryBackendId } : {}),
    noSession: parsed.noSession,
    skillRoots: mode === "agent" ? parsed.skillRoots ?? [] : [],
    pluginRoots: parsed.pluginRoots,
    providers: builtinProviders.providers,
    ...(builtinProviders.defaultProviderId ? { defaultProviderId: builtinProviders.defaultProviderId } : {}),
    ...(permissionHandler ? { permissionHandler } : {}),
  });
  const runtime = runtimeBundle.runtime;

  try {
    let lastErrorMetadata: Record<string, unknown> | undefined;
    runtime.subscribe(event => {
      if (event.type === "lifecycle" && event.phase === "error") {
        lastErrorMetadata = event.metadata;
      }
      renderEvent(event);
    });

    const turnInput = {
      sessionId: parsed.sessionId,
      source: "cli",
      message: parsed.message,
      ...(parsed.model !== undefined ? { model: parsed.model } : {}),
      ...(parsed.modelFallbacks !== undefined ? { modelFallbacks: parsed.modelFallbacks } : {}),
      metadata: {
        mode,
        agentAlias: mode === "agent",
      },
    } as const;
    const result = await runtime.runTurn(
      mode === "agent"
        ? { ...turnInput, workspace: process.cwd() }
        : turnInput,
    );

    if (result.status !== "ok") {
      if (lastErrorMetadata) {
        console.error(formatMetadata(lastErrorMetadata));
      }
      throw new Error(result.error ?? `Dragon turn failed with status ${result.status}.`);
    }

    const assistant = result.messages.find(item => item.role === "assistant");
    if (assistant?.content) {
      process.stdout.write(`${assistant.content}\n`);
    }
  } finally {
    await deactivateLoadedPlugins(runtimeBundle.plugins);
  }
}

async function runGateway(args: string[]): Promise<void> {
  const parsed = parseGatewayArgs(args);
  const builtinProviders = createBuiltinProvidersFromEnv();
  const trajectoryStore = createFileTrajectoryStore({ rootDir: path.join(parsed.memoryDir, "trajectories") });
  const cronStore = createFileCronJobStore({ filePath: parsed.cronJobsFile });
  const cronRunner = createCronRunner({
    store: cronStore,
    target: createGatewayWebhookCronTarget({
      gatewayUrl: gatewayUrlFromConfig(parsed.config),
      ...(parsed.config.sharedSecret !== undefined ? { sharedSecret: parsed.config.sharedSecret } : {}),
    }),
  });
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
  });
  const gateway = createHttpGateway({
    runtime: runtimeBundle.runtime,
    cronStore,
    cronRunner,
    trajectoryStore,
    pluginSummaries: summarizeLoadedPlugins(runtimeBundle.plugins),
    providerSummaries: summarizeProviders(runtimeBundle.providers),
    tools: runtimeBundle.tools,
    ...(runtimeBundle.permissionEngine ? { permissionEngine: runtimeBundle.permissionEngine } : {}),
  });
  try {
    await gateway.start(parsed.config);
    const address = gateway.address();
    process.stderr.write(`Dragon gateway listening on ${address?.url ?? "unknown address"}\n`);
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

async function runCron(args: string[]): Promise<void> {
  const parsed = parseCronArgs(args);
  const store = createFileCronJobStore({ filePath: parsed.jobsFile });
  const target = createGatewayWebhookCronTarget({
    gatewayUrl: parsed.gatewayUrl,
    ...(parsed.secret !== undefined ? { sharedSecret: parsed.secret } : {}),
  });
  const runner = createCronRunner({ store, target });

  if (parsed.once) {
    const result = await runner.tick();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const initial = await runner.tick();
  runner.start(parsed.intervalMs !== undefined ? { intervalMs: parsed.intervalMs } : {});
  process.stderr.write(`Dragon cron runner using ${parsed.jobsFile} -> ${parsed.gatewayUrl}\n`);
  if (initial.delivered.length > 0) {
    process.stderr.write(`Dragon cron delivered ${initial.delivered.length} due job(s) on startup.\n`);
  }
  try {
    await waitForShutdown();
  } finally {
    runner.stop();
  }
}

interface RuntimeFactoryOptions {
  mode: "chat" | "agent";
  allowWrite: boolean;
  sessionDir: string;
  memoryDir: string;
  memoryBackendId?: string;
  model?: string;
  noSession: boolean;
  skillRoots: string[];
  pluginRoots: string[];
  trajectoryStore?: TrajectoryStore;
  providers?: ModelProvider[];
  defaultProviderId?: string;
  permissionHandler?: DragonPermissionHandler;
}

interface RuntimeFactoryResult {
  runtime: DragonAgentRuntime;
  plugins: LoadedDragonPlugin[];
  providers: ModelProvider[];
  tools: ToolDefinition[];
  permissionEngine?: ToolPermissionEngine;
}

async function createRuntime(options: RuntimeFactoryOptions): Promise<RuntimeFactoryResult> {
  const plugins = await loadConfiguredPlugins(options.pluginRoots);
  try {
    const pluginProviders = plugins.flatMap(plugin => [...plugin.providers] as ModelProvider[]);
    const pluginTools = options.mode === "agent"
      ? plugins.flatMap(plugin => [...plugin.tools] as ToolDefinition[])
      : [];
    const pluginLifecycleHooks = plugins.flatMap(plugin => [...plugin.lifecycleHooks] as DragonLifecycleHook[]);
    const pluginMemoryBackends = plugins.flatMap(plugin => [...plugin.memoryBackends] as DragonPluginMemoryBackend[]);
    assertUniqueMemoryBackendIds(pluginMemoryBackends);
    const builtInProviders = options.providers ?? [];
    const providers = [
      ...builtInProviders,
      ...pluginProviders,
    ];
    assertUniqueProviderIds(providers);
    const registry = createProviderRegistry(
      providers,
      options.defaultProviderId ? { defaultProviderId: options.defaultProviderId } : {},
    );
    const sessionStore = options.noSession
      ? undefined
      : createFileSessionStore({ rootDir: options.sessionDir });
    const memoryStore = options.mode === "agent"
      ? selectMemoryStore(options.memoryBackendId, pluginMemoryBackends, options.memoryDir)
      : undefined;
    const memoryCandidateHook = options.mode === "agent" && memoryStore
      ? createMemoryCandidateLifecycleHook({ rootDir: options.memoryDir })
      : undefined;
    const lifecycleHooks = [
      ...pluginLifecycleHooks,
      ...(memoryCandidateHook ? [memoryCandidateHook] : []),
    ];
    const trajectoryStore = options.trajectoryStore
      ?? (options.mode === "agent" && !options.noSession
        ? createFileTrajectoryStore({ rootDir: path.join(options.memoryDir, "trajectories") })
        : undefined);
    let runtime: DragonAgentRuntime | undefined;
    const tools = options.mode === "agent" && memoryStore
      ? [
          ...createAgentTools(options.skillRoots, memoryStore, options.memoryDir, trajectoryStore, () => runtime),
          ...pluginTools,
        ]
      : [];
    const contextProviders = options.mode === "agent" && memoryStore
      ? [
          createMarkdownMemoryContextProvider({ rootDir: options.memoryDir }),
          ...(sessionStore ? [createSessionCompactionContextProvider({ rootDir: options.sessionDir })] : []),
          createMemoryContextProvider({ store: memoryStore }),
        ]
      : [];
    const loadedPluginLine = plugins.length > 0
      ? `Loaded Dragon plugins: ${plugins.map(plugin => `${plugin.manifest.name}@${plugin.manifest.version}`).join(", ")}.`
      : undefined;
    const permissionEngine = options.mode === "agent"
      ? createToolPermissionEngine({
          defaultDecision: "ask",
          rules: [
            { toolName: "file_read", decision: "allow" as const, reason: "CLI agent read-only workspace tool." },
            { toolName: "file_search", decision: "allow" as const, reason: "CLI agent read-only workspace tool." },
            { toolName: "shell_exec", decision: "allow" as const, reason: "CLI agent conservative read-only shell allowlist." },
            { toolName: "skill_list", decision: "allow" as const, reason: "CLI agent read-only skill discovery tool." },
            { toolName: "skill_load", decision: "allow" as const, reason: "CLI agent read-only skill loading tool." },
            { toolName: "memory_search", decision: "allow" as const, reason: "CLI agent read-only memory search tool." },
            { toolName: "memory_candidates_list", decision: "allow" as const, reason: "CLI agent read-only memory candidate review tool." },
            { toolName: "trajectory_list", decision: "allow" as const, reason: "CLI agent read-only trajectory listing tool." },
            { toolName: "trajectory_get", decision: "allow" as const, reason: "CLI agent read-only trajectory loading tool." },
            { toolName: "delegation_run", decision: "allow" as const, reason: "CLI agent bounded delegation execution tool." },
            ...pluginToolPermissionRules(pluginTools),
            ...(options.allowWrite
              ? [
                  { toolName: "file_patch", decision: "allow" as const, reason: "CLI agent write access explicitly enabled." },
                  { toolName: "skill_create", decision: "allow" as const, reason: "CLI agent write access explicitly enabled." },
                  { toolName: "skill_improve", decision: "allow" as const, reason: "CLI agent write access explicitly enabled." },
                  { toolName: "memory_candidate_promote", decision: "allow" as const, reason: "CLI agent write access explicitly enabled." },
                  { toolName: "memory_candidate_reject", decision: "allow" as const, reason: "CLI agent write access explicitly enabled." },
                ]
              : []),
          ],
        })
      : undefined;
    const runtimeOptions = {
      providerRegistry: registry,
      tools,
      lifecycleHooks,
      ...(sessionStore ? { sessionStore } : {}),
      ...(trajectoryStore ? { trajectoryStore } : {}),
      ...(contextProviders.length > 0 ? { contextProviders } : {}),
      ...(options.mode === "agent"
        ? {
            ...(permissionEngine ? { permissionEngine } : {}),
            systemPrompt: [
              "You are Dragon, a TypeScript-native local-first coding agent.",
              "Use tools when they help inspect the current workspace.",
              "Use skill_list and skill_load to discover and apply configured Dragon skills when they are relevant.",
              "Human-readable Markdown memory files are injected automatically when present.",
              "Older session history may be injected as bounded compacted context when recent history is truncated.",
              "Use memory_search to recall durable local context. Use memory_remember only when the user asks to keep a stable fact or project note.",
              "Explicit remember requests may also be captured as reviewable memory candidates before promotion to durable memory.",
              "Use trajectory_list and trajectory_get to inspect recent Dragon run records when debugging prior behavior.",
              "Use delegation_run for bounded multi-task delegation when a task can be split into independent or dependency-ordered subtasks.",
              loadedPluginLine,
              "Only use shell_exec for conservative read-only commands.",
              "Use sandbox_exec for conservative read-only commands in local, Docker, or SSH sandboxes when the user provides the target; keep the default inspect profile unless broader git-read, search-read, or repo-read access is explicitly useful.",
              "Use browser_snapshot for bounded HTTP(S) page inspection and browser_form_submit for basic GET/POST HTML forms when the user asks to inspect or submit a web page.",
              options.allowWrite
                ? "You may use file_patch for exact text replacements and skill_create/skill_improve for reviewable skill updates when requested."
                : "Write tools require CLI approval and may be denied.",
              "Summarize findings clearly and mention any tool errors.",
            ].filter(Boolean).join("\n"),
            ...(options.permissionHandler ? { permissionHandler: options.permissionHandler } : {}),
          }
        : {}),
    };

    const defaultProvider = options.defaultProviderId !== undefined
      ? providers.find(provider => provider.id === options.defaultProviderId)
      : undefined;
    const runtimeConfig = defaultProvider?.defaultModel !== undefined
      ? { ...runtimeOptions, defaultModel: defaultProvider.defaultModel }
      : runtimeOptions;

    runtime = createDragonRuntime(runtimeConfig);

    return {
      runtime,
      plugins,
      providers,
      tools,
      ...(permissionEngine ? { permissionEngine } : {}),
    };
  } catch (error) {
    await deactivateLoadedPlugins(plugins);
    throw error;
  }
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
}

interface ParsedCronArgs {
  jobsFile: string;
  gatewayUrl: string;
  secret?: string;
  once: boolean;
  intervalMs?: number;
}

function parseGatewayArgs(args: string[]): ParsedGatewayArgs {
  const config: GatewayConfig = {};
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
    throw new Error(`Unknown gateway option: ${arg}`);
  }

  return {
    config,
    allowWrite,
    sessionDir: path.resolve(sessionDir),
    memoryDir: path.resolve(memoryDir),
    cronJobsFile: path.resolve(cronJobsFile),
    ...(memoryBackendId !== undefined ? { memoryBackendId } : {}),
    skillRoots: uniquePaths([...skillRoots, ...defaultSkillRoots]),
    pluginRoots: uniquePaths(pluginRoots),
  };
}

function parseCronArgs(args: string[]): ParsedCronArgs {
  let jobsFile = process.env.DRAGON_CRON_JOBS?.trim() || path.join(process.cwd(), ".dragon", "cron", "jobs.json");
  let gatewayUrl = process.env.DRAGON_GATEWAY_URL?.trim() || "http://127.0.0.1:17357";
  let secret = process.env.DRAGON_GATEWAY_SECRET?.trim() || undefined;
  let once = false;
  let intervalMs: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--once") {
      once = true;
      continue;
    }
    if (arg === "--jobs") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon cron --jobs <path>");
      }
      jobsFile = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--jobs=")) {
      const value = arg.slice("--jobs=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon cron --jobs=<path>");
      }
      jobsFile = path.resolve(value);
      continue;
    }
    if (arg === "--gateway-url") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon cron --gateway-url <url>");
      }
      gatewayUrl = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--gateway-url=")) {
      const value = arg.slice("--gateway-url=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon cron --gateway-url=<url>");
      }
      gatewayUrl = value;
      continue;
    }
    if (arg === "--secret") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon cron --secret <value>");
      }
      secret = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--secret=")) {
      const value = arg.slice("--secret=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon cron --secret=<value>");
      }
      secret = value;
      continue;
    }
    if (arg === "--interval-ms") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon cron --interval-ms <ms>");
      }
      intervalMs = parseIntervalMs(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--interval-ms=")) {
      intervalMs = parseIntervalMs(arg.slice("--interval-ms=".length).trim());
      continue;
    }
    throw new Error(`Unknown cron option: ${arg}`);
  }

  return {
    jobsFile: path.resolve(jobsFile),
    gatewayUrl,
    once,
    ...(secret !== undefined ? { secret } : {}),
    ...(intervalMs !== undefined ? { intervalMs } : {}),
  };
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function parseIntervalMs(value: string): number {
  const intervalMs = Number(value);
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 24 * 60 * 60 * 1000) {
    throw new Error(`Invalid interval-ms: ${value}`);
  }
  return intervalMs;
}

function gatewayUrlFromConfig(config: GatewayConfig): string {
  const configuredHost = config.host ?? "127.0.0.1";
  const host = configuredHost === "0.0.0.0" || configuredHost === "::"
    ? "127.0.0.1"
    : configuredHost.includes(":") && !configuredHost.startsWith("[")
      ? `[${configuredHost}]`
      : configuredHost;
  const port = config.port ?? 17357;
  return `http://${host}:${port}`;
}

async function waitForShutdown(): Promise<void> {
  await new Promise<void>(resolve => {
    const done = () => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolve();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

interface ParsedChatArgs {
  message: string;
  sessionId: string;
  sessionDir: string;
  memoryDir: string;
  memoryBackendId?: string;
  model?: string;
  modelFallbacks?: string[];
  noSession: boolean;
  allowWrite: boolean;
  skillRoots?: string[];
  pluginRoots: string[];
}

function parseChatArgs(mode: "chat" | "agent", args: string[]): ParsedChatArgs {
  const messageParts: string[] = [];
  let sessionId = process.env.DRAGON_SESSION_ID?.trim() || "cli";
  let sessionDir = process.env.DRAGON_SESSION_DIR?.trim() || path.join(process.cwd(), ".dragon", "sessions");
  let memoryDir = process.env.DRAGON_MEMORY_DIR?.trim() || path.join(process.cwd(), ".dragon", "memory");
  let memoryBackendId = mode === "agent" ? process.env.DRAGON_MEMORY_BACKEND?.trim() || undefined : undefined;
  let model = process.env.DRAGON_MODEL?.trim() || undefined;
  const modelFallbacks = parseListEnv(process.env.DRAGON_MODEL_FALLBACKS);
  let noSession = false;
  let allowWrite = false;
  const defaultSkillRoots = mode === "agent" ? configuredSkillRoots() : [];
  const skillRoots: string[] = [];
  const pluginRoots = configuredPluginRoots();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-session") {
      noSession = true;
      continue;
    }
    if (arg === "--allow-write") {
      allowWrite = true;
      continue;
    }
    if (arg === "--model") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --model <provider:model> <message>`);
      }
      model = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--model=")) {
      const value = arg.slice("--model=".length).trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --model=<provider:model> <message>`);
      }
      model = value;
      continue;
    }
    if (arg === "--model-fallback") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --model-fallback <provider:model> <message>`);
      }
      modelFallbacks.push(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--model-fallback=")) {
      const value = arg.slice("--model-fallback=".length).trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --model-fallback=<provider:model> <message>`);
      }
      modelFallbacks.push(value);
      continue;
    }
    if (arg === "--session") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --session <id> <message>`);
      }
      sessionId = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--session=")) {
      const value = arg.slice("--session=".length).trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --session=<id> <message>`);
      }
      sessionId = value;
      continue;
    }
    if (arg === "--session-dir") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --session-dir <path> <message>`);
      }
      sessionDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--session-dir=")) {
      const value = arg.slice("--session-dir=".length).trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --session-dir=<path> <message>`);
      }
      sessionDir = path.resolve(value);
      continue;
    }
    if (arg === "--memory-dir") {
      if (mode !== "agent") {
        throw new Error("--memory-dir is only supported by dragon agent and dragon gateway.");
      }
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --memory-dir <path> <message>`);
      }
      memoryDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--memory-dir=")) {
      if (mode !== "agent") {
        throw new Error("--memory-dir is only supported by dragon agent and dragon gateway.");
      }
      const value = arg.slice("--memory-dir=".length).trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --memory-dir=<path> <message>`);
      }
      memoryDir = path.resolve(value);
      continue;
    }
    if (arg === "--memory-backend") {
      if (mode !== "agent") {
        throw new Error("--memory-backend is only supported by dragon agent and dragon gateway.");
      }
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --memory-backend <id> <message>`);
      }
      memoryBackendId = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--memory-backend=")) {
      if (mode !== "agent") {
        throw new Error("--memory-backend is only supported by dragon agent and dragon gateway.");
      }
      const value = arg.slice("--memory-backend=".length).trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --memory-backend=<id> <message>`);
      }
      memoryBackendId = value;
      continue;
    }
    if (arg === "--skill-root") {
      if (mode !== "agent") {
        throw new Error("--skill-root is only supported by dragon agent and dragon gateway.");
      }
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --skill-root <path> <message>`);
      }
      skillRoots.push(resolveSkillRoot(value));
      index += 1;
      continue;
    }
    if (arg?.startsWith("--skill-root=")) {
      if (mode !== "agent") {
        throw new Error("--skill-root is only supported by dragon agent and dragon gateway.");
      }
      const value = arg.slice("--skill-root=".length).trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --skill-root=<path> <message>`);
      }
      skillRoots.push(resolveSkillRoot(value));
      continue;
    }
    if (arg === "--plugin-root") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --plugin-root <path> <message>`);
      }
      pluginRoots.push(resolveExistingPluginRoot(value));
      index += 1;
      continue;
    }
    if (arg?.startsWith("--plugin-root=")) {
      const value = arg.slice("--plugin-root=".length).trim();
      if (!value) {
        throw new Error(`Usage: dragon ${mode} --plugin-root=<path> <message>`);
      }
      pluginRoots.push(resolveExistingPluginRoot(value));
      continue;
    }
    messageParts.push(arg ?? "");
  }

  const message = messageParts.join(" ").trim();
  if (!message) {
    throw new Error(`Usage: dragon ${mode} [--session <id>] [--no-session] <message>`);
  }

  return {
    message,
    sessionId,
    sessionDir: path.resolve(sessionDir),
    memoryDir: path.resolve(memoryDir),
    ...(memoryBackendId !== undefined ? { memoryBackendId } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(modelFallbacks.length > 0 ? { modelFallbacks } : {}),
    noSession,
    allowWrite,
    pluginRoots: uniquePaths(pluginRoots),
    ...(mode === "agent" ? { skillRoots: uniquePaths([...skillRoots, ...defaultSkillRoots]) } : {}),
  };
}

function parseListEnv(value: string | undefined): string[] {
  return value === undefined
    ? []
    : value.split(",").map(item => item.trim()).filter(Boolean);
}

type SkillsSlashCommand =
  | { action: "list"; query?: string }
  | { action: "load"; name: string };

function parseSkillsSlashCommand(message: string): SkillsSlashCommand | undefined {
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
      throw new Error("Usage: dragon agent /skills load <name>");
    }
    return { action: "load", name };
  }
  return { action: "list", query: rest };
}

async function runSkillsSlashCommand(skillRoots: string[], command: SkillsSlashCommand): Promise<void> {
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
    query ? `Dragon skills matching "${query}":` : "Dragon skills:",
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

function configuredSkillRoots(): string[] {
  const envRoots = parseRootList(process.env.DRAGON_SKILL_ROOTS);
  const defaultRoot = path.join(process.cwd(), ".dragon", "skills");
  if (envRoots.length > 0) {
    return [...envRoots.map(resolveSkillRoot), path.resolve(defaultRoot)];
  }
  return [path.resolve(defaultRoot)];
}

function configuredPluginRoots(): string[] {
  const envRoots = parseRootList(process.env.DRAGON_PLUGIN_ROOTS);
  if (envRoots.length > 0) {
    return envRoots.map(resolveExistingPluginRoot);
  }

  const defaultRoot = path.join(process.cwd(), ".dragon", "plugins");
  return existsSync(defaultRoot) && isExistingDirectory(defaultRoot) ? [path.resolve(defaultRoot)] : [];
}

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

function resolveSkillRoot(value: string): string {
  const root = path.resolve(value);
  if (existsSync(root) && !isExistingDirectory(root)) {
    throw new Error(`Skill root must be a directory: ${root}`);
  }
  return root;
}

function resolveExistingPluginRoot(value: string): string {
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

function uniquePaths(values: string[]): string[] {
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

async function loadConfiguredPlugins(pluginRoots: string[]): Promise<LoadedDragonPlugin[]> {
  const roots = await discoverPluginRoots(pluginRoots);
  const plugins: LoadedDragonPlugin[] = [];
  try {
    for (const root of roots) {
      plugins.push(await loadDragonPlugin(root));
    }
    return plugins;
  } catch (error) {
    await deactivateLoadedPlugins(plugins);
    throw error;
  }
}

async function discoverPluginRoots(pluginRoots: string[]): Promise<string[]> {
  const discovered: string[] = [];
  const seen = new Set<string>();
  for (const rootInput of pluginRoots) {
    const root = await realpath(path.resolve(rootInput));
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) {
      throw new Error(`Plugin root must be a directory: ${root}`);
    }

    if (await hasPluginManifest(root)) {
      addDiscoveredPluginRoot(root, seen, discovered);
      continue;
    }

    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      const candidatePath = path.join(root, entry.name);
      const candidateRoot = await tryRealDirectory(candidatePath);
      if (!candidateRoot || !isPathInside(candidateRoot, root)) {
        continue;
      }
      if (await hasPluginManifest(candidateRoot)) {
        addDiscoveredPluginRoot(candidateRoot, seen, discovered);
      }
    }
  }
  return discovered;
}

async function tryRealDirectory(value: string): Promise<string | undefined> {
  try {
    const resolved = await realpath(value);
    const valueStat = await stat(resolved);
    return valueStat.isDirectory() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

async function hasPluginManifest(pluginRoot: string): Promise<boolean> {
  try {
    const manifestPath = await realpath(path.join(pluginRoot, "dragon.plugin.json"));
    const manifestStat = await stat(manifestPath);
    return manifestStat.isFile() && isPathInside(manifestPath, pluginRoot);
  } catch {
    return false;
  }
}

function addDiscoveredPluginRoot(root: string, seen: Set<string>, discovered: string[]): void {
  const normalized = path.resolve(root);
  if (seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  discovered.push(normalized);
}

function assertUniqueProviderIds(providers: ModelProvider[]): void {
  const seen = new Set<string>();
  for (const provider of providers) {
    const id = provider.id.trim();
    if (!id) {
      throw new Error("Provider id must not be empty.");
    }
    if (seen.has(id)) {
      throw new Error(`Provider "${id}" is already registered.`);
    }
    seen.add(id);
  }
}

function assertUniqueMemoryBackendIds(backends: DragonPluginMemoryBackend[]): void {
  const seen = new Set<string>();
  for (const backend of backends) {
    const id = backend.id.trim();
    if (!id) {
      throw new Error("Memory backend id must not be empty.");
    }
    if (isBuiltInMemoryBackendId(id)) {
      throw new Error(`Memory backend id "${id}" is reserved for Dragon's built-in stores.`);
    }
    if (seen.has(id)) {
      throw new Error(`Memory backend "${id}" is already registered.`);
    }
    seen.add(id);
  }
}

function selectMemoryStore(
  requestedBackendId: string | undefined,
  pluginBackends: DragonPluginMemoryBackend[],
  memoryDir: string,
): MemoryStore {
  const backendId = requestedBackendId?.trim() || "file";
  const normalizedBackendId = backendId.toLowerCase();
  if (normalizedBackendId === "file") {
    return createFileMemoryStore({ rootDir: memoryDir });
  }
  if (normalizedBackendId === "sqlite") {
    return createSqliteMemoryStore({ rootDir: memoryDir });
  }
  const backend = pluginBackends.find(item => item.id === backendId);
  if (!backend) {
    const available = ["file", "sqlite", ...pluginBackends.map(item => item.id)].join(", ");
    throw new Error(`Unknown memory backend "${backendId}". Available memory backends: ${available}.`);
  }
  return createValidatingMemoryStore(backend.id, backend.store);
}

function isBuiltInMemoryBackendId(id: string): boolean {
  const normalized = id.toLowerCase();
  return normalized === "file" || normalized === "sqlite";
}

function createValidatingMemoryStore(backendId: string, store: MemoryStore): MemoryStore {
  return {
    async remember(record) {
      return validateMemoryRecord(await store.remember(record), `${backendId}.remember`);
    },
    async get(id) {
      const record = await store.get(id);
      return record === undefined ? undefined : validateMemoryRecord(record, `${backendId}.get`);
    },
    async search(query, limit) {
      const results = await store.search(query, limit);
      if (!Array.isArray(results)) {
        throw new Error(`Memory backend "${backendId}" search() must return an array.`);
      }
      return results.slice(0, MAX_PLUGIN_MEMORY_RESULTS).map((result, index) =>
        validateMemorySearchResult(result, `${backendId}.search[${index}]`)
      );
    },
  };
}

function validateMemorySearchResult(value: unknown, source: string): MemorySearchResult {
  if (!isRecord(value)) {
    throw new Error(`Memory backend ${source} must return an object.`);
  }
  const record = validateMemoryRecord(value.record, `${source}.record`);
  const score = value.score;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new Error(`Memory backend ${source}.score must be a finite number.`);
  }
  const result: MemorySearchResult = { record, score };
  if (value.reason !== undefined) {
    if (typeof value.reason !== "string") {
      throw new Error(`Memory backend ${source}.reason must be a string.`);
    }
    result.reason = value.reason.slice(0, 500);
  }
  return result;
}

function validateMemoryRecord(value: unknown, source: string): MemoryRecord {
  if (!isRecord(value)) {
    throw new Error(`Memory backend ${source} must return a memory record object.`);
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    throw new Error(`Memory backend ${source}.id must be a non-empty string.`);
  }
  if (!isMemoryScope(value.scope)) {
    throw new Error(`Memory backend ${source}.scope is invalid.`);
  }
  if (typeof value.content !== "string" || !value.content.trim()) {
    throw new Error(`Memory backend ${source}.content must be a non-empty string.`);
  }
  if (value.content.length > MAX_PLUGIN_MEMORY_CONTENT_CHARS) {
    throw new Error(`Memory backend ${source}.content is too large.`);
  }
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    throw new Error(`Memory backend ${source}.createdAt must be an ISO timestamp.`);
  }
  const record: MemoryRecord = {
    id: value.id,
    scope: value.scope,
    content: value.content,
    createdAt: value.createdAt,
  };
  if (value.source !== undefined) {
    if (typeof value.source !== "string") {
      throw new Error(`Memory backend ${source}.source must be a string.`);
    }
    record.source = value.source.slice(0, 500);
  }
  if (value.updatedAt !== undefined) {
    if (typeof value.updatedAt !== "string" || Number.isNaN(Date.parse(value.updatedAt))) {
      throw new Error(`Memory backend ${source}.updatedAt must be an ISO timestamp.`);
    }
    record.updatedAt = value.updatedAt;
  }
  if (value.metadata !== undefined) {
    record.metadata = clonePluginMemoryMetadata(value.metadata, `${source}.metadata`);
  }
  return record;
}

function isMemoryScope(value: unknown): value is MemoryRecord["scope"] {
  return value === "user" || value === "project" || value === "session" || value === "skill";
}

type PluginMemoryMetadataValue =
  | null
  | string
  | number
  | boolean
  | PluginMemoryMetadataValue[]
  | { [key: string]: PluginMemoryMetadataValue };

function clonePluginMemoryMetadata(value: unknown, source: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Memory backend ${source} must be an object.`);
  }
  const clone = clonePluginMemoryMetadataValue(value, source);
  const serialized = JSON.stringify(clone);
  if (!serialized || Buffer.byteLength(serialized, "utf8") > MAX_PLUGIN_MEMORY_METADATA_BYTES) {
    throw new Error(`Memory backend ${source} is too large.`);
  }
  return clone as Record<string, unknown>;
}

function clonePluginMemoryMetadataValue(
  value: unknown,
  source: string,
  seen = new WeakSet<object>(),
  depth = 0,
): PluginMemoryMetadataValue {
  if (depth > MAX_PLUGIN_MEMORY_METADATA_DEPTH) {
    throw new Error(`Memory backend ${source} is too deeply nested.`);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Memory backend ${source} must be JSON-safe.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_PLUGIN_MEMORY_METADATA_ARRAY_ITEMS) {
      throw new Error(`Memory backend ${source} has too many array items.`);
    }
    if (seen.has(value)) {
      throw new Error(`Memory backend ${source} must not contain circular references.`);
    }
    seen.add(value);
    const clone = value.map((item, index) =>
      clonePluginMemoryMetadataValue(item, `${source}[${index}]`, seen, depth + 1)
    );
    seen.delete(value);
    return clone;
  }
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Memory backend ${source} must be a plain JSON object.`);
    }
    if (seen.has(value)) {
      throw new Error(`Memory backend ${source} must not contain circular references.`);
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_PLUGIN_MEMORY_METADATA_OBJECT_KEYS) {
      throw new Error(`Memory backend ${source} has too many object keys.`);
    }
    seen.add(value);
    const clone: Record<string, PluginMemoryMetadataValue> = {};
    for (const [key, item] of entries) {
      clone[key] = clonePluginMemoryMetadataValue(item, `${source}.${key}`, seen, depth + 1);
    }
    seen.delete(value);
    return clone;
  }
  throw new Error(`Memory backend ${source} must be JSON-safe.`);
}

function pluginToolPermissionRules(tools: ToolDefinition[]): ToolPermissionRule[] {
  const rules: ToolPermissionRule[] = [];
  for (const tool of tools) {
    if (tool.permission === "allow") {
      rules.push({
        toolName: tool.name,
        decision: "allow",
        reason: `Plugin tool "${tool.name}" declares allow permission.`,
      });
    } else if (tool.permission === "deny") {
      rules.push({
        toolName: tool.name,
        decision: "deny",
        reason: `Plugin tool "${tool.name}" declares deny permission.`,
      });
    }
  }
  return rules;
}

async function deactivateLoadedPlugins(plugins: LoadedDragonPlugin[]): Promise<void> {
  for (const plugin of [...plugins].reverse()) {
    try {
      await plugin.deactivate();
    } catch (error) {
      process.stderr.write(
        `Dragon plugin ${plugin.manifest.name} failed to deactivate: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
}

function summarizeLoadedPlugins(plugins: LoadedDragonPlugin[]): GatewayPluginSummary[] {
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
    if (plugin.manifest.dragonVersion !== undefined) {
      summary.dragonVersion = plugin.manifest.dragonVersion;
    }
    return summary;
  });
}

function summarizeProviders(providers: ModelProvider[]): GatewayProviderSummary[] {
  return providers.map(provider => ({
    id: provider.id,
    displayName: provider.displayName,
    supportsToolCalling: provider.supportsToolCalling,
    ...(provider.defaultModel !== undefined ? { defaultModel: provider.defaultModel } : {}),
  }));
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function createCliPermissionHandler(): DragonPermissionHandler | undefined {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    return undefined;
  }

  return async request => {
    process.stderr.write(formatPermissionRequest(request));
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      const answer = await rl.question("Allow this tool call? [y/N] ");
      const approved = /^(y|yes)$/i.test(answer.trim());
      return {
        decision: approved ? "allow" : "deny",
        reason: approved ? "User approved in CLI prompt." : "User denied in CLI prompt.",
        metadata: { surface: "cli" },
      };
    } finally {
      rl.close();
    }
  };
}

function formatPermissionRequest(request: DragonPermissionRequest): string {
  return [
    "",
    `Permission required for tool: ${request.toolName}`,
    `Reason: ${request.reason}`,
    `Input: ${summarizePermissionInput(request)}`,
    "",
  ].join("\n");
}

function summarizePermissionInput(request: DragonPermissionRequest): string {
  if (request.toolName === "file_patch" && isRecord(request.input)) {
    return stringifyPreview({
      path: request.input.path,
      replaceAll: request.input.replaceAll,
      oldText: previewText(request.input.oldText),
      newText: previewText(request.input.newText),
    });
  }
  return stringifyPreview(request.input);
}

function stringifyPreview(value: unknown): string {
  const json = JSON.stringify(value, (key, item) => {
    if (/token|secret|api[_-]?key|authorization/i.test(key)) {
      return "[redacted]";
    }
    return previewText(item);
  });
  if (!json) {
    return String(value);
  }
  return json.length > 1200 ? `${json.slice(0, 1200)}... [truncated]` : json;
}

function previewText(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return value.length > 300
    ? `${value.slice(0, 300)}... [${value.length} chars]`
    : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderEvent(event: DragonEvent): void {
  if (event.type === "lifecycle" && event.phase === "start") {
    process.stderr.write("Dragon is thinking...\n");
  }
  if (event.type === "tool") {
    process.stderr.write(`Tool ${event.phase}: ${event.toolName}\n`);
  }
}

function formatMetadata(metadata: Record<string, unknown>): string {
  return Object.entries(metadata)
    .map(([key, value]) => `${key}: ${formatMetadataValue(key, value)}`)
    .join("\n");
}

function formatMetadataValue(key: string, value: unknown): string {
  const text = String(value);
  if (/body|token|secret|key|authorization/i.test(key)) {
    return sanitizeProviderBody(text);
  }
  return text;
}

function printHelp(): void {
  console.log(`Dragon (Qianlong)

Usage:
  dragon chat [--session <id>] [--session-dir <path>] [--no-session] [--model <ref>] [--model-fallback <ref>] [--plugin-root <path>] <message>
  dragon agent [--session <id>] [--session-dir <path>] [--no-session] [--allow-write] [--model <ref>] [--model-fallback <ref>] [--skill-root <path>] [--plugin-root <path>] [--memory-dir <path>] [--memory-backend <id>] <message>
  dragon gateway [--host <host>] [--port <port>] [--secret <value>] [--session-dir <path>] [--allow-write] [--skill-root <path>] [--plugin-root <path>] [--memory-dir <path>] [--memory-backend <id>] [--cron-jobs <path>]
  dragon cron [--jobs <path>] [--gateway-url <url>] [--secret <value>] [--once] [--interval-ms <ms>]

Provider:
  Set DRAGON_OPENAI_API_KEY or OPENAI_API_KEY for the OpenAI-compatible provider.
  Optional: DRAGON_OPENAI_BASE_URL, DRAGON_OPENAI_MODEL, DRAGON_OPENAI_PROVIDER_ID.
  Set DRAGON_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY for the Anthropic Messages provider.
  Optional: DRAGON_ANTHROPIC_BASE_URL, DRAGON_ANTHROPIC_MODEL, DRAGON_ANTHROPIC_PROVIDER_ID.
  Provider plugins can also be loaded from .dragon/plugins, DRAGON_PLUGIN_ROOTS, or --plugin-root <path>.
  Model refs with a registered provider prefix, such as openai:gpt-4o or anthropic:claude-sonnet-4-5, route explicitly to that provider.
  Optional: DRAGON_MODEL, --model <ref>, DRAGON_MODEL_FALLBACKS, --model-fallback <ref>.

Permissions:
  Write tools prompt for approval in an interactive terminal.
  Use --allow-write to allow file_patch, skill_create, skill_improve, and memory candidate promote/reject without prompting.

Session:
  Sessions are stored as JSONL under .dragon/sessions by default.
  Optional: DRAGON_SESSION_ID, DRAGON_SESSION_DIR, --session-dir <path>.

Skills:
  Agent mode loads SKILL.md roots from .dragon/skills and can create that root when needed.
  Local slash commands: dragon agent /skills, dragon agent /skills <query>, dragon agent /skills load <name>.
  Optional: DRAGON_SKILL_ROOTS, --skill-root <path>.

Plugins:
  Plugin roots can point to a plugin directory or a directory containing plugin directories.
  Optional: DRAGON_PLUGIN_ROOTS, --plugin-root <path>.
  Tool plugins are available in agent and gateway mode. Tools that declare permission "allow" can run without an interactive prompt, permission "deny" is always refused, and omitted permission defaults to ask. Ask is skipped when no permission handler is available.

Memory:
  dragon agent and dragon gateway store durable memory records under .dragon/memory with the built-in "file" backend by default.
  Human-readable Markdown memory files can live in .dragon/memory/USER.md, PROJECT.md, MEMORY.md, and notes/YYYY-MM-DD.md.
  Explicit remember requests create pending memory candidates; memory_candidates_list can review them, while promote/reject tools require write permission.
  Use --memory-backend sqlite for the built-in SQLite/FTS backend when node:sqlite is available.
  Optional: DRAGON_MEMORY_DIR, --memory-dir <path>, DRAGON_MEMORY_BACKEND, --memory-backend <id>.
  Memory backend plugins must be selected explicitly; loaded plugins never replace the default file backend by accident.

Gateway:
  Defaults to 127.0.0.1:17357 with no auth.
  Includes a cron runner backed by .dragon/cron/jobs.json.
  Optional: DRAGON_GATEWAY_HOST, DRAGON_GATEWAY_PORT, DRAGON_GATEWAY_SECRET, DRAGON_CRON_JOBS, --cron-jobs <path>.

Cron:
  Runs due jobs from a JSON cron store and delivers them to the Gateway webhook channel.
  Use --once for system cron style execution; omit it for a long-running local runner.
  Optional: DRAGON_CRON_JOBS, DRAGON_GATEWAY_URL, DRAGON_GATEWAY_SECRET.
`);
}

function createAgentTools(
  skillRoots: string[],
  memoryStore: ReturnType<typeof createFileMemoryStore>,
  memoryDir: string,
  trajectoryStore: TrajectoryStore | undefined,
  runtime: (() => DragonAgentRuntime | undefined) | undefined,
): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    createFileReadTool(),
    createFileSearchTool(),
    createBrowserSnapshotTool(),
    createBrowserFormSubmitTool(),
    createShellExecTool(),
    createSandboxExecTool(),
    createFilePatchTool(),
    ...createMemoryTools(memoryStore),
    ...createMemoryCandidateTools({ rootDir: memoryDir, store: memoryStore }),
  ];
  if (runtime !== undefined) {
    tools.push(createRuntimeDelegationTool({ runtime, source: "api", maxTasks: 8, maxConcurrency: 3 }));
  }
  if (trajectoryStore) {
    tools.push(...createTrajectoryTools(trajectoryStore));
  }
  if (skillRoots.length > 0) {
    tools.push(...createSkillTools(createFileSkillRuntime({ roots: skillRoots })));
  }
  return tools;
}
