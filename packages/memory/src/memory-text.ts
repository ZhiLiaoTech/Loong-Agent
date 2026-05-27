import { MemoryToolError } from "./memory-tool-error.js";

export function summarizeText(value: string, maxChars: number): string {
  return value.length > maxChars
    ? `${value.slice(0, maxChars)}... [${value.length} chars]`
    : value;
}

export function normalizeOptionalText(value: string, fieldName: string, maxChars: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new MemoryToolError(`${fieldName} cannot be empty.`);
  }
  if (trimmed.length > maxChars) {
    throw new MemoryToolError(`${fieldName} must be ${maxChars} characters or fewer.`);
  }
  return trimmed;
}

export function normalizeRunId(value: string): string {
  return normalizeOptionalText(value, "runId", 200);
}

export function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function fitText(value: string, maxChars: number, suffix: string): string {
  if (maxChars <= 0) {
    return "";
  }
  if (value.length <= maxChars) {
    return value;
  }
  if (suffix.length + 1 >= maxChars) {
    return value.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - suffix.length - 1)} ${suffix}`;
}

export function tokenize(value: string): string[] {
  const normalized = value.toLowerCase();
  return [
    ...new Set([
      ...(normalized.match(/[\p{L}\p{N}_-]{2,}/gu) ?? []),
      ...normalized.split(/\s+/).filter(part => part.length >= 2),
    ]),
  ];
}
