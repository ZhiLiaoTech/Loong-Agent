import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const indexPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "index.ts");
let lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/);

// Remove session types (0-based 221-259)
lines.splice(221, 39);

// Remove file session store block (was 3087-3277, after first splice shift -3091+39 = -3052 from original)
// Find createFileSessionStore line
const start = lines.findIndex(line => line.startsWith("export function createFileSessionStore"));
const end = lines.findIndex((line, i) => i > start && line.startsWith("function clampPositiveInteger"));
if (start >= 0 && end > start) {
  lines.splice(start, end - start);
}

// Remove util duplicates at end (clampPositiveInteger through sameFileStat)
const utilStart = lines.findIndex(line => line.startsWith("function clampPositiveInteger"));
if (utilStart >= 0) {
  lines.splice(utilStart);
}

const insert = `export type {
  FileSessionStoreOptions,
  SessionMessage,
  SessionSource,
  SessionStore,
  SessionTurnRecord,
  SessionUsage,
} from "./memory-types.js";
export { createFileSessionStore, FileSessionStore } from "./file-session-store.js";
import {
  ABSOLUTE_MAX_HISTORY_MESSAGES,
  clampPositiveInteger,
  DEFAULT_MAX_HISTORY_MESSAGES,
  isIsoTimestamp,
  isNodeError,
  isObject,
  isPathInside,
  sameFileStat,
  stringifyJson,
} from "./memory-util.js";
`;

const toolImport = lines.findIndex(line => line.includes('from "@loong/tools"'));
lines.splice(toolImport + 1, 0, insert);

fs.writeFileSync(indexPath, `${lines.join("\n")}\n`);
console.log("patched index.ts, lines:", lines.length);
