import type { McpServerConfig } from "./config.js";
import { jsonRpcErrorMessage, parseJsonRpcResponseBody, type JsonRpcRequest, type JsonRpcResponse } from "./jsonrpc.js";
import type { McpToolDescriptor } from "./jsonrpc.js";

export interface McpHttpClientOptions {
  fetchImpl?: typeof fetch;
}

export class McpHttpClient {
  readonly #config: McpServerConfig;
  readonly #fetchImpl: typeof fetch;
  #sessionId: string | undefined;
  #nextId = 1;

  constructor(config: McpServerConfig, options: McpHttpClientOptions = {}) {
    this.#config = config;
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  async connect(): Promise<void> {
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
    this.#sessionId = undefined;
  }

  async #notify(method: string, params: Record<string, unknown>): Promise<void> {
    await this.#post({ jsonrpc: "2.0", method, params });
  }

  async #request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.#nextId++;
    const response = await this.#post({ jsonrpc: "2.0", id, method, params });
    if (response.error) {
      throw new Error(jsonRpcErrorMessage(response));
    }
    return response.result;
  }

  async #post(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const url = this.#config.url?.trim();
    if (!url) {
      throw new Error(`MCP server ${this.#config.id} has no url.`);
    }
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(this.#config.headers ?? {}),
    };
    if (this.#sessionId) {
      headers["mcp-session-id"] = this.#sessionId;
    }
    let response: Response;
    try {
      response = await this.#fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
      });
    } catch (error) {
      throw new Error(
        `MCP HTTP server ${this.#config.id} request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const sessionId = response.headers.get("mcp-session-id")?.trim();
    if (sessionId) {
      this.#sessionId = sessionId;
    }
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `MCP HTTP server ${this.#config.id} returned HTTP ${response.status}: ${body.slice(0, 400)}`,
      );
    }
    if (request.id === undefined || !body.trim()) {
      return {};
    }
    const parsed = parseJsonRpcResponseBody(body, contentType);
    if (request.id !== undefined && parsed.id !== request.id) {
      throw new Error(`MCP HTTP server ${this.#config.id} returned mismatched JSON-RPC id.`);
    }
    return parsed;
  }
}
