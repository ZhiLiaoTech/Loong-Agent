import { createHash } from "node:crypto";
import type {
  ModelMessage,
  ModelProvider,
  ModelResponse,
  ModelToolCall,
  ProviderRegistry,
  ProviderResolution,
} from "@dragon/providers";
import { ProviderError, createProviderRegistry } from "@dragon/providers";
import { isSensitiveKey } from "@dragon/security";
import type {
  ToolDefinition,
  ToolInvocation,
  ToolPermissionEngine,
  ToolPermissionResult,
  ToolRegistry,
} from "@dragon/tools";
import { createToolPermissionEngine, createToolRegistry } from "@dragon/tools";
import type {
  DragonAgentRuntime,
  DragonContextItem,
  DragonContextProvider,
  DragonEvent,
  DragonLifecycleHook,
  DragonLifecycleHookRequest,
  DragonMessage,
  DragonPermissionEventPayload,
  DragonPermissionHandler,
  DragonPermissionRequest,
  DragonPermissionResponse,
  DragonSessionStore,
  DragonSessionTurnRecord,
  DragonTrajectoryRecord,
  DragonTrajectoryStore,
  DragonTurnInput,
  DragonTurnResult,
  DragonUsage,
} from "./types.js";

export interface DragonRuntimeOptions {
  providerRegistry?: ProviderRegistry;
  providers?: ModelProvider[];
  toolRegistry?: ToolRegistry;
  tools?: ToolDefinition[];
  permissionEngine?: ToolPermissionEngine;
  permissionHandler?: DragonPermissionHandler;
  sessionStore?: DragonSessionStore;
  trajectoryStore?: DragonTrajectoryStore;
  contextProviders?: DragonContextProvider[];
  lifecycleHooks?: DragonLifecycleHook[];
  defaultModel?: string;
  modelFallbacks?: string[];
  systemPrompt?: string;
  maxToolIterations?: number;
  maxContextChars?: number;
}

interface ModelAttemptFailure {
  requestedModel?: string;
  providerId?: string;
  model?: string;
  message: string;
  retryable?: boolean;
  status?: number;
  code?: string;
}

export class DefaultDragonAgentRuntime implements DragonAgentRuntime {
  readonly #providerRegistry: ProviderRegistry;
  readonly #toolRegistry: ToolRegistry;
  readonly #permissionEngine: ToolPermissionEngine;
  readonly #permissionHandler: DragonPermissionHandler | undefined;
  readonly #sessionStore: DragonSessionStore | undefined;
  readonly #trajectoryStore: DragonTrajectoryStore | undefined;
  readonly #contextProviders: DragonContextProvider[];
  readonly #lifecycleHooks: DragonLifecycleHook[];
  readonly #defaultModel: string | undefined;
  readonly #modelFallbacks: string[];
  readonly #systemPrompt: string;
  readonly #maxToolIterations: number;
  readonly #maxContextChars: number;
  readonly #lifecycleHookTimeoutMs: number;
  readonly #maxToolResultChars = 64_000;
  readonly #listeners = new Set<(event: DragonEvent) => void>();
  readonly #eventCollectors = new Map<string, DragonEvent[]>();

  constructor(options: DragonRuntimeOptions = {}) {
    this.#providerRegistry = options.providerRegistry ?? createProviderRegistry(options.providers ?? []);
    this.#toolRegistry = options.toolRegistry ?? createToolRegistry(options.tools ?? []);
    this.#permissionEngine = options.permissionEngine ?? createToolPermissionEngine();
    this.#permissionHandler = options.permissionHandler;
    this.#sessionStore = options.sessionStore;
    this.#trajectoryStore = options.trajectoryStore;
    this.#contextProviders = [...(options.contextProviders ?? [])];
    this.#lifecycleHooks = [...(options.lifecycleHooks ?? [])];
    this.#defaultModel = options.defaultModel;
    this.#modelFallbacks = normalizeModelRefs(options.modelFallbacks ?? []);
    this.#systemPrompt = options.systemPrompt ?? "You are Dragon, a TypeScript-native local-first agent.";
    this.#maxToolIterations = options.maxToolIterations ?? 4;
    this.#maxContextChars = options.maxContextChars ?? 12_000;
    this.#lifecycleHookTimeoutMs = 500;
  }

  subscribe(listener: (event: DragonEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async runTurn(input: DragonTurnInput): Promise<DragonTurnResult> {
    const runId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const userMessage = createMessage("user", input.message, createdAt, {
      source: input.source,
      workspace: input.workspace,
    });
    let resultMessages: DragonMessage[] = [userMessage];
    this.#eventCollectors.set(runId, []);

    try {
      if (input.signal?.aborted) {
        throw new DragonCancelledError("Turn was cancelled before it started.");
      }

      this.#emit({
        type: "lifecycle",
        phase: "start",
        runId,
        metadata: toLifecycleMetadata(input),
      });
      await this.#notifyLifecycleHooks("start", input, runId, createdAt);
      const history = input.history ?? await this.#loadSessionMessages(input.sessionId);
      const contextItems = await this.#buildContextItems(input, history, runId, createdAt);

      const modelMessages: ModelMessage[] = [
        { role: "system", content: composeSystemPrompt(this.#systemPrompt, contextItems, this.#maxContextChars) },
        ...toModelHistory(history),
        { role: "user", content: input.message },
      ];

      const modelRefs = modelAttemptRefs(input.model, this.#defaultModel, input.modelFallbacks, this.#modelFallbacks);
      let completion = await this.#completeModelWithFallback(modelRefs, modelMessages, input, runId);
      let providerResponse = completion.response;
      let resolution = completion.resolution;
      let fallbackFailures = completion.failures;

      if (input.signal?.aborted) {
        throw new DragonCancelledError("Turn was cancelled.");
      }

      let toolIterations = 0;
      while (providerResponse.toolCalls?.length && toolIterations < this.#maxToolIterations) {
        toolIterations += 1;
        modelMessages.push({
          role: "assistant",
          content: providerResponse.text ?? "",
          toolCalls: providerResponse.toolCalls,
        });

        for (const toolCall of providerResponse.toolCalls) {
          const toolResult = await this.#runToolCall(toolCall, input, runId);
          modelMessages.push({
            role: "tool",
            content: toolResult.content,
            toolCallId: toolCall.id,
          });
        }

        completion = await this.#completeModelWithFallback(modelRefs, modelMessages, input, runId);
        providerResponse = completion.response;
        resolution = completion.resolution;
        fallbackFailures = completion.failures;
      }

      if (providerResponse.toolCalls?.length) {
        throw new Error(`Tool iteration limit exceeded (${this.#maxToolIterations}).`);
      }

      const assistantText = providerResponse.text ?? "";
      if (assistantText && !providerResponse.streamedText) {
        this.#emit({ type: "assistant_delta", runId, text: assistantText });
      }
      const assistantMetadata: Record<string, unknown> = {
        providerId: resolution.provider.id,
        model: resolution.model,
        requestedModel: resolution.requestedModel,
      };
      if (providerResponse.toolCalls) {
        assistantMetadata.toolCalls = providerResponse.toolCalls;
      }
      if (fallbackFailures.length > 0) {
        assistantMetadata.modelFallbacks = fallbackFailures;
      }
      const assistantMessage = createMessage("assistant", assistantText, new Date().toISOString(), assistantMetadata);
      resultMessages = [userMessage, assistantMessage];

      const result: DragonTurnResult = {
        runId,
        status: "ok",
        messages: resultMessages,
      };

      const usage = toDragonUsage(providerResponse.usage);
      if (usage) {
        result.usage = usage;
      }

      await this.#persistTurn(input, result, createdAt);
      const completedAt = new Date().toISOString();
      this.#emit({ type: "lifecycle", phase: "end", runId });
      await this.#notifyLifecycleHooks("end", input, runId, createdAt, completedAt, result);
      await this.#tryPersistTrajectory(input, result, createdAt, completedAt);
      return result;
    } catch (error) {
      const errorDetails = errorToDetails(error);
      const status = error instanceof DragonCancelledError || input.signal?.aborted ? "cancelled" : "error";
      const result: DragonTurnResult = {
        runId,
        status,
        messages: resultMessages,
        error: errorDetails.message,
      };
      if (!(error instanceof DragonPersistenceError)) {
        await this.#tryPersistTurn(input, result, createdAt);
      }
      const lifecycleEvent: DragonEvent = {
        type: "lifecycle",
        phase: status === "cancelled" ? "cancelled" : "error",
        runId,
        message: errorDetails.message,
      };
      if (errorDetails.metadata !== undefined) {
        lifecycleEvent.metadata = errorDetails.metadata;
      }
      this.#emit(lifecycleEvent);
      const completedAt = new Date().toISOString();
      const hookPhase = lifecycleEvent.phase === "cancelled" ? "cancelled" : "error";
      await this.#notifyLifecycleHooks(hookPhase, input, runId, createdAt, completedAt, result);
      await this.#tryPersistTrajectory(input, result, createdAt, completedAt);
      return result;
    } finally {
      this.#eventCollectors.delete(runId);
    }
  }

  #emit(event: DragonEvent): void {
    this.#eventCollectors.get(event.runId)?.push(cloneEvent(event));
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Event subscribers are observers; they must not break the agent turn.
      }
    }
  }

  async #loadSessionMessages(sessionId: string): Promise<DragonMessage[]> {
    if (!this.#sessionStore) {
      return [];
    }
    try {
      return await this.#sessionStore.loadMessages(sessionId);
    } catch (error) {
      throw new DragonPersistenceError(
        `Failed to load session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async #buildContextItems(
    input: DragonTurnInput,
    history: DragonMessage[],
    runId: string,
    createdAt: string,
  ): Promise<DragonContextItem[]> {
    const items: DragonContextItem[] = [];
    for (const provider of this.#contextProviders) {
      this.#emit({
        type: "context",
        runId,
        providerName: provider.name,
        phase: "start",
      });
      try {
        const providerItems = await provider.buildContext({ input, history, runId, createdAt });
        items.push(...providerItems);
        this.#emit({
          type: "context",
          runId,
          providerName: provider.name,
          phase: "end",
          payload: { ok: true, itemCount: providerItems.length },
        });
      } catch {
        this.#emit({
          type: "context",
          runId,
          providerName: provider.name,
          phase: "end",
          payload: { ok: false, code: "context_provider_failed" },
        });
      }
      if (input.signal?.aborted) {
        throw new DragonCancelledError("Turn was cancelled.");
      }
    }
    return items;
  }

  async #notifyLifecycleHooks(
    phase: DragonLifecycleHookRequest["phase"],
    input: DragonTurnInput,
    runId: string,
    createdAt: string,
    completedAt?: string,
    result?: DragonTurnResult,
  ): Promise<void> {
    if (this.#lifecycleHooks.length === 0) {
      return;
    }
    // Hooks run in-process. Promise timeout protects the turn from rejected or
    // non-settling async hooks, but cannot preempt CPU-bound synchronous code.
    await Promise.all(this.#lifecycleHooks.map(async hook => {
      try {
        const request = toLifecycleHookRequest(phase, input, runId, createdAt, completedAt, result);
        const frozenRequest = freezeLifecycleHookRequest(request);
        await withTimeout(Promise.resolve(hook.onLifecycle(frozenRequest)), this.#lifecycleHookTimeoutMs);
      } catch {
        // Lifecycle hooks are observers; they must not change turn outcome.
      }
    }));
  }

  async #persistTurn(
    input: DragonTurnInput,
    result: DragonTurnResult,
    createdAt: string,
  ): Promise<void> {
    if (!this.#sessionStore) {
      return;
    }
    const record = toSessionTurnRecord(input, result, createdAt);
    try {
      await this.#sessionStore.appendTurn(record);
    } catch (error) {
      throw new DragonPersistenceError(
        `Failed to persist session ${input.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async #tryPersistTurn(
    input: DragonTurnInput,
    result: DragonTurnResult,
    createdAt: string,
  ): Promise<void> {
    try {
      await this.#persistTurn(input, result, createdAt);
    } catch {
      // Preserve the original turn failure when error-path persistence also fails.
    }
  }

  async #tryPersistTrajectory(
    input: DragonTurnInput,
    result: DragonTurnResult,
    createdAt: string,
    completedAt: string,
  ): Promise<void> {
    if (!this.#trajectoryStore) {
      return;
    }
    const events = this.#eventCollectors.get(result.runId) ?? [];
    try {
      await this.#trajectoryStore.append(toTrajectoryRecord(input, result, createdAt, completedAt, events));
    } catch {
      // Trajectory capture is observability data; it must not change turn outcome.
    }
  }

  async #completeModel(
    provider: ModelProvider,
    model: string,
    messages: ModelMessage[],
    input: DragonTurnInput,
    runId: string,
    streamDeltas = true,
  ): Promise<ModelResponse> {
    let streamedText = false;
    const onTextDelta = (delta: string): void => {
      if (!delta) {
        return;
      }
      streamedText = true;
      this.#emit({ type: "assistant_delta", runId, text: delta });
    };
    const response = await provider.complete({
      model,
      messages,
      ...(provider.supportsToolCalling ? { tools: this.#toolRegistry.list().map(toModelTool) } : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
      ...(streamDeltas ? { onTextDelta } : {}),
      metadata: {
        runId,
        sessionId: input.sessionId,
        source: input.source,
      },
    });
    if (streamedText) {
      response.streamedText = true;
    }
    return response;
  }

  async #completeModelWithFallback(
    modelRefs: Array<string | undefined>,
    messages: ModelMessage[],
    input: DragonTurnInput,
    runId: string,
  ): Promise<{ resolution: ProviderResolution; response: ModelResponse; failures: ModelAttemptFailure[] }> {
    const failures: ModelAttemptFailure[] = [];
    const streamDeltas = modelRefs.length === 1;

    for (let index = 0; index < modelRefs.length; index += 1) {
      const requestedModel = modelRefs[index];
      const resolution = this.#providerRegistry.resolveModel(requestedModel);
      if (!resolution) {
        failures.push({
          ...(requestedModel !== undefined ? { requestedModel } : {}),
          message: requestedModel === undefined
            ? "No model provider is configured. Set DRAGON_OPENAI_API_KEY or register a provider."
            : `No provider could resolve model "${requestedModel}".`,
          retryable: true,
        });
        continue;
      }

      try {
        const response = await this.#completeModel(
          resolution.provider,
          resolution.model,
          messages,
          input,
          runId,
          streamDeltas,
        );
        return { resolution, response, failures };
      } catch (error) {
        if (input.signal?.aborted) {
          throw error;
        }
        const failure = toModelAttemptFailure(resolution, error);
        failures.push(failure);
        const hasNext = index < modelRefs.length - 1;
        if (!hasNext || !isFallbackEligible(error)) {
          throw failures.length > 1 ? new DragonModelFallbackError(failures) : error;
        }
      }
    }

    throw new DragonModelFallbackError(failures);
  }

  async #runToolCall(
    toolCall: ModelToolCall,
    input: DragonTurnInput,
    runId: string,
  ): Promise<{ content: string }> {
    const toolName = toolCall.function?.name;
    if (!toolName) {
      this.#emit({
        type: "tool",
        runId,
        toolName: toolCall.id,
        phase: "end",
        payload: { ok: false, code: "missing_tool_name", toolCallId: toolCall.id },
      });
      return { content: JSON.stringify({ ok: false, error: "Tool call is missing function name." }) };
    }

    const tool = this.#toolRegistry.get(toolName);
    if (!tool) {
      this.#emit({
        type: "tool",
        runId,
        toolName,
        phase: "end",
        payload: { ok: false, code: "unknown_tool", toolCallId: toolCall.id },
      });
      return { content: JSON.stringify({ ok: false, error: `Unknown tool: ${toolName}` }) };
    }

    const parsedInput = parseToolArguments(toolCall.function?.arguments ?? "{}");
    if (!parsedInput.ok) {
      this.#emit({
        type: "tool",
        runId,
        toolName: tool.name,
        phase: "end",
        payload: { ok: false, code: "invalid_tool_arguments", toolCallId: toolCall.id },
      });
      return {
        content: safeStringifyToolResult({
          ok: false,
          code: "invalid_tool_arguments",
          error: parsedInput.error,
        }, this.#maxToolResultChars),
      };
    }

    const invocation: ToolInvocation = {
      id: toolCall.id,
      name: tool.name,
      input: parsedInput.value,
      sessionId: input.sessionId,
      metadata: {
        runId,
        source: input.source,
      },
    };
    if (input.workspace !== undefined) {
      Object.assign(invocation, { workspace: input.workspace });
    }
    const permission = await this.#resolvePermission(
      tool,
      invocation,
      this.#permissionEngine.decide(tool, invocation),
      runId,
    );
    if (permission.decision !== "allow") {
      this.#emit({
        type: "tool",
        runId,
        toolName: tool.name,
        phase: "end",
        payload: { toolCallId: toolCall.id, permission, skipped: true },
      });
      return {
        content: JSON.stringify({
          ok: false,
          error: `Tool permission ${permission.decision}: ${permission.reason}`,
        }),
      };
    }

    this.#emit({
      type: "tool",
      runId,
      toolName: tool.name,
      phase: "start",
      payload: { toolCallId: toolCall.id, inputSummary: summarizePermissionInput(parsedInput.value) },
    });
    try {
      const result = await tool.invoke(invocation);
      this.#emit({
        type: "tool",
        runId,
        toolName: tool.name,
        phase: "end",
        payload: { toolCallId: toolCall.id, resultSummary: summarizePermissionInput(result) },
      });
      return { content: safeStringifyToolResult(result, this.#maxToolResultChars) };
    } catch (error) {
      const result = {
        id: toolCall.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      this.#emit({
        type: "tool",
        runId,
        toolName: tool.name,
        phase: "end",
        payload: { toolCallId: toolCall.id, resultSummary: summarizePermissionInput(result) },
      });
      return { content: safeStringifyToolResult(result, this.#maxToolResultChars) };
    }
  }

  async #resolvePermission(
    tool: ToolDefinition,
    invocation: ToolInvocation,
    permission: ToolPermissionResult,
    runId: string,
  ): Promise<ToolPermissionResult> {
    if (permission.decision !== "ask") {
      return permission;
    }

    const request = toPermissionRequest(runId, tool, invocation, permission.reason);
    this.#emit({
      type: "permission",
      runId,
      toolName: tool.name,
      toolCallId: invocation.id,
      phase: "request",
      payload: toPermissionEventPayload(request),
    });

    if (!this.#permissionHandler) {
      return permission;
    }

    try {
      const response = normalizePermissionResponse(await this.#permissionHandler(request), permission.reason);
      const resolved: ToolPermissionResult = {
        decision: response.decision,
        reason: response.reason ?? `Permission ${response.decision} from permission handler.`,
      };
      this.#emit({
        type: "permission",
        runId,
        toolName: tool.name,
        toolCallId: invocation.id,
        phase: "resolved",
        payload: toPermissionEventPayload(request, resolved, response.metadata),
      });
      return resolved;
    } catch (error) {
      const resolved: ToolPermissionResult = {
        decision: "deny",
        reason: `Permission prompt failed: ${error instanceof Error ? error.message : String(error)}`,
      };
      this.#emit({
        type: "permission",
        runId,
        toolName: tool.name,
        toolCallId: invocation.id,
        phase: "resolved",
        payload: toPermissionEventPayload(request, resolved),
      });
      return resolved;
    }
  }
}

export function createDragonRuntime(options: DragonRuntimeOptions = {}): DragonAgentRuntime {
  return new DefaultDragonAgentRuntime(options);
}

function createMessage(
  role: DragonMessage["role"],
  content: string,
  createdAt: string,
  metadata?: Record<string, unknown>,
): DragonMessage {
  const message: DragonMessage = {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt,
  };
  if (metadata !== undefined) {
    message.metadata = metadata;
  }
  return message;
}

function toLifecycleMetadata(input: DragonTurnInput): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    sessionId: input.sessionId,
    source: input.source,
  };
  if (input.workspace !== undefined) {
    metadata.workspace = input.workspace;
  }
  if (input.model !== undefined) {
    metadata.requestedModel = input.model;
  }
  if (input.modelFallbacks !== undefined) {
    metadata.requestedModelFallbacks = [...input.modelFallbacks];
  }
  return metadata;
}

function toLifecycleHookRequest(
  phase: DragonLifecycleHookRequest["phase"],
  input: DragonTurnInput,
  runId: string,
  createdAt: string,
  completedAt?: string,
  result?: DragonTurnResult,
): DragonLifecycleHookRequest {
  const request: DragonLifecycleHookRequest = {
    phase,
    runId,
    sessionId: input.sessionId,
    source: input.source,
    createdAt,
  };
  if (completedAt !== undefined) {
    request.completedAt = completedAt;
  }
  if (input.workspace !== undefined) {
    request.workspace = input.workspace;
  }
  if (input.model !== undefined) {
    request.model = input.model;
  }
  request.userMessage = input.message;
  if (result?.status !== undefined) {
    request.status = result.status;
  }
  const assistantMessage = result?.messages.slice().reverse().find(message => message.role === "assistant");
  if (assistantMessage?.content) {
    request.assistantMessage = assistantMessage.content;
  }
  if (result?.error !== undefined) {
    request.error = result.error;
  }
  if (result?.usage !== undefined) {
    request.usage = result.usage;
  }
  if (input.metadata !== undefined) {
    request.metadata = input.metadata;
  }
  return request;
}

function freezeLifecycleHookRequest(request: DragonLifecycleHookRequest): Readonly<DragonLifecycleHookRequest> {
  const clone: DragonLifecycleHookRequest = {
    ...request,
    ...(request.usage !== undefined ? { usage: deepCloneAndFreeze(request.usage) as DragonUsage } : {}),
    ...(request.metadata !== undefined ? { metadata: deepCloneAndFreeze(request.metadata) as Record<string, unknown> } : {}),
  };
  return Object.freeze(clone);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>(resolve => {
        timeout = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function deepCloneAndFreeze(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || typeof value === "undefined"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    const existing = seen.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (let index = 0; index < value.length; index += 1) {
      clone.push(deepCloneAndFreeze(value[index], seen));
    }
    return Object.freeze(clone);
  }
  if (typeof value === "object") {
    const existing = seen.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const clone: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    seen.set(value, clone);
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(clone, key, {
        value: deepCloneAndFreeze(item, seen),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(clone);
  }
  return Object.freeze({ type: typeof value });
}

function toPermissionRequest(
  runId: string,
  tool: ToolDefinition,
  invocation: ToolInvocation,
  reason: string,
): DragonPermissionRequest {
  const request: DragonPermissionRequest = {
    runId,
    toolCallId: invocation.id,
    toolName: tool.name,
    input: invocation.input,
    reason,
    sessionId: invocation.sessionId,
  };
  if (invocation.workspace !== undefined) {
    request.workspace = invocation.workspace;
  }
  if (tool.capabilities !== undefined) {
    request.capabilities = [...tool.capabilities];
  }
  return request;
}

function normalizePermissionResponse(
  response: DragonPermissionResponse | "allow" | "deny",
  previousReason: string,
): DragonPermissionResponse {
  if (response === "allow" || response === "deny") {
    return {
      decision: response,
      reason: `Permission ${response} from permission handler. Previous policy reason: ${previousReason}`,
    };
  }
  if (response.decision !== "allow" && response.decision !== "deny") {
    throw new Error(`Invalid permission handler decision: ${String(response.decision)}`);
  }
  return response.reason === undefined
    ? {
        ...response,
        reason: `Permission ${response.decision} from permission handler. Previous policy reason: ${previousReason}`,
      }
    : response;
}

function toPermissionEventPayload(
  request: DragonPermissionRequest,
  result?: ToolPermissionResult,
  metadata?: Record<string, unknown>,
): DragonPermissionEventPayload {
  const payload: DragonPermissionEventPayload = {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    reason: result?.reason ?? request.reason,
    sessionId: request.sessionId,
    inputSummary: summarizePermissionInput(request.input),
  };
  if (request.workspace !== undefined) {
    payload.workspace = request.workspace;
  }
  if (request.capabilities !== undefined) {
    payload.capabilities = [...request.capabilities];
  }
  if (result !== undefined) {
    payload.decision = result.decision === "allow" ? "allow" : "deny";
  }
  if (metadata !== undefined) {
    payload.metadata = metadata;
  }
  return payload;
}

function summarizePermissionInput(value: unknown, key = "input", depth = 0): unknown {
  if (isSensitiveKey(key)) {
    return { type: typeof value, redacted: true };
  }
  if (typeof value === "string") {
    return summarizeString(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (typeof value === "bigint") {
    return { type: "bigint", digits: value.toString().length };
  }
  if (value === undefined) {
    return { type: "undefined" };
  }
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      items: depth >= 2 ? "[omitted]" : value.slice(0, 5).map((item, index) => summarizePermissionInput(item, String(index), depth + 1)),
      truncated: value.length > 5,
    };
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).slice(0, 20);
    const summary: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of entries) {
      summary[entryKey] = depth >= 2
        ? summarizeShape(entryValue, entryKey)
        : summarizePermissionInput(entryValue, entryKey, depth + 1);
    }
    if (Object.keys(value).length > entries.length) {
      summary.$truncatedKeys = Object.keys(value).length - entries.length;
    }
    return summary;
  }
  return { type: typeof value };
}

function summarizeShape(value: unknown, key: string): unknown {
  if (isSensitiveKey(key)) {
    return { type: typeof value, redacted: true };
  }
  if (typeof value === "string") {
    return summarizeString(value);
  }
  if (Array.isArray(value)) {
    return { type: "array", length: value.length };
  }
  if (isRecord(value)) {
    return { type: "object", keys: Object.keys(value).slice(0, 20) };
  }
  return value === null ? null : { type: typeof value };
}

function summarizeString(value: string): Record<string, unknown> {
  return {
    type: "string",
    chars: value.length,
    bytes: Buffer.byteLength(value, "utf8"),
    sha256: createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSessionTurnRecord(
  input: DragonTurnInput,
  result: DragonTurnResult,
  createdAt: string,
): DragonSessionTurnRecord {
  const record: DragonSessionTurnRecord = {
    sessionId: input.sessionId,
    runId: result.runId,
    source: input.source,
    createdAt,
    status: result.status,
    messages: result.messages,
  };

  if (input.workspace !== undefined) {
    record.workspace = input.workspace;
  }
  if (result.usage !== undefined) {
    record.usage = result.usage;
  }
  if (result.error !== undefined) {
    record.error = result.error;
  }

  const metadata: Record<string, unknown> = {};
  if (input.metadata !== undefined) {
    Object.assign(metadata, input.metadata);
  }
  if (input.model !== undefined) {
    metadata.requestedModel = input.model;
  }
  if (input.modelFallbacks !== undefined) {
    metadata.requestedModelFallbacks = [...input.modelFallbacks];
  }
  if (input.thinking !== undefined) {
    metadata.thinking = input.thinking;
  }
  if (Object.keys(metadata).length > 0) {
    record.metadata = metadata;
  }

  return record;
}

function toTrajectoryRecord(
  input: DragonTurnInput,
  result: DragonTurnResult,
  createdAt: string,
  completedAt: string,
  events: DragonEvent[],
): DragonTrajectoryRecord {
  const assistantMessage = [...result.messages].reverse().find(message => message.role === "assistant");
  const record: DragonTrajectoryRecord = {
    runId: result.runId,
    sessionId: input.sessionId,
    source: input.source,
    createdAt,
    completedAt,
    status: result.status,
    userMessage: input.message,
    events: events.map(cloneEvent),
  };
  if (assistantMessage?.content) {
    record.assistantMessage = assistantMessage.content;
  }
  if (input.workspace !== undefined) {
    record.workspace = input.workspace;
  }
  if (input.model !== undefined) {
    record.model = input.model;
  }
  if (result.usage !== undefined) {
    record.usage = result.usage;
  }
  if (result.error !== undefined) {
    record.error = result.error;
  }
  if (input.metadata !== undefined) {
    record.metadata = input.metadata;
  }
  return record;
}

function cloneEvent(event: DragonEvent): DragonEvent {
  try {
    return JSON.parse(JSON.stringify(event)) as DragonEvent;
  } catch {
    return {
      type: "lifecycle",
      phase: "error",
      runId: event.runId,
      message: "Event could not be serialized.",
    };
  }
}

function toDragonUsage(
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
): DragonUsage | undefined {
  if (!usage) {
    return undefined;
  }

  const dragonUsage: DragonUsage = {};
  if (usage.inputTokens !== undefined) {
    dragonUsage.inputTokens = usage.inputTokens;
  }
  if (usage.outputTokens !== undefined) {
    dragonUsage.outputTokens = usage.outputTokens;
  }
  if (usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
    dragonUsage.totalTokens = usage.inputTokens + usage.outputTokens;
  }
  return dragonUsage;
}

function modelAttemptRefs(
  requestedModel: string | undefined,
  defaultModel: string | undefined,
  inputFallbacks: string[] | undefined,
  defaultFallbacks: string[],
): Array<string | undefined> {
  const refs: Array<string | undefined> = [];
  const primary = requestedModel ?? defaultModel;
  if (primary === undefined) {
    refs.push(undefined);
  } else {
    refs.push(...splitModelRefs(primary));
  }
  refs.push(...normalizeModelRefs(inputFallbacks ?? []));
  refs.push(...defaultFallbacks);

  const seen = new Set<string>();
  const unique: Array<string | undefined> = [];
  for (const ref of refs) {
    if (ref === undefined) {
      if (!seen.has("")) {
        seen.add("");
        unique.push(undefined);
      }
      continue;
    }
    if (!seen.has(ref)) {
      seen.add(ref);
      unique.push(ref);
    }
  }
  return unique.length > 0 ? unique : [undefined];
}

function normalizeModelRefs(values: string[]): string[] {
  return values.flatMap(splitModelRefs);
}

function splitModelRefs(value: string): string[] {
  return value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function toModelAttemptFailure(resolution: ProviderResolution, error: unknown): ModelAttemptFailure {
  const failure: ModelAttemptFailure = {
    requestedModel: resolution.requestedModel,
    providerId: resolution.provider.id,
    model: resolution.model,
    message: error instanceof Error ? error.message : String(error),
  };
  if (error instanceof ProviderError) {
    failure.retryable = error.retryable;
    if (error.status !== undefined) {
      failure.status = error.status;
    }
    if (error.code !== undefined) {
      failure.code = error.code;
    }
  }
  return failure;
}

function isFallbackEligible(error: unknown): boolean {
  return error instanceof ProviderError
    ? error.retryable === true
    : true;
}

function toModelHistory(history: DragonMessage[]): ModelMessage[] {
  return history
    .filter(message => message.role === "user" || message.role === "assistant" || message.role === "tool")
    .map(message => {
      const modelMessage: ModelMessage = {
        role: message.role,
        content: message.content,
      };
      const toolCallId = readStringMetadata(message.metadata, "toolCallId");
      if (toolCallId !== undefined) {
        modelMessage.toolCallId = toolCallId;
      }
      const toolCalls = readToolCallsMetadata(message.metadata);
      if (toolCalls !== undefined) {
        modelMessage.toolCalls = toolCalls;
      }
      return modelMessage;
    });
}

function readStringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function readToolCallsMetadata(metadata: Record<string, unknown> | undefined): ModelToolCall[] | undefined {
  const value = metadata?.toolCalls;
  return Array.isArray(value) ? value as ModelToolCall[] : undefined;
}

type ParsedToolArguments =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

function parseToolArguments(value: string): ParsedToolArguments {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function safeStringifyToolResult(value: unknown, maxChars: number): string {
  try {
    const json = JSON.stringify(value, (_key, item) => {
      if (typeof item === "bigint") {
        return item.toString();
      }
      return item;
    });
    if (!json) {
      return JSON.stringify({ ok: false, error: "Tool returned an unserializable result." });
    }
    return json.length > maxChars
      ? JSON.stringify({ ok: true, truncated: true, resultPreview: json.slice(0, maxChars) })
      : json;
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function composeSystemPrompt(
  systemPrompt: string,
  contextItems: DragonContextItem[],
  maxContextChars: number,
): string {
  const contextText = formatContextItems(contextItems, maxContextChars);
  return contextText
    ? `${systemPrompt}\n\nDragon recall context:\n${contextText}`
    : systemPrompt;
}

function formatContextItems(contextItems: DragonContextItem[], maxContextChars: number): string {
  if (contextItems.length === 0 || maxContextChars <= 0) {
    return "";
  }
  const orderedItems = [...contextItems].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const lines: string[] = [];
  let chars = 0;
  for (const [index, item] of orderedItems.entries()) {
    const title = item.title?.trim() || `Context ${index + 1}`;
    const content = item.content.trim();
    if (!content) {
      continue;
    }
    const block = `### ${title}\n${content}`;
    const remaining = maxContextChars - chars;
    if (remaining <= 0) {
      break;
    }
    const boundedBlock = fitText(block, remaining, "[context truncated]");
    lines.push(boundedBlock);
    chars += boundedBlock.length + 2;
  }
  return lines.join("\n\n");
}

function fitText(value: string, maxChars: number, suffix: string): string {
  if (maxChars <= 0) {
    return "";
  }
  if (value.length <= maxChars) {
    return value;
  }
  if (suffix.length + 1 >= maxChars) {
    return value.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - suffix.length - 1)}\n${suffix}`;
}

function toModelTool(tool: ToolDefinition): unknown {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

interface ErrorDetails {
  message: string;
  metadata?: Record<string, unknown>;
}

function errorToDetails(error: unknown): ErrorDetails {
  if (error instanceof DragonModelFallbackError) {
    return {
      message: error.message,
      metadata: {
        modelFallbacks: error.failures,
      },
    };
  }

  if (error instanceof ProviderError) {
    const metadata: Record<string, unknown> = {
      providerId: error.providerId,
      retryable: error.retryable,
    };
    if (error.status !== undefined) {
      metadata.status = error.status;
    }
    if (error.code !== undefined) {
      metadata.code = error.code;
    }
    if (error.responseBody !== undefined) {
      metadata.responseBody = error.responseBody;
    }
    return {
      message: error.message,
      metadata,
    };
  }

  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

class DragonCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DragonCancelledError";
  }
}

class DragonModelFallbackError extends Error {
  readonly failures: ModelAttemptFailure[];

  constructor(failures: ModelAttemptFailure[]) {
    super(formatModelFallbackError(failures));
    this.name = "DragonModelFallbackError";
    this.failures = failures;
  }
}

function formatModelFallbackError(failures: ModelAttemptFailure[]): string {
  if (failures.length === 0) {
    return "No model provider is configured. Set DRAGON_OPENAI_API_KEY or register a provider.";
  }
  return `All model fallback attempts failed: ${failures.map(formatModelFailure).join("; ")}`;
}

function formatModelFailure(failure: ModelAttemptFailure): string {
  const target = [
    failure.providerId,
    failure.model,
  ].filter(Boolean).join(":") || failure.requestedModel || "default";
  return `${target}: ${failure.message}`;
}

class DragonPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DragonPersistenceError";
  }
}
