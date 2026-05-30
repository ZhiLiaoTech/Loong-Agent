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

// Remove trajectory type block (FileTrajectoryStoreOptions through TrajectoryGetOutput)
const trajTypeStart = findLine("export interface FileTrajectoryStoreOptions");
const trajTypeEnd = findLine("export interface MemoryContextProviderOptions");
lines.splice(trajTypeStart, trajTypeEnd - trajTypeStart);

// Remove MemoryToolError class
const errStart = findLine("class MemoryToolError");
const errEnd = findLine("const DEFAULT_MAX_MEMORY_RECORDS");
lines.splice(errStart, errEnd - errStart);

// Remove trajectory constants
const trajConstStart = lines.findIndex(line => line.startsWith("const DEFAULT_MAX_TRAJECTORY_EVENTS"));
const trajConstEnd = lines.findIndex((line, i) => i > trajConstStart && line.startsWith("const DEFAULT_TRAJECTORY_TOOL_DATE_WINDOW_DAYS"));
if (trajConstStart >= 0 && trajConstEnd >= 0) {
  lines.splice(trajConstStart, trajConstEnd - trajConstStart + 1);
}

// Remove trajectory schemas
const listSchema = findLine("const trajectoryListSchema");
const memSearchSchema = findLine("const memorySearchSchema");
if (listSchema < memSearchSchema) {
  // trajectory schemas are AFTER memory schemas in file - find trajectoryListSchema after memoryCandidateRejectSchema
}
const trajSchemaStart = lines.findIndex(line => line.startsWith("const trajectoryListSchema"));
const trajSchemaEnd = lines.findIndex((line, i) => i > trajSchemaStart && line.startsWith("export function createFileMemoryStore"));
if (trajSchemaStart >= 0 && trajSchemaEnd > trajSchemaStart) {
  lines.splice(trajSchemaStart, trajSchemaEnd - trajSchemaStart);
}

// Remove createFileTrajectoryStore factory (single line block)
const createTraj = findLine("export function createFileTrajectoryStore");
if (lines[createTraj + 1]?.includes("return new FileTrajectoryStore")) {
  lines.splice(createTraj, 3);
}

// Remove createTrajectoryTools block
const createTrajTools = findLine("export function createTrajectoryTools");
const afterTrajTools = lines.findIndex((line, i) => i > createTrajTools && line.startsWith("export function createMemoryContextProvider"));
lines.splice(createTrajTools, afterTrajTools - createTrajTools);

// Remove trajectory tool functions createTrajectoryListTool through limitTrajectoryStoreForTools
const trajListTool = findLine("export function createTrajectoryListTool");
const afterLimit = lines.findIndex((line, i) => i > trajListTool && line.startsWith("export class FileMemoryStore"));
lines.splice(trajListTool, afterLimit - trajListTool);

// Remove FileTrajectoryStore class
const fileTrajClass = findLine("export class FileTrajectoryStore");
const safelyInvoke = findLine("async function safelyInvokeMemoryTool");
lines.splice(fileTrajClass, safelyInvoke - fileTrajClass);

// Remove duplicate helpers at end: summarizeText through trajectoryPath
const summarizeStart = lines.findIndex(line => line.startsWith("function summarizeText"));
const trajPathEnd = lines.findIndex((line, i) => i > summarizeStart && line.startsWith("function trajectoryPath"));
if (summarizeStart >= 0 && trajPathEnd >= 0) {
  lines.splice(summarizeStart, lines.length - summarizeStart);
}

// Remove assertCanAppendFile and assertCanAppendRegularFile
const assertStart = lines.findIndex(line => line.startsWith("async function assertCanAppendFile"));
const assertEnd = lines.findIndex((line, i) => i > assertStart && line.startsWith("async function assertSafeMemoryCandidateDirectory"));
if (assertStart >= 0 && assertEnd > assertStart) {
  lines.splice(assertStart, assertEnd - assertStart);
}

// Remove parseTrajectory* and withInvocationSession and sanitizeMemoryToolError if still there
for (const prefix of [
  "function parseTrajectoryListInput",
  "function withInvocationSession",
  "function parseTrajectoryGetInput",
  "function sanitizeMemoryToolError",
  "function validateTrajectoryRecord",
  "function parseTrajectoryRecord",
  "async function readTrajectoryFileNames",
  "function normalizeTrajectoryListFilter",
  "function normalizeTrajectoryDate",
  "function isIsoDate",
  "function shiftDate",
  "function normalizeRunId",
  "function normalizeOptionalText",
  "function trajectoryDateMatches",
  "function trajectoryRecordMatches",
  "function toTrajectorySummary",
  "function normalizeTrajectoryRecord",
]) {
  const i = lines.findIndex(line => line.startsWith(prefix));
  if (i >= 0) {
    let end = i + 1;
    while (end < lines.length && !lines[end].match(/^(export |async function |function |class )/) && lines[end].trim() !== "") {
      end += 1;
    }
    // walk until next top-level function
    while (end < lines.length) {
      const line = lines[end];
      if (line.match(/^(export |async function |function |class )/) && end > i + 1) {
        break;
      }
      end += 1;
    }
    lines.splice(i, end - i);
  }
}

const insertAfterToolsImport = lines.findIndex(line => line.includes('from "@loong/tools"'));
const block = `
export type {
  FileTrajectoryStoreOptions,
  TrajectoryGetInput,
  TrajectoryGetOutput,
  TrajectoryListFilter,
  TrajectoryListInput,
  TrajectoryListOutput,
  TrajectoryListResult,
  TrajectoryRecordSummary,
  TrajectoryStore,
} from "./trajectory-types.js";
export { createFileTrajectoryStore, FileTrajectoryStore } from "./file-trajectory-store.js";
export { createTrajectoryTools, createTrajectoryGetTool, createTrajectoryListTool } from "./trajectory-tools.js";
export { MemoryToolError, sanitizeMemoryToolError } from "./memory-tool-error.js";
export {
  fitText,
  isIsoDate,
  normalizeOptionalText,
  normalizeRunId,
  shiftDate,
  summarizeText,
  tokenize,
} from "./memory-text.js";
export { assertCanAppendFile, assertCanAppendRegularFile } from "./memory-file-io.js";
import { MemoryToolError } from "./memory-tool-error.js";
import { assertCanAppendFile, assertCanAppendRegularFile } from "./memory-file-io.js";
import {
  fitText,
  normalizeOptionalText,
  normalizeRunId,
  shiftDate,
  summarizeText,
  tokenize,
} from "./memory-text.js";
`;

lines.splice(insertAfterToolsImport + 1, 0, ...block.trim().split("\n"));

fs.writeFileSync(indexPath, `${lines.join("\n")}\n`);
console.log("patched index.ts, lines:", lines.length);
