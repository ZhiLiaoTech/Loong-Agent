export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string; code?: number };
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export function parseJsonRpcResponseBody(body: string, contentType = ""): JsonRpcResponse {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error("MCP response body was empty.");
  }
  if (contentType.includes("text/event-stream") || trimmed.startsWith("event:") || trimmed.includes("\ndata: ")) {
    return parseJsonRpcSseBody(trimmed);
  }
  return JSON.parse(trimmed) as JsonRpcResponse;
}

export function parseJsonRpcSseBody(body: string): JsonRpcResponse {
  let lastWithId: JsonRpcResponse | undefined;
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) {
      continue;
    }
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }
    const parsed = JSON.parse(payload) as JsonRpcResponse;
    if (parsed.id !== undefined) {
      lastWithId = parsed;
    }
  }
  if (!lastWithId) {
    throw new Error("MCP SSE response did not include a JSON-RPC message with an id.");
  }
  return lastWithId;
}

export function jsonRpcErrorMessage(response: JsonRpcResponse): string {
  return response.error?.message ?? `MCP error ${response.error?.code ?? "unknown"}`;
}
