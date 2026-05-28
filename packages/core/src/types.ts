export type DragonSource = "cli" | "gateway" | "web" | "ide" | "cron" | "api";

export type DragonThinkingLevel = "none" | "low" | "medium" | "high";

export type DragonAttachmentKind = "image" | "text" | "document" | "binary";

/**
 * A single attachment carried in a turn input. The runtime resolves text
 * attachments inline as a structured `<file>` block in the user prompt, image
 * attachments as multimodal content for vision-capable providers, and document
 * attachments (PDF/DOCX/XLSX/PPTX/...) by extracting their text server-side
 * before inlining.
 *
 * `data` is always base64-encoded.
 */
export interface DragonAttachment {
  /**
   * `image`    → forwarded to the provider as multimodal image content
   * `text`     → decoded as UTF-8 and inlined into the user prompt
   * `document` → extracted to text (mammoth/pdfjs/xlsx/jszip-pptx) and inlined
   * `binary`   → reserved for future use; currently rejected
   */
  kind: DragonAttachmentKind;
  mimeType: string;
  /** base64-encoded bytes */
  data: string;
  /** original filename for display */
  name?: string;
  /** decoded byte size (informational; runtime re-computes for validation) */
  size?: number;
}

export type DragonTierHint = "fast" | "standard" | "deep";

export interface DragonTurnInput {
  sessionId: string;
  message: string;
  source: DragonSource;
  history?: DragonMessage[];
  workspace?: string;
  model?: string;
  modelFallbacks?: string[];
  thinking?: DragonThinkingLevel;
  /** When false, model tool calling is disabled for this turn. */
  toolsEnabled?: boolean;
  /** When false, memory-related context providers are skipped. */
  memoryEnabled?: boolean;
  /** Appended to the runtime system prompt for this turn. */
  systemPrompt?: string;
  /** Optional file/image attachments. The runtime validates and resolves them. */
  attachments?: readonly DragonAttachment[];
  /** Caller-forced tier. Bypasses the heuristic classifier entirely. */
  tier?: DragonTierHint;
  /**
   * When true (default for Gateway when query loop is enabled), a turn that hits
   * the tool-iteration cap may request an automatic continuation turn.
   */
  queryLoop?: boolean;
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
  metadata?: Record<string, unknown>;
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
  | { type: "assistant_replace"; runId: string; text: string }
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
  /** Hot-swap tier scheduling for subsequent turns (optional on concrete runtimes). */
  setTierConfig?(config: import("./tiers.js").ModelTierConfig | undefined): void;
  /** Hot-swap model providers for subsequent turns (optional on concrete runtimes). */
  setProviderRegistry?(registry: import("@dragon/providers").ProviderRegistry): void;
}
