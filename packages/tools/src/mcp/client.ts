import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { McpServerConfig } from "./config.js";
import { jsonRpcErrorMessage, type JsonRpcRequest, type JsonRpcResponse, type McpToolDescriptor } from "./jsonrpc.js";

export type { McpToolDescriptor } from "./jsonrpc.js";

export class McpStdioClient {
  readonly #config: McpServerConfig;
  #child: ReturnType<typeof spawn> | undefined;
  #nextId = 1;
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();

  constructor(config: McpServerConfig) {
    this.#config = config;
  }

  async connect(): Promise<void> {
    if (this.#child) {
      return;
    }
    const command = this.#config.command?.trim();
    if (!command) {
      throw new Error(`MCP server ${this.#config.id} has no command.`);
    }
    const child = spawn(command, this.#config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(this.#config.env ?? {}) },
    });
    this.#child = child;
    const stdout = child.stdout;
    if (!stdout) {
      throw new Error(`MCP server ${this.#config.id} has no stdout.`);
    }
    const reader = createInterface({ input: stdout });
    reader.on("line", line => {
      this.#handleLine(line);
    });
    child.on("exit", () => {
      this.#child = undefined;
      for (const pending of this.#pending.values()) {
        pending.reject(new Error(`MCP server ${this.#config.id} exited.`));
      }
      this.#pending.clear();
    });
    await this.#request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "loong", version: "0.0.0" },
    });
    await this.#notify("notifications/initialized", {});
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = await this.#request("tools/list", {}) as { tools?: McpToolDescriptor[] } | undefined;
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.#request("tools/call", { name, arguments: args }) as { content?: unknown } | undefined;
    return result?.content ?? result;
  }

  async close(): Promise<void> {
    const child = this.#child;
    this.#child = undefined;
    if (child && !child.killed) {
      child.kill();
    }
  }

  async #notify(method: string, params: Record<string, unknown>): Promise<void> {
    await this.#write({ jsonrpc: "2.0", id: this.#nextId++, method, params });
  }

  async #request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.#nextId++;
    const response = await new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      void this.#write({ jsonrpc: "2.0", id, method, params }).catch(reject);
    });
    return response;
  }

  async #write(request: JsonRpcRequest): Promise<void> {
    const child = this.#child;
    if (!child?.stdin) {
      throw new Error(`MCP server ${this.#config.id} is not connected.`);
    }
    child.stdin.write(`${JSON.stringify(request)}\n`);
  }

  #handleLine(line: string): void {
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }
    if (parsed.id === undefined) {
      return;
    }
    const pending = this.#pending.get(parsed.id);
    if (!pending) {
      return;
    }
    this.#pending.delete(parsed.id);
    if (parsed.error) {
      pending.reject(new Error(jsonRpcErrorMessage(parsed)));
      return;
    }
    pending.resolve(parsed.result);
  }
}
