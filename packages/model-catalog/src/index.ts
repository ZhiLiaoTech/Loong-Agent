export type LoongModelStatus = "stable" | "preview" | "deprecated" | "unknown";

export interface LoongModelCapabilities {
  toolCalling?: boolean;
  streaming?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  jsonMode?: boolean;
}

export interface LoongProviderModelCatalogEntry {
  id: string;
  displayName?: string;
  aliases?: readonly string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: LoongModelCapabilities;
  status?: LoongModelStatus;
  default?: boolean;
  metadata?: Record<string, unknown>;
}

export interface LoongModelCatalogEntry extends LoongProviderModelCatalogEntry {
  providerId: string;
  providerDisplayName?: string;
}

export interface LoongModelProviderCatalogSource {
  id: string;
  displayName?: string;
  defaultModel?: string;
  supportsToolCalling?: boolean;
  models?: readonly LoongProviderModelCatalogEntry[];
}

export interface LoongModelCatalog {
  register(entry: LoongModelCatalogEntry): void;
  list(): readonly LoongModelCatalogEntry[];
  listByProvider(providerId: string): readonly LoongModelCatalogEntry[];
  find(providerId: string, modelIdOrAlias: string): LoongModelCatalogEntry | undefined;
  resolve(modelRef: string): LoongModelCatalogEntry | undefined;
}

export interface NormalizeProviderModelEntriesOptions {
  defaultModel?: string;
  supportsToolCalling?: boolean;
}

const MODEL_STATUSES = new Set<LoongModelStatus>(["stable", "preview", "deprecated", "unknown"]);
const MAX_ID_LENGTH = 200;
const MAX_DISPLAY_NAME_LENGTH = 240;
const MAX_ALIAS_COUNT = 20;
const MAX_METADATA_KEYS = 100;

export class DefaultLoongModelCatalog implements LoongModelCatalog {
  readonly #entries = new Map<string, LoongModelCatalogEntry>();

  constructor(entries: readonly LoongModelCatalogEntry[] = []) {
    for (const entry of entries) {
      this.register(entry);
    }
  }

  register(entry: LoongModelCatalogEntry): void {
    const normalized = normalizeModelCatalogEntry(entry);
    const key = catalogKey(normalized.providerId, normalized.id);
    if (this.#entries.has(key)) {
      throw new Error(`Model "${normalized.providerId}:${normalized.id}" is already registered.`);
    }
    this.#entries.set(key, normalized);
  }

  list(): readonly LoongModelCatalogEntry[] {
    return Object.freeze([...this.#entries.values()]);
  }

  listByProvider(providerId: string): readonly LoongModelCatalogEntry[] {
    const normalizedProviderId = normalizeIdentifier(providerId, "provider id");
    return Object.freeze([...this.#entries.values()].filter(entry => entry.providerId === normalizedProviderId));
  }

  find(providerId: string, modelIdOrAlias: string): LoongModelCatalogEntry | undefined {
    const normalizedProviderId = normalizeIdentifier(providerId, "provider id");
    const normalizedModelRef = normalizeIdentifier(modelIdOrAlias, "model id");
    return [...this.#entries.values()].find(entry =>
      entry.providerId === normalizedProviderId
      && (entry.id === normalizedModelRef || entry.aliases?.includes(normalizedModelRef) === true),
    );
  }

  resolve(modelRef: string): LoongModelCatalogEntry | undefined {
    const normalizedRef = normalizeIdentifier(modelRef, "model ref");
    const separatorIndex = findProviderSeparator(normalizedRef);
    if (separatorIndex > 0) {
      const providerId = normalizedRef.slice(0, separatorIndex);
      const modelId = normalizedRef.slice(separatorIndex + 1);
      if (!modelId) {
        return undefined;
      }
      return this.find(providerId, modelId);
    }

    const matches = [...this.#entries.values()].filter(entry =>
      entry.id === normalizedRef || entry.aliases?.includes(normalizedRef) === true,
    );
    return matches.length === 1 ? matches[0] : undefined;
  }
}

export function createModelCatalog(entries: readonly LoongModelCatalogEntry[] = []): LoongModelCatalog {
  return new DefaultLoongModelCatalog(entries);
}

export interface ModelRefCarrier {
  model?: string;
}

export function createModelCatalogFromProviders(
  providers: readonly LoongModelProviderCatalogSource[],
): LoongModelCatalog {
  return createModelCatalog(catalogEntriesFromProviders(providers));
}

/** Canonicalize bare model ids and aliases to `provider:model` when unambiguous. */
export function applyModelCatalogToParams<T extends ModelRefCarrier>(
  params: T,
  catalog: LoongModelCatalog | undefined,
): T {
  const modelRef = params.model?.trim();
  if (!modelRef || !catalog) {
    return params;
  }
  const resolved = catalog.resolve(modelRef);
  if (!resolved) {
    return params;
  }
  return {
    ...params,
    model: `${resolved.providerId}:${resolved.id}`,
  };
}

export function catalogEntriesFromProviders(
  providers: readonly LoongModelProviderCatalogSource[],
): readonly LoongModelCatalogEntry[] {
  return Object.freeze(providers.flatMap(provider => {
    const providerId = normalizeIdentifier(provider.id, "provider id");
    const providerDisplayName = provider.displayName?.trim();
    const models = normalizeProviderModelEntries(provider.models ?? [], {
      ...(provider.defaultModel !== undefined ? { defaultModel: provider.defaultModel } : {}),
      ...(provider.supportsToolCalling !== undefined ? { supportsToolCalling: provider.supportsToolCalling } : {}),
    });
    return models.map(model => normalizeModelCatalogEntry({
      ...model,
      providerId,
      ...(providerDisplayName ? { providerDisplayName } : {}),
    }));
  }));
}

export function normalizeProviderModelEntries(
  entries: readonly LoongProviderModelCatalogEntry[],
  options: NormalizeProviderModelEntriesOptions = {},
): readonly LoongProviderModelCatalogEntry[] {
  const normalized = entries.map(normalizeProviderModelEntry);
  const defaultModel = options.defaultModel?.trim();
  const withDefault = defaultModel
    ? ensureDefaultModelEntry(normalized, defaultModel, options.supportsToolCalling)
    : normalized;
  const seenIds = new Set<string>();
  for (const entry of withDefault) {
    if (seenIds.has(entry.id)) {
      throw new Error(`Model "${entry.id}" is registered more than once.`);
    }
    seenIds.add(entry.id);
  }
  return Object.freeze(withDefault.map(entry => Object.freeze(entry)));
}

export function normalizeModelCatalogEntry(entry: LoongModelCatalogEntry): LoongModelCatalogEntry {
  const providerId = normalizeIdentifier(entry.providerId, "provider id");
  const providerDisplayName = entry.providerDisplayName?.trim();
  const model = normalizeProviderModelEntry(entry);
  return Object.freeze({
    ...model,
    providerId,
    ...(providerDisplayName ? { providerDisplayName: trimBounded(providerDisplayName, MAX_DISPLAY_NAME_LENGTH) } : {}),
  });
}

function normalizeProviderModelEntry(entry: LoongProviderModelCatalogEntry): LoongProviderModelCatalogEntry {
  if (!isRecord(entry)) {
    throw new Error("Model catalog entry must be an object.");
  }
  const id = normalizeIdentifier(entry.id, "model id");
  const displayName = entry.displayName?.trim();
  const aliases = normalizeAliases(entry.aliases, id);
  const capabilities = normalizeCapabilities(entry.capabilities);
  const status = normalizeStatus(entry.status);
  const contextWindow = normalizePositiveInteger(entry.contextWindow, "contextWindow");
  const maxOutputTokens = normalizePositiveInteger(entry.maxOutputTokens, "maxOutputTokens");
  const metadata = normalizeMetadata(entry.metadata);
  const normalized: LoongProviderModelCatalogEntry = {
    id,
  };
  if (displayName) {
    normalized.displayName = trimBounded(displayName, MAX_DISPLAY_NAME_LENGTH);
  }
  if (aliases.length > 0) {
    normalized.aliases = Object.freeze(aliases);
  }
  if (contextWindow !== undefined) {
    normalized.contextWindow = contextWindow;
  }
  if (maxOutputTokens !== undefined) {
    normalized.maxOutputTokens = maxOutputTokens;
  }
  if (capabilities !== undefined) {
    normalized.capabilities = capabilities;
  }
  if (status !== undefined) {
    normalized.status = status;
  }
  if (entry.default !== undefined) {
    normalized.default = Boolean(entry.default);
  }
  if (metadata !== undefined) {
    normalized.metadata = metadata;
  }
  return Object.freeze(normalized);
}

function ensureDefaultModelEntry(
  entries: readonly LoongProviderModelCatalogEntry[],
  defaultModel: string,
  supportsToolCalling: boolean | undefined,
): LoongProviderModelCatalogEntry[] {
  const defaultId = normalizeIdentifier(defaultModel, "default model");
  const foundIndex = entries.findIndex(entry => entry.id === defaultId || entry.aliases?.includes(defaultId) === true);
  if (foundIndex === -1) {
    return [
      Object.freeze({
        id: defaultId,
        default: true,
        ...(supportsToolCalling !== undefined ? { capabilities: Object.freeze({ toolCalling: supportsToolCalling }) } : {}),
      }),
      ...entries,
    ];
  }
  return entries.map((entry, index) => index === foundIndex && entry.default !== true
    ? Object.freeze({ ...entry, default: true })
    : entry);
}

function normalizeAliases(values: readonly string[] | undefined, modelId: string): string[] {
  if (values === undefined) {
    return [];
  }
  if (!Array.isArray(values)) {
    throw new Error("Model aliases must be an array.");
  }
  if (values.length > MAX_ALIAS_COUNT) {
    throw new Error(`Model aliases can include at most ${MAX_ALIAS_COUNT} values.`);
  }
  const aliases: string[] = [];
  const seen = new Set<string>([modelId]);
  for (const value of values) {
    const alias = normalizeIdentifier(value, "model alias");
    if (seen.has(alias)) {
      continue;
    }
    seen.add(alias);
    aliases.push(alias);
  }
  return aliases;
}

function normalizeCapabilities(value: LoongModelCapabilities | undefined): LoongModelCapabilities | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("Model capabilities must be an object.");
  }
  const normalized: LoongModelCapabilities = {};
  copyBooleanCapability(value, normalized, "toolCalling");
  copyBooleanCapability(value, normalized, "streaming");
  copyBooleanCapability(value, normalized, "vision");
  copyBooleanCapability(value, normalized, "reasoning");
  copyBooleanCapability(value, normalized, "jsonMode");
  return Object.keys(normalized).length > 0 ? Object.freeze(normalized) : undefined;
}

function copyBooleanCapability(source: Record<string, unknown>, target: LoongModelCapabilities, key: keyof LoongModelCapabilities): void {
  const value = source[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Model capability "${key}" must be a boolean.`);
  }
  target[key] = value;
}

function normalizeStatus(value: LoongModelStatus | undefined): LoongModelStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !MODEL_STATUSES.has(value as LoongModelStatus)) {
    throw new Error("Model status must be stable, preview, deprecated, or unknown.");
  }
  return value as LoongModelStatus;
}

function normalizePositiveInteger(value: number | undefined, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Model ${fieldName} must be a positive safe integer.`);
  }
  return value;
}

function normalizeMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("Model metadata must be an object.");
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_METADATA_KEYS) {
    throw new Error(`Model metadata can include at most ${MAX_METADATA_KEYS} keys.`);
  }
  return Object.freeze({ ...value });
}

function normalizeIdentifier(value: string, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`Model catalog ${fieldName} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Model catalog ${fieldName} must not be empty.`);
  }
  if (normalized.length > MAX_ID_LENGTH) {
    throw new Error(`Model catalog ${fieldName} is too long.`);
  }
  if (/[\u0000-\u001f]/.test(normalized)) {
    throw new Error(`Model catalog ${fieldName} contains control characters.`);
  }
  return normalized;
}

function catalogKey(providerId: string, modelId: string): string {
  return `${providerId}\u0000${modelId}`;
}

function findProviderSeparator(modelRef: string): number {
  const slash = modelRef.indexOf("/");
  const colon = modelRef.indexOf(":");
  if (slash === -1) {
    return colon;
  }
  if (colon === -1) {
    return slash;
  }
  return Math.min(slash, colon);
}

function trimBounded(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
