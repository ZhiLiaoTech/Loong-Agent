import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const indexPath = path.join(srcDir, "index.ts");
let lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/);

function findLine(prefix) {
  const i = lines.findIndex(line => line.startsWith(prefix));
  if (i < 0) throw new Error(`Missing: ${prefix}`);
  return i;
}

const typesStart = findLine("export interface MemoryCandidateLifecycleHookOptions");
const typesEnd = findLine("export interface MemoryContextProviderOptions");
const constStart = findLine("const DEFAULT_MEMORY_CANDIDATE_CHARS");
const schemaEnd = findLine("export function createFileMemoryStore");
const toolsStart = findLine("export function createMemoryCandidateTools");
const fileMemStart = findLine("export class FileMemoryStore");
const storeStart = findLine("function buildMemoryCandidate(");
const storeEnd = findLine("function parseMemorySearchInput");
const assertSafeStart = findLine("async function assertSafeMemoryCandidateDirectory");
const assertSafeEnd = findLine("function parseMemoryRecord");

const constSchemaBody = lines.slice(constStart, schemaEnd);
const toolsBody = lines.slice(toolsStart, fileMemStart);
const storeBody = [
  ...lines.slice(storeStart, storeEnd),
  "",
  ...lines.slice(assertSafeStart, assertSafeEnd),
];

const storeHeader = `import { createHash, randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, open, opendir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LoongLifecycleHookRequest } from "@loong/core";
import type { ToolInvocation } from "@loong/tools";
import { isLoongSource } from "./file-session-store.js";
import { normalizeTrajectoryDate } from "./file-trajectory-store.js";
import { withMemoryFileLock } from "./memory-file-lock.js";
import { MemoryToolError } from "./memory-tool-error.js";
import { normalizeOptionalText, summarizeText } from "./memory-text.js";
import {
  ABSOLUTE_MAX_MEMORY_RECORD_BYTES,
  isMemoryScope,
  type MemoryRecord,
} from "./memory-record-types.js";
import {
  clampPositiveInteger,
  isNodeError,
  isObject,
  isPathInside,
  sameFileStat,
  stringifyJson,
} from "./memory-util.js";
import type {
  MemoryCandidateListInput,
  MemoryCandidatePromoteInput,
  MemoryCandidateRecord,
  MemoryCandidateStatus,
} from "./memory-candidate-types.js";

export const DEFAULT_MEMORY_CANDIDATE_CHARS = 1200;
export const ABSOLUTE_MEMORY_CANDIDATE_CHARS = 4000;
export const DEFAULT_MEMORY_CANDIDATE_BYTES = 12_000;
export const ABSOLUTE_MEMORY_CANDIDATE_BYTES = 64_000;
export const DEFAULT_MEMORY_CANDIDATE_FILE_BYTES = 4 * 1024 * 1024;
export const ABSOLUTE_MEMORY_CANDIDATE_FILE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MEMORY_CANDIDATE_FILES = 366;
export const ABSOLUTE_MEMORY_CANDIDATE_FILES = 5000;
export const DEFAULT_MEMORY_CANDIDATE_LIST_LIMIT = 20;
export const ABSOLUTE_MEMORY_CANDIDATE_LIST_LIMIT = 100;

const memoryCandidateReviewLocks = new Set<string>();

`;

const toolsHeader = `import { randomUUID } from "node:crypto";
import path from "node:path";
import type { LoongLifecycleHook } from "@loong/core";
import type { ToolDefinition, ToolJsonSchema } from "@loong/tools";
import { safelyInvokeMemoryTool } from "./memory-tool-invoke.js";
import type { MemoryStore } from "./memory-record-types.js";
import {
  assertSafeMemoryCandidateDirectory,
  buildMemoryCandidate,
  DEFAULT_MEMORY_CANDIDATE_BYTES,
  DEFAULT_MEMORY_CANDIDATE_FILE_BYTES,
  DEFAULT_MEMORY_CANDIDATE_FILES,
  findMemoryCandidate,
  listMemoryCandidates,
  memoryCandidatePath,
  memoryDraftFromCandidate,
  parseMemoryCandidateListInput,
  parseMemoryCandidatePromoteInput,
  parseMemoryCandidateRejectInput,
  rewriteMemoryCandidate,
  stringifyMemoryCandidate,
  withMemoryCandidateReviewLock,
} from "./memory-candidate-store.js";
import type {
  MemoryCandidateLifecycleHookOptions,
  MemoryCandidateListInput,
  MemoryCandidateListOutput,
  MemoryCandidatePromoteInput,
  MemoryCandidatePromoteOutput,
  MemoryCandidateRejectInput,
  MemoryCandidateRejectOutput,
  MemoryCandidateToolsOptions,
} from "./memory-candidate-types.js";
import { clampPositiveInteger } from "./memory-util.js";
import { withMemoryFileLock } from "./memory-file-lock.js";
import { MemoryToolError } from "./memory-tool-error.js";
import { normalizeOptionalText } from "./memory-text.js";

${constSchemaBody.filter(line => line.includes("Schema") || line.includes("memoryCandidate")).join("\n")}

`;

let storeContent = storeBody.join("\n");
const exportPrefixes = [
  "async function listMemoryCandidates",
  "async function findMemoryCandidate",
  "async function rewriteMemoryCandidate",
  "function buildMemoryCandidate",
  "function stringifyMemoryCandidate",
  "function memoryCandidatePath",
  "async function withMemoryCandidateReviewLock",
  "function memoryDraftFromCandidate",
  "function parseMemoryCandidateListInput",
  "function parseMemoryCandidatePromoteInput",
  "function parseMemoryCandidateRejectInput",
  "async function assertSafeMemoryCandidateDirectory",
];
for (const prefix of exportPrefixes) {
  storeContent = storeContent.replace(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gm"), `export ${prefix}`);
}

const lockStart = storeContent.indexOf("const MEMORY_FILE_LOCK_TIMEOUT_MS");
const lockEnd = storeContent.indexOf("interface MemoryCandidateEntry");
if (lockStart >= 0 && lockEnd > lockStart) {
  storeContent = storeContent.slice(0, lockStart) + storeContent.slice(lockEnd);
}

fs.writeFileSync(path.join(srcDir, "memory-candidate-store.ts"), `${storeHeader}${storeContent}\n`);
fs.writeFileSync(path.join(srcDir, "memory-candidate-tools.ts"), `${toolsHeader}${toolsBody.join("\n")}\n`);

const removals = [
  { start: assertSafeStart, end: assertSafeEnd },
  { start: storeStart, end: storeEnd },
  { start: toolsStart, end: fileMemStart },
  { start: constStart, end: schemaEnd },
  { start: typesStart, end: typesEnd },
].sort((a, b) => b.start - a.start);

for (const { start, end } of removals) {
  lines.splice(start, end - start);
}

const insertAt = lines.findIndex(line => line.includes('from "@loong/tools"'));
const block = `
export type {
  FileMemoryStoreOptions,
  MemoryRecord,
  MemoryRememberInput,
  MemoryRememberOutput,
  MemorySearchInput,
  MemorySearchOutput,
  MemorySearchResult,
  MemoryStore,
  SqliteMemoryStoreOptions,
} from "./memory-record-types.js";
export { ABSOLUTE_MAX_MEMORY_RECORD_BYTES, isMemoryScope } from "./memory-record-types.js";
export type {
  MemoryCandidateLifecycleHookOptions,
  MemoryCandidateListInput,
  MemoryCandidateListOutput,
  MemoryCandidatePromoteInput,
  MemoryCandidatePromoteOutput,
  MemoryCandidateRecord,
  MemoryCandidateRejectInput,
  MemoryCandidateRejectOutput,
  MemoryCandidateStatus,
  MemoryCandidateToolsOptions,
} from "./memory-candidate-types.js";
export {
  createMemoryCandidateLifecycleHook,
  createMemoryCandidateListTool,
  createMemoryCandidatePromoteTool,
  createMemoryCandidateRejectTool,
  createMemoryCandidateTools,
} from "./memory-candidate-tools.js";
export { withMemoryFileLock } from "./memory-file-lock.js";
`;

lines.splice(insertAt + 1, 0, ...block.trim().split("\n"));

// Remove duplicate MemoryRecord block
const memRecStart = lines.findIndex(line => line === "export interface MemoryRecord {");
const memRecEnd = lines.findIndex((line, i) => i > memRecStart && line === "export interface MemoryContextProviderOptions {");
if (memRecStart >= 0 && memRecEnd > memRecStart) {
  lines.splice(memRecStart, memRecEnd - memRecStart);
}

fs.writeFileSync(indexPath, `${lines.join("\n")}\n`);
console.log("index lines:", lines.length);
