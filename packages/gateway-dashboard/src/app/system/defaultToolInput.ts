export function defaultToolInput(toolName: string): Record<string, unknown> {
  if (toolName === "git_status") {
    return { porcelain: false };
  }
  if (toolName === "git_diff") {
    return { stat: true, maxChars: 20000 };
  }
  if (toolName === "git_log") {
    return { limit: 10, maxChars: 20000 };
  }
  return {};
}
