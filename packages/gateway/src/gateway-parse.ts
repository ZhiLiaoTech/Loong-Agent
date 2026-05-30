import type { LoongSource, LoongThinkingLevel } from "@loong/core";
import { badRequest } from "./gateway-http.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isLoongSource(value: unknown): value is LoongSource {
  return ["cli", "gateway", "web", "ide", "cron", "api"].includes(String(value));
}

export function isLoongThinking(value: unknown): value is LoongThinkingLevel {
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
