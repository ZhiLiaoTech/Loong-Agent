import type { DragonSource, DragonThinkingLevel } from "@dragon/core";
import { badRequest } from "./gateway-http.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDragonSource(value: unknown): value is DragonSource {
  return ["cli", "gateway", "web", "ide", "cron", "api"].includes(String(value));
}

export function isDragonThinking(value: unknown): value is DragonThinkingLevel {
  return ["none", "low", "medium", "high"].includes(String(value));
}

export function normalizeShortText(value: string, fieldName: string, maxChars: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    badRequest(`${fieldName} cannot be empty.`);
  }
  if (trimmed.length > maxChars) {
    badRequest(`${fieldName} must be ${maxChars} characters or fewer.`);
  }
  return trimmed;
}

export function normalizeBoundedText(value: string, fieldName: string, maxChars: number): string {
  return normalizeShortText(value, fieldName, maxChars);
}
