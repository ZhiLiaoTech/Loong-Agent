import { appendFile, mkdir, opendir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { LoongTrajectoryRecord } from "@loong/core";
import { assertCanAppendFile } from "./memory-file-io.js";
import { MemoryToolError } from "./memory-tool-error.js";
import { isLoongSource, isTurnStatus } from "./file-session-store.js";
import { isIsoDate, normalizeOptionalText, normalizeRunId, summarizeText } from "./memory-text.js";
import {
  clampPositiveInteger,
  isIsoTimestamp,
  isNodeError,
  isObject,
  stringifyJson,
} from "./memory-util.js";
import type {
  FileTrajectoryStoreOptions,
  TrajectoryListFilter,
  TrajectoryListResult,
  TrajectoryRecordSummary,
  TrajectoryStore,
} from "./trajectory-types.js";

const DEFAULT_MAX_TRAJECTORY_EVENTS = 200;
const ABSOLUTE_MAX_TRAJECTORY_EVENTS = 2000;
const DEFAULT_MAX_TRAJECTORY_FILES = 366;
const ABSOLUTE_MAX_TRAJECTORY_FILES = 5000;
export const TOOL_MAX_TRAJECTORY_FILES = 31;
export const TOOL_MAX_TRAJECTORY_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_TRAJECTORY_RECORD_BYTES = 1024 * 1024;
const ABSOLUTE_MAX_TRAJECTORY_RECORD_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TRAJECTORY_FILE_BYTES = 64 * 1024 * 1024;
const ABSOLUTE_MAX_TRAJECTORY_FILE_BYTES = 256 * 1024 * 1024;
const DEFAULT_TRAJECTORY_LIST_LIMIT = 20;
const ABSOLUTE_TRAJECTORY_LIST_LIMIT = 100;

export function createFileTrajectoryStore(options: FileTrajectoryStoreOptions = {}): TrajectoryStore {
  return new FileTrajectoryStore(options);
}

export class FileTrajectoryStore implements TrajectoryStore {
  readonly #rootDir: string;
  readonly #maxEvents: number;
  readonly #maxFiles: number;
  readonly #maxRecordBytes: number;
  readonly #maxFileBytes: number;

  constructor(options: FileTrajectoryStoreOptions = {}) {
    this.#rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".loong", "memory", "trajectories"));
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

  async append(record: LoongTrajectoryRecord): Promise<void> {
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
  ): Promise<LoongTrajectoryRecord | undefined> {
    const normalizedRunId = normalizeRunId(runId);
    const records = await this.#readTrajectoryRecords({ ...filter, runId: normalizedRunId }, 1);
    return records.find(record => record.runId === normalizedRunId);
  }

  async #readTrajectoryRecords(
    filter: TrajectoryListFilter,
    maxMatches: number,
  ): Promise<LoongTrajectoryRecord[]> {
    const files = await readTrajectoryFileNames(this.#rootDir, filter, this.#maxFiles);
    const records: LoongTrajectoryRecord[] = [];
    for (const fileName of files) {
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

export function validateTrajectoryRecord(record: LoongTrajectoryRecord): void {
  if (!record.runId.trim()) {
    throw new Error("Trajectory record missing runId.");
  }
  if (!record.sessionId.trim()) {
    throw new Error("Trajectory record missing sessionId.");
  }
  if (!isLoongSource(record.source)) {
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

export function parseTrajectoryRecord(line: string, lineNumber: number): LoongTrajectoryRecord {
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
  const record = value as unknown as LoongTrajectoryRecord;
  validateTrajectoryRecord(record);
  return record;
}

export async function readTrajectoryFileNames(
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

export function normalizeTrajectoryListFilter(filter: TrajectoryListFilter): TrajectoryListFilter {
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

export function normalizeTrajectoryDate(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!isIsoDate(trimmed)) {
    throw new MemoryToolError(`trajectory_list ${fieldName} must use YYYY-MM-DD.`);
  }
  return trimmed;
}

function trajectoryDateMatches(fileDate: string, dateFrom: string | undefined, dateTo: string | undefined): boolean {
  return (dateFrom === undefined || fileDate >= dateFrom)
    && (dateTo === undefined || fileDate <= dateTo);
}

function trajectoryRecordMatches(record: LoongTrajectoryRecord, filter: TrajectoryListFilter): boolean {
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

function toTrajectorySummary(record: LoongTrajectoryRecord): TrajectoryRecordSummary {
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
  record: LoongTrajectoryRecord,
  maxEvents: number,
): LoongTrajectoryRecord {
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
