import { pathToFileURL } from "node:url";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { DragonLifecycleHook } from "@dragon/core";
import type { MemoryStore } from "@dragon/memory";
import { normalizeProviderModelEntries } from "@dragon/model-catalog";
import type { ModelProvider } from "@dragon/providers";
import type { ToolCapability, ToolDefinition, ToolPermissionDecision } from "@dragon/tools";

export interface DragonPluginManifest {
  name: string;
  version: string;
  entry: string;
  description?: string;
  dragonVersion?: string;
}

export interface DragonPluginContext {
  registerTool(tool: ToolDefinition): void;
  registerProvider(provider: ModelProvider): void;
  registerLifecycleHook(hook: DragonLifecycleHook): void;
  registerMemoryBackend(backend: DragonPluginMemoryBackend): void;
}

export interface DragonPluginMemoryBackend {
  id: string;
  displayName: string;
  store: MemoryStore;
}

export interface DragonPlugin {
  manifest?: DragonPluginManifest;
  activate(context: DragonPluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}

export interface LoadedDragonPlugin {
  manifest: DragonPluginManifest;
  rootDir: string;
  tools: readonly Readonly<ToolDefinition>[];
  providers: readonly Readonly<ModelProvider>[];
  lifecycleHooks: readonly Readonly<DragonLifecycleHook>[];
  memoryBackends: readonly Readonly<DragonPluginMemoryBackend>[];
  deactivate(): Promise<void>;
}

export interface DragonPluginLoadOptions {
  manifestFile?: string;
}

const DEFAULT_MANIFEST_FILE = "dragon.plugin.json";
const MAX_MANIFEST_BYTES = 64_000;
const MAX_REGISTERED_TOOLS = 100;
const MAX_REGISTERED_PROVIDERS = 40;
const MAX_REGISTERED_LIFECYCLE_HOOKS = 40;
const MAX_REGISTERED_MEMORY_BACKENDS = 20;
const MAX_JSON_DEPTH = 40;
const MAX_JSON_ARRAY_ITEMS = 10_000;
const MAX_JSON_OBJECT_KEYS = 10_000;
const TOOL_PERMISSIONS = new Set<ToolPermissionDecision>(["allow", "ask", "deny"]);
const TOOL_CAPABILITIES = new Set<ToolCapability>(["read", "write", "execute", "network", "memory", "custom"]);

type JsonValue = null | string | number | boolean | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export async function loadDragonPlugin(
  pluginRoot: string,
  options: DragonPluginLoadOptions = {},
): Promise<LoadedDragonPlugin> {
  const rootDir = await resolvePluginRoot(pluginRoot);
  const manifest = await readPluginManifest(rootDir, options.manifestFile ?? DEFAULT_MANIFEST_FILE);
  const entryPath = await resolvePluginEntry(rootDir, manifest.entry);
  const moduleUrl = pathToFileURL(entryPath).href;
  const plugin = normalizePluginModule(await import(moduleUrl), manifest);
  const tools: Readonly<ToolDefinition>[] = [];
  const providers: Readonly<ModelProvider>[] = [];
  const lifecycleHooks: Readonly<DragonLifecycleHook>[] = [];
  const memoryBackends: Readonly<DragonPluginMemoryBackend>[] = [];
  let registrationOpen = true;
  const context: DragonPluginContext = {
    registerTool(tool) {
      assertRegistrationOpen(registrationOpen);
      const normalizedTool = normalizeTool(tool);
      if (tools.length >= MAX_REGISTERED_TOOLS) {
        throw new Error(`Plugin registered more than ${MAX_REGISTERED_TOOLS} tools.`);
      }
      if (tools.some(item => item.name === normalizedTool.name)) {
        throw new Error(`Plugin registered duplicate tool: ${normalizedTool.name}`);
      }
      tools.push(Object.freeze(normalizedTool));
    },
    registerProvider(provider) {
      assertRegistrationOpen(registrationOpen);
      const normalizedProvider = normalizeProvider(provider);
      if (providers.length >= MAX_REGISTERED_PROVIDERS) {
        throw new Error(`Plugin registered more than ${MAX_REGISTERED_PROVIDERS} providers.`);
      }
      if (providers.some(item => item.id === normalizedProvider.id)) {
        throw new Error(`Plugin registered duplicate provider: ${normalizedProvider.id}`);
      }
      providers.push(Object.freeze(normalizedProvider));
    },
    registerLifecycleHook(hook) {
      assertRegistrationOpen(registrationOpen);
      const normalizedHook = normalizeLifecycleHook(hook);
      if (lifecycleHooks.length >= MAX_REGISTERED_LIFECYCLE_HOOKS) {
        throw new Error(`Plugin registered more than ${MAX_REGISTERED_LIFECYCLE_HOOKS} lifecycle hooks.`);
      }
      if (lifecycleHooks.some(item => item.name === normalizedHook.name)) {
        throw new Error(`Plugin registered duplicate lifecycle hook: ${normalizedHook.name}`);
      }
      lifecycleHooks.push(Object.freeze(normalizedHook));
    },
    registerMemoryBackend(backend) {
      assertRegistrationOpen(registrationOpen);
      const normalizedBackend = normalizeMemoryBackend(backend);
      if (memoryBackends.length >= MAX_REGISTERED_MEMORY_BACKENDS) {
        throw new Error(`Plugin registered more than ${MAX_REGISTERED_MEMORY_BACKENDS} memory backends.`);
      }
      if (memoryBackends.some(item => item.id === normalizedBackend.id)) {
        throw new Error(`Plugin registered duplicate memory backend: ${normalizedBackend.id}`);
      }
      memoryBackends.push(Object.freeze(normalizedBackend));
    },
  };

  try {
    try {
      await plugin.activate(context);
    } finally {
      registrationOpen = false;
    }
  } catch (error) {
    try {
      await plugin.deactivate?.();
    } catch {
      // Preserve the activate failure. Deactivation here is best-effort cleanup.
    }
    throw error;
  }

  return {
    manifest: Object.freeze({ ...(plugin.manifest ?? manifest) }),
    rootDir,
    tools: Object.freeze([...tools]),
    providers: Object.freeze([...providers]),
    lifecycleHooks: Object.freeze([...lifecycleHooks]),
    memoryBackends: Object.freeze([...memoryBackends]),
    async deactivate() {
      await plugin.deactivate?.();
    },
  };
}

async function resolvePluginRoot(pluginRoot: string): Promise<string> {
  const rootDir = await realpath(path.resolve(pluginRoot));
  const rootStat = await stat(rootDir);
  if (!rootStat.isDirectory()) {
    throw new Error("Plugin root must be a directory.");
  }
  return rootDir;
}

async function readPluginManifest(rootDir: string, manifestFile: string): Promise<DragonPluginManifest> {
  if (path.isAbsolute(manifestFile) || hasWindowsDrivePrefix(manifestFile) || manifestFile.includes("..")) {
    throw new Error("Plugin manifest path must stay inside plugin root.");
  }
  const manifestPath = await realpath(path.join(rootDir, manifestFile));
  if (!isPathInside(manifestPath, rootDir)) {
    throw new Error("Plugin manifest escapes plugin root.");
  }
  const manifestStat = await stat(manifestPath);
  if (!manifestStat.isFile()) {
    throw new Error("Plugin manifest must be a file.");
  }
  if (manifestStat.size > MAX_MANIFEST_BYTES) {
    throw new Error(`Plugin manifest is larger than ${MAX_MANIFEST_BYTES} bytes.`);
  }
  const value = JSON.parse(stripBom(await readFile(manifestPath, "utf8")));
  return validateManifest(value);
}

function validateManifest(value: unknown): DragonPluginManifest {
  if (!isRecord(value)) {
    throw new Error("Plugin manifest must be an object.");
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new Error("Plugin manifest requires name.");
  }
  if (typeof value.version !== "string" || !value.version.trim()) {
    throw new Error("Plugin manifest requires version.");
  }
  if (typeof value.entry !== "string" || !value.entry.trim()) {
    throw new Error("Plugin manifest requires entry.");
  }
  const manifest: DragonPluginManifest = {
    name: normalizeIdentifier(value.name, "manifest.name"),
    version: value.version.trim(),
    entry: value.entry.trim(),
  };
  if (typeof value.description === "string" && value.description.trim()) {
    manifest.description = value.description.trim().slice(0, 500);
  }
  if (typeof value.dragonVersion === "string" && value.dragonVersion.trim()) {
    manifest.dragonVersion = value.dragonVersion.trim();
  }
  return manifest;
}

async function resolvePluginEntry(rootDir: string, entry: string): Promise<string> {
  if (path.isAbsolute(entry) || hasWindowsDrivePrefix(entry)) {
    throw new Error("Plugin entry must be relative to plugin root.");
  }
  const entryPath = await realpath(path.resolve(rootDir, entry));
  if (!isPathInside(entryPath, rootDir)) {
    throw new Error("Plugin entry escapes plugin root.");
  }
  const entryStat = await stat(entryPath);
  if (!entryStat.isFile()) {
    throw new Error("Plugin entry must be a file.");
  }
  const extension = path.extname(entryPath).toLowerCase();
  if (extension !== ".js" && extension !== ".mjs") {
    throw new Error("Plugin entry must be a JavaScript module.");
  }
  return entryPath;
}

function normalizePluginModule(moduleValue: unknown, manifest: DragonPluginManifest): DragonPlugin {
  const candidate = isRecord(moduleValue) && moduleValue.default !== undefined
    ? moduleValue.default
    : moduleValue;
  if (!isRecord(candidate) || typeof candidate.activate !== "function") {
    throw new Error("Plugin module must export a plugin object with activate().");
  }
  const plugin: DragonPlugin = {
    activate: candidate.activate as DragonPlugin["activate"],
  };
  const deactivate = candidate.deactivate;
  if (typeof deactivate === "function") {
    plugin.deactivate = deactivate as NonNullable<DragonPlugin["deactivate"]>;
  }
  if (isRecord(candidate.manifest)) {
    const inlineManifest = validateManifest({ ...manifest, ...candidate.manifest });
    if (inlineManifest.name !== manifest.name) {
      throw new Error("Plugin inline manifest name must match manifest file.");
    }
    if (inlineManifest.version !== manifest.version || inlineManifest.entry !== manifest.entry) {
      throw new Error("Plugin inline manifest version and entry must match manifest file.");
    }
    plugin.manifest = inlineManifest;
  } else {
    plugin.manifest = manifest;
  }
  return plugin;
}

function normalizeTool(tool: ToolDefinition): ToolDefinition {
  if (!isRecord(tool)) {
    throw new Error("Plugin tool must be an object.");
  }
  const rawName = tool.name;
  const rawDescription = tool.description;
  const rawInputSchema = tool.inputSchema;
  const rawPermission = tool.permission;
  const rawCapabilities = tool.capabilities;
  const rawInvoke = tool.invoke;
  const name = normalizeIdentifier(rawName, "tool.name");
  if (typeof rawDescription !== "string" || !rawDescription.trim()) {
    throw new Error("Plugin tool requires description.");
  }
  const inputSchema = cloneAndFreezeJson(rawInputSchema, "tool.inputSchema");
  if (!isRecord(inputSchema) || inputSchema.type !== "object") {
    throw new Error("Plugin tool inputSchema must be an object JSON schema.");
  }
  const permission = normalizeToolPermission(rawPermission);
  const capabilities = normalizeToolCapabilities(rawCapabilities);
  if (typeof rawInvoke !== "function") {
    throw new Error("Plugin tool requires invoke().");
  }
  const normalized: ToolDefinition = {
    name,
    description: rawDescription.trim(),
    inputSchema,
    invoke: rawInvoke,
  };
  if (permission !== undefined) {
    normalized.permission = permission;
  }
  if (capabilities !== undefined) {
    normalized.capabilities = capabilities;
  }
  return normalized;
}

function normalizeProvider(provider: ModelProvider): ModelProvider {
  if (!isRecord(provider)) {
    throw new Error("Plugin provider must be an object.");
  }
  const rawId = provider.id;
  const rawDisplayName = provider.displayName;
  const rawSupportsToolCalling = provider.supportsToolCalling;
  const rawComplete = provider.complete;
  const rawDefaultModel = provider.defaultModel;
  const rawModels = provider.models;
  const rawCanHandleModel = provider.canHandleModel;
  const rawNormalizeModel = provider.normalizeModel;
  const id = normalizeIdentifier(rawId, "provider.id");
  if (typeof rawDisplayName !== "string" || !rawDisplayName.trim()) {
    throw new Error("Plugin provider requires displayName.");
  }
  if (typeof rawSupportsToolCalling !== "boolean") {
    throw new Error("Plugin provider requires supportsToolCalling.");
  }
  if (rawDefaultModel !== undefined && typeof rawDefaultModel !== "string") {
    throw new Error("Plugin provider defaultModel must be a string.");
  }
  if (rawModels !== undefined && !Array.isArray(rawModels)) {
    throw new Error("Plugin provider models must be an array.");
  }
  if (rawCanHandleModel !== undefined && typeof rawCanHandleModel !== "function") {
    throw new Error("Plugin provider canHandleModel must be a function.");
  }
  if (rawNormalizeModel !== undefined && typeof rawNormalizeModel !== "function") {
    throw new Error("Plugin provider normalizeModel must be a function.");
  }
  if (typeof rawComplete !== "function") {
    throw new Error("Plugin provider requires complete().");
  }
  const normalized: ModelProvider = {
    id,
    displayName: rawDisplayName.trim(),
    supportsToolCalling: rawSupportsToolCalling,
    complete: rawComplete,
  };
  if (rawDefaultModel !== undefined) {
    normalized.defaultModel = rawDefaultModel;
  }
  if (rawModels !== undefined || rawDefaultModel !== undefined) {
    normalized.models = normalizeProviderModelEntries(rawModels ?? [], {
      ...(rawDefaultModel !== undefined ? { defaultModel: rawDefaultModel } : {}),
      supportsToolCalling: rawSupportsToolCalling,
    });
  }
  if (rawCanHandleModel !== undefined) {
    normalized.canHandleModel = rawCanHandleModel;
  }
  if (rawNormalizeModel !== undefined) {
    normalized.normalizeModel = rawNormalizeModel;
  }
  return normalized;
}

function normalizeLifecycleHook(hook: DragonLifecycleHook): DragonLifecycleHook {
  if (!isRecord(hook)) {
    throw new Error("Plugin lifecycle hook must be an object.");
  }
  const rawName = hook.name;
  const rawOnLifecycle = hook.onLifecycle;
  const name = normalizeIdentifier(rawName, "lifecycleHook.name");
  if (typeof rawOnLifecycle !== "function") {
    throw new Error("Plugin lifecycle hook requires onLifecycle().");
  }
  return {
    name,
    onLifecycle: rawOnLifecycle,
  };
}

function normalizeMemoryBackend(backend: DragonPluginMemoryBackend): DragonPluginMemoryBackend {
  if (!isRecord(backend)) {
    throw new Error("Plugin memory backend must be an object.");
  }
  const id = normalizeIdentifier(backend.id, "memoryBackend.id");
  if (id.toLowerCase() === "file" || id.toLowerCase() === "sqlite") {
    throw new Error(`Plugin memory backend id "${id}" is reserved.`);
  }
  if (typeof backend.displayName !== "string" || !backend.displayName.trim()) {
    throw new Error("Plugin memory backend requires displayName.");
  }
  const store = backend.store;
  if (!isRecord(store)) {
    throw new Error("Plugin memory backend requires store.");
  }
  if (typeof store.remember !== "function" || typeof store.get !== "function" || typeof store.search !== "function") {
    throw new Error("Plugin memory backend store must implement remember(), get(), and search().");
  }
  return {
    id,
    displayName: backend.displayName.trim(),
    store,
  };
}

function normalizeIdentifier(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Plugin ${fieldName} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized !== value) {
    throw new Error(`Plugin ${fieldName} must not include leading or trailing whitespace.`);
  }
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(normalized)) {
    throw new Error(`Plugin ${fieldName} contains unsupported characters.`);
  }
  return normalized;
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function assertRegistrationOpen(open: boolean): void {
  if (!open) {
    throw new Error("Plugin registration is closed after activate().");
  }
}

function normalizeToolPermission(value: unknown): ToolPermissionDecision | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !TOOL_PERMISSIONS.has(value as ToolPermissionDecision)) {
    throw new Error("Plugin tool permission must be allow, ask, or deny.");
  }
  return value as ToolPermissionDecision;
}

function normalizeToolCapabilities(value: unknown): readonly ToolCapability[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("Plugin tool capabilities must be an array.");
  }
  const capabilities: ToolCapability[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== "string" || !TOOL_CAPABILITIES.has(item as ToolCapability)) {
      throw new Error(`Plugin tool capabilities[${index}] is not supported.`);
    }
    capabilities.push(item as ToolCapability);
  }
  return Object.freeze(capabilities);
}

function cloneAndFreezeJson(
  value: unknown,
  fieldName: string,
  seen = new WeakSet<object>(),
  depth = 0,
): JsonValue {
  if (depth > MAX_JSON_DEPTH) {
    throw new Error(`Plugin ${fieldName} is too deeply nested.`);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Plugin ${fieldName} must be JSON-serializable.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ARRAY_ITEMS) {
      throw new Error(`Plugin ${fieldName} has too many array items.`);
    }
    if (seen.has(value)) {
      throw new Error(`Plugin ${fieldName} must not contain circular references.`);
    }
    seen.add(value);
    const clone: JsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      clone.push(cloneAndFreezeJson(value[index], `${fieldName}[${index}]`, seen, depth + 1));
    }
    seen.delete(value);
    return Object.freeze(clone);
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Plugin ${fieldName} must be a plain JSON object.`);
    }
    if (seen.has(value)) {
      throw new Error(`Plugin ${fieldName} must not contain circular references.`);
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_JSON_OBJECT_KEYS) {
      throw new Error(`Plugin ${fieldName} has too many object keys.`);
    }
    seen.add(value);
    const clone: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const [key, item] of entries) {
      Object.defineProperty(clone, key, {
        value: cloneAndFreezeJson(item, `${fieldName}.${key}`, seen, depth + 1),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    seen.delete(value);
    return Object.freeze(clone);
  }
  throw new Error(`Plugin ${fieldName} must be JSON-serializable.`);
}

function hasWindowsDrivePrefix(value: string): boolean {
  return /^[a-zA-Z]:/.test(value);
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
