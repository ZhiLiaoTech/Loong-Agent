import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  FileSessionStoreOptions,
  SessionMessage,
  SessionStore,
  SessionTurnRecord,
  SessionUsage,
} from "./memory-types.js";
import {
  ABSOLUTE_MAX_HISTORY_MESSAGES,
  clampPositiveInteger,
  DEFAULT_MAX_HISTORY_MESSAGES,
  isNodeError,
  isObject,
  stringifyJson,
} from "./memory-util.js";

export function createFileSessionStore(options: FileSessionStoreOptions = {}): SessionStore {
  return new FileSessionStore(options);
}

export class FileSessionStore implements SessionStore {
  readonly #rootDir: string;
  readonly #maxHistoryMessages: number;

  constructor(options: FileSessionStoreOptions = {}) {
    this.#rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".loong", "sessions"));
    this.#maxHistoryMessages = clampPositiveInteger(
      options.maxHistoryMessages,
      DEFAULT_MAX_HISTORY_MESSAGES,
      ABSOLUTE_MAX_HISTORY_MESSAGES,
    );
  }

  async loadMessages(sessionId: string): Promise<SessionMessage[]> {
    const filePath = sessionPath(this.#rootDir, sessionId);
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const messages: SessionMessage[] = [];
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const record = parseTurnRecord(trimmed, index + 1, filePath);
      if (record.sessionId !== sessionId) {
        throw new Error(`Session record mismatch in ${filePath} at line ${index + 1}.`);
      }
      messages.push(...record.messages);
    }

    return messages.slice(-this.#maxHistoryMessages);
  }

  async appendTurn(record: SessionTurnRecord): Promise<void> {
    validateTurnRecord(record, "append");
    await mkdir(this.#rootDir, { recursive: true });
    await appendFile(sessionPath(this.#rootDir, record.sessionId), `${stringifyJson(record)}\n`, "utf8");
  }
}

export function sessionPath(rootDir: string, sessionId: string): string {
  if (!sessionId.trim()) {
    throw new Error("Session id cannot be empty.");
  }
  const fileName = `${createHash("sha256").update(sessionId, "utf8").digest("hex")}.jsonl`;
  return path.join(rootDir, fileName);
}

export function parseTurnRecord(line: string, lineNumber: number, filePath: string): SessionTurnRecord {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(
      `Invalid session JSON in ${filePath} at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  validateTurnRecord(value, `${filePath}:${lineNumber}`);
  return value;
}

function validateTurnRecord(value: unknown, source: string): asserts value is SessionTurnRecord {
  if (!isObject(value)) {
    throw new Error(`Invalid session record at ${source}: expected object.`);
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    throw new Error(`Invalid session record at ${source}: missing sessionId.`);
  }
  if (typeof value.runId !== "string" || !value.runId.trim()) {
    throw new Error(`Invalid session record at ${source}: missing runId.`);
  }
  if (!isLoongSource(value.source)) {
    throw new Error(`Invalid session record at ${source}: invalid source.`);
  }
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    throw new Error(`Invalid session record at ${source}: invalid createdAt.`);
  }
  if (!isTurnStatus(value.status)) {
    throw new Error(`Invalid session record at ${source}: invalid status.`);
  }
  if (!Array.isArray(value.messages) || !value.messages.every(isLoongMessage)) {
    throw new Error(`Invalid session record at ${source}: invalid messages.`);
  }
  if (value.workspace !== undefined && typeof value.workspace !== "string") {
    throw new Error(`Invalid session record at ${source}: invalid workspace.`);
  }
  if (value.usage !== undefined && !isSessionUsage(value.usage)) {
    throw new Error(`Invalid session record at ${source}: invalid usage.`);
  }
  if (value.error !== undefined && typeof value.error !== "string") {
    throw new Error(`Invalid session record at ${source}: invalid error.`);
  }
  if (value.metadata !== undefined && !isObject(value.metadata)) {
    throw new Error(`Invalid session record at ${source}: invalid metadata.`);
  }
}

function isLoongMessage(value: unknown): value is SessionMessage {
  if (!isObject(value)) {
    return false;
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    return false;
  }
  if (!["system", "user", "assistant", "tool"].includes(String(value.role))) {
    return false;
  }
  if (typeof value.content !== "string") {
    return false;
  }
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    return false;
  }
  return value.metadata === undefined || isObject(value.metadata);
}

export function isLoongSource(value: unknown): boolean {
  return ["cli", "gateway", "web", "ide", "cron", "api"].includes(String(value));
}

function isSessionUsage(value: unknown): value is SessionUsage {
  if (!isObject(value)) {
    return false;
  }
  return ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "costUsd"].every(key => {
    const item = value[key];
    return item === undefined || (typeof item === "number" && Number.isFinite(item) && item >= 0);
  });
}

export function isTurnStatus(value: unknown): value is SessionTurnRecord["status"] {
  return ["ok", "error", "cancelled", "timeout"].includes(String(value));
}
