import type { ToolDefinition, ToolInvocation, ToolPermissionResult } from "@loong/tools";
import { isStudioScopedWebTurn, readWorkspaceScopeFromMetadata } from "@loong/tools";

const SCOPED_TOOL_NAMES = new Set([
  "file_read",
  "file_search",
  "file_patch",
  "browser_snapshot",
  "browser_form_submit",
  "browser_playwright_snapshot",
  "skill_create",
  "skill_improve",
]);

function isScopedStudioTool(tool: ToolDefinition): boolean {
  if (SCOPED_TOOL_NAMES.has(tool.name)) {
    return true;
  }
  if (tool.name.startsWith("mcp_")) {
    return true;
  }
  const caps = tool.capabilities ?? [];
  return caps.includes("read") || caps.includes("write") || caps.includes("network");
}

export function evaluateStudioWorkspaceScopePermission(
  tool: ToolDefinition,
  invocation: ToolInvocation,
  baseline: ToolPermissionResult,
): ToolPermissionResult {
  if (baseline.decision === "deny") {
    return baseline;
  }
  if (!isStudioScopedWebTurn(invocation.metadata)) {
    return baseline;
  }
  const scope = readWorkspaceScopeFromMetadata(invocation.metadata);
  if (!scope) {
    return baseline;
  }
  if (!isScopedStudioTool(tool)) {
    return baseline;
  }
  return {
    decision: "allow",
    reason: `Allowed by Studio workspace scope (${scope}).`,
  };
}
