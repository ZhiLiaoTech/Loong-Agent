import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertCanAppendFile } from "./memory-file-io.js";
import {
  createMemoryId,
  DEFAULT_MAX_MEMORY_RECORD_BYTES,
  DEFAULT_MAX_MEMORY_RECORDS,
  DEFAULT_MEMORY_SEARCH_LIMIT,
  parseMemoryRecord,
  scoreMemoryRecord,
  stringifyMemoryRecord,
  validateMemoryDraft,
  ABSOLUTE_MAX_MEMORY_RECORDS,
  ABSOLUTE_MEMORY_SEARCH_LIMIT,
} from "./memory-record-helpers.js";
import {
  ABSOLUTE_MAX_MEMORY_RECORD_BYTES,
  type FileMemoryStoreOptions,
  type MemoryRecord,
  type MemorySearchResult,
  type MemoryStore,
} from "./memory-record-types.js";
import { tokenize } from "./memory-text.js";
import { clampPositiveInteger, isNodeError } from "./memory-util.js";

export const DEFAULT_MAX_MEMORY_FILE_BYTES = 16 * 1024 * 1024;
export const ABSOLUTE_MAX_MEMORY_FILE_BYTES = 128 * 1024 * 1024;

export function createFileMemoryStore(options: FileMemoryStoreOptions = {}): MemoryStore {
  return new FileMemoryStore(options);
}

export class FileMemoryStore implements MemoryStore {
  readonly #rootDir: string;
  readonly #filePath: string;
  readonly #maxRecords: number;
  readonly #maxRecordBytes: number;
  readonly #maxFileBytes: number;

  constructor(options: FileMemoryStoreOptions = {}) {
    this.#rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".loong", "memory"));
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
    await this.#pruneRecordsIfNeeded();
    return memoryRecord;
  }

  async #pruneRecordsIfNeeded(): Promise<void> {
    let content: string;
    try {
      content = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    if (lines.length <= this.#maxRecords) {
      return;
    }
    const kept = lines.slice(-this.#maxRecords);
    await writeFile(this.#filePath, `${kept.join("\n")}\n`, "utf8");
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

