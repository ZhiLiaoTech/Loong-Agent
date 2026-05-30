import { randomBytes } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import type { Server } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { LoongAgentRuntime, LoongEvent, LoongTurnInput, LoongTurnResult } from "@loong/core";
import type { ToolDefinition } from "@loong/tools";

export const TEST_TIMEOUT_MS = 5000;
type AnyBuffer = Buffer<ArrayBufferLike>;
const execFile = promisify(execFileCallback);
export const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

export function createMockTool(
  name: string,
  capabilities: NonNullable<ToolDefinition["capabilities"]>,
  output: (invocation: Parameters<ToolDefinition["invoke"]>[0]) => Promise<unknown>,
): ToolDefinition {
  return {
    name,
    description: name,
    inputSchema: { type: "object", additionalProperties: true },
    capabilities,
    permission: "allow",
    async invoke(invocation) {
      return {
        id: invocation.id,
        ok: true,
        output: await output(invocation),
      };
    },
  };
}

export function createNoopRuntime(): LoongAgentRuntime {
  return {
    async runTurn(): Promise<LoongTurnResult> {
      throw new Error("Runtime should not be called in this test.");
    },
    subscribe() {
      return () => undefined;
    },
  };
}

export function createEventRuntime(): LoongAgentRuntime {
  const listeners = new Set<(event: LoongEvent) => void>();
  return {
    async runTurn(input: LoongTurnInput): Promise<LoongTurnResult> {
      const runId = "ws-run-1";
      for (const listener of listeners) {
        listener({
          type: "lifecycle",
          runId,
          phase: "start",
          metadata: { sessionId: input.sessionId },
        });
      }
      await delay(10);
      return {
        runId,
        status: "ok",
        messages: [
          { id: "user-1", role: "user", content: input.message, createdAt: new Date().toISOString() },
          { id: "assistant-1", role: "assistant", content: "ws-ok", createdAt: new Date().toISOString() },
        ],
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export async function rpc(baseUrl: string, type: string, params?: unknown, secret = "secret"): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ type, id: `${type}-${Date.now()}`, params }),
  });
  return {
    status: response.status,
    json: await response.json() as Record<string, unknown>,
  };
}

export async function postJson(url: string, body: unknown, secret = "secret"): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    json: await response.json() as Record<string, unknown>,
  };
}

export class RawWebSocketClient {
  readonly #socket: net.Socket;
  #buffer: AnyBuffer = Buffer.alloc(0);
  #messages: Array<Record<string, unknown>> = [];
  #waiters: Array<{
    predicate: (message: Record<string, unknown>) => boolean;
    resolve: (message: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    label: string;
    timer: NodeJS.Timeout;
  }> = [];

  private constructor(socket: net.Socket, initialBuffer: AnyBuffer) {
    this.#socket = socket;
    this.#buffer = initialBuffer;
    this.#socket.on("data", chunk => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#drainFrames();
    });
    this.#socket.on("error", error => {
      this.#rejectAll(error);
    });
    this.#socket.on("close", () => {
      this.#rejectAll(new Error("WebSocket closed."));
    });
    this.#drainFrames();
  }

  static async connect(port: number, pathname: string, headers: Record<string, string>): Promise<RawWebSocketClient> {
    const response = await rawWebSocketUpgrade(port, pathname, headers, true);
    assert(response.statusLine.startsWith("HTTP/1.1 101"), `Expected 101 upgrade, got ${response.statusLine}`);
    return new RawWebSocketClient(response.socket, response.remaining);
  }

  sendJson(value: unknown): void {
    this.#socket.write(createClientTextFrame(JSON.stringify(value)));
  }

  async waitForJson(
    predicate: (message: Record<string, unknown>) => boolean,
    label: string,
  ): Promise<Record<string, unknown>> {
    const existing = this.#messages.find(predicate);
    if (existing) {
      return existing;
    }
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter(waiter => waiter.timer !== timer);
        reject(new Error(`Timed out waiting for ${label}`));
      }, TEST_TIMEOUT_MS);
      this.#waiters.push({ predicate, resolve, reject, label, timer });
    });
  }

  close(): void {
    this.#socket.end(createClientCloseFrame());
  }

  #drainFrames(): void {
    while (this.#buffer.length >= 2) {
      const parsed = parseServerFrame(this.#buffer);
      if (!parsed) {
        return;
      }
      this.#buffer = parsed.remaining;
      if (parsed.opcode === 0x1) {
        const message = JSON.parse(parsed.payload.toString("utf8")) as Record<string, unknown>;
        this.#messages.push(message);
        const waiter = this.#waiters.find(item => item.predicate(message));
        if (waiter) {
          clearTimeout(waiter.timer);
          this.#waiters = this.#waiters.filter(item => item !== waiter);
          waiter.resolve(message);
        }
      } else if (parsed.opcode === 0x9) {
        this.#socket.write(createClientPongFrame(parsed.payload));
      } else if (parsed.opcode === 0x8) {
        this.close();
      }
    }
  }

  #rejectAll(error: Error): void {
    for (const waiter of this.#waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.#waiters = [];
  }
}

export async function rawWebSocketUpgrade(
  port: number,
  pathname: string,
  headers: Record<string, string>,
  keepOpen?: false,
): Promise<string>;
export async function rawWebSocketUpgrade(
  port: number,
  pathname: string,
  headers: Record<string, string>,
  keepOpen: true,
): Promise<{ statusLine: string; socket: net.Socket; remaining: AnyBuffer }>;
export async function rawWebSocketUpgrade(
  port: number,
  pathname: string,
  headers: Record<string, string>,
  keepOpen = false,
): Promise<string | { statusLine: string; socket: net.Socket; remaining: AnyBuffer }> {
  return await new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let buffer: AnyBuffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Raw WebSocket upgrade timed out."));
    }, TEST_TIMEOUT_MS);

    socket.on("connect", () => {
      const key = randomBytes(16).toString("base64");
      socket.write([
        `GET ${pathname} HTTP/1.1`,
        "Host: 127.0.0.1",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        "",
        "",
      ].join("\r\n"));
    });
    socket.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }
      clearTimeout(timer);
      const rawHeader = buffer.subarray(0, headerEnd).toString("utf8");
      const remaining = buffer.subarray(headerEnd + 4);
      if (keepOpen) {
        socket.removeAllListeners("data");
        socket.removeAllListeners("close");
        socket.removeAllListeners("error");
        resolve({ statusLine: rawHeader.split("\r\n")[0] ?? "", socket, remaining });
        return;
      }
      socket.destroy();
      resolve(rawHeader);
    });
    socket.on("close", () => {
      if (!keepOpen && buffer.length > 0) {
        clearTimeout(timer);
        resolve(buffer.toString("utf8"));
      }
    });
    socket.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export function createClientTextFrame(text: string): AnyBuffer {
  return createClientFrame(0x1, Buffer.from(text, "utf8"));
}

export function createClientPongFrame(payload: AnyBuffer): AnyBuffer {
  return createClientFrame(0xA, payload);
}

export function createClientCloseFrame(): AnyBuffer {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(1000, 0);
  return createClientFrame(0x8, payload);
}

export function createClientFrame(opcode: number, payload: AnyBuffer): AnyBuffer {
  const mask = randomBytes(4);
  let header: AnyBuffer;
  if (payload.byteLength < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payload.byteLength]);
  } else if (payload.byteLength <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.byteLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.byteLength), 2);
  }
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] = masked[index]! ^ mask[index % 4]!;
  }
  return Buffer.concat([header, mask, masked]);
}

export function parseServerFrame(buffer: AnyBuffer): { opcode: number; payload: AnyBuffer; remaining: AnyBuffer } | undefined {
  if (buffer.length < 2) {
    return undefined;
  }
  const first = buffer[0]!;
  const second = buffer[1]!;
  const opcode = first & 0x0f;
  let payloadLength = second & 0x7f;
  let headerLength = 2;
  if (payloadLength === 126) {
    if (buffer.length < 4) {
      return undefined;
    }
    payloadLength = buffer.readUInt16BE(2);
    headerLength = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) {
      return undefined;
    }
    payloadLength = Number(buffer.readBigUInt64BE(2));
    headerLength = 10;
  }
  const frameLength = headerLength + payloadLength;
  if (buffer.length < frameLength) {
    return undefined;
  }
  return {
    opcode,
    payload: buffer.subarray(headerLength, frameLength),
    remaining: buffer.subarray(frameLength),
  };
}

export async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert(address !== null && typeof address !== "string", "test HTTP server did not bind to a TCP port");
  return address.port;
}

export async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export function readHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function runCli(args: string[], envOverrides: Record<string, string> = {}): Promise<{ stdout: string; stderr: string }> {
  const cliPath = path.join(WORKSPACE_ROOT, "packages", "cli", "dist", "index.js");
  return await execFile(process.execPath, [cliPath, ...args], {
    cwd: WORKSPACE_ROOT,
    timeout: TEST_TIMEOUT_MS,
    windowsHide: true,
    env: {
      ...process.env,
      LOONG_OPENAI_API_KEY: "",
      OPENAI_API_KEY: "",
      LOONG_ANTHROPIC_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      LOONG_OPENROUTER_API_KEY: "",
      OPENROUTER_API_KEY: "",
      LOONG_MODEL: "",
      LOONG_MODEL_CONFIG: path.join(os.tmpdir(), `loong-test-empty-model-config-${process.pid}.json`),
      LOONG_TIER_CONFIG: path.join(os.tmpdir(), `loong-test-empty-tier-config-${process.pid}.json`),
      LOONG_TIER: "",
      LOONG_PLUGIN_ROOTS: "",
      LOONG_SKILL_ROOTS: "",
      ...envOverrides,
    },
  });
}

export function mustFindTool<TInput, TOutput>(
  tools: ToolDefinition[],
  name: string,
): ToolDefinition<TInput, TOutput> {
  const tool = tools.find(item => item.name === name);
  assert(tool !== undefined, `Missing tool: ${name}`);
  return tool as ToolDefinition<TInput, TOutput>;
}

export function readArray(value: unknown, key: string): Array<Record<string, unknown> | string> {
  const item = isRecord(value) ? value[key] : undefined;
  return Array.isArray(item) ? item : [];
}

export function readRecordArray(value: unknown, key: string): Array<Record<string, unknown>> {
  return readArray(value, key).filter(isRecord);
}

export function readRecordArrayAt(value: unknown, pathItems: Array<string | number>): Array<Record<string, unknown>> {
  const item = readPath(value, pathItems);
  return Array.isArray(item) ? item.filter(isRecord) : [];
}

export function toSse(items: Array<Record<string, unknown> | string>, eventName?: string): string {
  return items.map(item => {
    const lines = [];
    if (eventName !== undefined) {
      lines.push(`event: ${eventName}`);
    }
    lines.push(`data: ${typeof item === "string" ? item : JSON.stringify(item)}`);
    return `${lines.join("\n")}\n\n`;
  }).join("");
}

export function readPath(value: unknown, pathItems: Array<string | number>): unknown {
  let current = value;
  for (const item of pathItems) {
    if (typeof item === "number") {
      current = Array.isArray(current) ? current[item] : undefined;
    } else {
      current = isRecord(current) ? current[item] : undefined;
    }
  }
  return current;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertThrows(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

export async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}
