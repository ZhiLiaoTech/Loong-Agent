import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const indexPath = path.join(srcDir, "index.ts");
const lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/);

function lineIndex(prefix) {
  const i = lines.findIndex(l => l.startsWith(prefix));
  if (i < 0) throw new Error(`Missing ${prefix}`);
  return i;
}

const fileStoreStart = lineIndex("export class FileMemoryStore");
const fileStoreEnd = lineIndex("async function readSessionTurnRecords");
const sqliteStart = lineIndex("export class SqliteMemoryStore");
const sqliteEnd = lineIndex("function parseMemorySearchInput");
const helpersStart = sqliteEnd;
const helpersEnd = lines.length;

const helpersHeader = `import { createHash, randomUUID } from "node:crypto";
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

`;

const fileHeader = `import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertCanAppendFile } from "./memory-file-io.js";
import {
  createMemoryId,
  DEFAULT_MAX_MEMORY_FILE_BYTES,
  DEFAULT_MAX_MEMORY_RECORD_BYTES,
  DEFAULT_MAX_MEMORY_RECORDS,
  DEFAULT_MEMORY_SEARCH_LIMIT,
  parseMemoryRecord,
  scoreMemoryRecord,
  stringifyMemoryRecord,
  validateMemoryDraft,
  ABSOLUTE_MAX_MEMORY_RECORD_BYTES,
  ABSOLUTE_MAX_MEMORY_RECORDS,
  ABSOLUTE_MEMORY_SEARCH_LIMIT,
} from "./memory-record-helpers.js";
import type { FileMemoryStoreOptions, MemoryRecord, MemorySearchResult, MemoryStore } from "./memory-record-types.js";
import { clampPositiveInteger, isNodeError } from "./memory-util.js";

export const DEFAULT_MAX_MEMORY_FILE_BYTES = 16 * 1024 * 1024;
export const ABSOLUTE_MAX_MEMORY_FILE_BYTES = 128 * 1024 * 1024;

export function createFileMemoryStore(options: FileMemoryStoreOptions = {}): MemoryStore {
  return new FileMemoryStore(options);
}

`;

const sqliteHeader = `import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { MemoryToolError } from "./memory-tool-error.js";
import {
  createMemoryId,
  DEFAULT_MAX_MEMORY_FILE_BYTES,
  DEFAULT_MAX_MEMORY_RECORD_BYTES,
  DEFAULT_MAX_MEMORY_RECORDS,
  DEFAULT_MEMORY_SEARCH_LIMIT,
  escapeSqlLike,
  readSqlitePragmaNumber,
  sqliteRankToScore,
  sqliteRowToMemoryRecord,
  stringifyMemoryRecord,
  toSafeFtsQuery,
  validateMemoryDraft,
  ABSOLUTE_MAX_MEMORY_RECORD_BYTES,
  ABSOLUTE_MAX_MEMORY_RECORDS,
  ABSOLUTE_MEMORY_SEARCH_LIMIT,
} from "./memory-record-helpers.js";
import type { MemorySearchResult, MemoryStore, SqliteMemoryStoreOptions } from "./memory-record-types.js";
import { clampPositiveInteger, isNodeError, isObject, stringifyJson, tokenize } from "./memory-util.js";

export function createSqliteMemoryStore(options: SqliteMemoryStoreOptions = {}): MemoryStore {
  return new SqliteMemoryStore(options);
}

`;

let helpersBody = lines.slice(helpersStart, helpersEnd).join("\n");
helpersBody = helpersBody
  .replace(/^function /gm, "export function ")
  .replace(/^export export /gm, "export ");

fs.writeFileSync(path.join(srcDir, "memory-record-helpers.ts"), `${helpersHeader}${helpersBody}\n`);
fs.writeFileSync(path.join(srcDir, "file-memory-store.ts"), `${fileHeader}${lines.slice(fileStoreStart, fileStoreEnd).join("\n")}\n`);
fs.writeFileSync(path.join(srcDir, "sqlite-memory-store.ts"), `${sqliteHeader}${lines.slice(sqliteStart, sqliteEnd).join("\n")}\n`);

const removals = [
  { start: helpersStart, end: helpersEnd },
  { start: sqliteStart, end: sqliteEnd },
  { start: lineIndex("export function createFileMemoryStore"), end: fileStoreStart },
  { start: fileStoreStart, end: fileStoreEnd },
  { start: lineIndex("const DEFAULT_MAX_MEMORY_RECORDS"), end: lineIndex("const memorySearchSchema") },
].sort((a, b) => b.start - a.start);

let newLines = [...lines];
for (const { start, end } of removals) {
  newLines.splice(start, end - start);
}

const insertAt = newLines.findIndex(l => l.includes('from "@loong/tools"'));
const block = `
export { createFileMemoryStore, FileMemoryStore } from "./file-memory-store.js";
export { createSqliteMemoryStore, SqliteMemoryStore } from "./sqlite-memory-store.js";
export {
  createMemoryId,
  parseMemoryRememberInput,
  parseMemorySearchInput,
  scoreMemoryRecord,
  summarizeMemoryResults,
  validateMemoryDraft,
} from "./memory-record-helpers.js";
`;

newLines.splice(insertAt + 1, 0, ...block.trim().split("\n"));

// Fix index constants - keep context constants, remove duplicate DEFAULT_MAX_MEMORY_RECORD_BYTES if any
const dupConst = newLines.findIndex((l, i) => l.includes("DEFAULT_MAX_MEMORY_RECORD_BYTES") && i > 150);
if (dupConst >= 0 && newLines[dupConst].startsWith("const DEFAULT_MAX_MEMORY")) {
  newLines.splice(dupConst, 1);
}

fs.writeFileSync(indexPath, `${newLines.join("\n")}\n`);
console.log("index lines:", newLines.length);
