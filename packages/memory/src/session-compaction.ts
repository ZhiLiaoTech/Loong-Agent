import { lstat, open } from "node:fs/promises";
import path from "node:path";
import type { DragonContextProvider } from "@dragon/core";
import { parseTurnRecord, sessionPath } from "./file-session-store.js";
import type { SessionMessage, SessionTurnRecord } from "./memory-types.js";
import { summarizeText } from "./memory-text.js";
import {
  ABSOLUTE_MAX_HISTORY_MESSAGES,
  clampPositiveInteger,
  DEFAULT_MAX_HISTORY_MESSAGES,
  isNodeError,
  sameFileStat,
} from "./memory-util.js";

const DEFAULT_SESSION_COMPACTION_RECENT_MESSAGES = DEFAULT_MAX_HISTORY_MESSAGES;
const ABSOLUTE_SESSION_COMPACTION_RECENT_MESSAGES = ABSOLUTE_MAX_HISTORY_MESSAGES;
const DEFAULT_SESSION_COMPACTION_MESSAGES = 24;
const ABSOLUTE_SESSION_COMPACTION_MESSAGES = 100;
const DEFAULT_SESSION_COMPACTION_CHARS = 6000;
const ABSOLUTE_SESSION_COMPACTION_CHARS = 20_000;
const DEFAULT_SESSION_COMPACTION_FILE_BYTES = 8 * 1024 * 1024;
const ABSOLUTE_SESSION_COMPACTION_FILE_BYTES = 64 * 1024 * 1024;

export interface SessionCompactionContextProviderOptions {
  rootDir?: string;
  recentMessages?: number;
  maxMessages?: number;
  maxContentChars?: number;
  maxFileBytes?: number;
}

export function createSessionCompactionContextProvider(
  options: SessionCompactionContextProviderOptions = {},
): DragonContextProvider {
  const rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "sessions"));
  const recentMessages = clampPositiveInteger(
    options.recentMessages,
    DEFAULT_SESSION_COMPACTION_RECENT_MESSAGES,
    ABSOLUTE_SESSION_COMPACTION_RECENT_MESSAGES,
  );
  const maxMessages = clampPositiveInteger(
    options.maxMessages,
    DEFAULT_SESSION_COMPACTION_MESSAGES,
    ABSOLUTE_SESSION_COMPACTION_MESSAGES,
  );
  const maxContentChars = clampPositiveInteger(
    options.maxContentChars,
    DEFAULT_SESSION_COMPACTION_CHARS,
    ABSOLUTE_SESSION_COMPACTION_CHARS,
  );
  const maxFileBytes = clampPositiveInteger(
    options.maxFileBytes,
    DEFAULT_SESSION_COMPACTION_FILE_BYTES,
    ABSOLUTE_SESSION_COMPACTION_FILE_BYTES,
  );

  return {
    name: "session_compaction",
    async buildContext(request) {
      const records = await readSessionTurnRecords(rootDir, request.input.sessionId, maxFileBytes);
      if (records.length === 0) {
        return [];
      }
      const messages = records
        .flatMap(record => record.messages)
        .filter(message => message.role === "user" || message.role === "assistant");
      const compactableCount = Math.max(0, messages.length - recentMessages);
      if (compactableCount === 0) {
        return [];
      }
      const compacted = compactSessionMessages(
        messages.slice(0, compactableCount),
        maxMessages,
        maxContentChars,
      );
      const content = compacted.messages.map(formatCompactedSessionMessage).join("\n");
      return content
        ? [{
            title: "Older session context",
            content,
            priority: 15,
            metadata: {
              compactedMessages: compacted.messages.length,
              omittedOlderMessages: compacted.omittedMessages,
              recentMessages,
              ...(compacted.truncated ? { truncated: true } : {}),
            },
          }]
        : [];
    },
  };
}

async function readSessionTurnRecords(
  rootDir: string,
  sessionId: string,
  maxFileBytes: number,
): Promise<SessionTurnRecord[]> {
  const filePath = sessionPath(rootDir, sessionId);
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    return [];
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    return [];
  }
  if (before.size > maxFileBytes) {
    return [];
  }

  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, "r");
  } catch {
    return [];
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileStat(before, opened)) {
      return [];
    }
    if (opened.size > maxFileBytes) {
      return [];
    }
    const after = await lstat(filePath);
    if (!after.isFile() || after.isSymbolicLink() || !sameFileStat(opened, after)) {
      return [];
    }
    const buffer = Buffer.alloc(maxFileBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxFileBytes) {
      return [];
    }
    const content = buffer.subarray(0, bytesRead).toString("utf8");
    const records: SessionTurnRecord[] = [];
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const record = parseTurnRecord(trimmed, index + 1, filePath);
      if (record.sessionId !== sessionId) {
        return [];
      }
      records.push(record);
    }
    return records;
  } catch {
    return [];
  } finally {
    await handle.close();
  }
}

interface CompactedSessionMessages {
  messages: SessionMessage[];
  omittedMessages: number;
  truncated: boolean;
}

function compactSessionMessages(
  compactableMessages: SessionMessage[],
  maxMessages: number,
  maxContentChars: number,
): CompactedSessionMessages {
  const selected: SessionMessage[] = [];
  let chars = 0;
  let truncated = false;
  for (let index = compactableMessages.length - 1; index >= 0; index -= 1) {
    if (selected.length >= maxMessages) {
      truncated = true;
      break;
    }
    const message = compactableMessages[index];
    if (message === undefined) {
      continue;
    }
    const line = formatCompactedSessionMessage(message);
    const separatorChars = selected.length > 0 ? 1 : 0;
    if (chars + separatorChars + line.length > maxContentChars) {
      truncated = true;
      break;
    }
    selected.push(message);
    chars += separatorChars + line.length;
  }
  selected.reverse();
  return {
    messages: selected,
    omittedMessages: Math.max(0, compactableMessages.length - selected.length),
    truncated,
  };
}

function formatCompactedSessionMessage(message: SessionMessage): string {
  const timestamp = message.createdAt ? ` at ${message.createdAt}` : "";
  const content = summarizeText(message.content.replace(/\s+/g, " ").trim(), 500);
  return `- ${message.role}${timestamp}: ${content}`;
}
