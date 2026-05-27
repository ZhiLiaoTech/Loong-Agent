import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(root, "src", "index.ts");
const helpersPath = path.join(root, "src", "lib", "test-helpers.ts");

const index = fs.readFileSync(indexPath, "utf8");
const lines = index.split(/\r?\n/);

const header = `import { randomBytes } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import type { Server } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { DragonAgentRuntime, DragonEvent, DragonTurnInput, DragonTurnResult } from "@dragon/core";
import type { ToolDefinition } from "@dragon/tools";

export const TEST_TIMEOUT_MS = 5000;
type AnyBuffer = Buffer<ArrayBufferLike>;
const execFile = promisify(execFileCallback);
export const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

`;

const start = lines.findIndex(line => line.startsWith("function createMockTool"));
const end = lines.findIndex((line, i) => i > start && line.startsWith("async function delay"));
if (start < 0 || end < 0) {
  throw new Error("Could not find helper block");
}

let body = lines.slice(start, end + 2).join("\n");
body = body
  .replace(/^function /gm, "export function ")
  .replace(/^async function rpc/gm, "export async function rpc")
  .replace(/^async function postJson/gm, "export async function postJson")
  .replace(/^async function listenOnLoopback/gm, "export async function listenOnLoopback")
  .replace(/^async function closeServer/gm, "export async function closeServer")
  .replace(/^async function runCli/gm, "export async function runCli")
  .replace(/^async function delay/gm, "export async function delay")
  .replace(/^async function rawWebSocketUpgrade/gm, "export async function rawWebSocketUpgrade")
  .replace(/^class RawWebSocketClient/gm, "export class RawWebSocketClient");

fs.mkdirSync(path.dirname(helpersPath), { recursive: true });
fs.writeFileSync(helpersPath, `${header}${body}\n`);

const importBlock = `import {
  assert,
  assertThrows,
  closeServer,
  createEventRuntime,
  createMockTool,
  createNoopRuntime,
  delay,
  isRecord,
  listenOnLoopback,
  mustFindTool,
  postJson,
  rawWebSocketUpgrade,
  RawWebSocketClient,
  readArray,
  readHeader,
  readPath,
  readRecordArray,
  readRecordArrayAt,
  rpc,
  runCli,
  toSse,
  WORKSPACE_ROOT,
} from "./lib/test-helpers.js";
`;

const newLines = [
  ...lines.slice(0, 90),
  importBlock.trim(),
  "",
  ...lines.slice(94, start),
  "",
  ...lines.slice(end + 2),
];
fs.writeFileSync(indexPath, `${newLines.join("\n")}\n`);
console.log("extracted helpers, index lines:", newLines.length);
