import type { ChatTurn } from "./types.js";
import { trimChatTurns } from "./chatHistoryRestore.js";

const TURNS_KEY_PREFIX = "loong.chat.turns.v1.";

function turnsStorageKey(sessionId: string): string {
  return `${TURNS_KEY_PREFIX}${sessionId}`;
}

function isPersistableTurn(turn: ChatTurn): boolean {
  return !turn.streaming;
}

export function loadLocalChatTurns(sessionId: string): ChatTurn[] {
  if (typeof globalThis.sessionStorage === "undefined") {
    return [];
  }
  try {
    const raw = globalThis.sessionStorage.getItem(turnsStorageKey(sessionId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return trimChatTurns(
      parsed.filter(
        (entry): entry is ChatTurn =>
          typeof entry === "object"
          && entry !== null
          && (entry as ChatTurn).role !== undefined
          && typeof (entry as ChatTurn).text === "string",
      ).map(entry => ({ ...entry, streaming: false })),
    );
  } catch {
    return [];
  }
}

export function saveLocalChatTurns(sessionId: string, turns: readonly ChatTurn[]): void {
  if (typeof globalThis.sessionStorage === "undefined") {
    return;
  }
  const persistable = trimChatTurns(turns.filter(isPersistableTurn));
  try {
    if (!persistable.length) {
      globalThis.sessionStorage.removeItem(turnsStorageKey(sessionId));
      return;
    }
    globalThis.sessionStorage.setItem(turnsStorageKey(sessionId), JSON.stringify(persistable));
  } catch {
    // Ignore quota errors; gateway trajectory remains source of truth.
  }
}
