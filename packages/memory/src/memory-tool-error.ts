import { summarizeText } from "./memory-text.js";

export class MemoryToolError extends Error {
  readonly safeMessage: string;

  constructor(safeMessage: string) {
    super(safeMessage);
    this.name = "MemoryToolError";
    this.safeMessage = safeMessage;
  }
}

export function sanitizeMemoryToolError(error: unknown): string {
  return error instanceof MemoryToolError
    ? summarizeText(error.safeMessage, 1000)
    : "Memory tool failed.";
}
