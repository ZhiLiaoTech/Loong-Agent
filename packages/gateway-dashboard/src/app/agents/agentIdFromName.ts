/** Derive a stable profile id when the user leaves advanced id blank. */
export function agentIdFromName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized) {
    return normalized.slice(0, 48);
  }

  return `assistant-${Date.now().toString(36)}`;
}
