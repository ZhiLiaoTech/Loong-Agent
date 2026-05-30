import { createHash } from "node:crypto";
import type {
  ModelContentPart,
  ModelMessage,
  ModelProvider,
  ModelResponse,
  ModelToolCall,
  ProviderRegistry,
  ProviderResolution,
} from "@loong/providers";
import { ProviderError, createProviderRegistry } from "@loong/providers";
import { isSensitiveKey, redactSecretsInText } from "@loong/security";
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
import {
  applyTurnPrep,
  buildTurnPrepOptions,
  isLikelyContextOverflowError,
  type TurnPrepReport,
} from "./turn-prep.js";
import {
  appendToolIterationLimitFinalizeMessages,
  toToolLimitFinalizeInput,
} from "./turn-tool-limit.js";
import {
  appendCancelledToolResults,
  isTurnCancelled,
  repairModelMessagesAfterCancel,
} from "./turn-cancel.js";
import { resolveSessionCompactionForTurn } from "./session-compaction-config.js";
import { resolveAiSummarizationForTurn } from "./ai-summarization-config.js";
import type { AISummarizationConfig, AISummarizationOptions } from "./ai-summarization.js";
import type { SessionMessageCompactionOptions } from "./session-message-compaction.js";
import { prepareSessionHistoryForModel } from "./session-history-prep.js";
import type {
  ToolDefinition,
  ToolInvocation,
  ToolPermissionEngine,
  ToolPermissionResult,
  ToolRegistry,
} from "@loong/tools";
import { createToolPermissionEngine, createToolRegistry, normalizeToolName } from "@loong/tools";
import { canRunToolCallsInParallel } from "./tool-parallel.js";
import { formatToolActivityDisplay } from "./tool-activity-display.js";
import type {
  LoongAgentRuntime,
  LoongAttachment,
  LoongContextItem,
  LoongContextProvider,
  LoongEvent,
  LoongLifecycleHook,
  LoongLifecycleHookRequest,
  LoongMessage,
  LoongPermissionEventPayload,
  LoongPermissionHandler,
  LoongPermissionRequest,
  LoongPermissionResponse,
  LoongSessionStore,
  LoongSessionTurnRecord,
  LoongTrajectoryRecord,
  LoongTrajectoryStore,
  LoongTurnInput,
  LoongTurnResult,
  LoongUsage,
} from "./types.js";

export interface LoongRuntimeOptions {
  providerRegistry?: ProviderRegistry;
  providers?: ModelProvider[];
  toolRegistry?: ToolRegistry;
  tools?: ToolDefinition[];
  permissionEngine?: ToolPermissionEngine;
  permissionHandler?: LoongPermissionHandler;
  sessionStore?: LoongSessionStore;
  trajectoryStore?: LoongTrajectoryStore;
  contextProviders?: LoongContextProvider[];
  lifecycleHooks?: LoongLifecycleHook[];
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
  /** When true (default), apply in-turn context prep before each model call. */
  turnPrepEnabled?: boolean;
  /** L2 cross-turn compaction for session history; `false` disables. */
  sessionCompaction?: SessionMessageCompactionOptions | false;
  /** L1 AI summarization for older session turns; `false` disables. Default off. */
  aiSummarization?: AISummarizationConfig | false;
  /** When true, denied tool permissions fail the turn instead of returning a soft tool error. */
  failOnPermissionDeny?: boolean;
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

export class DefaultLoongAgentRuntime implements LoongAgentRuntime {
  #providerRegistry: ProviderRegistry;
  readonly #toolRegistry: ToolRegistry;
  readonly #permissionEngine: ToolPermissionEngine;
  readonly #permissionHandler: LoongPermissionHandler | undefined;
  readonly #sessionStore: LoongSessionStore | undefined;
  readonly #trajectoryStore: LoongTrajectoryStore | undefined;
  readonly #contextProviders: LoongContextProvider[];
  readonly #lifecycleHooks: LoongLifecycleHook[];
  readonly #defaultModel: string | undefined;
  readonly #modelFallbacks: string[];
  readonly #systemPrompt: string;
  readonly #maxToolIterations: number;
  readonly #maxContextChars: number;
  readonly #lifecycleHookTimeoutMs: number;
  readonly #denyAskWithoutHandler: boolean;
  readonly #permissionEvaluator: LoongRuntimeOptions["permissionEvaluator"];
  readonly #modelTimeoutMs: number;
  readonly #turnPrepEnabled: boolean;
  readonly #sessionCompaction: SessionMessageCompactionOptions | false;
  readonly #aiSummarization: AISummarizationConfig | false;
  readonly #failOnPermissionDeny: boolean;
  #tierConfig: ModelTierConfig | undefined;
  readonly #maxToolResultChars = 64_000;
  readonly #listeners = new Set<(event: LoongEvent) => void>();
  readonly #eventCollectors = new Map<string, LoongEvent[]>();

  constructor(options: LoongRuntimeOptions = {}) {
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
    this.#systemPrompt = options.systemPrompt ?? "You are Loong, a TypeScript-native local-first agent.";
    this.#maxToolIterations = options.maxToolIterations ?? 20;
    this.#maxContextChars = options.maxContextChars ?? 12_000;
    this.#lifecycleHookTimeoutMs = 500;
    this.#denyAskWithoutHandler = options.denyAskWithoutHandler ?? true;
    this.#permissionEvaluator = options.permissionEvaluator;
    this.#modelTimeoutMs = options.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
    this.#turnPrepEnabled = options.turnPrepEnabled !== false;
    this.#sessionCompaction = options.sessionCompaction === false ? false : (options.sessionCompaction ?? {});
    this.#aiSummarization = options.aiSummarization === false ? false : (options.aiSummarization ?? { enabled: false });
    this.#failOnPermissionDeny = options.failOnPermissionDeny === true;
    this.#tierConfig = options.tierConfig;
  }

  subscribe(listener: (event: LoongEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Hot-swap the tier scheduling config. Takes effect on the NEXT turn ù?runs
   * already in flight see the previous decision. Pass `undefined` to disable
   * tier scheduling for subsequent turns.
   */
  setTierConfig(config: ModelTierConfig | undefined): void {
    this.#tierConfig = config;
  }

  /**
   * Hot-swap the provider registry. Takes effect on the NEXT turn ù?runs already
   * in flight keep the previous registry.
   */
  setProviderRegistry(registry: ProviderRegistry): void {
    this.#providerRegistry = registry;
  }

  /** Returns a shallow copy of the active tier config, or undefined. */
  getTierConfig(): ModelTierConfig | undefined {
    if (!this.#tierConfig) return undefined;
    return JSON.parse(JSON.stringify(this.#tierConfig)) as ModelTierConfig;
  }

  async runTurn(input: LoongTurnInput): Promise<LoongTurnResult> {
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
    let resultMessages: LoongMessage[] = [userMessage];
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
    const activeInput: LoongTurnInput = { ...input, signal: turnAbort.signal };
    let modelMessages: ModelMessage[] | undefined;

    try {
      if (activeInput.signal?.aborted) {
        throw new LoongCancelledError("Turn was cancelled before it started.");
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
      const rawHistory = toModelHistory(history);
      const aiSummarizationConfig = resolveAiSummarizationForTurn(this.#aiSummarization, activeInput);
      const aiSummarizationOptions = aiSummarizationConfig !== false && aiSummarizationConfig.enabled === true
        ? await this.#buildAiSummarizationOptions(aiSummarizationConfig, activeInput, runId)
        : undefined;
      const sessionHistoryPrep = await prepareSessionHistoryForModel(
        rawHistory,
        turnMaxContextChars,
        resolveSessionCompactionForTurn(this.#sessionCompaction, activeInput),
        aiSummarizationOptions ? { aiSummarization: aiSummarizationOptions } : {},
      );
      if (sessionHistoryPrep.report.sessionCompaction?.compactedToolMessages) {
        this.#emit({
          type: "context",
          runId,
          providerName: "session_message_compaction",
          phase: "end",
          payload: {
            ok: true,
            ...sessionHistoryPrep.report.sessionCompaction,
          },
        });
      }
      if (
        sessionHistoryPrep.report.truncatedToolResults > 0
        || sessionHistoryPrep.report.truncatedAssistantMessages > 0
        || sessionHistoryPrep.report.strippedReasoningMessages > 0
      ) {
        this.#emit({
          type: "context",
          runId,
          providerName: "session_history_prep",
          phase: "end",
          payload: {
            ok: true,
            ...sessionHistoryPrep.report,
          },
        });
      }
      modelMessages = [
        { role: "system", content: composeSystemPrompt(effectiveSystemPrompt, contextItems, turnMaxContextChars) },
        ...sessionHistoryPrep.messages,
        { role: "user", content: userContent },
      ];

      const modelRefs = modelAttemptRefs(activeInput.model, this.#defaultModel, activeInput.modelFallbacks, this.#modelFallbacks);
      let completion = await this.#completeModelWithPrep(modelRefs, modelMessages, activeInput, runId, turnMaxContextChars);
      let providerResponse = augmentResponseWithTextToolCalls(completion.response, activeInput.toolsEnabled);
      let resolution = completion.resolution;
      let fallbackFailures = completion.failures;
      if (providerResponse.textToolCallsExtracted && providerResponse.streamedText) {
        const cleaned = stripTextToolBlocks(completion.response.text ?? "");
        this.#emit({
          type: "assistant_replace",
          runId,
          text: cleaned.length > 0 ? `${cleaned}\n\n[????????ù]\n` : "[????????ù]\n",
        });
      }

      if (activeInput.signal?.aborted) {
        throw new LoongCancelledError("Turn was cancelled.");
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
        const toolOutcome = await this.#executeToolCallsForRound(toolCalls, modelMessages, activeInput, runId);
        if (toolOutcome === "cancelled") {
          repairModelMessagesAfterCancel(modelMessages);
          throw new LoongCancelledError("Turn was cancelled.");
        }

        if (activeInput.signal?.aborted) {
          repairModelMessagesAfterCancel(modelMessages);
          throw new LoongCancelledError("Turn was cancelled.");
        }

        completion = await this.#completeModelWithPrep(modelRefs, modelMessages, activeInput, runId, turnMaxContextChars);
        providerResponse = augmentResponseWithTextToolCalls(completion.response, activeInput.toolsEnabled);
        resolution = completion.resolution;
        fallbackFailures = completion.failures;
      }

      let toolIterationLimitReached = false;
      if (providerResponse.toolCalls?.length) {
        const finalized = await this.#finalizeAfterToolIterationLimit(
          modelRefs,
          modelMessages,
          providerResponse,
          activeInput,
          runId,
          turnMaxContextChars,
        );
        providerResponse = augmentResponseWithTextToolCalls(finalized.response, false);
        resolution = finalized.resolution;
        fallbackFailures = finalized.failures;
        toolIterationLimitReached = true;
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
      if (providerResponse.toolCalls && !toolIterationLimitReached) {
        assistantMetadata.toolCalls = providerResponse.toolCalls;
      }
      if (toolIterationLimitReached) {
        assistantMetadata.toolIterationLimitReached = true;
        assistantMetadata.toolIterationLimit = this.#maxToolIterations;
        if (activeInput.queryLoop !== false) {
          assistantMetadata.queryLoopContinue = true;
        }
      }
      if (fallbackFailures.length > 0) {
        assistantMetadata.modelFallbacks = fallbackFailures;
      }
      const assistantMessage = createMessage("assistant", assistantText, new Date().toISOString(), assistantMetadata);
      resultMessages = [userMessage, assistantMessage];

      const result: LoongTurnResult = {
        runId,
        status: "ok",
        messages: resultMessages,
      };

      const usage = toLoongUsage(providerResponse.usage);
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
      if (modelMessages && isTurnCancelled(activeInput.signal, error)) {
        repairModelMessagesAfterCancel(modelMessages);
      }
      const errorDetails = errorToDetails(error);
      const status = resolveTurnFailureStatus(error, input.signal, turnAbort);
      const result: LoongTurnResult = {
        runId,
        status,
        messages: resultMessages,
        error: errorDetails.message,
      };
      if (!(error instanceof LoongPersistenceError)) {
        await this.#tryPersistTurn(activeInput, result, createdAt);
      }
      const lifecycleEvent: LoongEvent = {
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

  #emit(event: LoongEvent): void {
    this.#eventCollectors.get(event.runId)?.push(cloneEvent(event));
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Event subscribers are observers; they must not break the agent turn.
      }
    }
  }

  async #loadSessionMessages(sessionId: string): Promise<LoongMessage[]> {
    if (!this.#sessionStore) {
      return [];
    }
    try {
      return await this.#sessionStore.loadMessages(sessionId);
    } catch (error) {
      throw new LoongPersistenceError(
        `Failed to load session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async #buildAiSummarizationOptions(
    config: AISummarizationConfig,
    input: LoongTurnInput,
    runId: string,
  ): Promise<AISummarizationOptions> {
    const modelRef = config.model?.trim() || input.model?.trim() || this.#defaultModel;
    const resolution = modelRef ? this.#providerRegistry.resolveModel(modelRef) : undefined;
    return {
      ...config,
      enabled: true,
      ...(resolution ? { provider: resolution.provider, model: resolution.model } : {}),
      onSummaryGenerated: report => {
        if (report.skipped && !report.error) {
          return;
        }
        this.#emit({
          type: "context",
          runId,
          providerName: "ai_summarization",
          phase: "end",
          payload: {
            ok: !report.error,
            ...report,
          },
        });
      },
    };
  }

  async #buildContextItems(
    input: LoongTurnInput,
    history: LoongMessage[],
    runId: string,
    createdAt: string,
  ): Promise<LoongContextItem[]> {
    const items: LoongContextItem[] = [];
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
        throw new LoongCancelledError("Turn was cancelled.");
      }
    }
    return items;
  }

  async #notifyLifecycleHooks(
    phase: LoongLifecycleHookRequest["phase"],
    input: LoongTurnInput,
    runId: string,
    createdAt: string,
    completedAt?: string,
    result?: LoongTurnResult,
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
    input: LoongTurnInput,
    result: LoongTurnResult,
    createdAt: string,
  ): Promise<void> {
    if (!this.#sessionStore) {
      return;
    }
    const record = toSessionTurnRecord(input, result, createdAt);
    try {
      await this.#sessionStore.appendTurn(record);
    } catch (error) {
      throw new LoongPersistenceError(
        `Failed to persist session ${input.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async #tryPersistTurn(
    input: LoongTurnInput,
    result: LoongTurnResult,
    createdAt: string,
  ): Promise<void> {
    try {
      await this.#persistTurn(input, result, createdAt);
    } catch {
      // Preserve the original turn failure when error-path persistence also fails.
    }
  }

  async #tryPersistTrajectory(
    input: LoongTurnInput,
    result: LoongTurnResult,
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
    input: LoongTurnInput,
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

  async #finalizeAfterToolIterationLimit(
    modelRefs: Array<string | undefined>,
    modelMessages: ModelMessage[],
    providerResponse: ModelResponse,
    input: LoongTurnInput,
    runId: string,
    turnMaxContextChars: number,
  ): Promise<{ resolution: ProviderResolution; response: ModelResponse; failures: ModelAttemptFailure[] }> {
    const finalizeInput = toToolLimitFinalizeInput(providerResponse);
    if (!finalizeInput) {
      throw new Error("Tool iteration finalize requested without pending tool calls.");
    }
    const pendingCount = appendToolIterationLimitFinalizeMessages(
      modelMessages,
      finalizeInput,
      this.#maxToolIterations,
    );
    this.#emit({
      type: "context",
      runId,
      providerName: "tool_iteration_limit",
      phase: "end",
      payload: {
        ok: true,
        limit: this.#maxToolIterations,
        pendingToolCalls: pendingCount,
      },
    });
    return await this.#completeModelWithPrep(
      modelRefs,
      modelMessages,
      { ...input, toolsEnabled: false },
      runId,
      turnMaxContextChars,
    );
  }

  async #completeModelWithPrep(
    modelRefs: Array<string | undefined>,
    messages: ModelMessage[],
    input: LoongTurnInput,
    runId: string,
    turnMaxContextChars: number,
  ): Promise<{ resolution: ProviderResolution; response: ModelResponse; failures: ModelAttemptFailure[] }> {
    if (!this.#turnPrepEnabled) {
      return await this.#completeModelWithFallback(modelRefs, messages, input, runId);
    }

    const standard = applyTurnPrep(messages, buildTurnPrepOptions(turnMaxContextChars));
    this.#emitTurnPrep(runId, standard.report);
    try {
      return await this.#completeModelWithFallback(modelRefs, standard.messages, input, runId);
    } catch (error) {
      if (input.signal?.aborted || !isLikelyContextOverflowError(error)) {
        throw error;
      }
      const aggressive = applyTurnPrep(messages, buildTurnPrepOptions(turnMaxContextChars, {}, true));
      this.#emitTurnPrep(runId, aggressive.report, { reactive: true });
      return await this.#completeModelWithFallback(modelRefs, aggressive.messages, input, runId);
    }
  }

  #emitTurnPrep(
    runId: string,
    report: TurnPrepReport,
    options: { reactive?: boolean } = {},
  ): void {
    const changed = report.estimatedCharsBefore !== report.estimatedCharsAfter
      || report.truncatedToolResults > 0
      || report.truncatedAssistantMessages > 0
      || report.strippedReasoningMessages > 0;
    if (!changed && options.reactive !== true) {
      return;
    }
    this.#emit({
      type: "context",
      runId,
      providerName: "turn_prep",
      phase: "end",
      payload: {
        ok: true,
        reactive: options.reactive === true,
        aggressive: report.aggressive,
        truncatedToolResults: report.truncatedToolResults,
        truncatedAssistantMessages: report.truncatedAssistantMessages,
        strippedReasoningMessages: report.strippedReasoningMessages,
        estimatedCharsBefore: report.estimatedCharsBefore,
        estimatedCharsAfter: report.estimatedCharsAfter,
      },
    });
  }

  async #completeModelWithFallback(
    modelRefs: Array<string | undefined>,
    messages: ModelMessage[],
    input: LoongTurnInput,
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
          throw failures.length > 1 ? new LoongModelFallbackError(failures) : error;
        }
      }
    }

    throw new LoongModelFallbackError(failures);
  }

  async #executeToolCallsForRound(
    toolCalls: ModelToolCall[],
    modelMessages: ModelMessage[],
    input: LoongTurnInput,
    runId: string,
  ): Promise<"completed" | "cancelled"> {
    if (input.toolsEnabled === false) {
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
      return "completed";
    }

    if (canRunToolCallsInParallel(toolCalls, this.#toolRegistry)) {
      if (input.signal?.aborted) {
        appendCancelledToolResults(modelMessages, toolCalls);
        return "cancelled";
      }

      const toolResults: Array<{ content: string } | undefined> = new Array(toolCalls.length);
      let cancelled = false;
      try {
        const parallelTotal = toolCalls.length;
        let parallelCompleted = 0;
        await Promise.all(toolCalls.map(async (toolCall, index) => {
          if (input.signal?.aborted) {
            cancelled = true;
            return;
          }
          toolResults[index] = await this.#runToolCall(toolCall, input, runId);
          parallelCompleted += 1;
          this.#emitParallelReadToolProgress(runId, toolCall, parallelCompleted, parallelTotal, toolResults[index]?.content);
          if (input.signal?.aborted) {
            cancelled = true;
          }
        }));
      } catch (error) {
        if (isTurnCancelled(input.signal, error)) {
          cancelled = true;
        } else {
          throw error;
        }
      }

      for (const [index, toolResult] of toolResults.entries()) {
        if (!toolResult) {
          continue;
        }
        modelMessages.push({
          role: "tool",
          content: toolResult.content,
          toolCallId: toolCalls[index]!.id,
        });
      }

      if (cancelled || input.signal?.aborted) {
        appendCancelledToolResults(modelMessages, toolCalls);
        return "cancelled";
      }
      return "completed";
    }

    for (let index = 0; index < toolCalls.length; index++) {
      const toolCall = toolCalls[index]!;
      if (input.signal?.aborted) {
        appendCancelledToolResults(modelMessages, toolCalls.slice(index));
        return "cancelled";
      }

      try {
        const toolResult = await this.#runToolCall(toolCall, input, runId);
        modelMessages.push({
          role: "tool",
          content: toolResult.content,
          toolCallId: toolCall.id,
        });
        if (input.signal?.aborted) {
          appendCancelledToolResults(modelMessages, toolCalls.slice(index + 1));
          return "cancelled";
        }
      } catch (error) {
        if (isTurnCancelled(input.signal, error)) {
          appendCancelledToolResults(modelMessages, toolCalls.slice(index));
          return "cancelled";
        }
        throw error;
      }
    }

    return "completed";
  }

  async #runToolCall(
    toolCall: ModelToolCall,
    input: LoongTurnInput,
    runId: string,
  ): Promise<{ content: string }> {
    if (input.signal?.aborted) {
      throw new LoongCancelledError("Turn was cancelled during tool execution.");
    }

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

    const tool = this.#toolRegistry.get(normalizeToolName(toolName));
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
    const permission = await this.#resolvePermission(tool, invocation, baselinePermission, runId, input.signal);
    if (permission.decision !== "allow") {
      this.#emit({
        type: "tool",
        runId,
        toolName: tool.name,
        phase: "end",
        payload: { toolCallId: toolCall.id, permission, skipped: true },
      });
      if (this.#failOnPermissionDeny) {
        throw new LoongPermissionDeniedError(tool.name, permission);
      }
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
      payload: (() => {
        const inputSummary = summarizePermissionInput(parsedInput.value);
        const display = formatToolActivityDisplay(tool.name, parsedInput.value, "start");
        return {
          toolCallId: toolCall.id,
          inputSummary,
          displayLabel: display.displayLabel,
          ...(display.displayDetail ? { displayDetail: display.displayDetail } : {}),
        };
      })(),
    });
    try {
      const result = await tool.invoke(invocation);
      const display = formatToolActivityDisplay(tool.name, parsedInput.value, "end");
      this.#emit({
        type: "tool",
        runId,
        toolName: tool.name,
        phase: "end",
        payload: {
          toolCallId: toolCall.id,
          resultSummary: summarizePermissionInput(result),
          displayLabel: display.displayLabel,
          ...(display.displayDetail ? { displayDetail: display.displayDetail } : {}),
        },
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

  /** Streams parallel read-only tool completion to subscribers (Gateway SSE / Dashboard). */
  #emitParallelReadToolProgress(
    runId: string,
    toolCall: ModelToolCall,
    completed: number,
    total: number,
    resultContent: string | undefined,
  ): void {
    const toolName = toolCall.function?.name?.trim() || toolCall.id;
    const preview = resultContent === undefined
      ? undefined
      : resultContent.length > 400
        ? `${resultContent.slice(0, 400)}ù`
        : resultContent;
    this.#emit({
      type: "tool",
      runId,
      toolName,
      phase: "update",
      payload: {
        toolCallId: toolCall.id,
        parallelBatch: true,
        completed,
        total,
        ...(preview !== undefined ? { resultPreview: preview } : {}),
      },
    });
  }

  async #resolvePermission(
    tool: ToolDefinition,
    invocation: ToolInvocation,
    permission: ToolPermissionResult,
    runId: string,
    signal: AbortSignal | undefined,
  ): Promise<ToolPermissionResult> {
    if (permission.decision !== "ask") {
      return permission;
    }

    if (signal?.aborted) {
      throw new LoongCancelledError("Turn was cancelled while waiting for permission.");
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

    if (signal?.aborted) {
      throw new LoongCancelledError("Turn was cancelled while waiting for permission.");
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

export function createLoongRuntime(options: LoongRuntimeOptions = {}): LoongAgentRuntime {
  return new DefaultLoongAgentRuntime(options);
}

function createMessage(
  role: LoongMessage["role"],
  content: string,
  createdAt: string,
  metadata?: Record<string, unknown>,
): LoongMessage {
  const message: LoongMessage = {
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
  input: LoongTurnInput,
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
  phase: LoongLifecycleHookRequest["phase"],
  input: LoongTurnInput,
  runId: string,
  createdAt: string,
  completedAt?: string,
  result?: LoongTurnResult,
): LoongLifecycleHookRequest {
  const request: LoongLifecycleHookRequest = {
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

function freezeLifecycleHookRequest(request: LoongLifecycleHookRequest): Readonly<LoongLifecycleHookRequest> {
  const clone: LoongLifecycleHookRequest = {
    ...request,
    ...(request.usage !== undefined ? { usage: deepCloneAndFreeze(request.usage) as LoongUsage } : {}),
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
): LoongPermissionRequest {
  const request: LoongPermissionRequest = {
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
  response: LoongPermissionResponse | "allow" | "deny",
  previousReason: string,
): LoongPermissionResponse {
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
  request: LoongPermissionRequest,
  result?: ToolPermissionResult,
  metadata?: Record<string, unknown>,
): LoongPermissionEventPayload {
  const payload: LoongPermissionEventPayload = {
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
  input: LoongTurnInput,
  result: LoongTurnResult,
  createdAt: string,
): LoongSessionTurnRecord {
  const record: LoongSessionTurnRecord = {
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
  input: LoongTurnInput,
  result: LoongTurnResult,
  createdAt: string,
  completedAt: string,
  events: LoongEvent[],
): LoongTrajectoryRecord {
  const assistantMessage = [...result.messages].reverse().find(message => message.role === "assistant");
  const record: LoongTrajectoryRecord = {
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

function cloneEvent(event: LoongEvent): LoongEvent {
  try {
    return JSON.parse(JSON.stringify(event)) as LoongEvent;
  } catch {
    return {
      type: "lifecycle",
      phase: "error",
      runId: event.runId,
      message: "Event could not be serialized.",
    };
  }
}

function toLoongUsage(
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
): LoongUsage | undefined {
  if (!usage) {
    return undefined;
  }

  const loongUsage: LoongUsage = {};
  if (usage.inputTokens !== undefined) {
    loongUsage.inputTokens = usage.inputTokens;
  }
  if (usage.outputTokens !== undefined) {
    loongUsage.outputTokens = usage.outputTokens;
  }
  if (usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
    loongUsage.totalTokens = usage.inputTokens + usage.outputTokens;
  }
  return loongUsage;
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

async function resolveAttachments(attachments: readonly LoongAttachment[] | undefined): Promise<ResolvedAttachment[]> {
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
        extracted = `[empty document: ${safeName} (${mime}, ${buffer.byteLength} bytes) ù?no extractable text]`;
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
    // No images ù?plain string is enough for any provider.
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
// Document text extractors (lazy-loaded). Each is best-effort ù?failures
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
  // Minimal RTF stripper ù?good enough for most plain RTF files.
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

function toModelHistory(history: LoongMessage[]): ModelMessage[] {
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

function composeSystemPrompt(
  systemPrompt: string,
  contextItems: LoongContextItem[],
  maxContextChars: number,
): string {
  const contextText = formatContextItems(contextItems, maxContextChars);
  return contextText
    ? `${systemPrompt}\n\nLoong recall context:\n${contextText}`
    : systemPrompt;
}

function formatContextItems(contextItems: LoongContextItem[], maxContextChars: number): string {
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
  if (error instanceof LoongModelFallbackError) {
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

class LoongCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoongCancelledError";
  }
}

class LoongPermissionDeniedError extends Error {
  readonly toolName: string;
  readonly permission: ToolPermissionResult;

  constructor(toolName: string, permission: ToolPermissionResult) {
    super(`Tool permission ${permission.decision} for ${toolName}: ${permission.reason}`);
    this.name = "LoongPermissionDeniedError";
    this.toolName = toolName;
    this.permission = permission;
  }
}

class LoongModelFallbackError extends Error {
  readonly failures: ModelAttemptFailure[];

  constructor(failures: ModelAttemptFailure[]) {
    super(formatModelFallbackError(failures));
    this.name = "LoongModelFallbackError";
    this.failures = failures;
  }
}

function formatModelFallbackError(failures: ModelAttemptFailure[]): string {
  if (failures.length === 0) {
    return "No model provider is configured. Register a provider or set an API key (e.g. LOONG_OPENAI_API_KEY, LOONG_ANTHROPIC_API_KEY, LOONG_OPENROUTER_API_KEY).";
  }
  return `All model fallback attempts failed: ${failures.map(formatModelFailure).join("; ")}`;
}

function formatNoProviderMessage(registry: ProviderRegistry): string {
  const providers = registry.list();
  if (providers.length === 0) {
    return "No model provider is configured. Register a provider or set an API key (e.g. LOONG_OPENAI_API_KEY, LOONG_ANTHROPIC_API_KEY, LOONG_OPENROUTER_API_KEY).";
  }
  const ids = providers.map(provider => provider.id).join(", ");
  return `No default model provider could be selected. Configured providers: [${ids}]. Pass --model <provider:model> or set LOONG_MODEL.`;
}

function formatModelFailure(failure: ModelAttemptFailure): string {
  const target = [
    failure.providerId,
    failure.model,
  ].filter(Boolean).join(":") || failure.requestedModel || "default";
  return `${target}: ${failure.message}`;
}

class LoongPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoongPersistenceError";
  }
}
