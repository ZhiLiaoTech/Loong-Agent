export function readThinkingLevel(metadata?: Record<string, unknown>): "low" | "medium" | "high" | undefined {
  const thinking = metadata?.thinking;
  if (thinking === "low" || thinking === "medium" || thinking === "high") {
    return thinking;
  }
  return undefined;
}
