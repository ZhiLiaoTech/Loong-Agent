import type { ToolInvocation, ToolResult } from "@dragon/tools";
import { sanitizeMemoryToolError } from "./memory-tool-error.js";

export async function safelyInvokeMemoryTool<TOutput>(
  invocation: ToolInvocation,
  fn: () => Promise<TOutput>,
): Promise<ToolResult<TOutput>> {
  try {
    return {
      id: invocation.id,
      ok: true,
      output: await fn(),
    };
  } catch (error) {
    return {
      id: invocation.id,
      ok: false,
      error: sanitizeMemoryToolError(error),
    };
  }
}
