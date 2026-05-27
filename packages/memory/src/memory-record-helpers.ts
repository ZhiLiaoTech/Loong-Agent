import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  ABSOLUTE_MAX_MEMORY_RECORD_BYTES,
  isMemoryScope,
  type MemoryRecord,
  type MemoryRememberInput,
  type MemorySearchInput,
  type MemorySearchResult,
} from "./memory-record-types.js";
import { MemoryToolError } from "./memory-tool-error.js";
import { fitText, summarizeText, tokenize } from "./memory-text.js";
import { isObject, stringifyJson } from "./memory-util.js";

export const DEFAULT_MAX_MEMORY_RECORDS = 5000;
export const ABSOLUTE_MAX_MEMORY_RECORDS = 50_000;
export const DEFAULT_MAX_MEMORY_RECORD_BYTES = 16_000;
export const DEFAULT_MEMORY_SEARCH_LIMIT = 10;
export const ABSOLUTE_MEMORY_SEARCH_LIMIT = 50;

export function parseMemorySearchInput(input: unknown): MemorySearchInput {
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

export function parseMemoryRememberInput(input: unknown): MemoryRememberInput {
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

export function validateMemoryDraft(
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

export function stringifyMemoryRecord(record: MemoryRecord, maxRecordBytes: number): string {
  const json = stringifyJson(record);
  if (Buffer.byteLength(`${json}\n`, "utf8") > maxRecordBytes) {
    throw new MemoryToolError(`Memory record is larger than ${maxRecordBytes} bytes.`);
  }
  return json;
}

export function parseMemoryRecord(line: string, lineNumber: number): MemoryRecord {
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

export function sqliteRowToMemoryRecord(row: Record<string, unknown>, source: string): MemoryRecord {
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

export function readSqliteText(row: Record<string, unknown>, key: string, source: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid SQLite memory record from ${source}: ${key} must be a non-empty string.`);
  }
  return value;
}

export function readOptionalSqliteText(row: Record<string, unknown>, key: string, source: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid SQLite memory record from ${source}: ${key} must be a string.`);
  }
  return value.trim() ? value : undefined;
}

export function readSqlitePragmaNumber(database: DatabaseSync, sql: string, key: string): number {
  const row = database.prepare(sql).get();
  const value = row?.[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new MemoryToolError(`SQLite memory database returned invalid ${key}.`);
  }
  return value;
}

export function toSafeFtsQuery(tokens: string[]): string | undefined {
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

export function sqliteRankToScore(rank: number): number {
  if (!Number.isFinite(rank)) {
    return 0;
  }
  const score = Math.max(0, -rank) * 1_000_000;
  return Number(score.toFixed(6));
}

export function escapeSqlLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

export function validateMemoryRecord(value: unknown, lineNumber: number): asserts value is MemoryRecord {
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

export function createMemoryId(record: Omit<MemoryRecord, "id" | "createdAt">, createdAt: string): string {
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

export function scoreMemoryRecord(
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

export function summarizeMemoryResults(results: MemorySearchResult[], maxContentChars: number): string {
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



