import { useCallback, useMemo, useState } from "react";
import { readStoredLocale, resolveMessage, getMessages } from "../i18n/resolve.js";

export interface ChatSessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

const REGISTRY_KEY = "loong.chat.sessions.v1";
const ACTIVE_KEY = "loong.chat.activeSession.v1";
const LEGACY_SESSION_ID = "studio";

function readRegistry(): ChatSessionMeta[] {
  if (typeof globalThis.sessionStorage === "undefined") {
    return [];
  }
  try {
    const raw = globalThis.sessionStorage.getItem(REGISTRY_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is ChatSessionMeta =>
        typeof entry === "object"
        && entry !== null
        && typeof (entry as ChatSessionMeta).id === "string"
        && typeof (entry as ChatSessionMeta).title === "string",
    );
  } catch {
    return [];
  }
}

function writeRegistry(sessions: readonly ChatSessionMeta[]): void {
  if (typeof globalThis.sessionStorage === "undefined") {
    return;
  }
  globalThis.sessionStorage.setItem(REGISTRY_KEY, JSON.stringify(sessions));
}

function readActiveId(): string | null {
  if (typeof globalThis.sessionStorage === "undefined") {
    return null;
  }
  return globalThis.sessionStorage.getItem(ACTIVE_KEY);
}

function writeActiveId(sessionId: string): void {
  if (typeof globalThis.sessionStorage === "undefined") {
    return;
  }
  globalThis.sessionStorage.setItem(ACTIVE_KEY, sessionId);
}

function defaultSessionTitle(): string {
  const locale = readStoredLocale();
  return resolveMessage(getMessages(locale), "chat.defaultConversation");
}

function newSessionTitle(): string {
  const locale = readStoredLocale();
  return resolveMessage(getMessages(locale), "chat.newConversation");
}

function createDefaultRegistry(): ChatSessionMeta[] {
  const now = new Date().toISOString();
  return [{
    id: LEGACY_SESSION_ID,
    title: defaultSessionTitle(),
    createdAt: now,
    updatedAt: now,
  }];
}

function ensureRegistry(): ChatSessionMeta[] {
  const existing = readRegistry();
  if (existing.length > 0) {
    return existing;
  }
  const defaults = createDefaultRegistry();
  writeRegistry(defaults);
  if (!readActiveId()) {
    writeActiveId(LEGACY_SESSION_ID);
  }
  return defaults;
}

function newSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `studio-${globalThis.crypto.randomUUID()}`;
  }
  return `studio-${Date.now()}`;
}

export function useChatSessions() {
  const [sessions, setSessions] = useState<ChatSessionMeta[]>(() => ensureRegistry());
  const [activeSessionId, setActiveSessionId] = useState(() => {
    ensureRegistry();
    return readActiveId() ?? LEGACY_SESSION_ID;
  });

  const activeSession = useMemo(
    () => sessions.find(entry => entry.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions],
  );

  const persist = useCallback((next: ChatSessionMeta[]) => {
    writeRegistry(next);
    setSessions(next);
  }, []);

  const selectSession = useCallback((sessionId: string) => {
    writeActiveId(sessionId);
    setActiveSessionId(sessionId);
  }, []);

  const createSession = useCallback((title?: string) => {
    const now = new Date().toISOString();
    const session: ChatSessionMeta = {
      id: newSessionId(),
      title: title?.trim() || newSessionTitle(),
      createdAt: now,
      updatedAt: now,
    };
    const next = [session, ...sessions];
    persist(next);
    selectSession(session.id);
    return session;
  }, [persist, selectSession, sessions]);

  const touchSession = useCallback((sessionId: string, patch?: Partial<Pick<ChatSessionMeta, "title">>) => {
    const now = new Date().toISOString();
    const next = sessions.map(entry =>
      entry.id === sessionId
        ? {
            ...entry,
            ...patch,
            updatedAt: now,
          }
        : entry,
    );
    persist(next);
  }, [persist, sessions]);

  const renameFromFirstMessage = useCallback((sessionId: string, message: string) => {
    const session = sessions.find(entry => entry.id === sessionId);
    const text = message.trim();
    if (!session || session.title !== newSessionTitle() || !text) {
      return;
    }
    const title = text.length > 24 ? `${text.slice(0, 24)}…` : text;
    touchSession(sessionId, { title });
  }, [sessions, touchSession]);

  return {
    sessions,
    activeSessionId,
    activeSession,
    selectSession,
    createSession,
    touchSession,
    renameFromFirstMessage,
  };
}
