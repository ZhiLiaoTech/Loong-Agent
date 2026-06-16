import path from "node:path";
import { readdir, realpath, stat } from "node:fs/promises";
import {
  createLoongRuntime,
  mergeAiSummarizationLayers,
  mergeSessionCompactionLayers,
  evaluateWorkspaceScopePermission,
  type LoongAgentRuntime,
  type LoongLifecycleHook,
  type LoongPermissionHandler,
  type ModelTierConfig,
} from "@loong/core";
import { loadContextConfig } from "./context-config.js";
import { bootstrapAgentToolRegistry } from "./bootstrap-agent-tool-registry.js";
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
import { createProviderRegistry, type ModelProvider } from "@loong/providers";
import {
  createToolPermissionEngine,
  createToolRegistry,
  hasWorkspacePermissionContext,
  type ToolDefinition,
  type ToolPermissionEngine,
  type ToolPermissionRule,
  type ToolRegistry,
} from "@loong/tools";
import { evaluateOrgAwarePermission, type EmployeeStore, type ToolPolicyStore } from "@loong/org";

const MAX_PLUGIN_MEMORY_RESULTS = 50;
const MAX_PLUGIN_MEMORY_CONTENT_CHARS = 16_000;
const MAX_PLUGIN_MEMORY_METADATA_BYTES = 4096;
const MAX_PLUGIN_MEMORY_METADATA_DEPTH = 8;
const MAX_PLUGIN_MEMORY_METADATA_ARRAY_ITEMS = 100;
const MAX_PLUGIN_MEMORY_METADATA_OBJECT_KEYS = 100;

export interface RuntimeFactoryOptions {
  mode: "chat" | "agent";
  allowWrite: boolean;
  allowExec?: boolean;
  failOnPermissionDeny?: boolean;
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
  permissionHandler?: LoongPermissionHandler;
  denyAskWithoutHandler?: boolean;
  tierConfig?: ModelTierConfig;
  orgStores?: {
    employeeStore: EmployeeStore;
    toolPolicyStore: ToolPolicyStore;
  };
  ticketLifecycleHook?: LoongLifecycleHook;
  modelTimeoutMs?: number;
}

export interface RuntimeFactoryResult {
  runtime: LoongAgentRuntime;
  plugins: LoadedLoongPlugin[];
  providers: ModelProvider[];
  modelCatalog: LoongModelCatalog;
  tools: ToolDefinition[];
  toolRegistry: ToolRegistry;
  permissionEngine?: ToolPermissionEngine;
}

export async function createRuntime(options: RuntimeFactoryOptions): Promise<RuntimeFactoryResult> {
  const contextConfig = options.mode === "agent" ? await loadContextConfig() : {};
  const agentConfigForCompaction = options.mode === "agent"
    ? await (async () => {
      const { configuredAgentConfigPath, loadPersistedAgentConfig } = await import("./cli-impl.js");
      return loadPersistedAgentConfig(configuredAgentConfigPath());
    })()
    : undefined;
  const mergedSessionCompaction = options.mode === "agent"
    ? mergeSessionCompactionLayers(contextConfig.sessionCompaction, agentConfigForCompaction?.sessionCompaction)
    : undefined;
  const mergedAiSummarization = options.mode === "agent"
    ? mergeAiSummarizationLayers(contextConfig.aiSummarization, agentConfigForCompaction?.aiSummarization)
    : undefined;
  const plugins = await loadConfiguredPlugins(options.pluginRoots);
  try {
    const pluginProviders = plugins.flatMap(plugin => [...plugin.providers] as ModelProvider[]);
    const pluginTools = options.mode === "agent"
      ? plugins.flatMap(plugin => [...plugin.tools] as ToolDefinition[])
      : [];
    const pluginLifecycleHooks = plugins.flatMap(plugin => [...plugin.lifecycleHooks] as LoongLifecycleHook[]);
    const pluginMemoryBackends = plugins.flatMap(plugin => [...plugin.memoryBackends] as LoongPluginMemoryBackend[]);
    assertUniqueMemoryBackendIds(pluginMemoryBackends);
    const builtInProviders = options.providers ?? [];
    const providers = [
      ...builtInProviders,
      ...pluginProviders,
    ];
    assertUniqueProviderIds(providers);
    const modelCatalog = createModelCatalog(catalogEntriesFromProviders(providers));
    const registry = createProviderRegistry(providers, {
      ...(options.defaultProviderId ? { defaultProviderId: options.defaultProviderId } : {}),
      modelCatalog,
    });
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
      ...(options.ticketLifecycleHook ? [options.ticketLifecycleHook] : []),
    ];
    const trajectoryStore = options.trajectoryStore
      ?? (options.mode === "agent" && !options.noSession
        ? createFileTrajectoryStore({ rootDir: path.join(options.memoryDir, "trajectories") })
        : undefined);
    let runtime: LoongAgentRuntime | undefined;
    const contextProviders = options.mode === "agent" && memoryStore
      ? [
          createMarkdownMemoryContextProvider({ rootDir: options.memoryDir }),
          ...(sessionStore ? [createSessionCompactionContextProvider({ rootDir: options.sessionDir })] : []),
          createMemoryContextProvider({ store: memoryStore }),
        ]
      : [];
    const loadedPluginLine = plugins.length > 0
      ? `Loaded Loong plugins: ${plugins.map(plugin => `${plugin.manifest.name}@${plugin.manifest.version}`).join(", ")}.`
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
            {
              capability: "write",
              decision: "allow" as const,
              reason: "Workspace-scoped write access.",
              when: context => hasWorkspacePermissionContext(context.invocation),
            },
            {
              capability: "network",
              decision: "allow" as const,
              reason: "Workspace-scoped network access.",
              when: context => hasWorkspacePermissionContext(context.invocation),
            },
            ...pluginToolPermissionRules(pluginTools),
            ...(options.allowWrite
              ? [
                  { toolName: "file_patch", decision: "allow" as const, reason: "CLI agent write access explicitly enabled." },
                  { toolName: "file_write", decision: "allow" as const, reason: "CLI agent write access explicitly enabled." },
                  { toolName: "skill_create", decision: "allow" as const, reason: "CLI agent write access explicitly enabled." },
                  { toolName: "skill_improve", decision: "allow" as const, reason: "CLI agent write access explicitly enabled." },
                  { toolName: "memory_candidate_promote", decision: "allow" as const, reason: "CLI agent write access explicitly enabled." },
                  { toolName: "memory_candidate_reject", decision: "allow" as const, reason: "CLI agent write access explicitly enabled." },
                ]
              : []),
            ...(options.allowExec
              ? [
                  { toolName: "shell_run", decision: "allow" as const, reason: "CLI agent shell_run enabled." },
                  { capability: "execute" as const, decision: "allow" as const, reason: "CLI agent execute enabled." },
                ]
              : []),
          ],
        })
      : undefined;
    let toolRegistry: ToolRegistry = createToolRegistry();
    if (options.mode === "agent" && memoryStore) {
      const bootstrapped = await bootstrapAgentToolRegistry({
        skillRoots: options.skillRoots,
        memoryStore,
        memoryDir: options.memoryDir,
        ...(trajectoryStore ? { trajectoryStore } : {}),
        runtime: () => runtime,
        ...(options.allowExec ? { allowExec: true } : {}),
      });
      toolRegistry = bootstrapped.registry;
      for (const tool of pluginTools) {
        toolRegistry.register(tool);
      }
      if (bootstrapped.mcpRegistered.length > 0) {
        process.stderr.write(`Loaded MCP tools: ${bootstrapped.mcpRegistered.join(", ")}\n`);
      }
      for (const mcpError of bootstrapped.mcpErrors) {
        process.stderr.write(`MCP server skipped: ${mcpError}\n`);
      }
    }
    const runtimeOptions = {
      providerRegistry: registry,
      toolRegistry,
      lifecycleHooks,
      ...(sessionStore ? { sessionStore } : {}),
      ...(trajectoryStore ? { trajectoryStore } : {}),
      ...(contextProviders.length > 0 ? { contextProviders } : {}),
      ...(options.mode === "agent"
        ? {
            ...(permissionEngine ? { permissionEngine } : {}),
            systemPrompt: [
              "Runtime/tooling guidance for the active agent profile.",
              "The active agent profile or suite system prompt defines your identity, audience, and domain capabilities.",
              "When asked what you can do, answer from the active profile or suite definition first; mention Loong runtime tools only as implementation support when relevant.",
              "Use tools when they help inspect the current workspace.",
              "Use skill_list and skill_load to discover and apply configured Loong skills when they are relevant.",
              "Human-readable Markdown memory files are injected automatically when present.",
              "Older session history may be injected as bounded compacted context when recent history is truncated.",
              "Use memory_search to recall durable local context. Use memory_remember only when the user asks to keep a stable fact or project note.",
              "Explicit remember requests may also be captured as reviewable memory candidates before promotion to durable memory.",
              "Use trajectory_list and trajectory_get to inspect recent Loong run records when debugging prior behavior.",
              "Use delegation_run for bounded multi-task delegation when a task can be split into independent or dependency-ordered subtasks.",
              loadedPluginLine,
              "Only use shell_exec for conservative read-only commands.",
              "Use sandbox_exec for conservative read-only commands in local, Docker, or SSH sandboxes when the user provides the target; keep the default inspect profile unless broader git-read, search-read, or repo-read access is explicitly useful.",
              "Use browser_snapshot for bounded HTTP(S) page inspection, browser_playwright_snapshot for JavaScript-rendered pages when Playwright is installed, and browser_form_submit for basic GET/POST HTML forms when the user asks to inspect or submit a web page.",
              "Use file_search with regex:true for pattern-based code search when a plain substring is not enough.",
              "Use web_search to look up information on the web when configured (SearXNG, Tavily, or Brave).",
              options.allowExec
                ? "Use shell_run for arbitrary commands (build, test, install, scripts, python, bat) inside the workspace. shell_exec and sandbox_exec also accept common commands when LOONG_RELAX_SHELL_ALLOWLIST=1. Do not ask the user to configure a ClawWorks sandbox whitelist — Loong has no such UI."
                : "Only shell_exec and sandbox_exec are available; they use a conservative read-only allowlist (git, rg, version checks). For python, bat, or tasklist, enable shell_run via LOONG_ALLOW_EXEC=1.",
              "You may use file_patch for exact text replacements, file_write to create or overwrite files, and skill_create/skill_improve for reviewable skill updates when requested.",
              "Summarize findings clearly and mention any tool errors.",
            ].filter(Boolean).join("\n"),
            ...(options.permissionHandler ? { permissionHandler: options.permissionHandler } : {}),
            denyAskWithoutHandler: options.denyAskWithoutHandler ?? true,
            ...(options.failOnPermissionDeny ? { failOnPermissionDeny: true } : {}),
          }
        : {}),
    };

    const defaultProvider = options.defaultProviderId !== undefined
      ? providers.find(provider => provider.id === options.defaultProviderId)
      : undefined;
    const runtimeConfig: Parameters<typeof createLoongRuntime>[0] = {
      ...runtimeOptions,
      ...(defaultProvider?.defaultModel !== undefined ? { defaultModel: defaultProvider.defaultModel } : {}),
      ...(options.modelTimeoutMs !== undefined ? { modelTimeoutMs: options.modelTimeoutMs } : {}),
      ...(options.tierConfig !== undefined ? { tierConfig: options.tierConfig } : {}),
      ...(mergedSessionCompaction !== undefined ? { sessionCompaction: mergedSessionCompaction } : {}),
      ...(mergedAiSummarization !== undefined ? { aiSummarization: mergedAiSummarization } : {}),
      ...(options.orgStores
        ? {
            permissionEvaluator: async (tool, invocation, baseline) => {
              const org = await evaluateOrgAwarePermission(
                {
                  ...(permissionEngine ? { baseline: permissionEngine } : {}),
                  getEmployees: () => options.orgStores!.employeeStore.load(),
                  getToolPolicies: () => options.orgStores!.toolPolicyStore.load(),
                },
                tool,
                invocation,
              );
              return evaluateWorkspaceScopePermission(tool, invocation, org);
            },
          }
        : {
            permissionEvaluator: async (tool, invocation, baseline) =>
              evaluateWorkspaceScopePermission(tool, invocation, baseline),
          }),
    };

    runtime = createLoongRuntime(runtimeConfig);

    return {
      runtime,
      plugins,
      providers,
      modelCatalog,
      tools: toolRegistry.list(),
      toolRegistry,
      ...(permissionEngine ? { permissionEngine } : {}),
    };
  } catch (error) {
    await deactivateLoadedPlugins(plugins);
    throw error;
  }
}

async function loadConfiguredPlugins(pluginRoots: string[]): Promise<LoadedLoongPlugin[]> {
  const roots = await discoverPluginRoots(pluginRoots);
  const plugins: LoadedLoongPlugin[] = [];
  try {
    for (const root of roots) {
      plugins.push(await loadLoongPlugin(root));
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
    // A configured plugin root that does not exist yet (e.g. a fresh workspace
    // without .loong/plugins) is skipped silently rather than crashing the run.
    const root = await tryRealDirectory(path.resolve(rootInput));
    if (!root) {
      continue;
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
    const manifestPath = await realpath(path.join(pluginRoot, "loong.plugin.json"));
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

function assertUniqueMemoryBackendIds(backends: LoongPluginMemoryBackend[]): void {
  const seen = new Set<string>();
  for (const backend of backends) {
    const id = backend.id.trim();
    if (!id) {
      throw new Error("Memory backend id must not be empty.");
    }
    if (isBuiltInMemoryBackendId(id)) {
      throw new Error(`Memory backend id "${id}" is reserved for Loong's built-in stores.`);
    }
    if (seen.has(id)) {
      throw new Error(`Memory backend "${id}" is already registered.`);
    }
    seen.add(id);
  }
}

function selectMemoryStore(
  requestedBackendId: string | undefined,
  pluginBackends: LoongPluginMemoryBackend[],
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

export async function deactivateLoadedPlugins(plugins: LoadedLoongPlugin[]): Promise<void> {
  for (const plugin of [...plugins].reverse()) {
    try {
      await plugin.deactivate();
    } catch (error) {
      process.stderr.write(
        `Loong plugin ${plugin.manifest.name} failed to deactivate: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
