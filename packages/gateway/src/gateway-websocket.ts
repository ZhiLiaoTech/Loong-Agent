import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { MAX_REQUEST_BYTES, readSingleHeader } from "./gateway-http.js";
import { fitUtf8Text } from "./gateway-text.js";
import type { EventStreamFilters } from "./gateway-event-stream.js";

export const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const WEBSOCKET_PROTOCOL = "loong.gateway.v1";
export const MAX_WEBSOCKET_MESSAGE_BYTES = MAX_REQUEST_BYTES;
export const MAX_WEBSOCKET_BUFFER_BYTES = MAX_REQUEST_BYTES * 2;

export interface WebSocketClient {
  id: string;
  socket: Duplex;
  filters: EventStreamFilters;
  heartbeat: NodeJS.Timeout;
  buffer: Buffer;
  closed: boolean;
}

interface ParsedWebSocketFrame {
  opcode: number;
  payload: Buffer;
}

interface ParsedWebSocketFrames {
  frames: ParsedWebSocketFrame[];
  remaining: Buffer;
}

export function isValidWebSocketUpgrade(request: IncomingMessage, key: string | undefined): key is string {
  if (request.method !== "GET") {
    return false;
  }
  const upgrade = readSingleHeader(request, "upgrade")?.toLowerCase();
  const connection = readSingleHeader(request, "connection")?.toLowerCase();
  const version = readSingleHeader(request, "sec-websocket-version");
  if (upgrade !== "websocket" || version !== "13" || !connection?.split(",").some(item => item.trim() === "upgrade")) {
    return false;
  }
  if (!key) {
    return false;
  }
  try {
    return Buffer.from(key, "base64").byteLength === 16;
  } catch {
    return false;
  }
}

export function readWebSocketProtocols(request: IncomingMessage): string[] {
  const header = readSingleHeader(request, "sec-websocket-protocol");
  if (!header) {
    return [];
  }
  return header.split(",").map(item => item.trim()).filter(Boolean);
}

export function rejectWebSocketUpgrade(socket: Duplex, statusCode: number, reason: string): void {
  const body = `${reason}\n`;
  socket.end([
    `HTTP/1.1 ${statusCode} ${reason}`,
    "Connection: close",
    "Content-Type: text/plain; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body, "utf8")}`,
    "",
    body,
  ].join("\r\n"));
}

export function parseWebSocketFrames(buffer: Buffer): ParsedWebSocketFrames {
  const frames: ParsedWebSocketFrame[] = [];
  let offset = 0;
  while (buffer.byteLength - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    if (first === undefined || second === undefined) {
      break;
    }
    const fin = (first & 0x80) !== 0;
    const reserved = first & 0x70;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLength = second & 0x7f;
    let headerLength = 2;

    if (reserved !== 0) {
      throw new Error("WebSocket extensions are not supported.");
    }
    if (!fin) {
      throw new Error("Fragmented WebSocket messages are not supported.");
    }
    if (!masked) {
      throw new Error("Client WebSocket frames must be masked.");
    }
    if (opcode !== 0x1 && opcode !== 0x8 && opcode !== 0x9 && opcode !== 0xA) {
      throw new Error("Unsupported WebSocket opcode.");
    }
    if (payloadLength === 126) {
      if (buffer.byteLength - offset < headerLength + 2) {
        break;
      }
      payloadLength = buffer.readUInt16BE(offset + headerLength);
      headerLength += 2;
    } else if (payloadLength === 127) {
      if (buffer.byteLength - offset < headerLength + 8) {
        break;
      }
      const extendedLength = buffer.readBigUInt64BE(offset + headerLength);
      if (extendedLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("WebSocket frame is too large.");
      }
      payloadLength = Number(extendedLength);
      headerLength += 8;
    }
    if (opcode >= 0x8 && payloadLength > 125) {
      throw new Error("WebSocket control frames must be 125 bytes or fewer.");
    }
    if (payloadLength > MAX_REQUEST_BYTES) {
      throw new Error(`WebSocket message exceeds ${MAX_REQUEST_BYTES} bytes.`);
    }
    const frameLength = headerLength + 4 + payloadLength;
    if (buffer.byteLength - offset < frameLength) {
      break;
    }
    const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
    const payload = Buffer.from(buffer.subarray(offset + headerLength + 4, offset + frameLength));
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] = payload[index]! ^ mask[index % 4]!;
    }
    frames.push({ opcode, payload });
    offset += frameLength;
  }
  return {
    frames,
    remaining: offset === 0 ? buffer : buffer.subarray(offset),
  };
}

export function sendWebSocketJson(client: WebSocketClient, payload: unknown): boolean {
  if (client.closed) {
    return false;
  }
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > MAX_WEBSOCKET_MESSAGE_BYTES) {
    return false;
  }
  sendWebSocketFrame(client, 0x1, Buffer.from(body, "utf8"));
  return true;
}

export function sendWebSocketFrame(client: WebSocketClient, opcode: number, payload: Buffer): void {
  if (client.closed) {
    return;
  }
  try {
    client.socket.write(createWebSocketFrame(opcode, payload));
  } catch {
    client.closed = true;
  }
}

export function closeWebSocketClient(client: WebSocketClient, statusCode: number, reason: string): void {
  if (client.closed) {
    return;
  }
  const reasonBytes = Buffer.from(fitUtf8Text(reason, 120, "[truncated]"), "utf8");
  const payload = Buffer.alloc(2 + reasonBytes.byteLength);
  payload.writeUInt16BE(statusCode, 0);
  reasonBytes.copy(payload, 2);
  client.closed = true;
  client.socket.end(createWebSocketFrame(0x8, payload));
  setTimeout(() => {
    client.socket.destroy();
  }, 1000).unref();
}

export function createWebSocketFrame(opcode: number, payload: Buffer): Buffer {
  const payloadLength = payload.byteLength;
  if (payloadLength < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, payloadLength]), payload]);
  }
  if (payloadLength <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payloadLength), 2);
  return Buffer.concat([header, payload]);
}
