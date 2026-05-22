import { normalizeToolName, type ToolCapability, type ToolDefinition, type ToolRegistry } from "@dragon/tools";
import type { ModelToolCall } from "@dragon/providers";

const PARALLEL_SAFE_CAPABILITIES = new Set<ToolCapability>(["read", "network"]);

/** Read-only tools (read and/or network only) with baseline allow may run in parallel per round. */
export function isParallelSafeTool(tool: ToolDefinition): boolean {
  const capabilities = tool.capabilities ?? [];
  if (capabilities.length === 0) {
    return false;
  }
  if (capabilities.some(capability => !PARALLEL_SAFE_CAPABILITIES.has(capability))) {
    return false;
  }
  return tool.permission === "allow";
}

export function canRunToolCallsInParallel(toolCalls: ModelToolCall[], registry: ToolRegistry): boolean {
  if (toolCalls.length <= 1) {
    return false;
  }
  return toolCalls.every(toolCall => {
    const toolName = toolCall.function?.name?.trim();
    if (!toolName) {
      return false;
    }
    const tool = registry.get(normalizeToolName(toolName));
    return tool !== undefined && isParallelSafeTool(tool);
  });
}
