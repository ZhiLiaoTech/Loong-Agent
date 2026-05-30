export type LoongSource = "cli" | "gateway" | "web" | "ide" | "cron" | "api";

export type LoongThinkingLevel = "none" | "low" | "medium" | "high";

export type LoongAttachmentKind = "image" | "text" | "document" | "binary";

/**
 * A single attachment carried in a turn input. The runtime resolves text
 * attachments inline as a structured `<file>` block in the user prompt, image
 * attachments as multimodal content for vision-capable providers, and document
 * attachments (PDF/DOCX/XLSX/PPTX/...) by extracting their text server-side
 * before inlining.
 *
 * `data` is always base64-encoded.
 */
export interface LoongAttachment {
  /**
   * `image`    â†?forwarded to the provider as multimodal image content
   * `text`     â†?decoded as UTF-8 and inlined into the user prompt
   * `document` â†?extracted to text (mammoth/pdfjs/xlsx/jszip-pptx) and inlined
   * `binary`   â†?reserved for future use; currently rejected
   */
  kind: LoongAttachmentKind;
  mimeType: string;
  /** base64-encoded bytes */
  data: string;
  /** original filename for display */
  name?: string;
  /** decoded byte size (informational; runtime re-computes for validation) */
  size?: number;
}

export type LoongTierHint = "fast" | "standard" | "deep";

export interface LoongTurnInput {
  sessionId: string;
  message: string;
  source: LoongSource;
  history?: LoongMessage[];
  workspace?: string;
  model?: string;
  modelFallbacks?: string[];
  thinking?: LoongThinkingLevel;
  /** When false, model tool calling is disabled for this turn. */
  toolsEnabled?: boolean;
  /** When false, memory-related context providers are skipped. */
  memoryEnabled?: boolean;
  /** Appended to the runtime system prompt for this turn. */
  systemPrompt?: string;
  /** Optional file/image attachments. The runtime validates and resolves them. */
  attachments?: readonly LoongAttachment[];
  /** Caller-forced tier. Bypasses the heuristic classifier entirely. */
  tier?: LoongTierHint;
  /**
   * When true (default for Gateway when query loop is enabled), a turn that hits
   * the tool-iteration cap may request an automatic continuation turn.
   */
  queryLoop?: boolean;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface LoongMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface LoongUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface LoongTurnResult {
  runId: string;
  status: "ok" | "error" | "cancelled" | "timeout";
  messages: LoongMessage[];
  usage?: LoongUsage;
  error?: string;
}

export interface LoongSessionTurnRecord {
  sessionId: string;
  runId: string;
  source: LoongSource;
  createdAt: string;
  status: LoongTurnResult["status"];
  messages: LoongMessage[];
  workspace?: string;
  usage?: LoongUsage;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface LoongSessionStore {
  loadMessages(sessionId: string): Promise<LoongMessage[]>;
  appendTurn(record: LoongSessionTurnRecord): Promise<void>;
}

export interface LoongTrajectoryRecord {
  runId: string;
  sessionId: string;
  source: LoongSource;
  createdAt: string;
  completedAt: string;
  status: LoongTurnResult["status"];
  userMessage: string;
  assistantMessage?: string;
  workspace?: string;
  model?: string;
  usage?: LoongUsage;
  error?: string;
  events: LoongEvent[];
  metadata?: Record<string, unknown>;
}

export interface LoongTrajectoryStore {
  append(record: LoongTrajectoryRecord): Promise<void>;
}

export interface LoongContextItem {
  title?: string;
  content: string;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface LoongContextRequest {
  input: LoongTurnInput;
  history: LoongMessage[];
  runId: string;
  createdAt: string;
}

export interface LoongContextProvider {
  name: string;
  buildContext(request: LoongContextRequest): Promise<LoongContextItem[]>;
}

export type LoongLifecycleHookPhase = "start" | "end" | "error" | "cancelled";

export interface LoongLifecycleHookRequest {
  phase: LoongLifecycleHookPhase;
  runId: string;
  sessionId: string;
  source: LoongSource;
  createdAt: string;
  completedAt?: string;
  workspace?: string;
  model?: string;
  status?: LoongTurnResult["status"];
  userMessage?: string;
  assistantMessage?: string;
  error?: string;
  usage?: LoongUsage;
  metadata?: Record<string, unknown>;
}

export interface LoongLifecycleHook {
  /**
   * Lifecycle hooks run in the Loong process. Keep synchronous work small:
   * the runtime isolates thrown errors, rejected promises, and async hooks that
   * do not settle in time, but JavaScript cannot preempt CPU-bound synchronous
   * hook code on the same event loop.
   */
  name: string;
  onLifecycle(request: Readonly<LoongLifecycleHookRequest>): Promise<void> | void;
}

export interface LoongPermissionRequest {
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

export interface LoongPermissionResponse {
  decision: "allow" | "deny";
  reason?: string;
  metadata?: Record<string, unknown>;
}

export type LoongPermissionHandler = (
  request: LoongPermissionRequest,
) => Promise<LoongPermissionResponse | "allow" | "deny">;

export interface LoongPermissionEventPayload {
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

export type LoongEvent =
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
      payload: LoongPermissionEventPayload;
    }
  | {
      type: "context";
      runId: string;
      providerName: string;
      phase: "start" | "end";
      payload?: unknown;
    }
  | { type: "tool"; runId: string; toolName: string; phase: "start" | "update" | "end"; payload?: unknown };

export interface LoongAgentRuntime {
  runTurn(input: LoongTurnInput): Promise<LoongTurnResult>;
  subscribe(listener: (event: LoongEvent) => void): () => void;
  /** Hot-swap tier scheduling for subsequent turns (optional on concrete runtimes). */
  setTierConfig?(config: import("./tiers.js").ModelTierConfig | undefined): void;
  /** Hot-swap model providers for subsequent turns (optional on concrete runtimes). */
  setProviderRegistry?(registry: import("@loong/providers").ProviderRegistry): void;
}
