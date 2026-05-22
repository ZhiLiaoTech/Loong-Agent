import type { ToolDefinition, ToolRegistry } from "../types.js";
import { normalizeToolName } from "../registry.js";
import type { McpServerConfig } from "./config.js";
import { McpStdioClient } from "./client.js";
import { McpHttpClient, type McpHttpClientOptions } from "./http-client.js";
import type { McpToolDescriptor } from "./jsonrpc.js";

export interface RegisterMcpToolsOptions {
  servers: readonly McpServerConfig[];
  toolNamePrefix?: string;
  fetchImpl?: McpHttpClientOptions["fetchImpl"];
}

interface McpClient {
  connect(): Promise<void>;
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

function createMcpClient(server: McpServerConfig, options: RegisterMcpToolsOptions): McpClient {
  if (server.url) {
    return new McpHttpClient(server, { ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  }
  if (server.command) {
    return new McpStdioClient(server);
  }
  throw new Error(`MCP server ${server.id} requires either url or command.`);
}

export async function registerMcpTools(
  registry: ToolRegistry,
  options: RegisterMcpToolsOptions,
): Promise<{ registered: string[]; errors: string[] }> {
  const prefix = options.toolNamePrefix ?? "mcp";
  const registered: string[] = [];
  const errors: string[] = [];

  for (const server of options.servers) {
    const client = createMcpClient(server, options);
    try {
      await client.connect();
      const tools = await client.listTools();
      for (const tool of tools) {
        const localName = normalizeToolName(`${prefix}_${server.id}_${tool.name}`);
        const definition: ToolDefinition = {
          name: localName,
          description: tool.description?.trim() || `MCP tool ${tool.name} from server ${server.id}`,
          inputSchema: tool.inputSchema ?? { type: "object", additionalProperties: true },
          capabilities: ["network", "custom"],
          permission: "ask",
          async invoke(invocation) {
            const input = invocation.input;
            const args = input && typeof input === "object" && !Array.isArray(input)
              ? input as Record<string, unknown>
              : {};
            const output = await client.callTool(tool.name, args);
            return {
              id: invocation.id,
              ok: true,
              output,
            };
          },
        };
        registry.register(definition);
        registered.push(localName);
      }
    } catch (error) {
      errors.push(`${server.id}: ${error instanceof Error ? error.message : String(error)}`);
      await client.close().catch(() => undefined);
    }
  }

  return { registered, errors };
}
