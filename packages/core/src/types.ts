export type DragonSource = "cli" | "gateway" | "web" | "ide" | "cron" | "api";

export type DragonThinkingLevel = "none" | "low" | "medium" | "high";

export interface DragonTurnInput {
  sessionId: string;
  message: string;
  source: DragonSource;
  history?: DragonMessage[];
  workspace?: string;
  model?: string;
  modelFallbacks?: string[];
  thinking?: DragonThinkingLevel;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface DragonMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface DragonUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface DragonTurnResult {
  runId: string;
  status: "ok" | "error" | "cancelled" | "timeout";
  messages: DragonMessage[];
  usage?: DragonUsage;
  error?: string;
}

export interface DragonSessionTurnRecord {
  sessionId: string;
  runId: string;
  source: DragonSource;
  createdAt: string;
  status: DragonTurnResult["status"];
  messages: DragonMessage[];
  workspace?: string;
  usage?: DragonUsage;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface DragonSessionStore {
  loadMessages(sessionId: string): Promise<DragonMessage[]>;
  appendTurn(record: DragonSessionTurnRecord): Promise<void>;
}

export interface DragonTrajectoryRecord {
  runId: string;
  sessionId: string;
  source: DragonSource;
  createdAt: string;
  completedAt: string;
  status: DragonTurnResult["status"];
  userMessage: string;
  assistantMessage?: string;
  workspace?: string;
  model?: string;
  usage?: DragonUsage;
  error?: string;
  events: DragonEvent[];
  metadata?: Record<string, unknown>;
}

export interface DragonTrajectoryStore {
  append(record: DragonTrajectoryRecord): Promise<void>;
}

export interface DragonContextItem {
  title?: string;
  content: string;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface DragonContextRequest {
  input: DragonTurnInput;
  history: DragonMessage[];
  runId: string;
  createdAt: string;
}

export interface DragonContextProvider {
  name: string;
  buildContext(request: DragonContextRequest): Promise<DragonContextItem[]>;
}

export type DragonLifecycleHookPhase = "start" | "end" | "error" | "cancelled";

export interface DragonLifecycleHookRequest {
  phase: DragonLifecycleHookPhase;
  runId: string;
  sessionId: string;
  source: DragonSource;
  createdAt: string;
  completedAt?: string;
  workspace?: string;
  model?: string;
  status?: DragonTurnResult["status"];
  userMessage?: string;
  assistantMessage?: string;
  error?: string;
  usage?: DragonUsage;
  metadata?: Record<string, unknown>;
}

export interface DragonLifecycleHook {
  /**
   * Lifecycle hooks run in the Dragon process. Keep synchronous work small:
   * the runtime isolates thrown errors, rejected promises, and async hooks that
   * do not settle in time, but JavaScript cannot preempt CPU-bound synchronous
   * hook code on the same event loop.
   */
  name: string;
  onLifecycle(request: Readonly<DragonLifecycleHookRequest>): Promise<void> | void;
}

export interface DragonPermissionRequest {
  runId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  reason: string;
  sessionId: string;
  workspace?: string;
  capabilities?: readonly string[];
}

export interface DragonPermissionResponse {
  decision: "allow" | "deny";
  reason?: string;
  metadata?: Record<string, unknown>;
}

export type DragonPermissionHandler = (
  request: DragonPermissionRequest,
) => Promise<DragonPermissionResponse | "allow" | "deny">;

export interface DragonPermissionEventPayload {
  toolCallId: string;
  toolName: string;
  reason?: string;
  sessionId?: string;
  workspace?: string;
  capabilities?: readonly string[];
  inputSummary?: unknown;
  decision?: "allow" | "deny";
  metadata?: Record<string, unknown>;
}

export type DragonEvent =
  | {
      type: "lifecycle";
      phase: "start" | "end" | "error" | "cancelled";
      runId: string;
      message?: string;
      metadata?: Record<string, unknown>;
    }
  | { type: "assistant_delta"; runId: string; text: string }
  | {
      type: "permission";
      runId: string;
      toolName: string;
      toolCallId: string;
      phase: "request" | "resolved";
      payload: DragonPermissionEventPayload;
    }
  | {
      type: "context";
      runId: string;
      providerName: string;
      phase: "start" | "end";
      payload?: unknown;
    }
  | { type: "tool"; runId: string; toolName: string; phase: "start" | "update" | "end"; payload?: unknown };

export interface DragonAgentRuntime {
  runTurn(input: DragonTurnInput): Promise<DragonTurnResult>;
  subscribe(listener: (event: DragonEvent) => void): () => void;
}
