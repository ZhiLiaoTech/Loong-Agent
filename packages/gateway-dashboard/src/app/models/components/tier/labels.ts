import type { TierName } from "../../types.js";

export const TIER_ORDER: readonly TierName[] = ["fast", "standard", "deep"];

export function tierNameKey(name: TierName): string {
  return `models.tier.names.${name}`;
}

export function tierHintKey(name: TierName): string {
  return `models.tier.hints.${name}`;
}
