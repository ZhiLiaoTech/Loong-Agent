import type { ConfiguredModelOption } from "../models/buildConfiguredModelOptions.js";

export function formatAgentModelLabel(
  modelRef: string | undefined,
  options: readonly ConfiguredModelOption[],
): string | undefined {
  const trimmed = modelRef?.trim();
  if (!trimmed) {
    return undefined;
  }

  const match = options.find(option => option.value === trimmed);
  if (match) {
    return match.label;
  }

  const parts = trimmed.split(":");
  if (parts.length > 1) {
    return `${parts[0]} — ${parts.at(-1) ?? trimmed}`;
  }

  return trimmed;
}
