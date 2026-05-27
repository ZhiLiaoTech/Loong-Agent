export interface FileSessionStoreOptions {
  rootDir?: string;
  maxHistoryMessages?: number;
}

export type SessionSource = "cli" | "gateway" | "web" | "ide" | "cron" | "api";

export interface SessionMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface SessionUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface SessionTurnRecord {
  sessionId: string;
  runId: string;
  source: SessionSource;
  status: "ok" | "error" | "cancelled" | "timeout";
  createdAt: string;
  messages: SessionMessage[];
  workspace?: string;
  usage?: SessionUsage;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionStore {
  loadMessages(sessionId: string): Promise<SessionMessage[]>;
  appendTurn(record: SessionTurnRecord): Promise<void>;
}
