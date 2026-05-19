import { lstat, mkdir, open, opendir, realpath, rm, stat, writeFile } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import type { ToolDefinition, ToolInvocation, ToolJsonSchema, ToolResult } from "@dragon/tools";

export interface SkillSummary {
  name: string;
  description: string;
  category?: string;
  path: string;
}

export interface LoadedSkill extends SkillSummary {
  content: string;
  references?: Array<{ path: string; content: string }>;
  metadata?: Record<string, unknown>;
}

export interface SkillEvidence {
  sessionId: string;
  observation: string;
  toolResults?: unknown[];
}

export interface SkillRuntime {
  list(): Promise<SkillSummary[]>;
  load(name: string): Promise<LoadedSkill | undefined>;
  create(skill: Omit<LoadedSkill, "path">): Promise<SkillSummary>;
  improve(name: string, evidence: SkillEvidence): Promise<void>;
}

export interface FileSkillRuntimeOptions {
  roots: string[];
  /** Writable skill root. Defaults to the first entry in `roots`. */
  writableRoot?: string;
  maxSkills?: number;
  maxDepth?: number;
  maxVisitedEntries?: number;
  maxSkillBytes?: number;
  maxReferences?: number;
  maxReferenceEntries?: number;
  maxReferenceBytes?: number;
}

export interface SkillListInput {
  query?: string;
  maxResults?: number;
}

export interface SkillListOutput {
  skills: SkillSummary[];
  total: number;
  truncated: boolean;
}

export interface SkillLoadInput {
  name: string;
}

export interface SkillLoadOutput {
  skill: LoadedSkill;
}

export interface SkillCreateInput {
  name: string;
  description: string;
  content: string;
  category?: string;
  references?: Array<{ path: string; content: string }>;
}

export interface SkillCreateOutput {
  skill: SkillSummary;
}

export interface SkillImproveInput {
  name: string;
  observation: string;
  toolResults?: unknown[];
}

export interface SkillImproveOutput {
  name: string;
  path: string;
  referencePath: string;
  improvedAt: string;
}

class SkillRuntimeError extends Error {
  readonly safeMessage: string;

  constructor(safeMessage: string) {
    super(safeMessage);
    this.name = "SkillRuntimeError";
    this.safeMessage = safeMessage;
  }
}

interface SkillIndexEntry {
  summary: SkillSummary;
  skillFile: string;
  root: string;
}

const DEFAULT_MAX_SKILLS = 80;
const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_MAX_VISITED_ENTRIES = 5000;
const DEFAULT_MAX_SKILL_BYTES = 128_000;
const DEFAULT_MAX_REFERENCES = 8;
const DEFAULT_MAX_REFERENCE_ENTRIES = 500;
const DEFAULT_MAX_REFERENCE_BYTES = 64_000;
const ABSOLUTE_MAX_SKILL_BYTES = 512_000;
const ABSOLUTE_MAX_REFERENCE_ENTRIES = 5_000;
const ABSOLUTE_MAX_REFERENCE_BYTES = 256_000;
const DEFAULT_SKILL_LIST_MAX_RESULTS = 20;
const ABSOLUTE_SKILL_LIST_MAX_RESULTS = 100;
const MAX_SKILL_NAME_CHARS = 120;
const ABSOLUTE_MAX_VISITED_ENTRIES = 20_000;
const MAX_EVIDENCE_JSON_BYTES = 8000;
const MAX_EVIDENCE_JSON_DEPTH = 8;
const MAX_EVIDENCE_ARRAY_ITEMS = 50;
const MAX_EVIDENCE_OBJECT_KEYS = 100;
const MAX_EVIDENCE_STRING_CHARS = 2000;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const skillListSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    query: { type: "string" },
    maxResults: { type: "number" },
  },
  additionalProperties: false,
};

const skillLoadSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
  },
  required: ["name"],
  additionalProperties: false,
};

const skillCreateSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    content: { type: "string" },
    category: { type: "string" },
    references: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  required: ["name", "description", "content"],
  additionalProperties: false,
};

const skillImproveSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    observation: { type: "string" },
    toolResults: { type: "array" },
  },
  required: ["name", "observation"],
  additionalProperties: false,
};

export function createFileSkillRuntime(options: FileSkillRuntimeOptions): SkillRuntime {
  return new FileSkillRuntime(options);
}

export function createSkillTools(runtime: SkillRuntime): ToolDefinition[] {
  return [
    createSkillListTool(runtime),
    createSkillLoadTool(runtime),
    createSkillCreateTool(runtime),
    createSkillImproveTool(runtime),
  ];
}

export function createSkillListTool(runtime: SkillRuntime): ToolDefinition<SkillListInput, SkillListOutput> {
  return {
    name: "skill_list",
    description: "List available Dragon skills from configured SKILL.md roots. Use this before loading a skill.",
    inputSchema: skillListSchema,
    capabilities: ["read"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseSkillListInput(invocation.input);
        const query = input.query?.toLowerCase();
        const maxResults = clampPositiveInteger(
          input.maxResults,
          DEFAULT_SKILL_LIST_MAX_RESULTS,
          ABSOLUTE_SKILL_LIST_MAX_RESULTS,
        );
        const allSkills = await runtime.list();
        const matches = query
          ? allSkills.filter(skill => skillMatchesQuery(skill, query))
          : allSkills;
        return {
          skills: matches.slice(0, maxResults),
          total: matches.length,
          truncated: matches.length > maxResults,
        };
      });
    },
  };
}

export function createSkillLoadTool(runtime: SkillRuntime): ToolDefinition<SkillLoadInput, SkillLoadOutput> {
  return {
    name: "skill_load",
    description: "Load one Dragon skill by name, including its SKILL.md content and bounded references.",
    inputSchema: skillLoadSchema,
    capabilities: ["read"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseSkillLoadInput(invocation.input);
        const skill = await runtime.load(input.name);
        if (!skill) {
          throw new SkillRuntimeError(`Skill not found: ${summarizeText(input.name, 80)}`);
        }
        return { skill };
      });
    },
  };
}

export function createSkillCreateTool(runtime: SkillRuntime): ToolDefinition<SkillCreateInput, SkillCreateOutput> {
  return {
    name: "skill_create",
    description: "Create a new Dragon skill as inspectable SKILL.md files when repeated work should be captured.",
    inputSchema: skillCreateSchema,
    capabilities: ["write"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseSkillCreateInput(invocation.input);
        const skill = await runtime.create({
          name: input.name,
          description: input.description,
          content: input.content,
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.references !== undefined ? { references: input.references } : {}),
        });
        return { skill };
      });
    },
  };
}

export function createSkillImproveTool(runtime: SkillRuntime): ToolDefinition<SkillImproveInput, SkillImproveOutput> {
  return {
    name: "skill_improve",
    description: "Append reviewable improvement evidence to an existing Dragon skill.",
    inputSchema: skillImproveSchema,
    capabilities: ["write"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseSkillImproveInput(invocation.input, invocation.sessionId);
        await runtime.improve(input.name, {
          sessionId: invocation.sessionId,
          observation: input.observation,
          ...(input.toolResults !== undefined ? { toolResults: input.toolResults } : {}),
        });
        const skill = await runtime.load(input.name);
        if (!skill) {
          throw new SkillRuntimeError(`Skill not found after improvement: ${summarizeText(input.name, 80)}`);
        }
        return {
          name: skill.name,
          path: skill.path,
          referencePath: `${path.posix.dirname(skill.path)}/references/improvements.md`,
          improvedAt: new Date().toISOString(),
        };
      });
    },
  };
}

async function safelyInvoke<TOutput>(
  invocation: ToolInvocation,
  fn: () => Promise<TOutput>,
): Promise<ToolResult<TOutput>> {
  try {
    return {
      id: invocation.id,
      ok: true,
      output: await fn(),
    };
  } catch (error) {
    return {
      id: invocation.id,
      ok: false,
      error: sanitizeToolError(error),
    };
  }
}

function parseSkillListInput(input: unknown): SkillListInput {
  if (input === undefined || input === null) {
    return {};
  }
  if (!isRecord(input)) {
    throw new SkillRuntimeError("skill_list input must be an object.");
  }
  const parsed: SkillListInput = {};
  if (typeof input.query === "string" && input.query.trim()) {
    parsed.query = input.query.trim();
  }
  if (typeof input.maxResults === "number") {
    parsed.maxResults = Math.max(1, Math.floor(input.maxResults));
  }
  return parsed;
}

function parseSkillLoadInput(input: unknown): SkillLoadInput {
  if (!isRecord(input) || typeof input.name !== "string" || !input.name.trim()) {
    throw new SkillRuntimeError("skill_load requires a non-empty name.");
  }
  const name = input.name.trim();
  if (name.length > MAX_SKILL_NAME_CHARS) {
    throw new SkillRuntimeError(`skill_load name must be ${MAX_SKILL_NAME_CHARS} characters or fewer.`);
  }
  return { name };
}

function parseSkillCreateInput(input: unknown): SkillCreateInput {
  if (!isRecord(input)) {
    throw new SkillRuntimeError("skill_create input must be an object.");
  }
  const name = parseBoundedText(input.name, "skill_create name", MAX_SKILL_NAME_CHARS);
  const description = parseBoundedText(input.description, "skill_create description", 500);
  const content = parseBoundedText(input.content, "skill_create content", ABSOLUTE_MAX_SKILL_BYTES);
  const parsed: SkillCreateInput = { name, description, content };
  if (typeof input.category === "string" && input.category.trim()) {
    parsed.category = parseBoundedText(input.category, "skill_create category", 80);
  }
  if (input.references !== undefined) {
    if (!Array.isArray(input.references)) {
      throw new SkillRuntimeError("skill_create references must be an array.");
    }
    if (input.references.length > DEFAULT_MAX_REFERENCES) {
      throw new SkillRuntimeError(`skill_create references must contain ${DEFAULT_MAX_REFERENCES} items or fewer.`);
    }
    parsed.references = input.references.map((reference, index) => {
      if (!isRecord(reference)) {
        throw new SkillRuntimeError(`skill_create references[${index}] must be an object.`);
      }
      return {
        path: parseBoundedText(reference.path, `skill_create references[${index}].path`, 200),
        content: parseBoundedText(reference.content, `skill_create references[${index}].content`, ABSOLUTE_MAX_REFERENCE_BYTES),
      };
    });
  }
  return parsed;
}

function parseSkillImproveInput(input: unknown, sessionId: string): SkillImproveInput {
  if (!isRecord(input)) {
    throw new SkillRuntimeError("skill_improve input must be an object.");
  }
  const parsed: SkillImproveInput = {
    name: parseBoundedText(input.name, "skill_improve name", MAX_SKILL_NAME_CHARS),
    observation: parseBoundedText(input.observation, "skill_improve observation", 8000),
  };
  if (input.toolResults !== undefined) {
    if (!Array.isArray(input.toolResults)) {
      throw new SkillRuntimeError("skill_improve toolResults must be an array.");
    }
    parsed.toolResults = input.toolResults.slice(0, 20).map((item, index) =>
      cloneEvidenceJson(item, `skill_improve toolResults[${index}]`)
    );
  }
  if (!sessionId.trim()) {
    throw new SkillRuntimeError("skill_improve requires a session id.");
  }
  return parsed;
}

function parseBoundedText(value: unknown, fieldName: string, maxChars: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SkillRuntimeError(`${fieldName} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxChars) {
    throw new SkillRuntimeError(`${fieldName} must be ${maxChars} characters or fewer.`);
  }
  return trimmed;
}

function skillMatchesQuery(skill: SkillSummary, query: string): boolean {
  return skill.name.toLowerCase().includes(query)
    || skill.description.toLowerCase().includes(query)
    || skill.category?.toLowerCase().includes(query) === true;
}

function sanitizeToolError(error: unknown): string {
  if (error instanceof SkillRuntimeError) {
    return summarizeText(error.safeMessage, 1000);
  }
  return "Skill tool failed.";
}

function summarizeText(value: string, maxChars: number): string {
  return value.length > maxChars
    ? `${value.slice(0, maxChars)}... [${value.length} chars]`
    : value;
}

export class FileSkillRuntime implements SkillRuntime {
  readonly #roots: string[];
  readonly #writableRootPath: string;
  readonly #maxSkills: number;
  readonly #maxDepth: number;
  readonly #maxVisitedEntries: number;
  readonly #maxSkillBytes: number;
  readonly #maxReferences: number;
  readonly #maxReferenceEntries: number;
  readonly #maxReferenceBytes: number;
  readonly #warnedDuplicates = new Set<string>();

  constructor(options: FileSkillRuntimeOptions) {
    if (options.roots.length === 0) {
      throw new Error("FileSkillRuntime requires at least one root.");
    }
    this.#roots = options.roots.map(root => path.resolve(root));
    this.#writableRootPath = path.resolve(options.writableRoot ?? this.#roots[0]!);
    if (!this.#roots.some(root => root === this.#writableRootPath)) {
      throw new Error("FileSkillRuntime writableRoot must be one of the configured roots.");
    }
    this.#maxSkills = clampPositiveInteger(options.maxSkills, DEFAULT_MAX_SKILLS, 500);
    this.#maxDepth = clampPositiveInteger(options.maxDepth, DEFAULT_MAX_DEPTH, 12);
    this.#maxVisitedEntries = clampPositiveInteger(
      options.maxVisitedEntries,
      DEFAULT_MAX_VISITED_ENTRIES,
      ABSOLUTE_MAX_VISITED_ENTRIES,
    );
    this.#maxSkillBytes = clampPositiveInteger(options.maxSkillBytes, DEFAULT_MAX_SKILL_BYTES, ABSOLUTE_MAX_SKILL_BYTES);
    this.#maxReferences = clampPositiveInteger(options.maxReferences, DEFAULT_MAX_REFERENCES, 40);
    this.#maxReferenceEntries = clampPositiveInteger(
      options.maxReferenceEntries,
      DEFAULT_MAX_REFERENCE_ENTRIES,
      ABSOLUTE_MAX_REFERENCE_ENTRIES,
    );
    this.#maxReferenceBytes = clampPositiveInteger(
      options.maxReferenceBytes,
      DEFAULT_MAX_REFERENCE_BYTES,
      ABSOLUTE_MAX_REFERENCE_BYTES,
    );
  }

  async list(): Promise<SkillSummary[]> {
    try {
      const entries = await this.#index();
      return entries.map(entry => entry.summary);
    } catch (error) {
      throw toSkillRuntimeError(error, "Failed to list skills.");
    }
  }

  async load(name: string): Promise<LoadedSkill | undefined> {
    try {
      const normalized = normalizeSkillName(name);
      const entries = await this.#index();
      const entry = entries.find(item => item.summary.name === normalized || item.summary.name.toLowerCase() === normalized.toLowerCase());
      if (!entry) {
        return undefined;
      }

      const content = await readBoundedTextFile(entry.skillFile, this.#maxSkillBytes);
      const references = await loadReferences(
        path.dirname(entry.skillFile),
        entry.root,
        this.#maxReferences,
        this.#maxReferenceEntries,
        this.#maxReferenceBytes,
      );
      const loaded: LoadedSkill = {
        ...entry.summary,
        content,
      };
      if (references.length > 0) {
        loaded.references = references;
      }
      return loaded;
    } catch (error) {
      throw toSkillRuntimeError(error, "Failed to load skill.");
    }
  }

  async create(skill: Omit<LoadedSkill, "path">): Promise<SkillSummary> {
    try {
      const root = await this.#resolveWritableRoot();
      const draft = normalizeSkillDraft(skill, this.#maxSkillBytes, this.#maxReferences, this.#maxReferenceBytes);
      const existing = await this.#index().catch(() => []);
      if (existing.some(entry => entry.summary.name === draft.name)) {
        throw new SkillRuntimeError(`Skill already exists: ${draft.name}`);
      }

      const skillDir = path.join(root, draft.name);
      await mkdir(skillDir, { recursive: false });
      // Roll back the just-created directory if any later step throws.
      // Without this, a partial create leaves an orphan empty/half-written
      // directory that blocks retry with "Skill already exists".
      let createdDir = true;
      try {
        const realSkillDir = await realpath(skillDir);
        if (!isPathInside(realSkillDir, root)) {
          throw new SkillRuntimeError("Skill directory escaped configured root.");
        }

        await writeFile(path.join(realSkillDir, "SKILL.md"), createSkillDocument(draft), { encoding: "utf8", flag: "wx" });
        if (draft.references !== undefined && draft.references.length > 0) {
          await writeSkillReferences(realSkillDir, root, draft.references, this.#maxReferenceBytes);
        }
        const summary = await parseSkillSummary(path.join(realSkillDir, "SKILL.md"), root, this.#maxSkillBytes);
        createdDir = false;
        return summary;
      } finally {
        if (createdDir) {
          try { await rm(skillDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        }
      }
    } catch (error) {
      throw toSkillRuntimeError(error, "Failed to create skill.");
    }
  }

  async improve(name: string, evidence: SkillEvidence): Promise<void> {
    try {
      const normalized = normalizeSkillName(name);
      const entries = await this.#index();
      const entry = entries.find(item => item.summary.name === normalized || item.summary.name.toLowerCase() === normalized.toLowerCase());
      if (!entry) {
        throw new SkillRuntimeError(`Skill not found: ${summarizeText(name, 80)}`);
      }
      const draft = normalizeSkillEvidence(evidence);
      const skillDir = path.dirname(entry.skillFile);
      const referencesDir = path.join(skillDir, "references");
      await mkdir(referencesDir, { recursive: true });
      const realReferencesDir = await realpath(referencesDir);
      if (!isPathInside(realReferencesDir, skillDir) || !isPathInside(realReferencesDir, entry.root)) {
        throw new SkillRuntimeError("Skill improvement reference path escaped configured root.");
      }
      const referencesDirStat = await safeDirectoryStat(realReferencesDir, "Skill improvement references");
      const improvement = formatSkillImprovement(draft);
      const improvementPath = path.join(realReferencesDir, "improvements.md");
      await appendTextFileSafely(
        improvementPath,
        realReferencesDir,
        referencesDirStat,
        improvement,
        this.#maxReferenceBytes,
        "Skill improvements",
        entry.skillFile,
      );
    } catch (error) {
      throw toSkillRuntimeError(error, "Failed to improve skill.");
    }
  }

  async #index(): Promise<SkillIndexEntry[]> {
    const entries: SkillIndexEntry[] = [];
    const resolvedRoots = await Promise.all(this.#roots.map(async root => await tryResolveSkillRoot(root)));
    const realRoots = resolvedRoots.filter((root): root is string => root !== undefined);
    const counter = { visited: 0 };
    for (const root of realRoots) {
      for await (const skillFile of findSkillFiles(
        root,
        root,
        this.#maxDepth,
        this.#maxSkills - entries.length,
        this.#maxVisitedEntries,
        counter,
      )) {
        const summary = await parseSkillSummary(skillFile, root, this.#maxSkillBytes);
        entries.push({ summary, skillFile, root });
        if (entries.length >= this.#maxSkills) {
          return this.#dedupeAndSortSkills(entries);
        }
      }
    }
    return this.#dedupeAndSortSkills(entries);
  }

  // Entries are appended in root order; the first-root winner keeps the
  // duplicate name. Warn once per duplicate so admins can diagnose unexpected
  // shadowing instead of silently picking one.
  #dedupeAndSortSkills(entries: SkillIndexEntry[]): SkillIndexEntry[] {
    const seen = new Map<string, SkillIndexEntry>();
    for (const entry of entries) {
      const key = entry.summary.name.toLowerCase();
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, entry);
        continue;
      }
      if (!this.#warnedDuplicates.has(key)) {
        this.#warnedDuplicates.add(key);
        console.warn(
          `[dragon-skills] duplicate skill "${entry.summary.name}" — keeping ${path.relative(process.cwd(), existing.skillFile)}, ignoring ${path.relative(process.cwd(), entry.skillFile)}`,
        );
      }
    }
    return sortSkills([...seen.values()]);
  }

  async #resolveWritableRoot(): Promise<string> {
    const root = this.#writableRootPath;
    if (root === undefined) {
      throw new SkillRuntimeError("FileSkillRuntime requires at least one root.");
    }
    await mkdir(root, { recursive: true });
    const resolved = await realpath(root);
    const rootStat = await stat(resolved);
    if (!rootStat.isDirectory()) {
      throw new SkillRuntimeError("Configured skill root is not a directory.");
    }
    return resolved;
  }
}

async function tryResolveSkillRoot(root: string): Promise<string | undefined> {
  try {
    const resolved = await realpath(root);
    const rootStat = await stat(resolved);
    if (!rootStat.isDirectory()) {
      throw new SkillRuntimeError("Configured skill root is not a directory.");
    }
    return resolved;
  } catch (error) {
    if (error instanceof SkillRuntimeError) {
      throw error;
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw new SkillRuntimeError("Configured skill root is unavailable.");
  }
}

function toSkillRuntimeError(error: unknown, fallbackMessage: string): SkillRuntimeError {
  return error instanceof SkillRuntimeError
    ? error
    : new SkillRuntimeError(fallbackMessage);
}

async function* findSkillFiles(
  root: string,
  current: string,
  maxDepth: number,
  remaining: number,
  maxVisitedEntries: number,
  counter: { visited: number },
  depth = 0,
): AsyncGenerator<string> {
  if (remaining <= 0 || depth > maxDepth || !isPathInside(current, root)) {
    return;
  }

  countVisitedEntry(counter, maxVisitedEntries);

  const currentStat = await stat(current);
  if (!currentStat.isDirectory()) {
    return;
  }

  const entries = await readDirectoryEntries(current, maxVisitedEntries, counter);
  if (entries.some(entry => entry.isFile() && entry.name === "SKILL.md")) {
    yield path.join(current, "SKILL.md");
    return;
  }

  for (const entry of entries) {
    if (remaining <= 0) {
      return;
    }
    if (!entry.isDirectory() || entry.isSymbolicLink() || shouldSkipDirectory(entry.name)) {
      continue;
    }
    const child = path.join(current, entry.name);
    if (!isPathInside(child, root)) {
      continue;
    }
    for await (const skillFile of findSkillFiles(
      root,
      child,
      maxDepth,
      remaining,
      maxVisitedEntries,
      counter,
      depth + 1,
    )) {
      remaining -= 1;
      yield skillFile;
      if (remaining <= 0) {
        return;
      }
    }
  }
}

async function parseSkillSummary(skillFile: string, root: string, maxBytes: number): Promise<SkillSummary> {
  const content = await readBoundedTextFile(skillFile, maxBytes);
  const frontmatter = parseFrontmatter(content);
  const heading = firstMarkdownHeading(content);
  const directoryName = path.basename(path.dirname(skillFile));
  const name = normalizeSkillName(readString(frontmatter.name) ?? heading ?? directoryName);
  const description = readString(frontmatter.description) ?? firstParagraph(content) ?? "";
  const summary: SkillSummary = {
    name,
    description: description.slice(0, 500),
    path: toPosixPath(path.relative(root, skillFile)),
  };
  const category = readString(frontmatter.category);
  if (category !== undefined) {
    summary.category = category;
  }
  return summary;
}

async function loadReferences(
  skillDir: string,
  root: string,
  maxReferences: number,
  maxReferenceEntries: number,
  maxBytes: number,
): Promise<Array<{ path: string; content: string }>> {
  const referencesDir = path.join(skillDir, "references");
  let realReferencesDir: string;
  try {
    realReferencesDir = await realpath(referencesDir);
  } catch {
    return [];
  }

  const realRoot = await realpath(root);
  if (!isPathInside(realReferencesDir, realRoot)) {
    throw new SkillRuntimeError("Skill references escape configured root.");
  }

  const references: Array<{ path: string; content: string }> = [];
  const entries = await readDirectoryEntries(
    realReferencesDir,
    maxReferenceEntries,
    { visited: 0 },
    "Skill references scan",
  );
  for (const entry of entries) {
    if (references.length >= maxReferences) {
      break;
    }
    if (!entry.isFile() || entry.isSymbolicLink() || !isSupportedReferenceFile(entry.name)) {
      continue;
    }
    const filePath = path.join(realReferencesDir, entry.name);
    const realFilePath = await realpath(filePath);
    if (!isPathInside(realFilePath, realRoot)) {
      continue;
    }
    references.push({
      path: toPosixPath(path.relative(root, realFilePath)),
      content: await readBoundedTextFile(realFilePath, maxBytes),
    });
  }
  return references;
}

interface NormalizedSkillDraft {
  name: string;
  description: string;
  content: string;
  category?: string;
  references?: Array<{ path: string; content: string }>;
}

function normalizeSkillDraft(
  skill: Omit<LoadedSkill, "path">,
  maxSkillBytes: number,
  maxReferences: number,
  maxReferenceBytes: number,
): NormalizedSkillDraft {
  const name = normalizeSkillName(skill.name);
  const description = parseBoundedText(skill.description, "skill description", 500);
  const content = parseBoundedText(skill.content, "skill content", maxSkillBytes);
  if (Buffer.byteLength(content, "utf8") > maxSkillBytes) {
    throw new SkillRuntimeError(`Skill content must be ${maxSkillBytes} bytes or fewer.`);
  }
  const draft: NormalizedSkillDraft = {
    name,
    description,
    content,
  };
  if (skill.category !== undefined) {
    draft.category = parseBoundedText(skill.category, "skill category", 80);
  }
  if (skill.references !== undefined) {
    if (skill.references.length > maxReferences) {
      throw new SkillRuntimeError(`Skill can include ${maxReferences} references or fewer.`);
    }
    const seen = new Set<string>();
    draft.references = skill.references.map(reference => {
      const referencePath = normalizeReferenceWritePath(reference.path);
      if (seen.has(referencePath)) {
        throw new SkillRuntimeError(`Duplicate skill reference: ${referencePath}`);
      }
      seen.add(referencePath);
      const referenceContent = parseBoundedText(reference.content, `skill reference ${referencePath}`, maxReferenceBytes);
      if (Buffer.byteLength(referenceContent, "utf8") > maxReferenceBytes) {
        throw new SkillRuntimeError(`Skill reference ${referencePath} must be ${maxReferenceBytes} bytes or fewer.`);
      }
      return { path: referencePath, content: referenceContent };
    });
  }
  return draft;
}

function createSkillDocument(skill: NormalizedSkillDraft): string {
  const frontmatter = [
    "---",
    `name: ${JSON.stringify(skill.name)}`,
    `description: ${JSON.stringify(skill.description)}`,
    ...(skill.category !== undefined ? [`category: ${JSON.stringify(skill.category)}`] : []),
    "---",
  ].join("\n");
  const heading = firstMarkdownHeading(skill.content) ? "" : `\n\n# ${skill.name}\n`;
  return `${frontmatter}${heading}\n\n${skill.content.trim()}\n`;
}

async function writeSkillReferences(
  skillDir: string,
  root: string,
  references: Array<{ path: string; content: string }>,
  maxReferenceBytes: number,
): Promise<void> {
  const referencesDir = path.join(skillDir, "references");
  await mkdir(referencesDir, { recursive: true });
  const realReferencesDir = await realpath(referencesDir);
  if (!isPathInside(realReferencesDir, skillDir) || !isPathInside(realReferencesDir, root)) {
    throw new SkillRuntimeError("Skill references escaped configured root.");
  }

  for (const reference of references) {
    const filePath = path.join(realReferencesDir, reference.path);
    const parentDir = path.dirname(filePath);
    await mkdir(parentDir, { recursive: true });
    const realParentDir = await realpath(parentDir);
    if (!isPathInside(realParentDir, realReferencesDir)) {
      throw new SkillRuntimeError("Skill reference escaped references directory.");
    }
    const content = `${reference.content.trim()}\n`;
    if (Buffer.byteLength(content, "utf8") > maxReferenceBytes) {
      throw new SkillRuntimeError(`Skill reference ${reference.path} must be ${maxReferenceBytes} bytes or fewer.`);
    }
    await writeFile(path.join(realParentDir, path.basename(reference.path)), content, { encoding: "utf8", flag: "wx" });
  }
}

function normalizeReferenceWritePath(value: string): string {
  if (path.isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.startsWith("\\\\")) {
    throw new SkillRuntimeError("Skill reference path must be relative.");
  }
  // Normalize separators first, then detect any newly-revealed absolute
  // forms (e.g. "\foo" -> "/foo", "C:\bar" -> "C:/bar") so cross-platform
  // inputs cannot bypass the relative-path checks below.
  const trimmed = value.trim().replace(/\\/g, "/").replace(/^references\//, "");
  if (trimmed.startsWith("/") || /^[a-zA-Z]:/.test(trimmed)) {
    throw new SkillRuntimeError("Skill reference path must be relative.");
  }
  if (!trimmed || trimmed.includes("\0") || trimmed.split("/").some(part => part === "" || part === "." || part === "..")) {
    throw new SkillRuntimeError("Skill reference path must stay inside references/.");
  }
  if (trimmed.includes("/")) {
    throw new SkillRuntimeError("Skill reference path must be a file directly under references/.");
  }
  if (!isSupportedReferenceFile(trimmed)) {
    throw new SkillRuntimeError("Skill reference file type is not supported.");
  }
  return trimmed;
}

function normalizeSkillEvidence(evidence: SkillEvidence): SkillEvidence {
  const sessionId = parseBoundedText(evidence.sessionId, "skill evidence sessionId", 200);
  const observation = parseBoundedText(evidence.observation, "skill evidence observation", 8000);
  const normalized: SkillEvidence = { sessionId, observation };
  if (evidence.toolResults !== undefined) {
    if (!Array.isArray(evidence.toolResults)) {
      throw new SkillRuntimeError("Skill evidence toolResults must be an array.");
    }
    normalized.toolResults = evidence.toolResults.slice(0, 20).map((item, index) =>
      cloneEvidenceJson(item, `skill evidence toolResults[${index}]`)
    );
  }
  return normalized;
}

function formatSkillImprovement(evidence: SkillEvidence): string {
  const lines = [
    "",
    `## ${new Date().toISOString()}`,
    "",
    `Session: ${evidence.sessionId}`,
    "",
    evidence.observation.trim(),
    "",
  ];
  if (evidence.toolResults !== undefined && evidence.toolResults.length > 0) {
    lines.push("Tool results:", "", "```json", safeEvidenceJson(evidence.toolResults), "```", "");
  }
  return `${lines.join("\n")}\n`;
}

function safeEvidenceJson(value: unknown): string {
  try {
    const json = JSON.stringify(value, undefined, 2);
    if (!json || Buffer.byteLength(json, "utf8") > MAX_EVIDENCE_JSON_BYTES) {
      return "[truncated]";
    }
    return json;
  } catch {
    return "[unserializable]";
  }
}

async function appendTextFileSafely(
  filePath: string,
  rootDir: string,
  rootDirStat: Stats,
  text: string,
  maxBytes: number,
  label: string,
  protectedFilePath?: string,
): Promise<void> {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) {
    throw new SkillRuntimeError(`${label} entry is larger than ${maxBytes} bytes.`);
  }
  if (!isPathInside(path.resolve(filePath), rootDir)) {
    throw new SkillRuntimeError(`${label} file escaped references directory.`);
  }

  try {
    await assertDirectoryUnchanged(rootDir, rootDirStat, label);
    const initialStat = await lstat(filePath).catch(error => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    });

    if (initialStat !== undefined) {
      validateAppendPathStat(initialStat, label);
      await appendToExistingTextFile(filePath, rootDir, rootDirStat, initialStat, text, bytes, maxBytes, label, protectedFilePath);
      return;
    }

    await appendToNewTextFile(filePath, rootDir, rootDirStat, text, bytes, maxBytes, label, protectedFilePath);
  } catch (error) {
    throw error instanceof SkillRuntimeError
      ? error
      : new SkillRuntimeError(`${label} is unavailable.`);
  }
}

function validateAppendPathStat(fileStat: Stats, label: string): void {
  if (fileStat.isSymbolicLink()) {
    throw new SkillRuntimeError(`${label} file must not be a symbolic link.`);
  }
  if (!fileStat.isFile()) {
    throw new SkillRuntimeError(`${label} path must be a file.`);
  }
  if (fileStat.nlink > 1) {
    throw new SkillRuntimeError(`${label} file must not be a hard link.`);
  }
}

async function appendToExistingTextFile(
  filePath: string,
  rootDir: string,
  rootDirStat: Stats,
  initialStat: Stats,
  text: string,
  bytes: number,
  maxBytes: number,
  label: string,
  protectedFilePath: string | undefined,
): Promise<void> {
  const handle = await open(filePath, "a+");
  try {
    const fileStat = await handle.stat();
    await assertDirectoryUnchanged(rootDir, rootDirStat, label);
    validateAppendPathStat(fileStat, label);
    if (!isSameStat(initialStat, fileStat)) {
      throw new SkillRuntimeError(`${label} file changed while opening.`);
    }
    if (protectedFilePath !== undefined && await isSameFile(fileStat, protectedFilePath)) {
      throw new SkillRuntimeError(`${label} file must not be the skill document.`);
    }
    if (fileStat.size + bytes > maxBytes) {
      throw new SkillRuntimeError(`${label} would exceed ${maxBytes} bytes.`);
    }
    const currentPathStat = await lstat(filePath);
    await assertDirectoryUnchanged(rootDir, rootDirStat, label);
    if (!isSameStat(currentPathStat, fileStat)) {
      throw new SkillRuntimeError(`${label} file changed before writing.`);
    }
    await handle.writeFile(text, "utf8");
  } finally {
    await handle.close();
  }
}

async function appendToNewTextFile(
  filePath: string,
  rootDir: string,
  rootDirStat: Stats,
  text: string,
  bytes: number,
  maxBytes: number,
  label: string,
  protectedFilePath: string | undefined,
): Promise<void> {
  const handle = await open(filePath, "wx");
  try {
    const fileStat = await handle.stat();
    await assertDirectoryUnchanged(rootDir, rootDirStat, label);
    validateAppendPathStat(fileStat, label);
    if (protectedFilePath !== undefined && await isSameFile(fileStat, protectedFilePath)) {
      throw new SkillRuntimeError(`${label} file must not be the skill document.`);
    }
    if (fileStat.size + bytes > maxBytes) {
      throw new SkillRuntimeError(`${label} would exceed ${maxBytes} bytes.`);
    }
    const currentPathStat = await lstat(filePath);
    await assertDirectoryUnchanged(rootDir, rootDirStat, label);
    if (!isSameStat(currentPathStat, fileStat)) {
      throw new SkillRuntimeError(`${label} file changed before writing.`);
    }
    await handle.writeFile(text, "utf8");
  } finally {
    await handle.close();
  }
}

function isSameStat(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function safeDirectoryStat(directoryPath: string, label: string): Promise<Stats> {
  const directoryStat = await lstat(directoryPath);
  if (directoryStat.isSymbolicLink()) {
    throw new SkillRuntimeError(`${label} directory must not be a symbolic link.`);
  }
  if (!directoryStat.isDirectory()) {
    throw new SkillRuntimeError(`${label} path must be a directory.`);
  }
  return directoryStat;
}

async function assertDirectoryUnchanged(directoryPath: string, expected: Stats, label: string): Promise<void> {
  const current = await safeDirectoryStat(directoryPath, label);
  if (!isSameStat(current, expected)) {
    throw new SkillRuntimeError(`${label} directory changed before writing.`);
  }
}

async function isSameFile(fileStat: Stats, otherPath: string): Promise<boolean> {
  try {
    const otherStat = await stat(otherPath);
    return isSameStat(fileStat, otherStat);
  } catch {
    return false;
  }
}

type EvidenceJsonValue =
  | null
  | string
  | number
  | boolean
  | EvidenceJsonValue[]
  | { [key: string]: EvidenceJsonValue };

function cloneEvidenceJson(value: unknown, source: string): EvidenceJsonValue {
  const cloned = cloneEvidenceJsonValue(value, source);
  const serialized = JSON.stringify(cloned);
  if (!serialized || Buffer.byteLength(serialized, "utf8") > MAX_EVIDENCE_JSON_BYTES) {
    throw new SkillRuntimeError(`${source} is too large.`);
  }
  return cloned;
}

function cloneEvidenceJsonValue(
  value: unknown,
  source: string,
  seen = new WeakSet<object>(),
  depth = 0,
): EvidenceJsonValue {
  if (depth > MAX_EVIDENCE_JSON_DEPTH) {
    throw new SkillRuntimeError(`${source} is too deeply nested.`);
  }
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > MAX_EVIDENCE_STRING_CHARS
      ? `${value.slice(0, MAX_EVIDENCE_STRING_CHARS)}... [truncated]`
      : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SkillRuntimeError(`${source} must be JSON-safe.`);
    }
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_EVIDENCE_ARRAY_ITEMS) {
      throw new SkillRuntimeError(`${source} has too many array items.`);
    }
    if (seen.has(value)) {
      throw new SkillRuntimeError(`${source} must not contain circular references.`);
    }
    seen.add(value);
    const clone = value.map((item, index) => cloneEvidenceJsonValue(item, `${source}[${index}]`, seen, depth + 1));
    seen.delete(value);
    return clone;
  }
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new SkillRuntimeError(`${source} must be a plain JSON object.`);
    }
    if (seen.has(value)) {
      throw new SkillRuntimeError(`${source} must not contain circular references.`);
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_EVIDENCE_OBJECT_KEYS) {
      throw new SkillRuntimeError(`${source} has too many object keys.`);
    }
    seen.add(value);
    const clone: Record<string, EvidenceJsonValue> = {};
    for (const [key, item] of entries) {
      clone[key] = cloneEvidenceJsonValue(item, `${source}.${key}`, seen, depth + 1);
    }
    seen.delete(value);
    return clone;
  }
  throw new SkillRuntimeError(`${source} must be JSON-safe.`);
}

async function readBoundedTextFile(filePath: string, maxBytes: number): Promise<string> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new SkillRuntimeError("Not a skill file.");
  }
  if (fileStat.size > maxBytes) {
    throw new SkillRuntimeError(`Refusing to load file larger than ${maxBytes} bytes.`);
  }

  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) {
      throw new SkillRuntimeError(`Refusing to load file larger than ${maxBytes} bytes.`);
    }
    const slice = buffer.subarray(0, bytesRead);
    if (slice.includes(0)) {
      throw new SkillRuntimeError("Refusing to load likely binary skill file.");
    }
    try {
      return utf8Decoder.decode(slice);
    } catch {
      throw new SkillRuntimeError("Refusing to load invalid UTF-8 skill file.");
    }
  } finally {
    await file.close();
  }
}

function countVisitedEntry(counter: { visited: number }, maxVisitedEntries: number, label = "Skill scan"): void {
  counter.visited += 1;
  if (counter.visited > maxVisitedEntries) {
    throw new SkillRuntimeError(`${label} exceeded ${maxVisitedEntries} visited entries.`);
  }
}

async function readDirectoryEntries(
  directoryPath: string,
  maxVisitedEntries: number,
  counter: { visited: number },
  label?: string,
): Promise<Dirent[]> {
  const entries: Dirent[] = [];
  const directory = await opendir(directoryPath);
  for await (const entry of directory) {
    countVisitedEntry(counter, maxVisitedEntries, label);
    entries.push(entry);
  }
  return sortDirents(entries);
}

function sortDirents<T extends { name: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => compareNames(a.name, b.name));
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return {};
  }
  const normalized = content.replace(/\r\n/g, "\n");
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return {};
  }
  const body = normalized.slice(4, end);
  const result: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key) && value) {
      result[key] = value;
    }
  }
  return result;
}

function firstMarkdownHeading(content: string): string | undefined {
  const line = content.split(/\r?\n/).find(item => item.startsWith("# "));
  return line?.slice(2).trim() || undefined;
}

function firstParagraph(content: string): string | undefined {
  const normalized = content.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "");
  for (const block of normalized.split(/\n{2,}/)) {
    const text = block.trim();
    if (!text || text.startsWith("#")) {
      continue;
    }
    return text.replace(/\s+/g, " ");
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeSkillName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new SkillRuntimeError("Skill name cannot be empty.");
  }
  return normalized;
}

function shouldSkipDirectory(name: string): boolean {
  return name === "node_modules" || name === ".git" || name === "dist" || name === ".next";
}

function isSupportedReferenceFile(name: string): boolean {
  return [".md", ".txt", ".json", ".yaml", ".yml"].includes(path.extname(name).toLowerCase());
}

function sortSkills(entries: SkillIndexEntry[]): SkillIndexEntry[] {
  return [...entries].sort((a, b) => compareNames(a.summary.name, b.summary.name));
}

function compareNames(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampPositiveInteger(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(1, Math.floor(value)), max);
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
