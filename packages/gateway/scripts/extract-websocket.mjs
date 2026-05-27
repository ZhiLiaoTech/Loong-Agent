import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const indexPath = path.join(srcDir, "index.ts");
const lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/);

const start = lines.findIndex(l => l.startsWith("interface ParsedWebSocketFrame"));
const end = lines.findIndex((l, i) => i > start && l.startsWith("function isTurnStatus"));
if (start < 0 || end < 0) throw new Error("slice bounds not found");

const header = `import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { MAX_REQUEST_BYTES, readSingleHeader } from "./gateway-http.js";
import type { GatewayWebSocketEnvelope } from "./gateway-rpc-types.js";
import { fitUtf8Text } from "./gateway-text.js";

export const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const WEBSOCKET_PROTOCOL = "dragon.gateway.v1";
export const MAX_WEBSOCKET_MESSAGE_BYTES = MAX_REQUEST_BYTES;
export const MAX_WEBSOCKET_BUFFER_BYTES = MAX_REQUEST_BYTES * 2;

export interface WebSocketClient {
  id: string;
  socket: Duplex;
  filters: import("./gateway-http-handler.js").EventStreamFilters extends never
    ? never
    : import("./index.js").EventStreamFilters;
  heartbeat: NodeJS.Timeout;
  buffer: Buffer;
  closed: boolean;
}

`;

// Fix WebSocketClient filters type - use EventStreamFilters from index export
const headerFixed = `import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { MAX_REQUEST_BYTES, readSingleHeader } from "./gateway-http.js";
import type { GatewayWebSocketEnvelope } from "./gateway-rpc-types.js";
import { fitUtf8Text } from "./gateway-text.js";

export const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const WEBSOCKET_PROTOCOL = "dragon.gateway.v1";
export const MAX_WEBSOCKET_MESSAGE_BYTES = MAX_REQUEST_BYTES;
export const MAX_WEBSOCKET_BUFFER_BYTES = MAX_REQUEST_BYTES * 2;

export interface EventStreamFilters {
  sessionId?: string;
  runId?: string;
}

export interface WebSocketClient {
  id: string;
  socket: Duplex;
  filters: EventStreamFilters;
  heartbeat: NodeJS.Timeout;
  buffer: Buffer;
  closed: boolean;
}

`;

let body = lines.slice(start, end).join("\n");
body = body
  .replace(/^interface ParsedWebSocketFrame/gm, "interface ParsedWebSocketFrame")
  .replace(/^function /gm, "export function ");

fs.writeFileSync(path.join(srcDir, "gateway-websocket.ts"), `${headerFixed}${body}\n`);

const removeConsts = [
  "const MAX_WEBSOCKET_MESSAGE_BYTES",
  "const MAX_WEBSOCKET_BUFFER_BYTES",
  "const WEBSOCKET_GUID",
  "const WEBSOCKET_PROTOCOL",
];
let newLines = lines.filter(l => !removeConsts.some(p => l.startsWith(p)));
const wsStart = newLines.findIndex(l => l.startsWith("interface ParsedWebSocketFrame"));
const wsEnd = newLines.findIndex((l, i) => i > wsStart && l.startsWith("function isTurnStatus"));
newLines.splice(wsStart, wsEnd - wsStart);

const fitStart = newLines.findIndex(l => l.startsWith("function fitUtf8Text"));
const fitEnd = newLines.findIndex((l, i) => i > fitStart && l.startsWith("function jsonSafeReplacer"));
newLines.splice(fitStart, fitEnd - fitStart);

const importLine = newLines.findIndex(l => l.includes('from "./gateway-http-handler.js"'));
newLines.splice(importLine + 1, 0, `import { fitUtf8Text } from "./gateway-text.js";`);
newLines.splice(importLine + 1, 0, `import {
  closeWebSocketClient,
  createWebSocketFrame,
  isValidWebSocketUpgrade,
  MAX_WEBSOCKET_BUFFER_BYTES,
  MAX_WEBSOCKET_MESSAGE_BYTES,
  parseWebSocketFrames,
  readWebSocketProtocols,
  rejectWebSocketUpgrade,
  sendWebSocketFrame,
  sendWebSocketJson,
  WEBSOCKET_GUID,
  WEBSOCKET_PROTOCOL,
  type WebSocketClient,
} from "./gateway-websocket.js";`);

// Remove duplicate WebSocketClient interface in index if EventStreamFilters stays
const wsClientIface = newLines.findIndex(l => l === "interface WebSocketClient {");
if (wsClientIface >= 0) {
  let depth = 0;
  let end = wsClientIface;
  for (let i = wsClientIface; i < newLines.length; i += 1) {
    if (newLines[i].includes("{")) depth += 1;
    if (newLines[i].includes("}")) depth -= 1;
    if (depth === 0 && i > wsClientIface) {
      end = i + 1;
      break;
    }
  }
  newLines.splice(wsClientIface, end - wsClientIface);
}

fs.writeFileSync(indexPath, `${newLines.join("\n")}\n`);
console.log("gateway index lines:", newLines.length);
