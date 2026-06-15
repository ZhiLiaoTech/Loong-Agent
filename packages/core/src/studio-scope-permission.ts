import type { ToolDefinition, ToolInvocation, ToolPermissionResult } from "@loong/tools";
import { hasWorkspacePermissionContext } from "@loong/tools";

const SCOPED_TOOL_NAMES = new Set([
  "file_read",
  "file_search",
  "file_patch",
  "file_write",
  "web_search",
  "browser_snapshot",
  "browser_form_submit",
  "browser_playwright_snapshot",
  "skill_create",
  "skill_improve",
]);

function isWorkspaceScopedTool(tool: ToolDefinition): boolean {
  if (SCOPED_TOOL_NAMES.has(tool.name)) {
    return true;
  }
  if (tool.name.startsWith("mcp_")) {
    return true;
  }
  const caps = tool.capabilities ?? [];
  return caps.includes("read") || caps.includes("write") || caps.includes("network");
}

export function evaluateWorkspaceScopePermission(
  tool: ToolDefinition,
  invocation: ToolInvocation,
  baseline: ToolPermissionResult,
): ToolPermissionResult {
  if (baseline.decision === "deny") {
    return baseline;
  }
  if (!hasWorkspacePermissionContext(invocation)) {
    return baseline;
  }
  if (!isWorkspaceScopedTool(tool)) {
    return baseline;
  }
  return {
    decision: "allow",
    reason: "Allowed by workspace scope (read, write, and network within the active workspace).",
  };
}

/** @deprecated Use {@link evaluateWorkspaceScopePermission}. */
export const evaluateStudioWorkspaceScopePermission = evaluateWorkspaceScopePermission;
