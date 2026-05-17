import { createHash, randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, open, opendir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  DragonContextProvider,
  DragonLifecycleHook,
  DragonLifecycleHookRequest,
  DragonTrajectoryRecord,
  DragonTrajectoryStore,
} from "@dragon/core";
import type { ToolDefinition, ToolInvocation, ToolJsonSchema, ToolResult } from "@dragon/tools";

export interface MemoryRecord {
  id: string;
  scope: "user" | "project" | "session" | "skill";
  content: string;
  source?: string;
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number;
  reason?: string;
}

export interface MemoryStore {
  remember(record: Omit<MemoryRecord, "id" | "createdAt">): Promise<MemoryRecord>;
  get(id: string): Promise<MemoryRecord | undefined>;
  search(query: string, limit?: number): Promise<MemorySearchResult[]>;
}

export interface FileMemoryStoreOptions {
  rootDir?: string;
  maxRecords?: number;
  maxRecordBytes?: number;
  maxFileBytes?: number;
}

export interface SqliteMemoryStoreOptions {
  rootDir?: string;
  databasePath?: string;
  maxRecords?: number;
  maxRecordBytes?: number;
  maxDatabaseBytes?: number;
}

export interface FileTrajectoryStoreOptions {
  rootDir?: string;
  maxEvents?: number;
  maxFiles?: number;
  maxRecordBytes?: number;
  maxFileBytes?: number;
}

export interface TrajectoryListFilter {
  runId?: string;
  sessionId?: string;
  status?: DragonTrajectoryRecord["status"];
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface TrajectoryRecordSummary {
  runId: string;
  sessionId: string;
  source: DragonTrajectoryRecord["source"];
  createdAt: string;
  completedAt: string;
  status: DragonTrajectoryRecord["status"];
  userPreview: string;
  assistantPreview?: string;
  errorPreview?: string;
  eventCount: number;
}

export interface TrajectoryListResult {
  trajectories: TrajectoryRecordSummary[];
  truncated: boolean;
}

export interface TrajectoryStore extends DragonTrajectoryStore {
  list(filter?: TrajectoryListFilter): Promise<TrajectoryListResult>;
  get(runId: string, filter?: Pick<TrajectoryListFilter, "sessionId" | "dateFrom" | "dateTo">): Promise<DragonTrajectoryRecord | undefined>;
}

export interface MemorySearchInput {
  query: string;
  limit?: number;
}

export interface MemorySearchOutput {
  query: string;
  results: MemorySearchResult[];
}

export interface MemoryRememberInput {
  scope: MemoryRecord["scope"];
  content: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryRememberOutput {
  record: MemoryRecord;
}

export interface TrajectoryListInput extends TrajectoryListFilter {}

export interface TrajectoryListOutput extends TrajectoryListResult {}

export interface TrajectoryGetInput {
  runId: string;
  maxEvents?: number;
}

export interface TrajectoryGetOutput {
  record: DragonTrajectoryRecord;
  eventsTruncated: boolean;
}

export interface MemoryContextProviderOptions {
  store: MemoryStore;
  limit?: number;
  maxContentChars?: number;
}

export interface MarkdownMemoryContextProviderOptions {
  rootDir?: string;
  maxContentChars?: number;
  maxFileBytes?: number;
  maxDailyNotes?: number;
}

export interface SessionCompactionContextProviderOptions {
  rootDir?: string;
  recentMessages?: number;
  maxMessages?: number;
  maxContentChars?: number;
  maxFileBytes?: number;
}

export interface MemoryCandidateLifecycleHookOptions {
  rootDir?: string;
  maxContentChars?: number;
  maxCandidateBytes?: number;
  maxFileBytes?: number;
}

export interface MemoryCandidateToolsOptions {
  rootDir?: string;
  store: MemoryStore;
  maxFiles?: number;
  maxFileBytes?: number;
  maxCandidateBytes?: number;
}

export type MemoryCandidateStatus = "pending" | "promoted" | "rejected";

export interface MemoryCandidateRecord {
  id: string;
  sessionId: string;
  runId: string;
  source: SessionSource;
  scope: MemoryRecord["scope"];
  content: string;
  reason: string;
  status: MemoryCandidateStatus;
  createdAt: string;
  reviewedAt?: string;
  reviewedByRunId?: string;
  promotedMemoryId?: string;
  rejectionReason?: string;
  workspace?: string;
  assistantPreview?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryCandidateListInput {
  status?: MemoryCandidateStatus | "all";
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface MemoryCandidateListOutput {
  candidates: MemoryCandidateRecord[];
  truncated: boolean;
}

export interface MemoryCandidatePromoteInput {
  id: string;
  scope?: MemoryRecord["scope"];
  content?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryCandidatePromoteOutput {
  candidate: MemoryCandidateRecord;
  record: MemoryRecord;
}

export interface MemoryCandidateRejectInput {
  id: string;
  reason?: string;
}

export interface MemoryCandidateRejectOutput {
  candidate: MemoryCandidateRecord;
}

export interface FileSessionStoreOptions {
  rootDir?: string;
  maxHistoryMessages?: number;
}

export type SessionSource = "cli" | "gateway" | "web" | "ide" | "cron" | "api";

export interface SessionMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface SessionUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface SessionTurnRecord {
  sessionId: string;
  runId: string;
  source: SessionSource;
  createdAt: string;
  status: "ok" | "error" | "cancelled" | "timeout";
  messages: SessionMessage[];
  workspace?: string;
  usage?: SessionUsage;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionStore {
  loadMessages(sessionId: string): Promise<SessionMessage[]>;
  appendTurn(record: SessionTurnRecord): Promise<void>;
}

class MemoryToolError extends Error {
  readonly safeMessage: string;

  constructor(safeMessage: string) {
    super(safeMessage);
    this.name = "MemoryToolError";
    this.safeMessage = safeMessage;
  }
}

const DEFAULT_MAX_HISTORY_MESSAGES = 80;
const ABSOLUTE_MAX_HISTORY_MESSAGES = 500;
const DEFAULT_MAX_MEMORY_RECORDS = 5000;
const ABSOLUTE_MAX_MEMORY_RECORDS = 50_000;
const DEFAULT_MAX_MEMORY_RECORD_BYTES = 16_000;
const ABSOLUTE_MAX_MEMORY_RECORD_BYTES = 128_000;
const DEFAULT_MAX_MEMORY_FILE_BYTES = 16 * 1024 * 1024;
const ABSOLUTE_MAX_MEMORY_FILE_BYTES = 128 * 1024 * 1024;
const DEFAULT_MEMORY_SEARCH_LIMIT = 10;
const ABSOLUTE_MEMORY_SEARCH_LIMIT = 50;
const DEFAULT_MEMORY_CONTEXT_LIMIT = 5;
const DEFAULT_MEMORY_CONTEXT_CHARS = 4000;
const ABSOLUTE_MEMORY_CONTEXT_CHARS = 12_000;
const DEFAULT_MARKDOWN_MEMORY_CONTEXT_CHARS = 6000;
const ABSOLUTE_MARKDOWN_MEMORY_CONTEXT_CHARS = 20_000;
const DEFAULT_MARKDOWN_MEMORY_FILE_BYTES = 64 * 1024;
const ABSOLUTE_MARKDOWN_MEMORY_FILE_BYTES = 1024 * 1024;
const DEFAULT_MARKDOWN_DAILY_NOTES = 3;
const ABSOLUTE_MARKDOWN_DAILY_NOTES = 30;
const MARKDOWN_DAILY_NOTE_SCAN_LIMIT = 1000;
const DEFAULT_SESSION_COMPACTION_RECENT_MESSAGES = DEFAULT_MAX_HISTORY_MESSAGES;
const ABSOLUTE_SESSION_COMPACTION_RECENT_MESSAGES = ABSOLUTE_MAX_HISTORY_MESSAGES;
const DEFAULT_SESSION_COMPACTION_MESSAGES = 24;
const ABSOLUTE_SESSION_COMPACTION_MESSAGES = 100;
const DEFAULT_SESSION_COMPACTION_CHARS = 6000;
const ABSOLUTE_SESSION_COMPACTION_CHARS = 20_000;
const DEFAULT_SESSION_COMPACTION_FILE_BYTES = 8 * 1024 * 1024;
const ABSOLUTE_SESSION_COMPACTION_FILE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MEMORY_CANDIDATE_CHARS = 1200;
const ABSOLUTE_MEMORY_CANDIDATE_CHARS = 4000;
const DEFAULT_MEMORY_CANDIDATE_BYTES = 12_000;
const ABSOLUTE_MEMORY_CANDIDATE_BYTES = 64_000;
const DEFAULT_MEMORY_CANDIDATE_FILE_BYTES = 4 * 1024 * 1024;
const ABSOLUTE_MEMORY_CANDIDATE_FILE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MEMORY_CANDIDATE_FILES = 366;
const ABSOLUTE_MEMORY_CANDIDATE_FILES = 5000;
const DEFAULT_MEMORY_CANDIDATE_LIST_LIMIT = 20;
const ABSOLUTE_MEMORY_CANDIDATE_LIST_LIMIT = 100;
const DEFAULT_MAX_TRAJECTORY_EVENTS = 200;
const ABSOLUTE_MAX_TRAJECTORY_EVENTS = 2000;
const DEFAULT_MAX_TRAJECTORY_FILES = 366;
const ABSOLUTE_MAX_TRAJECTORY_FILES = 5000;
const TOOL_MAX_TRAJECTORY_FILES = 31;
const TOOL_MAX_TRAJECTORY_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_TRAJECTORY_RECORD_BYTES = 1024 * 1024;
const ABSOLUTE_MAX_TRAJECTORY_RECORD_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TRAJECTORY_FILE_BYTES = 64 * 1024 * 1024;
const ABSOLUTE_MAX_TRAJECTORY_FILE_BYTES = 256 * 1024 * 1024;
const DEFAULT_TRAJECTORY_LIST_LIMIT = 20;
const ABSOLUTE_TRAJECTORY_LIST_LIMIT = 100;
const DEFAULT_TRAJECTORY_GET_MAX_EVENTS = 200;
const ABSOLUTE_TRAJECTORY_GET_MAX_EVENTS = 2000;
const DEFAULT_TRAJECTORY_TOOL_DATE_WINDOW_DAYS = 30;
const memoryCandidateReviewLocks = new Set<string>();

const memorySearchSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    query: { type: "string" },
    limit: { type: "number" },
  },
  required: ["query"],
  additionalProperties: false,
};

const memoryRememberSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    scope: { type: "string", enum: ["user", "project", "session", "skill"] },
    content: { type: "string" },
    source: { type: "string" },
    metadata: { type: "object" },
  },
  required: ["scope", "content"],
  additionalProperties: false,
};

const memoryCandidateListSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["pending", "promoted", "rejected", "all"] },
    dateFrom: { type: "string" },
    dateTo: { type: "string" },
    limit: { type: "number" },
  },
  additionalProperties: false,
};

const memoryCandidatePromoteSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    scope: { type: "string", enum: ["user", "project", "session", "skill"] },
    content: { type: "string" },
    source: { type: "string" },
    metadata: { type: "object" },
  },
  required: ["id"],
  additionalProperties: false,
};

const memoryCandidateRejectSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    reason: { type: "string" },
  },
  required: ["id"],
  additionalProperties: false,
};

const trajectoryListSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ok", "error", "cancelled", "timeout"] },
    dateFrom: { type: "string" },
    dateTo: { type: "string" },
    limit: { type: "number" },
  },
  additionalProperties: false,
};

const trajectoryGetSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    runId: { type: "string" },
    maxEvents: { type: "number" },
  },
  required: ["runId"],
  additionalProperties: false,
};

export function createFileMemoryStore(options: FileMemoryStoreOptions = {}): MemoryStore {
  return new FileMemoryStore(options);
}

export function createSqliteMemoryStore(options: SqliteMemoryStoreOptions = {}): MemoryStore {
  return new SqliteMemoryStore(options);
}

export function createFileTrajectoryStore(options: FileTrajectoryStoreOptions = {}): TrajectoryStore {
  return new FileTrajectoryStore(options);
}

export function createMemoryTools(store: MemoryStore): ToolDefinition[] {
  return [
    createMemorySearchTool(store),
    createMemoryRememberTool(store),
  ];
}

export function createMemoryCandidateTools(options: MemoryCandidateToolsOptions): ToolDefinition[] {
  return [
    createMemoryCandidateListTool(options),
    createMemoryCandidatePromoteTool(options),
    createMemoryCandidateRejectTool(options),
  ];
}

export function createTrajectoryTools(store: TrajectoryStore): ToolDefinition[] {
  const toolStore = limitTrajectoryStoreForTools(store);
  return [
    createTrajectoryListTool(toolStore),
    createTrajectoryGetTool(toolStore),
  ];
}

export function createMemoryContextProvider(options: MemoryContextProviderOptions): DragonContextProvider {
  const limit = clampPositiveInteger(
    options.limit,
    DEFAULT_MEMORY_CONTEXT_LIMIT,
    ABSOLUTE_MEMORY_SEARCH_LIMIT,
  );
  const maxContentChars = clampPositiveInteger(
    options.maxContentChars,
    DEFAULT_MEMORY_CONTEXT_CHARS,
    ABSOLUTE_MEMORY_CONTEXT_CHARS,
  );

  return {
    name: "memory_recall",
    async buildContext(request) {
      const results = await options.store.search(request.input.message, limit);
      if (results.length === 0) {
        return [];
      }
      const content = summarizeMemoryResults(results, maxContentChars);
      return content
        ? [{
            title: "Relevant durable memory",
            content,
            priority: 10,
            metadata: { resultCount: results.length },
          }]
        : [];
    },
  };
}

export function createMarkdownMemoryContextProvider(
  options: MarkdownMemoryContextProviderOptions = {},
): DragonContextProvider {
  const rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "memory"));
  const maxContentChars = clampPositiveInteger(
    options.maxContentChars,
    DEFAULT_MARKDOWN_MEMORY_CONTEXT_CHARS,
    ABSOLUTE_MARKDOWN_MEMORY_CONTEXT_CHARS,
  );
  const maxFileBytes = clampPositiveInteger(
    options.maxFileBytes,
    DEFAULT_MARKDOWN_MEMORY_FILE_BYTES,
    ABSOLUTE_MARKDOWN_MEMORY_FILE_BYTES,
  );
  const maxDailyNotes = clampPositiveInteger(
    options.maxDailyNotes,
    DEFAULT_MARKDOWN_DAILY_NOTES,
    ABSOLUTE_MARKDOWN_DAILY_NOTES,
  );

  return {
    name: "markdown_memory",
    async buildContext() {
      const sections = await loadMarkdownMemorySections(rootDir, maxFileBytes, maxDailyNotes);
      if (sections.length === 0) {
        return [];
      }
      const content = fitText(
        sections.map(section => `## ${section.label}\n${section.content}`).join("\n\n"),
        maxContentChars,
        "[markdown memory truncated]",
      );
      return content
        ? [{
            title: "Human-readable memory",
            content,
            priority: 20,
            metadata: { rootDir, sectionCount: sections.length },
          }]
        : [];
    },
  };
}

export function createSessionCompactionContextProvider(
  options: SessionCompactionContextProviderOptions = {},
): DragonContextProvider {
  const rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "sessions"));
  const recentMessages = clampPositiveInteger(
    options.recentMessages,
    DEFAULT_SESSION_COMPACTION_RECENT_MESSAGES,
    ABSOLUTE_SESSION_COMPACTION_RECENT_MESSAGES,
  );
  const maxMessages = clampPositiveInteger(
    options.maxMessages,
    DEFAULT_SESSION_COMPACTION_MESSAGES,
    ABSOLUTE_SESSION_COMPACTION_MESSAGES,
  );
  const maxContentChars = clampPositiveInteger(
    options.maxContentChars,
    DEFAULT_SESSION_COMPACTION_CHARS,
    ABSOLUTE_SESSION_COMPACTION_CHARS,
  );
  const maxFileBytes = clampPositiveInteger(
    options.maxFileBytes,
    DEFAULT_SESSION_COMPACTION_FILE_BYTES,
    ABSOLUTE_SESSION_COMPACTION_FILE_BYTES,
  );

  return {
    name: "session_compaction",
    async buildContext(request) {
      const records = await readSessionTurnRecords(rootDir, request.input.sessionId, maxFileBytes);
      if (records.length === 0) {
        return [];
      }
      const messages = records
        .flatMap(record => record.messages)
        .filter(message => message.role === "user" || message.role === "assistant");
      const compactableCount = Math.max(0, messages.length - recentMessages);
      if (compactableCount === 0) {
        return [];
      }
      const compacted = compactSessionMessages(
        messages.slice(0, compactableCount),
        maxMessages,
        maxContentChars,
      );
      const content = compacted.messages.map(formatCompactedSessionMessage).join("\n");
      return content
        ? [{
            title: "Older session context",
            content,
            priority: 15,
            metadata: {
              compactedMessages: compacted.messages.length,
              omittedOlderMessages: compacted.omittedMessages,
              recentMessages,
              ...(compacted.truncated ? { truncated: true } : {}),
            },
          }]
        : [];
    },
  };
}

export function createMemoryCandidateLifecycleHook(
  options: MemoryCandidateLifecycleHookOptions = {},
): DragonLifecycleHook {
  const rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "memory"));
  const maxContentChars = clampPositiveInteger(
    options.maxContentChars,
    DEFAULT_MEMORY_CANDIDATE_CHARS,
    ABSOLUTE_MEMORY_CANDIDATE_CHARS,
  );
  const maxCandidateBytes = clampPositiveInteger(
    options.maxCandidateBytes,
    DEFAULT_MEMORY_CANDIDATE_BYTES,
    ABSOLUTE_MEMORY_CANDIDATE_BYTES,
  );
  const maxFileBytes = clampPositiveInteger(
    options.maxFileBytes,
    DEFAULT_MEMORY_CANDIDATE_FILE_BYTES,
    ABSOLUTE_MEMORY_CANDIDATE_FILE_BYTES,
  );

  return {
    name: "memory_candidate_capture",
    async onLifecycle(request) {
      const candidate = buildMemoryCandidate(request, maxContentChars);
      if (!candidate) {
        return;
      }
      const serialized = stringifyMemoryCandidate(candidate, maxCandidateBytes);
      const filePath = memoryCandidatePath(rootDir, candidate.createdAt);
      await mkdir(path.dirname(filePath), { recursive: true });
      await assertSafeMemoryCandidateDirectory(path.dirname(filePath));
      await assertCanAppendRegularFile(
        filePath,
        Buffer.byteLength(`${serialized}\n`, "utf8"),
        maxFileBytes,
        "Memory candidate file",
      );
      await appendFile(filePath, `${serialized}\n`, "utf8");
    },
  };
}

export function createMemorySearchTool(store: MemoryStore): ToolDefinition<MemorySearchInput, MemorySearchOutput> {
  return {
    name: "memory_search",
    description: "Search Dragon's durable local memory for relevant prior facts or project context.",
    inputSchema: memorySearchSchema,
    capabilities: ["read", "memory"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const input = parseMemorySearchInput(invocation.input);
        const results = await store.search(input.query, input.limit);
        return {
          query: input.query,
          results,
        };
      });
    },
  };
}

export function createMemoryRememberTool(store: MemoryStore): ToolDefinition<MemoryRememberInput, MemoryRememberOutput> {
  return {
    name: "memory_remember",
    description: "Store a durable Dragon memory record when the user asks to remember a stable fact or project note.",
    inputSchema: memoryRememberSchema,
    capabilities: ["write", "memory"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const input = parseMemoryRememberInput(invocation.input);
        const record = await store.remember(input);
        return { record };
      });
    },
  };
}

export function createMemoryCandidateListTool(
  options: MemoryCandidateToolsOptions,
): ToolDefinition<MemoryCandidateListInput, MemoryCandidateListOutput> {
  const rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "memory"));
  const maxFiles = clampPositiveInteger(options.maxFiles, DEFAULT_MEMORY_CANDIDATE_FILES, ABSOLUTE_MEMORY_CANDIDATE_FILES);
  const maxFileBytes = clampPositiveInteger(
    options.maxFileBytes,
    DEFAULT_MEMORY_CANDIDATE_FILE_BYTES,
    ABSOLUTE_MEMORY_CANDIDATE_FILE_BYTES,
  );
  return {
    name: "memory_candidates_list",
    description: "List reviewable Dragon memory candidates without promoting them into durable memory.",
    inputSchema: memoryCandidateListSchema,
    capabilities: ["read", "memory"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const input = parseMemoryCandidateListInput(invocation.input);
        return await listMemoryCandidates(rootDir, input, maxFiles, maxFileBytes);
      });
    },
  };
}

export function createMemoryCandidatePromoteTool(
  options: MemoryCandidateToolsOptions,
): ToolDefinition<MemoryCandidatePromoteInput, MemoryCandidatePromoteOutput> {
  const rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "memory"));
  const maxFiles = clampPositiveInteger(options.maxFiles, DEFAULT_MEMORY_CANDIDATE_FILES, ABSOLUTE_MEMORY_CANDIDATE_FILES);
  const maxFileBytes = clampPositiveInteger(
    options.maxFileBytes,
    DEFAULT_MEMORY_CANDIDATE_FILE_BYTES,
    ABSOLUTE_MEMORY_CANDIDATE_FILE_BYTES,
  );
  const maxCandidateBytes = clampPositiveInteger(
    options.maxCandidateBytes,
    DEFAULT_MEMORY_CANDIDATE_BYTES,
    ABSOLUTE_MEMORY_CANDIDATE_BYTES,
  );
  return {
    name: "memory_candidate_promote",
    description: "Promote one pending memory candidate into durable memory after user review.",
    inputSchema: memoryCandidatePromoteSchema,
    capabilities: ["write", "memory"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const input = parseMemoryCandidatePromoteInput(invocation.input);
        return await withMemoryCandidateReviewLock(input.id, async () => {
          const current = await findMemoryCandidate(rootDir, input.id, maxFiles, maxFileBytes);
          if (current.record.status !== "pending") {
            throw new MemoryToolError(`Memory candidate is already ${current.record.status}.`);
          }
          const draft = memoryDraftFromCandidate(current.record, input, invocation);
          const memoryRecord = await options.store.remember(draft);
          const promoted = await rewriteMemoryCandidate(rootDir, current.filePath, input.id, maxFileBytes, maxCandidateBytes, candidate => {
            const updated: MemoryCandidateRecord = {
              ...candidate,
              status: "promoted",
              reviewedAt: new Date().toISOString(),
              promotedMemoryId: memoryRecord.id,
            };
            const runId = readInvocationRunId(invocation);
            if (runId !== undefined) {
              updated.reviewedByRunId = runId;
            }
            return updated;
          });
          return {
            candidate: promoted,
            record: memoryRecord,
          };
        });
      });
    },
  };
}

export function createMemoryCandidateRejectTool(
  options: MemoryCandidateToolsOptions,
): ToolDefinition<MemoryCandidateRejectInput, MemoryCandidateRejectOutput> {
  const rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "memory"));
  const maxFiles = clampPositiveInteger(options.maxFiles, DEFAULT_MEMORY_CANDIDATE_FILES, ABSOLUTE_MEMORY_CANDIDATE_FILES);
  const maxFileBytes = clampPositiveInteger(
    options.maxFileBytes,
    DEFAULT_MEMORY_CANDIDATE_FILE_BYTES,
    ABSOLUTE_MEMORY_CANDIDATE_FILE_BYTES,
  );
  const maxCandidateBytes = clampPositiveInteger(
    options.maxCandidateBytes,
    DEFAULT_MEMORY_CANDIDATE_BYTES,
    ABSOLUTE_MEMORY_CANDIDATE_BYTES,
  );
  return {
    name: "memory_candidate_reject",
    description: "Mark one pending memory candidate as rejected after review without storing durable memory.",
    inputSchema: memoryCandidateRejectSchema,
    capabilities: ["write", "memory"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const input = parseMemoryCandidateRejectInput(invocation.input);
        return await withMemoryCandidateReviewLock(input.id, async () => {
          const current = await findMemoryCandidate(rootDir, input.id, maxFiles, maxFileBytes);
          if (current.record.status !== "pending") {
            throw new MemoryToolError(`Memory candidate is already ${current.record.status}.`);
          }
          const rejected = await rewriteMemoryCandidate(rootDir, current.filePath, input.id, maxFileBytes, maxCandidateBytes, candidate => {
            const updated: MemoryCandidateRecord = {
              ...candidate,
              status: "rejected",
              reviewedAt: new Date().toISOString(),
            };
            const runId = readInvocationRunId(invocation);
            if (runId !== undefined) {
              updated.reviewedByRunId = runId;
            }
            if (input.reason !== undefined) {
              updated.rejectionReason = input.reason;
            }
            return updated;
          });
          return { candidate: rejected };
        });
      });
    },
  };
}

export function createTrajectoryListTool(store: TrajectoryStore): ToolDefinition<TrajectoryListInput, TrajectoryListOutput> {
  return {
    name: "trajectory_list",
    description: "List recent Dragon trajectory records as bounded summaries for review or debugging.",
    inputSchema: trajectoryListSchema,
    capabilities: ["read", "memory"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const input = withInvocationSession(parseTrajectoryListInput(invocation.input), invocation.sessionId);
        return await store.list(input);
      });
    },
  };
}

export function createTrajectoryGetTool(store: TrajectoryStore): ToolDefinition<TrajectoryGetInput, TrajectoryGetOutput> {
  return {
    name: "trajectory_get",
    description: "Load one Dragon trajectory record by runId, optionally limiting returned events.",
    inputSchema: trajectoryGetSchema,
    capabilities: ["read", "memory"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const input = parseTrajectoryGetInput(invocation.input);
        const sessionId = normalizeOptionalText(invocation.sessionId, "sessionId", 200);
        const record = await store.get(input.runId, { sessionId });
        if (!record) {
          throw new MemoryToolError(`Trajectory not found: ${summarizeText(input.runId, 80)}`);
        }
        const maxEvents = clampPositiveInteger(
          input.maxEvents,
          DEFAULT_TRAJECTORY_GET_MAX_EVENTS,
          ABSOLUTE_TRAJECTORY_GET_MAX_EVENTS,
        );
        const eventsTruncated = record.events.length > maxEvents;
        return {
          record: eventsTruncated
            ? { ...record, events: record.events.slice(-maxEvents) }
            : record,
          eventsTruncated,
        };
      });
    },
  };
}

function limitTrajectoryStoreForTools(store: TrajectoryStore): TrajectoryStore {
  if (store instanceof FileTrajectoryStore) {
    return store.forToolQueries();
  }
  return store;
}

export class FileMemoryStore implements MemoryStore {
  readonly #rootDir: string;
  readonly #filePath: string;
  readonly #maxRecords: number;
  readonly #maxRecordBytes: number;
  readonly #maxFileBytes: number;

  constructor(options: FileMemoryStoreOptions = {}) {
    this.#rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "memory"));
    this.#filePath = path.join(this.#rootDir, "records.jsonl");
    this.#maxRecords = clampPositiveInteger(
      options.maxRecords,
      DEFAULT_MAX_MEMORY_RECORDS,
      ABSOLUTE_MAX_MEMORY_RECORDS,
    );
    this.#maxRecordBytes = clampPositiveInteger(
      options.maxRecordBytes,
      DEFAULT_MAX_MEMORY_RECORD_BYTES,
      ABSOLUTE_MAX_MEMORY_RECORD_BYTES,
    );
    this.#maxFileBytes = clampPositiveInteger(
      options.maxFileBytes,
      DEFAULT_MAX_MEMORY_FILE_BYTES,
      ABSOLUTE_MAX_MEMORY_FILE_BYTES,
    );
  }

  async remember(record: Omit<MemoryRecord, "id" | "createdAt">): Promise<MemoryRecord> {
    validateMemoryDraft(record, this.#maxRecordBytes);
    const now = new Date().toISOString();
    const memoryRecord: MemoryRecord = {
      id: createMemoryId(record, now),
      scope: record.scope,
      content: record.content,
      createdAt: now,
    };
    if (record.source !== undefined) {
      memoryRecord.source = record.source;
    }
    if (record.updatedAt !== undefined) {
      memoryRecord.updatedAt = record.updatedAt;
    }
    if (record.metadata !== undefined) {
      memoryRecord.metadata = record.metadata;
    }

    const serialized = stringifyMemoryRecord(memoryRecord, this.#maxRecordBytes);
    await assertCanAppendFile(this.#filePath, Buffer.byteLength(`${serialized}\n`, "utf8"), this.#maxFileBytes, "Memory file");
    await mkdir(this.#rootDir, { recursive: true });
    await appendFile(this.#filePath, `${serialized}\n`, "utf8");
    return memoryRecord;
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    if (!id.trim()) {
      throw new Error("Memory id cannot be empty.");
    }
    const records = await this.#readRecords();
    return records.find(record => record.id === id);
  }

  async search(query: string, limit?: number): Promise<MemorySearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new Error("Memory search query cannot be empty.");
    }
    const maxResults = clampPositiveInteger(limit, DEFAULT_MEMORY_SEARCH_LIMIT, ABSOLUTE_MEMORY_SEARCH_LIMIT);
    const queryTokens = tokenize(normalizedQuery);

    const records = await this.#readRecords();
    return records
      .map(record => scoreMemoryRecord(record, normalizedQuery, queryTokens))
      .filter((result): result is MemorySearchResult => result !== undefined)
      .sort((a, b) => b.score - a.score || b.record.createdAt.localeCompare(a.record.createdAt))
      .slice(0, maxResults);
  }

  async #readRecords(): Promise<MemoryRecord[]> {
    let content: string;
    try {
      const fileStat = await stat(this.#filePath);
      if (fileStat.size > this.#maxFileBytes) {
        throw new Error(`Memory file is larger than ${this.#maxFileBytes} bytes.`);
      }
      content = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const lines = content.split(/\r?\n/).filter(line => line.trim());
    const selectedLines = lines.slice(-this.#maxRecords);
    const records: MemoryRecord[] = [];
    for (const [index, line] of selectedLines.entries()) {
      records.push(parseMemoryRecord(line, index + 1));
    }
    return records;
  }
}

async function readSessionTurnRecords(
  rootDir: string,
  sessionId: string,
  maxFileBytes: number,
): Promise<SessionTurnRecord[]> {
  const filePath = sessionPath(rootDir, sessionId);
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    return [];
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    return [];
  }
  if (before.size > maxFileBytes) {
    return [];
  }

  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, "r");
  } catch {
    return [];
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileStat(before, opened)) {
      return [];
    }
    if (opened.size > maxFileBytes) {
      return [];
    }
    const after = await lstat(filePath);
    if (!after.isFile() || after.isSymbolicLink() || !sameFileStat(opened, after)) {
      return [];
    }
    const buffer = Buffer.alloc(maxFileBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxFileBytes) {
      return [];
    }
    const content = buffer.subarray(0, bytesRead).toString("utf8");
    const records: SessionTurnRecord[] = [];
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const record = parseTurnRecord(trimmed, index + 1, filePath);
      if (record.sessionId !== sessionId) {
        return [];
      }
      records.push(record);
    }
    return records;
  } catch {
    return [];
  } finally {
    await handle.close();
  }
}

interface CompactedSessionMessages {
  messages: SessionMessage[];
  omittedMessages: number;
  truncated: boolean;
}

function compactSessionMessages(
  compactableMessages: SessionMessage[],
  maxMessages: number,
  maxContentChars: number,
): CompactedSessionMessages {
  const selected: SessionMessage[] = [];
  let chars = 0;
  let truncated = false;
  for (let index = compactableMessages.length - 1; index >= 0; index -= 1) {
    if (selected.length >= maxMessages) {
      truncated = true;
      break;
    }
    const message = compactableMessages[index];
    if (message === undefined) {
      continue;
    }
    const line = formatCompactedSessionMessage(message);
    const separatorChars = selected.length > 0 ? 1 : 0;
    if (chars + separatorChars + line.length > maxContentChars) {
      truncated = true;
      break;
    }
    selected.push(message);
    chars += separatorChars + line.length;
  }
  selected.reverse();
  return {
    messages: selected,
    omittedMessages: Math.max(0, compactableMessages.length - selected.length),
    truncated,
  };
}

function formatCompactedSessionMessage(message: SessionMessage): string {
  const timestamp = message.createdAt ? ` at ${message.createdAt}` : "";
  const content = summarizeText(message.content.replace(/\s+/g, " ").trim(), 500);
  return `- ${message.role}${timestamp}: ${content}`;
}

interface MarkdownMemorySection {
  label: string;
  content: string;
}

interface SafeMarkdownDirectory {
  path: string;
  stat: Awaited<ReturnType<typeof lstat>>;
}

async function loadMarkdownMemorySections(
  rootDir: string,
  maxFileBytes: number,
  maxDailyNotes: number,
): Promise<MarkdownMemorySection[]> {
  const memoryRoot = await resolveSafeMarkdownDirectory(rootDir);
  if (memoryRoot === undefined) {
    return [];
  }

  const sections: MarkdownMemorySection[] = [];
  for (const fileName of ["USER.md", "PROJECT.md", "MEMORY.md"]) {
    const content = await readMarkdownMemoryFile(memoryRoot, fileName, maxFileBytes);
    if (content !== undefined) {
      sections.push({ label: fileName, content });
    }
  }
  const notesRoot = await resolveSafeMarkdownDirectory(path.join(memoryRoot.path, "notes"), memoryRoot);
  const dailyNoteNames = notesRoot === undefined
    ? []
    : await listDailyMarkdownNotes(notesRoot, maxDailyNotes);
  for (const fileName of dailyNoteNames) {
    const content = notesRoot === undefined
      ? undefined
      : await readMarkdownMemoryFile(notesRoot, fileName, maxFileBytes);
    if (content !== undefined) {
      sections.push({ label: `notes/${fileName}`, content });
    }
  }
  return sections;
}

async function resolveSafeMarkdownDirectory(
  directoryPath: string,
  parent?: SafeMarkdownDirectory,
): Promise<SafeMarkdownDirectory | undefined> {
  const resolvedPath = path.resolve(directoryPath);
  if (parent !== undefined && !isPathInside(resolvedPath, parent.path)) {
    return undefined;
  }
  if (parent !== undefined && !await sameDirectoryRef(parent)) {
    return undefined;
  }

  let directoryStat: Awaited<ReturnType<typeof lstat>>;
  try {
    directoryStat = await lstat(resolvedPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    return undefined;
  }
  return { path: resolvedPath, stat: directoryStat };
}

async function sameDirectoryRef(directory: SafeMarkdownDirectory): Promise<boolean> {
  try {
    const current = await lstat(directory.path);
    return current.isDirectory() && !current.isSymbolicLink() && sameFileStat(directory.stat, current);
  } catch {
    return false;
  }
}

async function listDailyMarkdownNotes(notesDir: SafeMarkdownDirectory, maxDailyNotes: number): Promise<string[]> {
  const names: string[] = [];
  let directory: Awaited<ReturnType<typeof opendir>>;
  try {
    if (!await sameDirectoryRef(notesDir)) {
      return [];
    }
    directory = await opendir(notesDir.path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    return [];
  }

  let scanned = 0;
  for await (const entry of directory) {
    scanned += 1;
    if (scanned > MARKDOWN_DAILY_NOTE_SCAN_LIMIT) {
      break;
    }
    if (entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/i.test(entry.name)) {
      names.push(entry.name);
    }
  }
  return names.sort((a, b) => b.localeCompare(a)).slice(0, maxDailyNotes);
}

async function readMarkdownMemoryFile(
  rootDir: SafeMarkdownDirectory,
  fileName: string,
  maxFileBytes: number,
): Promise<string | undefined> {
  if (path.isAbsolute(fileName) || fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    return undefined;
  }
  if (!await sameDirectoryRef(rootDir)) {
    return undefined;
  }
  const rootPath = rootDir.path;
  const filePath = path.resolve(rootPath, fileName);
  if (!isPathInside(filePath, rootPath)) {
    return undefined;
  }

  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    return undefined;
  }
  if (before.size > maxFileBytes) {
    return `[omitted: file exceeds ${maxFileBytes} bytes]`;
  }

  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, "r");
  } catch {
    return undefined;
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileStat(before, opened)) {
      return undefined;
    }
    if (opened.size > maxFileBytes) {
      return `[omitted: file exceeds ${maxFileBytes} bytes]`;
    }
    const after = await lstat(filePath);
    if (!after.isFile() || after.isSymbolicLink() || !sameFileStat(opened, after)) {
      return undefined;
    }
    if (!await sameDirectoryRef(rootDir)) {
      return undefined;
    }
    const buffer = Buffer.alloc(maxFileBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxFileBytes) {
      return `[omitted: file exceeds ${maxFileBytes} bytes]`;
    }
    const content = buffer.subarray(0, bytesRead).toString("utf8");
    return content.trim() ? content.trim() : undefined;
  } finally {
    await handle.close();
  }
}

export class SqliteMemoryStore implements MemoryStore {
  readonly #rootDir: string;
  readonly #databasePath: string;
  readonly #memoryOnly: boolean;
  readonly #maxRecords: number;
  readonly #maxRecordBytes: number;
  readonly #maxDatabaseBytes: number;
  #database: DatabaseSync | undefined;
  #databasePromise: Promise<DatabaseSync> | undefined;

  constructor(options: SqliteMemoryStoreOptions = {}) {
    const defaultRootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "memory"));
    this.#memoryOnly = options.databasePath === ":memory:";
    this.#databasePath = this.#memoryOnly
      ? ":memory:"
      : path.resolve(options.databasePath ?? path.join(defaultRootDir, "memory.sqlite"));
    this.#rootDir = this.#memoryOnly ? defaultRootDir : path.dirname(this.#databasePath);
    this.#maxRecords = clampPositiveInteger(
      options.maxRecords,
      DEFAULT_MAX_MEMORY_RECORDS,
      ABSOLUTE_MAX_MEMORY_RECORDS,
    );
    this.#maxRecordBytes = clampPositiveInteger(
      options.maxRecordBytes,
      DEFAULT_MAX_MEMORY_RECORD_BYTES,
      ABSOLUTE_MAX_MEMORY_RECORD_BYTES,
    );
    this.#maxDatabaseBytes = clampPositiveInteger(
      options.maxDatabaseBytes,
      DEFAULT_MAX_MEMORY_FILE_BYTES,
      ABSOLUTE_MAX_MEMORY_FILE_BYTES,
    );
  }

  async remember(record: Omit<MemoryRecord, "id" | "createdAt">): Promise<MemoryRecord> {
    validateMemoryDraft(record, this.#maxRecordBytes);
    const now = new Date().toISOString();
    const memoryRecord: MemoryRecord = {
      id: createMemoryId(record, now),
      scope: record.scope,
      content: record.content,
      createdAt: now,
    };
    if (record.source !== undefined) {
      memoryRecord.source = record.source;
    }
    if (record.updatedAt !== undefined) {
      memoryRecord.updatedAt = record.updatedAt;
    }
    if (record.metadata !== undefined) {
      memoryRecord.metadata = record.metadata;
    }
    stringifyMemoryRecord(memoryRecord, this.#maxRecordBytes);
    await this.#assertDatabaseCanGrowBy(Buffer.byteLength(memoryRecord.content, "utf8"));

    const database = await this.#getDatabase();
    const metadataJson = memoryRecord.metadata === undefined ? null : stringifyJson(memoryRecord.metadata);
    try {
      database.exec("BEGIN IMMEDIATE");
      database.prepare(`
        INSERT INTO memory_records (
          id, scope, content, source, created_at, updated_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        memoryRecord.id,
        memoryRecord.scope,
        memoryRecord.content,
        memoryRecord.source ?? null,
        memoryRecord.createdAt,
        memoryRecord.updatedAt ?? null,
        metadataJson,
      );
      database.prepare(`
        INSERT INTO memory_records_fts (id, scope, source, content)
        VALUES (?, ?, ?, ?)
      `).run(
        memoryRecord.id,
        memoryRecord.scope,
        memoryRecord.source ?? "",
        memoryRecord.content,
      );
      this.#pruneOldRecords(database);
      this.#assertOpenDatabaseWithinLimit(database);
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the original SQLite failure.
      }
      throw error;
    }
    return memoryRecord;
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    const normalizedId = id.trim();
    if (!normalizedId) {
      throw new Error("Memory id cannot be empty.");
    }
    const database = await this.#getDatabase();
    const row = database.prepare(`
      SELECT id, scope, content, source, created_at, updated_at, metadata_json
      FROM memory_records
      WHERE id = ?
    `).get(normalizedId);
    return row === undefined ? undefined : sqliteRowToMemoryRecord(row, "memory_records");
  }

  async search(query: string, limit?: number): Promise<MemorySearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new Error("Memory search query cannot be empty.");
    }
    const maxResults = clampPositiveInteger(limit, DEFAULT_MEMORY_SEARCH_LIMIT, ABSOLUTE_MEMORY_SEARCH_LIMIT);
    const database = await this.#getDatabase();
    const queryTokens = tokenize(normalizedQuery);
    const ftsQuery = toSafeFtsQuery(queryTokens);
    if (!ftsQuery) {
      return this.#searchLike(database, normalizedQuery, maxResults);
    }

    const rows = database.prepare(`
      SELECT
        r.id,
        r.scope,
        r.content,
        r.source,
        r.created_at,
        r.updated_at,
        r.metadata_json,
        bm25(memory_records_fts) AS rank
      FROM memory_records_fts
      JOIN memory_records r ON r.id = memory_records_fts.id
      WHERE memory_records_fts MATCH ?
      ORDER BY rank, r.created_at DESC
      LIMIT ?
    `).all(ftsQuery, maxResults);

    return rows.map(row => {
      const rank = typeof row.rank === "number" ? row.rank : 0;
      return {
        record: sqliteRowToMemoryRecord(row, "memory_records_fts"),
        score: sqliteRankToScore(rank),
        reason: `Matched SQLite FTS tokens: ${queryTokens.slice(0, 8).join(", ")}.`,
      };
    });
  }

  close(): void {
    this.#database?.close();
    this.#database = undefined;
    this.#databasePromise = undefined;
  }

  async #assertDatabaseCanGrowBy(bytesToAppend: number): Promise<void> {
    if (this.#memoryOnly) {
      return;
    }
    try {
      const databaseStat = await stat(this.#databasePath);
      if (databaseStat.size + bytesToAppend > this.#maxDatabaseBytes) {
        throw new MemoryToolError(`SQLite memory database would exceed ${this.#maxDatabaseBytes} bytes.`);
      }
    } catch (error) {
      if (error instanceof MemoryToolError) {
        throw error;
      }
      if (isNodeError(error) && error.code === "ENOENT") {
        if (bytesToAppend > this.#maxDatabaseBytes) {
          throw new MemoryToolError(`SQLite memory database would exceed ${this.#maxDatabaseBytes} bytes.`);
        }
        return;
      }
      throw new MemoryToolError("SQLite memory database is unavailable.");
    }
  }

  #pruneOldRecords(database: DatabaseSync): void {
    const countRow = database.prepare("SELECT COUNT(*) AS count FROM memory_records").get();
    const count = typeof countRow?.count === "number" ? countRow.count : 0;
    const deleteCount = count - this.#maxRecords;
    if (deleteCount <= 0) {
      return;
    }
    database.prepare(`
      DELETE FROM memory_records_fts
      WHERE id IN (
        SELECT id FROM memory_records
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      )
    `).run(deleteCount);
    database.prepare(`
      DELETE FROM memory_records
      WHERE id IN (
        SELECT id FROM memory_records
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      )
    `).run(deleteCount);
  }

  #assertOpenDatabaseWithinLimit(database: DatabaseSync): void {
    if (this.#memoryOnly) {
      return;
    }
    const pageCount = readSqlitePragmaNumber(database, "PRAGMA page_count", "page_count");
    const pageSize = readSqlitePragmaNumber(database, "PRAGMA page_size", "page_size");
    if (pageCount * pageSize > this.#maxDatabaseBytes) {
      throw new MemoryToolError(`SQLite memory database would exceed ${this.#maxDatabaseBytes} bytes.`);
    }
  }

  async #searchLike(
    database: DatabaseSync,
    query: string,
    maxResults: number,
  ): Promise<MemorySearchResult[]> {
    const pattern = `%${escapeSqlLike(query)}%`;
    const rows = database.prepare(`
      SELECT id, scope, content, source, created_at, updated_at, metadata_json
      FROM memory_records
      WHERE content LIKE ? ESCAPE '\\'
        OR scope LIKE ? ESCAPE '\\'
        OR COALESCE(source, '') LIKE ? ESCAPE '\\'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(pattern, pattern, pattern, maxResults);

    return rows.map(row => ({
      record: sqliteRowToMemoryRecord(row, "memory_records_like"),
      score: 1,
      reason: "Matched SQLite fallback LIKE query.",
    }));
  }

  async #getDatabase(): Promise<DatabaseSync> {
    if (this.#database !== undefined) {
      return this.#database;
    }
    if (this.#databasePromise === undefined) {
      this.#databasePromise = this.#openDatabase().then(
        database => {
          this.#database = database;
          return database;
        },
        error => {
          this.#databasePromise = undefined;
          throw error;
        },
      );
    }
    return await this.#databasePromise;
  }

  async #openDatabase(): Promise<DatabaseSync> {
    if (!this.#memoryOnly) {
      await mkdir(this.#rootDir, { recursive: true });
    }
    let sqlite: typeof import("node:sqlite");
    try {
      sqlite = await import("node:sqlite");
    } catch (error) {
      throw new Error(
        `SQLite memory backend requires Node.js node:sqlite support: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let database: DatabaseSync | undefined;
    try {
      database = new sqlite.DatabaseSync(this.#databasePath, {
        timeout: 2000,
      });
      database.exec(`
        PRAGMA journal_mode = DELETE;
        PRAGMA busy_timeout = 2000;
        CREATE TABLE IF NOT EXISTS memory_records (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          content TEXT NOT NULL,
          source TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          metadata_json TEXT
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_records_fts
        USING fts5(id UNINDEXED, scope, source, content);
      `);
    } catch (error) {
      database?.close();
      throw new Error(
        `SQLite memory backend could not initialize schema: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (database === undefined) {
      throw new Error("SQLite memory backend could not initialize database.");
    }
    return database;
  }
}

export class FileTrajectoryStore implements TrajectoryStore {
  readonly #rootDir: string;
  readonly #maxEvents: number;
  readonly #maxFiles: number;
  readonly #maxRecordBytes: number;
  readonly #maxFileBytes: number;

  constructor(options: FileTrajectoryStoreOptions = {}) {
    this.#rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "memory", "trajectories"));
    this.#maxEvents = clampPositiveInteger(
      options.maxEvents,
      DEFAULT_MAX_TRAJECTORY_EVENTS,
      ABSOLUTE_MAX_TRAJECTORY_EVENTS,
    );
    this.#maxFiles = clampPositiveInteger(
      options.maxFiles,
      DEFAULT_MAX_TRAJECTORY_FILES,
      ABSOLUTE_MAX_TRAJECTORY_FILES,
    );
    this.#maxRecordBytes = clampPositiveInteger(
      options.maxRecordBytes,
      DEFAULT_MAX_TRAJECTORY_RECORD_BYTES,
      ABSOLUTE_MAX_TRAJECTORY_RECORD_BYTES,
    );
    this.#maxFileBytes = clampPositiveInteger(
      options.maxFileBytes,
      DEFAULT_MAX_TRAJECTORY_FILE_BYTES,
      ABSOLUTE_MAX_TRAJECTORY_FILE_BYTES,
    );
  }

  forToolQueries(): FileTrajectoryStore {
    return new FileTrajectoryStore({
      rootDir: this.#rootDir,
      maxEvents: this.#maxEvents,
      maxFiles: Math.min(this.#maxFiles, TOOL_MAX_TRAJECTORY_FILES),
      maxRecordBytes: this.#maxRecordBytes,
      maxFileBytes: Math.min(this.#maxFileBytes, TOOL_MAX_TRAJECTORY_FILE_BYTES),
    });
  }

  async append(record: DragonTrajectoryRecord): Promise<void> {
    validateTrajectoryRecord(record);
    const storedRecord = normalizeTrajectoryRecord(record, this.#maxEvents);
    const serialized = stringifyJson(storedRecord);
    const bytesToAppend = Buffer.byteLength(`${serialized}\n`, "utf8");
    if (bytesToAppend > this.#maxRecordBytes) {
      throw new Error(`Trajectory record is larger than ${this.#maxRecordBytes} bytes.`);
    }
    const filePath = trajectoryPath(this.#rootDir, storedRecord.createdAt);
    await assertCanAppendFile(filePath, bytesToAppend, this.#maxFileBytes, "Trajectory file");
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${serialized}\n`, "utf8");
  }

  async list(filter: TrajectoryListFilter = {}): Promise<TrajectoryListResult> {
    const normalizedFilter = normalizeTrajectoryListFilter(filter);
    const limit = clampPositiveInteger(
      normalizedFilter.limit,
      DEFAULT_TRAJECTORY_LIST_LIMIT,
      ABSOLUTE_TRAJECTORY_LIST_LIMIT,
    );
    const records = await this.#readTrajectoryRecords(normalizedFilter, limit + 1);
    return {
      trajectories: records.slice(0, limit).map(toTrajectorySummary),
      truncated: records.length > limit,
    };
  }

  async get(
    runId: string,
    filter: Pick<TrajectoryListFilter, "sessionId" | "dateFrom" | "dateTo"> = {},
  ): Promise<DragonTrajectoryRecord | undefined> {
    const normalizedRunId = normalizeRunId(runId);
    const records = await this.#readTrajectoryRecords({ ...filter, runId: normalizedRunId }, 1);
    return records.find(record => record.runId === normalizedRunId);
  }

  async #readTrajectoryRecords(
    filter: TrajectoryListFilter,
    maxMatches: number,
  ): Promise<DragonTrajectoryRecord[]> {
    const files = await readTrajectoryFileNames(this.#rootDir, filter, this.#maxFiles);
    const records: DragonTrajectoryRecord[] = [];
    for (const fileName of files) {
      const fileDate = fileName.slice(0, 10);
      const filePath = path.join(this.#rootDir, fileName);
      const fileStat = await stat(filePath);
      if (fileStat.size > this.#maxFileBytes) {
        throw new MemoryToolError(`Trajectory file is larger than ${this.#maxFileBytes} bytes.`);
      }
      const content = await readFile(filePath, "utf8");
      const lines = content.split(/\r?\n/).filter(line => line.trim()).reverse();
      for (const [index, line] of lines.entries()) {
        const record = parseTrajectoryRecord(line, index + 1);
        if (!trajectoryRecordMatches(record, filter)) {
          continue;
        }
        records.push(record);
        if (records.length >= maxMatches) {
          return records;
        }
      }
    }
    return records;
  }
}

async function safelyInvokeMemoryTool<TOutput>(
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
      error: sanitizeMemoryToolError(error),
    };
  }
}

function buildMemoryCandidate(
  request: Readonly<DragonLifecycleHookRequest>,
  maxContentChars: number,
): MemoryCandidateRecord | undefined {
  if (request.phase !== "end" || request.status !== "ok") {
    return undefined;
  }
  const userMessage = request.userMessage?.replace(/\s+/g, " ").trim();
  if (!userMessage || !isExplicitMemoryIntent(userMessage)) {
    return undefined;
  }
  const content = summarizeText(normalizeMemoryCandidateContent(userMessage), maxContentChars);
  if (!content.trim()) {
    return undefined;
  }
  const scope = inferMemoryCandidateScope(userMessage, request.workspace);
  const candidate: MemoryCandidateRecord = {
    id: createMemoryCandidateId(request, scope, content),
    sessionId: request.sessionId,
    runId: request.runId,
    source: request.source,
    scope,
    content,
    reason: "User message matched an explicit remember/note intent. Review before promoting to durable memory.",
    status: "pending",
    createdAt: request.completedAt ?? new Date().toISOString(),
    metadata: {
      capturedBy: "memory_candidate_capture",
    },
  };
  if (request.workspace !== undefined) {
    candidate.workspace = request.workspace;
  }
  if (request.assistantMessage !== undefined) {
    candidate.assistantPreview = summarizeText(request.assistantMessage.replace(/\s+/g, " ").trim(), 500);
  }
  return candidate;
}

function isExplicitMemoryIntent(value: string): boolean {
  return /(^|\b)(remember|note that|keep in mind|save this|please remember)\b/i.test(value)
    || /记住|请记住|帮我记住|记下来|留意一下|以后记得/.test(value);
}

function normalizeMemoryCandidateContent(value: string): string {
  return value
    .replace(/^\s*(please\s+)?remember\s+(that\s+)?/i, "")
    .replace(/^\s*note\s+that\s+/i, "")
    .replace(/^\s*keep\s+in\s+mind\s+(that\s+)?/i, "")
    .replace(/^\s*save\s+this\s*[:：-]?\s*/i, "")
    .replace(/^\s*(请)?(帮我)?记住\s*[:：-]?\s*/u, "")
    .replace(/^\s*记下来\s*[:：-]?\s*/u, "")
    .trim();
}

function inferMemoryCandidateScope(value: string, workspace: string | undefined): MemoryRecord["scope"] {
  if (workspace !== undefined || /project|repo|repository|codebase|workspace|项目|仓库|代码库/i.test(value)) {
    return "project";
  }
  return "user";
}

function createMemoryCandidateId(
  request: Readonly<DragonLifecycleHookRequest>,
  scope: MemoryRecord["scope"],
  content: string,
): string {
  return createHash("sha256")
    .update(request.sessionId, "utf8")
    .update("\0")
    .update(request.runId, "utf8")
    .update("\0")
    .update(scope, "utf8")
    .update("\0")
    .update(content, "utf8")
    .digest("hex");
}

function stringifyMemoryCandidate(candidate: MemoryCandidateRecord, maxCandidateBytes: number): string {
  const json = stringifyJson(candidate);
  if (Buffer.byteLength(`${json}\n`, "utf8") > maxCandidateBytes) {
    throw new MemoryToolError(`Memory candidate is larger than ${maxCandidateBytes} bytes.`);
  }
  return json;
}

function memoryCandidatePath(rootDir: string, createdAt: string): string {
  return path.join(rootDir, "candidates", `${normalizeCandidateDate(createdAt)}.jsonl`);
}

function normalizeCandidateDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsed.toISOString().slice(0, 10);
}

async function withMemoryCandidateReviewLock<T>(candidateId: string, task: () => Promise<T>): Promise<T> {
  if (memoryCandidateReviewLocks.has(candidateId)) {
    throw new MemoryToolError(`Memory candidate is already being reviewed: ${summarizeText(candidateId, 80)}`);
  }
  memoryCandidateReviewLocks.add(candidateId);
  try {
    return await task();
  } finally {
    memoryCandidateReviewLocks.delete(candidateId);
  }
}

interface MemoryCandidateEntry {
  record: MemoryCandidateRecord;
  filePath: string;
  lineNumber: number;
}

async function listMemoryCandidates(
  rootDir: string,
  input: MemoryCandidateListInput,
  maxFiles: number,
  maxFileBytes: number,
): Promise<MemoryCandidateListOutput> {
  const limit = clampPositiveInteger(input.limit, DEFAULT_MEMORY_CANDIDATE_LIST_LIMIT, ABSOLUTE_MEMORY_CANDIDATE_LIST_LIMIT);
  const entries = await readMemoryCandidateEntries(rootDir, input, maxFiles, maxFileBytes, limit + 1);
  const candidates = entries
    .map(entry => entry.record)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    candidates: candidates.slice(0, limit),
    truncated: candidates.length > limit,
  };
}

async function findMemoryCandidate(
  rootDir: string,
  id: string,
  maxFiles: number,
  maxFileBytes: number,
): Promise<MemoryCandidateEntry> {
  const normalizedId = normalizeCandidateId(id);
  const entries = await readMemoryCandidateEntries(rootDir, { status: "all" }, maxFiles, maxFileBytes);
  const entry = entries.find(item => item.record.id === normalizedId);
  if (!entry) {
    throw new MemoryToolError(`Memory candidate not found: ${summarizeText(normalizedId, 80)}`);
  }
  return entry;
}

async function readMemoryCandidateEntries(
  rootDir: string,
  input: MemoryCandidateListInput,
  maxFiles: number,
  maxFileBytes: number,
  maxEntries = Number.POSITIVE_INFINITY,
): Promise<MemoryCandidateEntry[]> {
  const candidateDir = await resolveSafeMemoryCandidateDirectory(path.join(rootDir, "candidates"));
  if (candidateDir === undefined) {
    return [];
  }
  const fileNames = await listMemoryCandidateFileNames(candidateDir, input, maxFiles);
  const entries: MemoryCandidateEntry[] = [];
  for (const fileName of fileNames) {
    const filePath = path.join(candidateDir.path, fileName);
    const fileEntries = await readMemoryCandidateFile(filePath, candidateDir, maxFileBytes);
    for (const entry of fileEntries) {
      if (!memoryCandidateMatches(entry.record, input)) {
        continue;
      }
      entries.push(entry);
      if (entries.length >= maxEntries) {
        return entries;
      }
    }
  }
  return entries;
}

interface SafeMemoryCandidateDirectory {
  path: string;
  stat: Awaited<ReturnType<typeof lstat>>;
}

async function resolveSafeMemoryCandidateDirectory(directoryPath: string): Promise<SafeMemoryCandidateDirectory | undefined> {
  const resolvedPath = path.resolve(directoryPath);
  let directoryStat: Awaited<ReturnType<typeof lstat>>;
  try {
    directoryStat = await lstat(resolvedPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw new MemoryToolError("Memory candidate directory is unavailable.");
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new MemoryToolError("Memory candidate directory must be a regular directory.");
  }
  return { path: resolvedPath, stat: directoryStat };
}

async function sameMemoryCandidateDirectoryRef(directory: SafeMemoryCandidateDirectory): Promise<boolean> {
  try {
    const current = await lstat(directory.path);
    return current.isDirectory() && !current.isSymbolicLink() && sameFileStat(directory.stat, current);
  } catch {
    return false;
  }
}

async function listMemoryCandidateFileNames(
  candidateDir: SafeMemoryCandidateDirectory,
  input: MemoryCandidateListInput,
  maxFiles: number,
): Promise<string[]> {
  if (!await sameMemoryCandidateDirectoryRef(candidateDir)) {
    return [];
  }
  let directory: Awaited<ReturnType<typeof opendir>>;
  try {
    directory = await opendir(candidateDir.path);
  } catch {
    return [];
  }
  const names: string[] = [];
  let scanned = 0;
  for await (const entry of directory) {
    scanned += 1;
    if (scanned > ABSOLUTE_MEMORY_CANDIDATE_FILES) {
      break;
    }
    if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.jsonl$/i.test(entry.name)) {
      continue;
    }
    const date = entry.name.slice(0, 10);
    if (input.dateFrom !== undefined && date < input.dateFrom) {
      continue;
    }
    if (input.dateTo !== undefined && date > input.dateTo) {
      continue;
    }
    names.push(entry.name);
  }
  return names.sort((left, right) => right.localeCompare(left)).slice(0, maxFiles);
}

async function readMemoryCandidateFile(
  filePath: string,
  candidateDir: SafeMemoryCandidateDirectory,
  maxFileBytes: number,
): Promise<MemoryCandidateEntry[]> {
  const content = await readSafeMemoryCandidateFile(filePath, candidateDir, maxFileBytes);
  const entries: MemoryCandidateEntry[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    entries.push({
      record: parseMemoryCandidateRecord(trimmed, index + 1, filePath),
      filePath,
      lineNumber: index + 1,
    });
  }
  return entries;
}

async function readSafeMemoryCandidateFile(
  filePath: string,
  candidateDir: SafeMemoryCandidateDirectory,
  maxFileBytes: number,
): Promise<string> {
  if (!isPathInside(filePath, candidateDir.path) || !await sameMemoryCandidateDirectoryRef(candidateDir)) {
    return "";
  }
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }
    throw new MemoryToolError("Memory candidate file is unavailable.");
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new MemoryToolError("Memory candidate file must be a regular file.");
  }
  if (before.size > maxFileBytes) {
    throw new MemoryToolError(`Memory candidate file is larger than ${maxFileBytes} bytes.`);
  }
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, "r");
  } catch {
    throw new MemoryToolError("Memory candidate file is unavailable.");
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileStat(before, opened)) {
      throw new MemoryToolError("Memory candidate file changed while reading.");
    }
    const after = await lstat(filePath);
    if (!after.isFile() || after.isSymbolicLink() || !sameFileStat(opened, after)) {
      throw new MemoryToolError("Memory candidate file changed while reading.");
    }
    if (!await sameMemoryCandidateDirectoryRef(candidateDir)) {
      throw new MemoryToolError("Memory candidate directory changed while reading.");
    }
    const buffer = Buffer.alloc(maxFileBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxFileBytes) {
      throw new MemoryToolError(`Memory candidate file is larger than ${maxFileBytes} bytes.`);
    }
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function rewriteMemoryCandidate(
  rootDir: string,
  filePath: string,
  candidateId: string,
  maxFileBytes: number,
  maxCandidateBytes: number,
  update: (candidate: MemoryCandidateRecord) => MemoryCandidateRecord,
): Promise<MemoryCandidateRecord> {
  const candidateDir = await resolveSafeMemoryCandidateDirectory(path.join(rootDir, "candidates"));
  if (candidateDir === undefined || !isPathInside(filePath, candidateDir.path)) {
    throw new MemoryToolError("Memory candidate file is unavailable.");
  }
  const content = await readSafeMemoryCandidateFile(filePath, candidateDir, maxFileBytes);
  const lines = content.split(/\r?\n/);
  let updated: MemoryCandidateRecord | undefined;
  const nextLines = lines.map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return "";
    }
    const record = parseMemoryCandidateRecord(trimmed, index + 1, filePath);
    if (record.id !== candidateId) {
      return stringifyMemoryCandidate(record, maxCandidateBytes);
    }
    if (record.status !== "pending") {
      throw new MemoryToolError(`Memory candidate is already ${record.status}.`);
    }
    updated = update(record);
    validateMemoryCandidateRecord(updated, `${filePath}:${index + 1}`);
    return stringifyMemoryCandidate(updated, maxCandidateBytes);
  });
  if (!updated) {
    throw new MemoryToolError(`Memory candidate not found: ${summarizeText(candidateId, 80)}`);
  }
  const nextContent = `${nextLines.filter(line => line.trim()).join("\n")}\n`;
  if (Buffer.byteLength(nextContent, "utf8") > maxFileBytes) {
    throw new MemoryToolError(`Memory candidate file would exceed ${maxFileBytes} bytes.`);
  }
  const tempPath = path.join(candidateDir.path, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, nextContent, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort cleanup for failed atomic rewrite.
    }
    throw error instanceof MemoryToolError
      ? error
      : new MemoryToolError(`Memory candidate file could not be updated: ${error instanceof Error ? error.message : String(error)}`);
  }
  return updated;
}

function memoryCandidateMatches(candidate: MemoryCandidateRecord, input: MemoryCandidateListInput): boolean {
  if (input.status !== undefined && input.status !== "all" && candidate.status !== input.status) {
    return false;
  }
  const date = candidate.createdAt.slice(0, 10);
  if (input.dateFrom !== undefined && date < input.dateFrom) {
    return false;
  }
  if (input.dateTo !== undefined && date > input.dateTo) {
    return false;
  }
  return true;
}

function parseMemoryCandidateRecord(line: string, lineNumber: number, filePath: string): MemoryCandidateRecord {
  if (Buffer.byteLength(line, "utf8") > ABSOLUTE_MEMORY_CANDIDATE_BYTES) {
    throw new MemoryToolError(`Memory candidate in ${filePath} at line ${lineNumber} is too large.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new MemoryToolError(
      `Invalid memory candidate JSON in ${filePath} at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  validateMemoryCandidateRecord(value, `${filePath}:${lineNumber}`);
  return value;
}

function validateMemoryCandidateRecord(value: unknown, source: string): asserts value is MemoryCandidateRecord {
  if (!isObject(value)) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: expected object.`);
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: missing id.`);
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: missing sessionId.`);
  }
  if (typeof value.runId !== "string" || !value.runId.trim()) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: missing runId.`);
  }
  if (!isDragonSource(value.source)) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid source.`);
  }
  if (!isMemoryScope(value.scope)) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid scope.`);
  }
  if (typeof value.content !== "string" || !value.content.trim()) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid content.`);
  }
  if (typeof value.reason !== "string" || !value.reason.trim()) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid reason.`);
  }
  if (!isMemoryCandidateStatus(value.status)) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid status.`);
  }
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid createdAt.`);
  }
  if (value.reviewedAt !== undefined && (typeof value.reviewedAt !== "string" || Number.isNaN(Date.parse(value.reviewedAt)))) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid reviewedAt.`);
  }
  if (value.reviewedByRunId !== undefined && typeof value.reviewedByRunId !== "string") {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid reviewedByRunId.`);
  }
  if (value.promotedMemoryId !== undefined && typeof value.promotedMemoryId !== "string") {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid promotedMemoryId.`);
  }
  if (value.rejectionReason !== undefined && typeof value.rejectionReason !== "string") {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid rejectionReason.`);
  }
  if (value.workspace !== undefined && typeof value.workspace !== "string") {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid workspace.`);
  }
  if (value.assistantPreview !== undefined && typeof value.assistantPreview !== "string") {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid assistantPreview.`);
  }
  if (value.metadata !== undefined && !isObject(value.metadata)) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid metadata.`);
  }
}

function isMemoryCandidateStatus(value: unknown): value is MemoryCandidateStatus {
  return value === "pending" || value === "promoted" || value === "rejected";
}

function normalizeCandidateId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new MemoryToolError("Memory candidate id cannot be empty.");
  }
  if (trimmed.length > 128) {
    throw new MemoryToolError("Memory candidate id is too long.");
  }
  return trimmed;
}

function memoryDraftFromCandidate(
  candidate: MemoryCandidateRecord,
  input: MemoryCandidatePromoteInput,
  invocation: ToolInvocation,
): Omit<MemoryRecord, "id" | "createdAt"> {
  const scope = input.scope ?? candidate.scope;
  const content = input.content ?? candidate.content;
  const metadata: Record<string, unknown> = {
    candidateId: candidate.id,
    candidateRunId: candidate.runId,
    candidateSessionId: candidate.sessionId,
  };
  if (candidate.workspace !== undefined) {
    metadata.workspace = candidate.workspace;
  }
  if (input.metadata !== undefined) {
    Object.assign(metadata, input.metadata);
  }
  const draft: Omit<MemoryRecord, "id" | "createdAt"> = {
    scope,
    content,
    source: input.source ?? "memory_candidate_promote",
    metadata,
  };
  const runId = readInvocationRunId(invocation);
  if (runId !== undefined) {
    draft.metadata = { ...metadata, promotedByRunId: runId };
  }
  return draft;
}

function readInvocationRunId(invocation: ToolInvocation): string | undefined {
  const runId = invocation.metadata?.runId;
  return typeof runId === "string" && runId.trim() ? runId : undefined;
}

function parseMemoryCandidateListInput(input: unknown): MemoryCandidateListInput {
  if (input === undefined || input === null) {
    return { status: "pending" };
  }
  if (!isObject(input)) {
    throw new MemoryToolError("memory_candidates_list input must be an object.");
  }
  const parsed: MemoryCandidateListInput = {
    status: "pending",
  };
  if (input.status !== undefined) {
    if (input.status !== "all" && !isMemoryCandidateStatus(input.status)) {
      throw new MemoryToolError("memory_candidates_list status is invalid.");
    }
    parsed.status = input.status;
  }
  if (typeof input.dateFrom === "string" && input.dateFrom.trim()) {
    parsed.dateFrom = normalizeTrajectoryDate(input.dateFrom, "dateFrom");
  }
  if (typeof input.dateTo === "string" && input.dateTo.trim()) {
    parsed.dateTo = normalizeTrajectoryDate(input.dateTo, "dateTo");
  }
  if (parsed.dateFrom !== undefined && parsed.dateTo !== undefined && parsed.dateFrom > parsed.dateTo) {
    throw new MemoryToolError("memory_candidates_list dateFrom must be before or equal to dateTo.");
  }
  if (typeof input.limit === "number") {
    parsed.limit = Math.max(1, Math.floor(input.limit));
  }
  return parsed;
}

function parseMemoryCandidatePromoteInput(input: unknown): MemoryCandidatePromoteInput {
  if (!isObject(input)) {
    throw new MemoryToolError("memory_candidate_promote input must be an object.");
  }
  if (typeof input.id !== "string" || !input.id.trim()) {
    throw new MemoryToolError("memory_candidate_promote requires a candidate id.");
  }
  const parsed: MemoryCandidatePromoteInput = {
    id: normalizeCandidateId(input.id),
  };
  if (input.scope !== undefined) {
    if (!isMemoryScope(input.scope)) {
      throw new MemoryToolError("memory_candidate_promote scope is invalid.");
    }
    parsed.scope = input.scope;
  }
  if (typeof input.content === "string" && input.content.trim()) {
    const content = input.content.trim();
    if (Buffer.byteLength(content, "utf8") > ABSOLUTE_MAX_MEMORY_RECORD_BYTES) {
      throw new MemoryToolError(`memory_candidate_promote content must be ${ABSOLUTE_MAX_MEMORY_RECORD_BYTES} bytes or fewer.`);
    }
    parsed.content = content;
  } else if (input.content !== undefined) {
    throw new MemoryToolError("memory_candidate_promote content must be non-empty when provided.");
  }
  if (typeof input.source === "string" && input.source.trim()) {
    parsed.source = normalizeOptionalText(input.source, "source", 200);
  }
  if (input.metadata !== undefined) {
    if (!isObject(input.metadata)) {
      throw new MemoryToolError("memory_candidate_promote metadata must be an object.");
    }
    parsed.metadata = input.metadata;
  }
  return parsed;
}

function parseMemoryCandidateRejectInput(input: unknown): MemoryCandidateRejectInput {
  if (!isObject(input)) {
    throw new MemoryToolError("memory_candidate_reject input must be an object.");
  }
  if (typeof input.id !== "string" || !input.id.trim()) {
    throw new MemoryToolError("memory_candidate_reject requires a candidate id.");
  }
  const parsed: MemoryCandidateRejectInput = {
    id: normalizeCandidateId(input.id),
  };
  if (typeof input.reason === "string" && input.reason.trim()) {
    parsed.reason = normalizeOptionalText(input.reason, "reason", 500);
  }
  return parsed;
}

function parseMemorySearchInput(input: unknown): MemorySearchInput {
  if (!isObject(input) || typeof input.query !== "string" || !input.query.trim()) {
    throw new MemoryToolError("memory_search requires a non-empty query.");
  }
  const parsed: MemorySearchInput = {
    query: input.query.trim(),
  };
  if (typeof input.limit === "number") {
    parsed.limit = Math.max(1, Math.floor(input.limit));
  }
  return parsed;
}

function parseMemoryRememberInput(input: unknown): MemoryRememberInput {
  if (!isObject(input)) {
    throw new MemoryToolError("memory_remember input must be an object.");
  }
  if (!isMemoryScope(input.scope)) {
    throw new MemoryToolError("memory_remember requires a valid scope.");
  }
  if (typeof input.content !== "string" || !input.content.trim()) {
    throw new MemoryToolError("memory_remember requires non-empty content.");
  }
  const content = input.content.trim();
  if (Buffer.byteLength(content, "utf8") > ABSOLUTE_MAX_MEMORY_RECORD_BYTES) {
    throw new MemoryToolError(`memory_remember content must be ${ABSOLUTE_MAX_MEMORY_RECORD_BYTES} bytes or fewer.`);
  }

  const parsed: MemoryRememberInput = {
    scope: input.scope,
    content,
  };
  if (typeof input.source === "string" && input.source.trim()) {
    parsed.source = input.source.trim();
  }
  if (isObject(input.metadata)) {
    parsed.metadata = input.metadata;
  }
  return parsed;
}

function parseTrajectoryListInput(input: unknown): TrajectoryListInput {
  if (input === undefined || input === null) {
    return {};
  }
  if (!isObject(input)) {
    throw new MemoryToolError("trajectory_list input must be an object.");
  }
  const filter: TrajectoryListFilter = {};
  if (typeof input.sessionId === "string" && input.sessionId.trim()) {
    throw new MemoryToolError("trajectory_list cannot override the current session.");
  }
  if (input.status !== undefined) {
    if (!isTurnStatus(input.status)) {
      throw new MemoryToolError("trajectory_list status is invalid.");
    }
    filter.status = input.status;
  }
  if (typeof input.dateFrom === "string" && input.dateFrom.trim()) {
    filter.dateFrom = input.dateFrom.trim();
  }
  if (typeof input.dateTo === "string" && input.dateTo.trim()) {
    filter.dateTo = input.dateTo.trim();
  }
  if (typeof input.limit === "number") {
    filter.limit = Math.max(1, Math.floor(input.limit));
  }
  return normalizeTrajectoryListFilter(filter);
}

function withInvocationSession(
  filter: TrajectoryListFilter,
  sessionId: string,
): TrajectoryListFilter {
  const normalizedSessionId = normalizeOptionalText(sessionId, "sessionId", 200);
  const today = new Date().toISOString().slice(0, 10);
  const defaultDateFrom = shiftDate(today, -DEFAULT_TRAJECTORY_TOOL_DATE_WINDOW_DAYS);
  return normalizeTrajectoryListFilter({
    ...filter,
    sessionId: normalizedSessionId,
    dateFrom: filter.dateFrom ?? defaultDateFrom,
    dateTo: filter.dateTo ?? today,
  });
}

function parseTrajectoryGetInput(input: unknown): TrajectoryGetInput {
  if (!isObject(input) || typeof input.runId !== "string" || !input.runId.trim()) {
    throw new MemoryToolError("trajectory_get requires a non-empty runId.");
  }
  return {
    runId: normalizeRunId(input.runId),
    ...(typeof input.maxEvents === "number" ? { maxEvents: Math.max(1, Math.floor(input.maxEvents)) } : {}),
  };
}

function sanitizeMemoryToolError(error: unknown): string {
  return error instanceof MemoryToolError
    ? summarizeText(error.safeMessage, 1000)
    : "Memory tool failed.";
}

function validateMemoryDraft(
  record: Omit<MemoryRecord, "id" | "createdAt">,
  maxRecordBytes: number,
): void {
  if (!isMemoryScope(record.scope)) {
    throw new MemoryToolError("Invalid memory scope.");
  }
  if (typeof record.content !== "string" || !record.content.trim()) {
    throw new MemoryToolError("Memory content cannot be empty.");
  }
  if (Buffer.byteLength(record.content, "utf8") > maxRecordBytes) {
    throw new MemoryToolError(`Memory content is larger than ${maxRecordBytes} bytes.`);
  }
  if (record.source !== undefined && typeof record.source !== "string") {
    throw new MemoryToolError("Invalid memory source.");
  }
  if (record.updatedAt !== undefined && Number.isNaN(Date.parse(record.updatedAt))) {
    throw new MemoryToolError("Invalid memory updatedAt.");
  }
  if (record.metadata !== undefined && !isObject(record.metadata)) {
    throw new MemoryToolError("Invalid memory metadata.");
  }
}

function stringifyMemoryRecord(record: MemoryRecord, maxRecordBytes: number): string {
  const json = stringifyJson(record);
  if (Buffer.byteLength(`${json}\n`, "utf8") > maxRecordBytes) {
    throw new MemoryToolError(`Memory record is larger than ${maxRecordBytes} bytes.`);
  }
  return json;
}

async function assertCanAppendFile(
  filePath: string,
  bytesToAppend: number,
  maxFileBytes: number,
  label: string,
): Promise<void> {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.size + bytesToAppend > maxFileBytes) {
      throw new MemoryToolError(`${label} would exceed ${maxFileBytes} bytes.`);
    }
  } catch (error) {
    if (error instanceof MemoryToolError) {
      throw error;
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      if (bytesToAppend > maxFileBytes) {
        throw new MemoryToolError(`${label} would exceed ${maxFileBytes} bytes.`);
      }
      return;
    }
    throw new MemoryToolError(`${label} is unavailable.`);
  }
}

async function assertCanAppendRegularFile(
  filePath: string,
  bytesToAppend: number,
  maxFileBytes: number,
  label: string,
): Promise<void> {
  try {
    const fileStat = await lstat(filePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new MemoryToolError(`${label} must be a regular file.`);
    }
    if (fileStat.size + bytesToAppend > maxFileBytes) {
      throw new MemoryToolError(`${label} would exceed ${maxFileBytes} bytes.`);
    }
  } catch (error) {
    if (error instanceof MemoryToolError) {
      throw error;
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      if (bytesToAppend > maxFileBytes) {
        throw new MemoryToolError(`${label} would exceed ${maxFileBytes} bytes.`);
      }
      return;
    }
    throw new MemoryToolError(`${label} is unavailable.`);
  }
}

async function assertSafeMemoryCandidateDirectory(directoryPath: string): Promise<void> {
  try {
    const directoryStat = await lstat(directoryPath);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new MemoryToolError("Memory candidate directory must be a regular directory.");
    }
  } catch (error) {
    if (error instanceof MemoryToolError) {
      throw error;
    }
    throw new MemoryToolError("Memory candidate directory is unavailable.");
  }
}

function parseMemoryRecord(line: string, lineNumber: number): MemoryRecord {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(
      `Invalid memory JSON at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  validateMemoryRecord(value, lineNumber);
  return value;
}

function sqliteRowToMemoryRecord(row: Record<string, unknown>, source: string): MemoryRecord {
  const scope = readSqliteText(row, "scope", source);
  if (!isMemoryScope(scope)) {
    throw new Error(`Invalid SQLite memory record from ${source}: invalid scope.`);
  }
  const record: MemoryRecord = {
    id: readSqliteText(row, "id", source),
    scope,
    content: readSqliteText(row, "content", source),
    createdAt: readSqliteText(row, "created_at", source),
  };
  const recordSource = readOptionalSqliteText(row, "source", source);
  if (recordSource !== undefined) {
    record.source = recordSource;
  }
  const updatedAt = readOptionalSqliteText(row, "updated_at", source);
  if (updatedAt !== undefined) {
    record.updatedAt = updatedAt;
  }
  const metadataJson = readOptionalSqliteText(row, "metadata_json", source);
  if (metadataJson !== undefined) {
    let metadata: unknown;
    try {
      metadata = JSON.parse(metadataJson);
    } catch (error) {
      throw new Error(
        `Invalid SQLite memory metadata from ${source}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!isObject(metadata)) {
      throw new Error(`Invalid SQLite memory metadata from ${source}: expected object.`);
    }
    record.metadata = metadata;
  }
  validateMemoryRecord(record, 1);
  return record;
}

function readSqliteText(row: Record<string, unknown>, key: string, source: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid SQLite memory record from ${source}: ${key} must be a non-empty string.`);
  }
  return value;
}

function readOptionalSqliteText(row: Record<string, unknown>, key: string, source: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid SQLite memory record from ${source}: ${key} must be a string.`);
  }
  return value.trim() ? value : undefined;
}

function readSqlitePragmaNumber(database: DatabaseSync, sql: string, key: string): number {
  const row = database.prepare(sql).get();
  const value = row?.[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new MemoryToolError(`SQLite memory database returned invalid ${key}.`);
  }
  return value;
}

function toSafeFtsQuery(tokens: string[]): string | undefined {
  const selectedTokens = tokens
    .map(token => token.trim())
    .filter(token => token.length > 0)
    .slice(0, 12);
  if (selectedTokens.length === 0) {
    return undefined;
  }
  return selectedTokens
    .map(token => `"${token.replaceAll('"', '""')}"`)
    .join(" OR ");
}

function sqliteRankToScore(rank: number): number {
  if (!Number.isFinite(rank)) {
    return 0;
  }
  const score = Math.max(0, -rank) * 1_000_000;
  return Number(score.toFixed(6));
}

function escapeSqlLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function validateMemoryRecord(value: unknown, lineNumber: number): asserts value is MemoryRecord {
  if (!isObject(value)) {
    throw new Error(`Invalid memory record at line ${lineNumber}: expected object.`);
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    throw new Error(`Invalid memory record at line ${lineNumber}: missing id.`);
  }
  if (!isMemoryScope(value.scope)) {
    throw new Error(`Invalid memory record at line ${lineNumber}: invalid scope.`);
  }
  if (typeof value.content !== "string" || !value.content.trim()) {
    throw new Error(`Invalid memory record at line ${lineNumber}: invalid content.`);
  }
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    throw new Error(`Invalid memory record at line ${lineNumber}: invalid createdAt.`);
  }
  if (value.updatedAt !== undefined && (typeof value.updatedAt !== "string" || Number.isNaN(Date.parse(value.updatedAt)))) {
    throw new Error(`Invalid memory record at line ${lineNumber}: invalid updatedAt.`);
  }
  if (value.source !== undefined && typeof value.source !== "string") {
    throw new Error(`Invalid memory record at line ${lineNumber}: invalid source.`);
  }
  if (value.metadata !== undefined && !isObject(value.metadata)) {
    throw new Error(`Invalid memory record at line ${lineNumber}: invalid metadata.`);
  }
}

function isMemoryScope(value: unknown): value is MemoryRecord["scope"] {
  return value === "user" || value === "project" || value === "session" || value === "skill";
}

function createMemoryId(record: Omit<MemoryRecord, "id" | "createdAt">, createdAt: string): string {
  return createHash("sha256")
    .update(record.scope, "utf8")
    .update("\0")
    .update(record.source ?? "", "utf8")
    .update("\0")
    .update(record.content, "utf8")
    .update("\0")
    .update(createdAt, "utf8")
    .update("\0")
    .update(randomUUID(), "utf8")
    .digest("hex");
}

function scoreMemoryRecord(
  record: MemoryRecord,
  query: string,
  queryTokens: string[],
): MemorySearchResult | undefined {
  const searchable = `${record.scope} ${record.source ?? ""} ${record.content}`.toLowerCase();
  const matchedTokens = queryTokens.filter(token => searchable.includes(token));
  let score = matchedTokens.length;
  if (searchable.includes(query.toLowerCase())) {
    score += 3;
  }
  if (score === 0) {
    return undefined;
  }
  const result: MemorySearchResult = {
    record,
    score,
  };
  if (matchedTokens.length > 0) {
    result.reason = `Matched ${matchedTokens.length} query token${matchedTokens.length === 1 ? "" : "s"}.`;
  }
  return result;
}

function summarizeMemoryResults(results: MemorySearchResult[], maxContentChars: number): string {
  const lines: string[] = [];
  let chars = 0;
  for (const result of results) {
    const source = result.record.source ? ` source=${result.record.source}` : "";
    const header = `- scope=${result.record.scope}${source} score=${result.score}`;
    const body = summarizeText(result.record.content.replace(/\s+/g, " "), 1000);
    const line = `${header}: ${body}`;
    const separatorChars = lines.length > 0 ? 1 : 0;
    const remaining = maxContentChars - chars - separatorChars;
    if (remaining <= 0) {
      break;
    }
    lines.push(fitText(line, remaining, "[truncated]"));
    chars += separatorChars + (lines[lines.length - 1]?.length ?? 0);
  }
  return lines.join("\n");
}

function fitText(value: string, maxChars: number, suffix: string): string {
  if (maxChars <= 0) {
    return "";
  }
  if (value.length <= maxChars) {
    return value;
  }
  if (suffix.length + 1 >= maxChars) {
    return value.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - suffix.length - 1)} ${suffix}`;
}

function tokenize(value: string): string[] {
  const normalized = value.toLowerCase();
  return [
    ...new Set([
      ...(normalized.match(/[\p{L}\p{N}_-]{2,}/gu) ?? []),
      ...normalized.split(/\s+/).filter(part => part.length >= 2),
    ]),
  ];
}

function summarizeText(value: string, maxChars: number): string {
  return value.length > maxChars
    ? `${value.slice(0, maxChars)}... [${value.length} chars]`
    : value;
}

function validateTrajectoryRecord(record: DragonTrajectoryRecord): void {
  if (!record.runId.trim()) {
    throw new Error("Trajectory record missing runId.");
  }
  if (!record.sessionId.trim()) {
    throw new Error("Trajectory record missing sessionId.");
  }
  if (!isDragonSource(record.source)) {
    throw new Error("Trajectory record has invalid source.");
  }
  if (!isIsoTimestamp(record.createdAt)) {
    throw new Error("Trajectory record has invalid createdAt.");
  }
  if (!isIsoTimestamp(record.completedAt)) {
    throw new Error("Trajectory record has invalid completedAt.");
  }
  if (!isTurnStatus(record.status)) {
    throw new Error("Trajectory record has invalid status.");
  }
  if (typeof record.userMessage !== "string") {
    throw new Error("Trajectory record has invalid userMessage.");
  }
  if (!Array.isArray(record.events)) {
    throw new Error("Trajectory record has invalid events.");
  }
}

function parseTrajectoryRecord(line: string, lineNumber: number): DragonTrajectoryRecord {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new MemoryToolError(
      `Invalid trajectory JSON at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isObject(value)) {
    throw new MemoryToolError(`Invalid trajectory record at line ${lineNumber}: expected object.`);
  }
  const record = value as unknown as DragonTrajectoryRecord;
  validateTrajectoryRecord(record);
  return record;
}

async function readTrajectoryFileNames(
  rootDir: string,
  filter: TrajectoryListFilter,
  maxFiles: number,
): Promise<string[]> {
  const fileNames: string[] = [];
  let directory: Awaited<ReturnType<typeof opendir>>;
  try {
    directory = await opendir(rootDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw new MemoryToolError("Trajectory directory is unavailable.");
  }

  for await (const entry of directory) {
    if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name)) {
      continue;
    }
    const fileDate = entry.name.slice(0, 10);
    if (trajectoryDateMatches(fileDate, filter.dateFrom, filter.dateTo)) {
      fileNames.push(entry.name);
    }
  }
  return fileNames
    .sort((a, b) => b.localeCompare(a))
    .slice(0, maxFiles);
}

function normalizeTrajectoryListFilter(filter: TrajectoryListFilter): TrajectoryListFilter {
  const normalized: TrajectoryListFilter = {};
  if (filter.runId !== undefined) {
    normalized.runId = normalizeRunId(filter.runId);
  }
  if (filter.sessionId !== undefined) {
    normalized.sessionId = normalizeOptionalText(filter.sessionId, "sessionId", 200);
  }
  if (filter.status !== undefined) {
    if (!isTurnStatus(filter.status)) {
      throw new MemoryToolError("trajectory_list status is invalid.");
    }
    normalized.status = filter.status;
  }
  if (filter.dateFrom !== undefined) {
    normalized.dateFrom = normalizeTrajectoryDate(filter.dateFrom, "dateFrom");
  }
  if (filter.dateTo !== undefined) {
    normalized.dateTo = normalizeTrajectoryDate(filter.dateTo, "dateTo");
  }
  if (normalized.dateFrom !== undefined && normalized.dateTo !== undefined && normalized.dateFrom > normalized.dateTo) {
    throw new MemoryToolError("trajectory_list dateFrom must be before or equal to dateTo.");
  }
  if (filter.limit !== undefined) {
    normalized.limit = Math.max(1, Math.floor(filter.limit));
  }
  return normalized;
}

function normalizeTrajectoryDate(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!isIsoDate(trimmed)) {
    throw new MemoryToolError(`trajectory_list ${fieldName} must use YYYY-MM-DD.`);
  }
  return trimmed;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function normalizeRunId(value: string): string {
  return normalizeOptionalText(value, "runId", 200);
}

function normalizeOptionalText(value: string, fieldName: string, maxChars: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new MemoryToolError(`${fieldName} cannot be empty.`);
  }
  if (trimmed.length > maxChars) {
    throw new MemoryToolError(`${fieldName} must be ${maxChars} characters or fewer.`);
  }
  return trimmed;
}

function trajectoryDateMatches(fileDate: string, dateFrom: string | undefined, dateTo: string | undefined): boolean {
  return (dateFrom === undefined || fileDate >= dateFrom)
    && (dateTo === undefined || fileDate <= dateTo);
}

function trajectoryRecordMatches(record: DragonTrajectoryRecord, filter: TrajectoryListFilter): boolean {
  if (filter.runId !== undefined && record.runId !== filter.runId) {
    return false;
  }
  if (filter.sessionId !== undefined && record.sessionId !== filter.sessionId) {
    return false;
  }
  if (filter.status !== undefined && record.status !== filter.status) {
    return false;
  }
  return trajectoryDateMatches(record.createdAt.slice(0, 10), filter.dateFrom, filter.dateTo);
}

function toTrajectorySummary(record: DragonTrajectoryRecord): TrajectoryRecordSummary {
  const summary: TrajectoryRecordSummary = {
    runId: record.runId,
    sessionId: record.sessionId,
    source: record.source,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    status: record.status,
    userPreview: summarizeText(record.userMessage, 300),
    eventCount: record.events.length,
  };
  if (record.assistantMessage !== undefined) {
    summary.assistantPreview = summarizeText(record.assistantMessage, 300);
  }
  if (record.error !== undefined) {
    summary.errorPreview = summarizeText(record.error, 300);
  }
  return summary;
}

function normalizeTrajectoryRecord(
  record: DragonTrajectoryRecord,
  maxEvents: number,
): DragonTrajectoryRecord {
  if (record.events.length <= maxEvents) {
    return record;
  }
  const truncatedEvents = record.events.slice(-maxEvents);
  return {
    ...record,
    events: truncatedEvents,
    metadata: {
      ...(record.metadata ?? {}),
      trajectoryEventsTruncated: record.events.length - truncatedEvents.length,
    },
  };
}

function trajectoryPath(rootDir: string, createdAt: string): string {
  const date = createdAt.slice(0, 10);
  return path.join(rootDir, `${date}.jsonl`);
}

function isIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value.slice(0, 10);
}

export function createFileSessionStore(options: FileSessionStoreOptions = {}): SessionStore {
  return new FileSessionStore(options);
}

export class FileSessionStore implements SessionStore {
  readonly #rootDir: string;
  readonly #maxHistoryMessages: number;

  constructor(options: FileSessionStoreOptions = {}) {
    this.#rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "sessions"));
    this.#maxHistoryMessages = clampPositiveInteger(
      options.maxHistoryMessages,
      DEFAULT_MAX_HISTORY_MESSAGES,
      ABSOLUTE_MAX_HISTORY_MESSAGES,
    );
  }

  async loadMessages(sessionId: string): Promise<SessionMessage[]> {
    const filePath = sessionPath(this.#rootDir, sessionId);
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const messages: SessionMessage[] = [];
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const record = parseTurnRecord(trimmed, index + 1, filePath);
      if (record.sessionId !== sessionId) {
        throw new Error(`Session record mismatch in ${filePath} at line ${index + 1}.`);
      }
      messages.push(...record.messages);
    }

    return messages.slice(-this.#maxHistoryMessages);
  }

  async appendTurn(record: SessionTurnRecord): Promise<void> {
    validateTurnRecord(record, "append");
    await mkdir(this.#rootDir, { recursive: true });
    await appendFile(sessionPath(this.#rootDir, record.sessionId), `${stringifyJson(record)}\n`, "utf8");
  }
}

function sessionPath(rootDir: string, sessionId: string): string {
  if (!sessionId.trim()) {
    throw new Error("Session id cannot be empty.");
  }
  const fileName = `${createHash("sha256").update(sessionId, "utf8").digest("hex")}.jsonl`;
  return path.join(rootDir, fileName);
}

function parseTurnRecord(line: string, lineNumber: number, filePath: string): SessionTurnRecord {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(
      `Invalid session JSON in ${filePath} at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  validateTurnRecord(value, `${filePath}:${lineNumber}`);
  return value;
}

function validateTurnRecord(value: unknown, source: string): asserts value is SessionTurnRecord {
  if (!isObject(value)) {
    throw new Error(`Invalid session record at ${source}: expected object.`);
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    throw new Error(`Invalid session record at ${source}: missing sessionId.`);
  }
  if (typeof value.runId !== "string" || !value.runId.trim()) {
    throw new Error(`Invalid session record at ${source}: missing runId.`);
  }
  if (!isDragonSource(value.source)) {
    throw new Error(`Invalid session record at ${source}: invalid source.`);
  }
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    throw new Error(`Invalid session record at ${source}: invalid createdAt.`);
  }
  if (!isTurnStatus(value.status)) {
    throw new Error(`Invalid session record at ${source}: invalid status.`);
  }
  if (!Array.isArray(value.messages) || !value.messages.every(isDragonMessage)) {
    throw new Error(`Invalid session record at ${source}: invalid messages.`);
  }
  if (value.workspace !== undefined && typeof value.workspace !== "string") {
    throw new Error(`Invalid session record at ${source}: invalid workspace.`);
  }
  if (value.usage !== undefined && !isSessionUsage(value.usage)) {
    throw new Error(`Invalid session record at ${source}: invalid usage.`);
  }
  if (value.error !== undefined && typeof value.error !== "string") {
    throw new Error(`Invalid session record at ${source}: invalid error.`);
  }
  if (value.metadata !== undefined && !isObject(value.metadata)) {
    throw new Error(`Invalid session record at ${source}: invalid metadata.`);
  }
}

function isDragonMessage(value: unknown): value is SessionMessage {
  if (!isObject(value)) {
    return false;
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    return false;
  }
  if (!["system", "user", "assistant", "tool"].includes(String(value.role))) {
    return false;
  }
  if (typeof value.content !== "string") {
    return false;
  }
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    return false;
  }
  return value.metadata === undefined || isObject(value.metadata);
}

function isDragonSource(value: unknown): boolean {
  return ["cli", "gateway", "web", "ide", "cron", "api"].includes(String(value));
}

function isSessionUsage(value: unknown): value is SessionUsage {
  if (!isObject(value)) {
    return false;
  }
  return ["inputTokens", "outputTokens", "totalTokens", "costUsd"].every(key => {
    const item = value[key];
    return item === undefined || (typeof item === "number" && Number.isFinite(item) && item >= 0);
  });
}

function isTurnStatus(value: unknown): value is SessionTurnRecord["status"] {
  return ["ok", "error", "cancelled", "timeout"].includes(String(value));
}

function stringifyJson(value: unknown): string {
  const json = JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") {
      return item.toString();
    }
    return item;
  });
  if (!json) {
    throw new Error("Session record could not be serialized.");
  }
  return json;
}

function clampPositiveInteger(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(1, Math.floor(value)), max);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sameFileStat(
  left: Awaited<ReturnType<typeof stat>>,
  right: Awaited<ReturnType<typeof stat>>,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
