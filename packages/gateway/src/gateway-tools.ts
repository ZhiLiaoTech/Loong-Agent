import type { ToolDefinition } from "@dragon/tools";

export interface GatewayToolSummary {
  name: string;
  description: string;
  capabilities?: readonly string[];
  permission?: "allow" | "ask" | "deny";
  inputSchema?: unknown;
  directInvokeAllowed: boolean;
  source?: "builtin" | "mcp" | "plugin";
}

export function classifyGatewayToolSource(toolName: string): "builtin" | "mcp" | "plugin" {
  if (toolName.startsWith("mcp_")) {
    return "mcp";
  }
  if (toolName.startsWith("plugin_")) {
    return "plugin";
  }
  return "builtin";
}

export function isDirectToolCandidate(tool: ToolDefinition, directToolNames: ReadonlySet<string>): boolean {
  if (!directToolNames.has(tool.name) || tool.permission !== "allow") {
    return false;
  }
  const capabilities = tool.capabilities ?? [];
  if (
    capabilities.includes("write")
    || capabilities.includes("custom")
    || capabilities.includes("network")
    || capabilities.includes("memory")
  ) {
    return false;
  }
  return true;
}

export function summarizeGatewayTool(
  tool: ToolDefinition,
  directToolNames: ReadonlySet<string>,
  includeSchemas: boolean,
): GatewayToolSummary {
  const summary: GatewayToolSummary = {
    name: tool.name,
    description: tool.description,
    directInvokeAllowed: isDirectToolCandidate(tool, directToolNames),
    source: classifyGatewayToolSource(tool.name),
  };
  if (tool.capabilities !== undefined) {
    summary.capabilities = [...tool.capabilities];
  }
  if (tool.permission !== undefined) {
    summary.permission = tool.permission;
  }
  if (includeSchemas) {
    summary.inputSchema = tool.inputSchema;
  }
  return summary;
}
