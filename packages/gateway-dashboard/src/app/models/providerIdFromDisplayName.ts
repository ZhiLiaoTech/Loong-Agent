/** Derive a stable provider id when the user leaves advanced id blank. */
export function providerIdFromDisplayName(displayName: string): string {
  const normalized = displayName
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized) {
    return normalized.slice(0, 48);
  }

  return `service-${Date.now().toString(36)}`;
}
