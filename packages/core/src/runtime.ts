import { createHash } from "node:crypto";
import type {
  ModelContentPart,
  ModelMessage,
  ModelProvider,
  ModelResponse,
  ModelToolCall,
  ProviderRegistry,
  ProviderResolution,
} from "@dragon/providers";
import { ProviderError, createProviderRegistry } from "@dragon/providers";
import { isSensitiveKey, redactSecretsInText } from "@dragon/security";
import {
  applyTierToInput,
  decideTier,
  type ModelTierConfig,
  type TierDecision,
} from "./tiers.js";
import {
  appendWorkspaceToolGuidance,
  augmentResponseWithTextToolCalls,
  stripTextToolBlocks,
} from "./text-tool-calls.js";
import {
  DEFAULT_MODEL_TIMEOUT_MS,
  createModelTurnAbort,
  resolveTurnFailureStatus,
} from "./model-timeout.js";
import type {
  ToolDefinition,
  ToolInvocation,
  ToolPermissionEngine,
  ToolPermissionResult,
  ToolRegistry,
} from "@dragon/tools";
import { createToolPermissionEngine, createToolRegistry, normalizeToolName } from "@dragon/tools";
import type {
  DragonAgentRuntime,
  DragonAttachment,
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
  /** When true (default), unresolved ask decisions deny instead of returning ask. */
  denyAskWithoutHandler?: boolean;
  /** Optional multi-tier routing policy. When `enabled: false` or undefined,
   * the runtime behaves as if there were no tier classifier (legacy mode). */
  tierConfig?: ModelTierConfig;
  /** Optional async hook to refine tool permission (e.g. digital-employee org policies). */
  permissionEvaluator?: (
    tool: ToolDefinition,
    invocation: ToolInvocation,
    baseline: ToolPermissionResult,
  ) => Promise<ToolPermissionResult>;
  /** Per model HTTP request timeout in ms (default 300_000). Set 0 to disable. */
  modelTimeoutMs?: number;
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
  readonly #denyAskWithoutHandler: boolean;
  readonly #permissionEvaluator: DragonRuntimeOptions["permissionEvaluator"];
  readonly #modelTimeoutMs: number;
  #tierConfig: ModelTierConfig | undefined;
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
    this.#maxToolIterations = options.maxToolIterations ?? 20;
    this.#maxContextChars = options.maxContextChars ?? 12_000;
    this.#lifecycleHookTimeoutMs = 500;
    this.#denyAskWithoutHandler = options.denyAskWithoutHandler ?? true;
    this.#permissionEvaluator = options.permissionEvaluator;
    this.#modelTimeoutMs = options.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
    this.#tierConfig = options.tierConfig;
  }

  subscribe(listener: (event: DragonEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Hot-swap the tier scheduling config. Takes effect on the NEXT turn — runs
   * already in flight see the previous decision. Pass `undefined` to disable
   * tier scheduling for subsequent turns.
   */
  setTierConfig(config: ModelTierConfig | undefined): void {
    this.#tierConfig = config;
  }

  /** Returns a shallow copy of the active tier config, or undefined. */
  getTierConfig(): ModelTierConfig | undefined {
    if (!this.#tierConfig) return undefined;
    return JSON.parse(JSON.stringify(this.#tierConfig)) as ModelTierConfig;
  }

  async runTurn(input: DragonTurnInput): Promise<DragonTurnResult> {
    const runId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    // Validate + resolve attachments BEFORE persisting the user message so we
    // can record a stable summary in metadata even on early failure.
    const resolvedAttachments = await resolveAttachments(input.attachments);
    const attachmentSummary = resolvedAttachments.length > 0
      ? summarizeAttachments(resolvedAttachments)
      : undefined;
    const userMessageMetadata: Record<string, unknown> = {
      source: input.source,
      workspace: input.workspace,
    };
    if (attachmentSummary !== undefined) {
      userMessageMetadata.attachments = attachmentSummary;
    }
    const userMessage = createMessage("user", input.message, createdAt, userMessageMetadata);
    let resultMessages: DragonMessage[] = [userMessage];
    this.#eventCollectors.set(runId, []);

    // Resolve tier BEFORE the lifecycle:start event so its metadata reflects
    // the effective model/budget. The decision uses only static signals
    // available before context providers run (message, attachments, workspace,
    // delegation depth in metadata). The caller's explicit model always wins;
    // tier only fills in defaults the caller did not specify.
    let tierDecision: TierDecision | undefined;
    let tierAdjustedMaxContextChars: number | undefined;
    if (this.#tierConfig?.enabled) {
      const parentTier = typeof input.metadata?.parentTier === "string"
        ? (input.metadata.parentTier as TierDecision["tier"])
        : undefined;
      const delegationDepth = typeof input.metadata?.delegationDepth === "number"
        ? input.metadata.delegationDepth
        : undefined;
      tierDecision = decideTier(this.#tierConfig, input, {
        ...(parentTier !== undefined ? { inheritedTier: parentTier } : {}),
        ...(delegationDepth !== undefined ? { delegationDepth } : {}),
      });
      if (tierDecision !== undefined) {
        const tierSpec = this.#tierConfig.tiers[tierDecision.tier];
        const applied = applyTierToInput(input, tierDecision, tierSpec);
        // Reassign the parameter binding so downstream tool calls, persistence,
        // and trajectory records all see the tier-resolved settings.
        input = applied.input;
        tierAdjustedMaxContextChars = applied.maxContextChars;
      }
    }
    const turnMaxContextChars = tierAdjustedMaxContextChars ?? this.#maxContextChars;
    const turnAbort = createModelTurnAbort(input.signal, this.#modelTimeoutMs);
    const activeInput: DragonTurnInput = { ...input, signal: turnAbort.signal };

    try {
      if (activeInput.signal?.aborted) {
        throw new DragonCancelledError("Turn was cancelled before it started.");
      }

      this.#emit({
        type: "lifecycle",
        phase: "start",
        runId,
        metadata: toLifecycleMetadata(input, tierDecision, turnMaxContextChars),
      });
      await this.#notifyLifecycleHooks("start", activeInput, runId, createdAt);
      const history = activeInput.history ?? await this.#loadSessionMessages(activeInput.sessionId);
      const contextItems = await this.#buildContextItems(activeInput, history, runId, createdAt);

      const effectiveSystemPrompt = appendWorkspaceToolGuidance(
        activeInput.systemPrompt?.trim()
          ? `${this.#systemPrompt}\n\n${activeInput.systemPrompt.trim()}`
          : this.#systemPrompt,
        activeInput.workspace,
      );
      const userContent = buildUserMessageContent(activeInput.message, resolvedAttachments);
      const modelMessages: ModelMessage[] = [
        { role: "system", content: composeSystemPrompt(effectiveSystemPrompt, contextItems, turnMaxContextChars) },
        ...toModelHistory(history),
        { role: "user", content: userContent },
      ];

      const modelRefs = modelAttemptRefs(activeInput.model, this.#defaultModel, activeInput.modelFallbacks, this.#modelFallbacks);
      let completion = await this.#completeModelWithFallback(modelRefs, modelMessages, activeInput, runId);
      let providerResponse = augmentResponseWithTextToolCalls(completion.response, activeInput.toolsEnabled);
      let resolution = completion.resolution;
      let fallbackFailures = completion.failures;
      if (providerResponse.textToolCallsExtracted && providerResponse.streamedText) {
        const cleaned = stripTextToolBlocks(completion.response.text ?? "");
        this.#emit({
          type: "assistant_replace",
          runId,
          text: cleaned.length > 0 ? `${cleaned}\n\n[正在执行工具调用…]\n` : "[正在执行工具调用…]\n",
        });
      }

      if (activeInput.signal?.aborted) {
        throw new DragonCancelledError("Turn was cancelled.");
      }

      let toolIterations = 0;
      while (providerResponse.toolCalls?.length && toolIterations < this.#maxToolIterations) {
        toolIterations += 1;
        const assistantTurn: ModelMessage = {
          role: "assistant",
          content: providerResponse.text ?? "",
          toolCalls: providerResponse.toolCalls,
        };
        // Echo reasoning_content back on the next turn so DeepSeek V4 Pro
        // (thinking mode) doesn't reject the follow-up with HTTP 400. Other
        // providers ignore the field.
        if (providerResponse.reasoningContent !== undefined && providerResponse.reasoningContent.length > 0) {
          assistantTurn.reasoningContent = providerResponse.reasoningContent;
        }
        modelMessages.push(assistantTurn);

        const toolCalls = providerResponse.toolCalls;
        if (activeInput.toolsEnabled === false) {
          for (const toolCall of toolCalls) {
            modelMessages.push({
              role: "tool",
              content: JSON.stringify({
                ok: false,
                error: "Tool calling is disabled for this turn.",
                toolCallId: toolCall.id,
              }),
              toolCallId: toolCall.id,
            });
          }
        } else if (canRunToolCallsInParallel(toolCalls, this.#toolRegistry)) {
          const toolResults = await Promise.all(toolCalls.map(toolCall => this.#runToolCall(toolCall, activeInput, runId)));
          for (const [index, toolResult] of toolResults.entries()) {
            modelMessages.push({
              role: "tool",
              content: toolResult.content,
              toolCallId: toolCalls[index]!.id,
            });
          }
        } else {
          for (const toolCall of toolCalls) {
            const toolResult = await this.#runToolCall(toolCall, activeInput, runId);
            modelMessages.push({
              role: "tool",
              content: toolResult.content,
              toolCallId: toolCall.id,
            });
          }
        }

        completion = await this.#completeModelWithFallback(modelRefs, modelMessages, activeInput, runId);
        providerResponse = augmentResponseWithTextToolCalls(completion.response, activeInput.toolsEnabled);
        resolution = completion.resolution;
        fallbackFailures = completion.failures;
      }

      if (providerResponse.toolCalls?.length) {
        throw new Error(`Tool iteration limit exceeded (${this.#maxToolIterations}).`);
      }

      const assistantText = providerResponse.text ?? "";
      if (assistantText) {
        if (providerResponse.streamedText) {
          this.#emit({ type: "assistant_replace", runId, text: assistantText });
        } else {
          this.#emit({ type: "assistant_delta", runId, text: assistantText });
        }
      }
      const assistantMetadata: Record<string, unknown> = {
        providerId: resolution.provider.id,
        model: resolution.model,
        requestedModel: resolution.requestedModel,
      };
      if (tierDecision !== undefined) {
        assistantMetadata.tier = tierDecision.tier;
        assistantMetadata.tierSource = tierDecision.source;
      }
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

      await this.#persistTurn(activeInput, result, createdAt);
      const completedAt = new Date().toISOString();
      this.#emit({ type: "lifecycle", phase: "end", runId });
      await this.#notifyLifecycleHooks("end", activeInput, runId, createdAt, completedAt, result);
      await this.#tryPersistTrajectory(activeInput, result, createdAt, completedAt);
      return result;
    } catch (error) {
      const errorDetails = errorToDetails(error);
      const status = resolveTurnFailureStatus(error, input.signal, turnAbort);
      const result: DragonTurnResult = {
        runId,
        status,
        messages: resultMessages,
        error: errorDetails.message,
      };
      if (!(error instanceof DragonPersistenceError)) {
        await this.#tryPersistTurn(activeInput, result, createdAt);
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
      await this.#notifyLifecycleHooks(hookPhase, activeInput, runId, createdAt, completedAt, result);
      await this.#tryPersistTrajectory(activeInput, result, createdAt, completedAt);
      return result;
    } finally {
      turnAbort.dispose();
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
      if (input.memoryEnabled === false && isMemoryContextProvider(provider.name)) {
        continue;
      }
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
    onTextDeltaSink?: (delta: string) => void,
  ): Promise<ModelResponse> {
    let streamedText = false;
    const onTextDelta = onTextDeltaSink
      ? (delta: string): void => {
          if (!delta) {
            return;
          }
          streamedText = true;
          onTextDeltaSink(delta);
        }
      : undefined;
    const toolsEnabled = input.toolsEnabled !== false;
    const response = await provider.complete({
      model,
      messages,
      ...(toolsEnabled && provider.supportsToolCalling
        ? { tools: this.#toolRegistry.list().map(toModelTool) }
        : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
      ...(onTextDelta !== undefined ? { onTextDelta } : {}),
      metadata: {
        runId,
        sessionId: input.sessionId,
        source: input.source,
        ...(input.thinking !== undefined ? { thinking: input.thinking } : {}),
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
    // Single-attempt: stream deltas directly to listeners. Multi-fallback:
    // provider still streams (so we can detect failures early), but we buffer
    // deltas per-attempt and flush them only when an attempt actually
    // succeeds, so users never see half-written output from a failed model.
    const directStream = modelRefs.length === 1;

    for (let index = 0; index < modelRefs.length; index += 1) {
      const requestedModel = modelRefs[index];
      const resolution = this.#providerRegistry.resolveModel(requestedModel);
      if (!resolution) {
        failures.push({
          ...(requestedModel !== undefined ? { requestedModel } : {}),
          message: requestedModel === undefined
            ? formatNoProviderMessage(this.#providerRegistry)
            : `No provider could resolve model "${requestedModel}".`,
          retryable: true,
        });
        continue;
      }

      const buffered: string[] = [];
      const sink = directStream
        ? (delta: string) => this.#emit({ type: "assistant_delta", runId, text: delta })
        : (delta: string) => buffered.push(delta);

      try {
        const response = await this.#completeModel(
          resolution.provider,
          resolution.model,
          messages,
          input,
          runId,
          sink,
        );
        if (!directStream) {
          for (const delta of buffered) {
            this.#emit({ type: "assistant_delta", runId, text: delta });
          }
        }
        return { resolution, response, failures };
      } catch (error) {
        buffered.length = 0;
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
        ...(input.metadata ?? {}),
      },
    };
    if (input.workspace !== undefined) {
      Object.assign(invocation, { workspace: input.workspace });
    }
    let baselinePermission = this.#permissionEngine.decide(tool, invocation);
    if (this.#permissionEvaluator) {
      baselinePermission = await this.#permissionEvaluator(tool, invocation, baselinePermission);
    }
    const permission = await this.#resolvePermission(tool, invocation, baselinePermission, runId);
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
      if (this.#denyAskWithoutHandler) {
        return {
          decision: "deny",
          reason: "Permission ask requires an interactive handler; running without one denies the request.",
        };
      }
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

function toLifecycleMetadata(
  input: DragonTurnInput,
  tierDecision?: TierDecision,
  maxContextChars?: number,
): Record<string, unknown> {
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
  if (input.attachments !== undefined && input.attachments.length > 0) {
    metadata.attachmentCount = input.attachments.length;
  }
  if (tierDecision !== undefined) {
    metadata.tier = tierDecision.tier;
    metadata.tierSource = tierDecision.source;
    metadata.tierScore = tierDecision.score;
    metadata.tierReason = tierDecision.reason;
    if (maxContextChars !== undefined) {
      metadata.tierMaxContextChars = maxContextChars;
    }
    if (input.thinking !== undefined) metadata.tierThinking = input.thinking;
    if (input.toolsEnabled !== undefined) metadata.tierToolsEnabled = input.toolsEnabled;
    if (input.memoryEnabled !== undefined) metadata.tierMemoryEnabled = input.memoryEnabled;
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
  if (invocation.metadata !== undefined) {
    request.metadata = { ...invocation.metadata };
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
  return error instanceof ProviderError && error.retryable === true;
}

const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;        // 10 MB per attachment
const MAX_TOTAL_ATTACHMENT_BYTES = 30 * 1024 * 1024;  // 30 MB per turn
const MAX_INLINED_TEXT_BYTES = 256 * 1024;            // 256 KB inlined per file
const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
const ALLOWED_TEXT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/css",
  "text/javascript",
  "text/x-python",
  "application/json",
  "application/xml",
  "application/yaml",
]);
const DOCUMENT_EXTRACTORS: Record<string, (buffer: Buffer, name: string) => Promise<string>> = {
  "application/pdf": extractPdfText,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": extractDocxText,
  "application/msword": extractDocxText,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": extractXlsxText,
  "application/vnd.ms-excel": extractXlsxText,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": extractPptxText,
  "application/vnd.ms-powerpoint": extractPptxText,
  "application/rtf": extractRtfText,
  "text/rtf": extractRtfText,
};

interface ResolvedAttachment {
  kind: "image" | "text";
  mimeType: string;
  name: string;
  size: number;
  /** Original base64 payload (for image transport) */
  dataBase64: string;
  /** Decoded text content (text + extracted document attachments) */
  text?: string;
  /** Original mime, before any text-extraction (so the prompt can mention it) */
  originalMimeType?: string;
}

async function resolveAttachments(attachments: readonly DragonAttachment[] | undefined): Promise<ResolvedAttachment[]> {
  if (!attachments || attachments.length === 0) {
    return [];
  }
  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`Too many attachments: ${attachments.length} (max ${MAX_ATTACHMENT_COUNT}).`);
  }
  const resolved: ResolvedAttachment[] = [];
  let totalBytes = 0;
  for (const [index, attachment] of attachments.entries()) {
    if (!attachment || typeof attachment !== "object") {
      throw new Error(`Attachment ${index + 1} must be an object.`);
    }
    if (attachment.kind !== "image" && attachment.kind !== "text" && attachment.kind !== "document") {
      throw new Error(`Attachment ${index + 1} kind must be "image", "text", or "document" (got ${String(attachment.kind)}).`);
    }
    const mime = String(attachment.mimeType ?? "").trim().toLowerCase();
    if (!mime) {
      throw new Error(`Attachment ${index + 1} requires mimeType.`);
    }
    if (typeof attachment.data !== "string" || attachment.data.length === 0) {
      throw new Error(`Attachment ${index + 1} requires base64 data.`);
    }
    if (attachment.kind === "image" && !ALLOWED_IMAGE_MIMES.has(mime)) {
      throw new Error(`Attachment ${index + 1} mimeType "${mime}" is not allowed for kind image.`);
    }
    if (attachment.kind === "text" && !ALLOWED_TEXT_MIMES.has(mime)) {
      throw new Error(`Attachment ${index + 1} mimeType "${mime}" is not allowed for kind text.`);
    }
    if (attachment.kind === "document" && !(mime in DOCUMENT_EXTRACTORS)) {
      throw new Error(`Attachment ${index + 1} mimeType "${mime}" has no document extractor. Supported: ${Object.keys(DOCUMENT_EXTRACTORS).join(", ")}.`);
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(attachment.data, "base64");
    } catch (error) {
      throw new Error(`Attachment ${index + 1} base64 data is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (buffer.byteLength === 0) {
      throw new Error(`Attachment ${index + 1} decoded to zero bytes.`);
    }
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment ${index + 1} exceeds per-file cap (${buffer.byteLength} > ${MAX_ATTACHMENT_BYTES} bytes).`);
    }
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error(`Attachments total exceeds turn cap (> ${MAX_TOTAL_ATTACHMENT_BYTES} bytes).`);
    }
    const rawName = typeof attachment.name === "string" ? attachment.name.trim() : "";
    const safeName = rawName.length > 0 && rawName.length <= 200 ? rawName : `attachment-${index + 1}`;
    if (attachment.kind === "text") {
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      } catch {
        throw new Error(`Attachment ${index + 1} (text) is not valid UTF-8.`);
      }
      if (buffer.byteLength > MAX_INLINED_TEXT_BYTES) {
        const truncatedBytes = buffer.subarray(0, MAX_INLINED_TEXT_BYTES);
        text = new TextDecoder("utf-8").decode(truncatedBytes) + `\n[file truncated: ${buffer.byteLength - MAX_INLINED_TEXT_BYTES} more bytes omitted]`;
      }
      resolved.push({
        kind: "text",
        mimeType: mime,
        name: safeName,
        size: buffer.byteLength,
        dataBase64: attachment.data,
        text,
      });
    } else if (attachment.kind === "document") {
      const extractor = DOCUMENT_EXTRACTORS[mime]!;
      let extracted: string;
      try {
        extracted = await extractor(buffer, safeName);
      } catch (error) {
        throw new Error(`Attachment ${index + 1} (${mime}) extraction failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!extracted.trim()) {
        extracted = `[empty document: ${safeName} (${mime}, ${buffer.byteLength} bytes) — no extractable text]`;
      }
      if (Buffer.byteLength(extracted, "utf8") > MAX_INLINED_TEXT_BYTES) {
        extracted = extracted.slice(0, MAX_INLINED_TEXT_BYTES) + `\n[document truncated: extracted text exceeds ${MAX_INLINED_TEXT_BYTES} bytes]`;
      }
      resolved.push({
        kind: "text",
        mimeType: "text/plain",
        originalMimeType: mime,
        name: safeName,
        size: buffer.byteLength,
        dataBase64: attachment.data,
        text: extracted,
      });
    } else {
      resolved.push({
        kind: "image",
        mimeType: mime,
        name: safeName,
        size: buffer.byteLength,
        dataBase64: buffer.toString("base64"),
      });
    }
  }
  return resolved;
}

function buildUserMessageContent(
  message: string,
  attachments: ResolvedAttachment[],
): string | ModelContentPart[] {
  if (attachments.length === 0) {
    return message;
  }
  const hasImage = attachments.some(a => a.kind === "image");
  const textPieces: string[] = [];
  if (message.trim()) {
    textPieces.push(message);
  }
  for (const attachment of attachments) {
    if (attachment.kind === "text") {
      const displayMime = attachment.originalMimeType ?? attachment.mimeType;
      textPieces.push(
        `--- file: ${attachment.name} (${displayMime}, ${attachment.size} bytes) ---\n${attachment.text ?? ""}\n--- end file: ${attachment.name} ---`,
      );
    }
  }
  const combinedText = textPieces.join("\n\n");
  if (!hasImage) {
    // No images → plain string is enough for any provider.
    return combinedText;
  }
  // Multimodal: emit a text part (text + inlined file contents) followed by
  // image parts. Vision-capable providers will receive both; text-only models
  // will see only the text part once their adapter discards images.
  const parts: ModelContentPart[] = [];
  if (combinedText.trim()) {
    parts.push({ type: "text", text: combinedText });
  } else {
    parts.push({ type: "text", text: "(see attached image)" });
  }
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      parts.push({
        type: "image",
        mimeType: attachment.mimeType,
        dataBase64: attachment.dataBase64,
      });
    }
  }
  return parts;
}

function summarizeAttachments(attachments: ResolvedAttachment[]): Array<Record<string, unknown>> {
  return attachments.map(a => ({
    kind: a.kind,
    mimeType: a.originalMimeType ?? a.mimeType,
    name: a.name,
    size: a.size,
  }));
}

// ---------------------------------------------------------------------------
// Document text extractors (lazy-loaded). Each is best-effort — failures
// surface a clear error to the caller via resolveAttachments.
// ---------------------------------------------------------------------------

async function extractPdfText(buffer: Buffer, _name: string): Promise<string> {
  // pdfjs-dist exposes a Node-compatible build under legacy/build/pdf.mjs
  // Use eval-based dynamic import so packages without the optional dep still type-check.
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string) as {
    getDocument(options: { data: Uint8Array }): { promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }> }>;
    }> };
  };
  // pdfjs needs Uint8Array, not Node Buffer
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str ?? "").join(" ");
    pages.push(`--- page ${i} ---\n${text}`);
  }
  return pages.join("\n\n");
}

async function extractDocxText(buffer: Buffer, _name: string): Promise<string> {
  const mammoth = await import("mammoth" as string) as { extractRawText(input: { buffer: Buffer }): Promise<{ value: string }> };
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractXlsxText(buffer: Buffer, _name: string): Promise<string> {
  const xlsx = await import("xlsx" as string) as {
    read(data: Buffer, opts: { type: "buffer" }): { SheetNames: string[]; Sheets: Record<string, unknown> };
    utils: { sheet_to_csv(sheet: unknown): string };
  };
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const sheets: string[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const csv = xlsx.utils.sheet_to_csv(sheet);
    sheets.push(`--- sheet: ${name} ---\n${csv}`);
  }
  return sheets.join("\n\n");
}

async function extractPptxText(buffer: Buffer, _name: string): Promise<string> {
  const jszipMod = await import("jszip" as string) as { default: { loadAsync(data: Buffer): Promise<{ files: Record<string, { name: string; async(type: "text"): Promise<string> }> }> } };
  const JSZip = jszipMod.default;
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(/slide(\d+)/.exec(a)?.[1] ?? 0);
      const nb = Number(/slide(\d+)/.exec(b)?.[1] ?? 0);
      return na - nb;
    });
  const slides: string[] = [];
  for (const slide of slideNames) {
    const xml = await zip.files[slide]!.async("text");
    // Extract text runs from <a:t>...</a:t>
    const matches = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map(m => decodeXmlEntities(m[1] ?? ""));
    slides.push(`--- ${slide.replace("ppt/slides/", "")} ---\n${matches.join(" ")}`);
  }
  return slides.join("\n\n");
}

async function extractRtfText(buffer: Buffer, _name: string): Promise<string> {
  // Minimal RTF stripper — good enough for most plain RTF files.
  const raw = buffer.toString("latin1");
  // Strip groups, control words, and binary content
  let out = raw
    .replace(/\\\*\\[^ ]+\s+/g, "") // \*\control words with optional content (rough)
    .replace(/\\[a-zA-Z]+-?\d*[ ]?/g, "")
    .replace(/\\['\\{}]/g, "")
    .replace(/[{}]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\\\n/g, "\n")
    .trim();
  return out;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code) || 0));
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

const MEMORY_CONTEXT_PROVIDER_NAMES = new Set([
  "memory_recall",
  "markdown_memory",
  "session_compaction",
]);

function isMemoryContextProvider(name: string): boolean {
  return MEMORY_CONTEXT_PROVIDER_NAMES.has(name);
}

function isParallelSafeTool(tool: ToolDefinition): boolean {
  const capabilities = tool.capabilities ?? [];
  if (capabilities.some(capability => capability !== "read")) {
    return false;
  }
  return tool.permission === "allow";
}

function canRunToolCallsInParallel(toolCalls: ModelToolCall[], registry: ToolRegistry): boolean {
  if (toolCalls.length <= 1) {
    return false;
  }
  return toolCalls.every(toolCall => {
    const toolName = toolCall.function?.name?.trim();
    if (!toolName) {
      return false;
    }
    const tool = registry.get(normalizeToolName(toolName));
    return tool !== undefined && isParallelSafeTool(tool);
  });
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
      // Defense in depth: providers sanitize at construction, but this body
      // ends up in lifecycle events and trajectory files, so re-redact.
      metadata.responseBody = redactSecretsInText(error.responseBody, {
        maxLength: 1200,
        compactWhitespace: true,
      });
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
    return "No model provider is configured. Register a provider or set an API key (e.g. DRAGON_OPENAI_API_KEY, DRAGON_ANTHROPIC_API_KEY, DRAGON_OPENROUTER_API_KEY).";
  }
  return `All model fallback attempts failed: ${failures.map(formatModelFailure).join("; ")}`;
}

function formatNoProviderMessage(registry: ProviderRegistry): string {
  const providers = registry.list();
  if (providers.length === 0) {
    return "No model provider is configured. Register a provider or set an API key (e.g. DRAGON_OPENAI_API_KEY, DRAGON_ANTHROPIC_API_KEY, DRAGON_OPENROUTER_API_KEY).";
  }
  const ids = providers.map(provider => provider.id).join(", ");
  return `No default model provider could be selected. Configured providers: [${ids}]. Pass --model <provider:model> or set DRAGON_MODEL.`;
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
