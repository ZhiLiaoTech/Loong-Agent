import { useCallback, useEffect, useRef, useState } from "react";
import { GatewayApiError } from "../../api/index.js";
import type { GatewayEventEnvelope } from "../../api/index.js";
import { useLoongEvents } from "../events/EventsContext.js";
import type { TranslateFn } from "../events/formatGatewayEvent.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import { applyActivityEvent, isActivityEvent } from "./activity/activityFromEvent.js";
import {
  loadChatActivityPreferences,
  saveChatActivityPreferences,
} from "./activity/chatActivityPreferences.js";
import type { ChatActivityPreferences } from "./activity/types.js";
import { pickAssistantDisplayText, stripTextToolBlocks } from "./chatDisplay.js";
import { buildErrorDetail, type RunFailureInfo } from "./runFailure.js";
import {
  hydrateChatHistory,
  MAX_CHAT_TURNS,
  normalizeChatSessionId,
  trimChatTurns,
} from "./chatHistoryRestore.js";
import { saveLocalChatTurns, loadLocalChatTurns } from "./chatSessionStorage.js";
import type { AgentProfile, AgentRunResult, ChatActivityStep, ChatTurn, RunSettings } from "./types.js";
import type { WorkspaceScopeSelection } from "./workspaceScope.js";
import { resolveEffectiveWorkspace } from "./workspaceScope.js";

// Module-level cache so chat state survives RunWorkspace unmount when the user
// navigates to Models/Agents/etc. and returns. Full page refresh restores from
// gateway trajectory records for the same sessionId.
export interface LastTierInfo {
  tier: "fast" | "standard" | "deep";
  source: "heuristic" | "fixed" | "inherited" | "explicit-input";
  score?: number;
  reason?: string;
  maxContextChars?: number;
  thinking?: "none" | "low" | "medium" | "high";
}

interface CachedChatState {
  chatTurns: ChatTurn[];
  activeRunId: string;
  lastResult: AgentRunResult | null;
  lastTier: LastTierInfo | null;
  hydrated: boolean;
}

const emptyCache = (): CachedChatState => ({
  chatTurns: [],
  activeRunId: "",
  lastResult: null,
  lastTier: null,
  hydrated: false,
});

const chatStateCacheBySession = new Map<string, CachedChatState>();

function getChatCache(sessionId: string): CachedChatState {
  const key = normalizeChatSessionId(sessionId);
  const existing = chatStateCacheBySession.get(key);
  if (existing) {
    return existing;
  }
  const created = emptyCache();
  chatStateCacheBySession.set(key, created);
  return created;
}

/** Fallback when Gateway returns runId but no SSE lifecycle (sync-only providers). */
const RUN_FINALIZE_TIMEOUT_MS = 30_000;

export function useRunChat(
  settings: RunSettings,
  selectedProfile: AgentProfile | undefined,
  options?: {
    gatewayOnline?: boolean;
    translate?: TranslateFn;
    workspaceScope?: WorkspaceScopeSelection;
    profileWorkspace?: string;
  },
) {
  const gatewayOnline = options?.gatewayOnline ?? true;
  const translate = options?.translate ?? (key => key);
  const workspaceScope = options?.workspaceScope ?? { kind: "global" as const };
  const profileWorkspace = options?.profileWorkspace ?? selectedProfile?.workspace;
  const client = useGatewayClient();
  const { events, connectionEpoch } = useLoongEvents();
  const sessionKey = normalizeChatSessionId(settings.sessionId);
  const chatStateCache = getChatCache(sessionKey);
  // Hydrate from the module cache. Any assistant turn that was mid-stream
  // when the user navigated away gets settled so we don't show a stuck "...".
  const initialChatTurns = chatStateCache.chatTurns.map(turn =>
    turn.role === "assistant" && turn.streaming
      ? { ...turn, streaming: false, text: turn.text || "[interrupted by navigation]" }
      : turn,
  );
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>(initialChatTurns);
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState(chatStateCache.activeRunId);
  const [timelineRunId, setTimelineRunId] = useState("");
  const [expectingRun, setExpectingRun] = useState(false);
  const [lastResult, setLastResult] = useState<AgentRunResult | null>(chatStateCache.lastResult);
  const [lastTier, setLastTier] = useState<LastTierInfo | null>(chatStateCache.lastTier);
  const [showRaw, setShowRaw] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [activityPreferences, setActivityPreferences] = useState(loadChatActivityPreferences);

  const updateActivityPreferences = useCallback((patch: Partial<ChatActivityPreferences>) => {
    setActivityPreferences(current => {
      const next = { ...current, ...patch };
      saveChatActivityPreferences(next);
      return next;
    });
  }, []);

  // Mirror current chat state into the module cache so the next mount can
  // restore it after a navigation.
  useEffect(() => {
    chatStateCache.chatTurns = chatTurns;
    chatStateCache.activeRunId = activeRunId;
    chatStateCache.lastResult = lastResult;
    chatStateCache.lastTier = lastTier;
  }, [chatTurns, activeRunId, lastResult, lastTier, chatStateCache]);

  useEffect(() => {
    const persistable = chatTurns
      .filter(turn => !turn.streaming)
      .map(({ activities, activitiesExpanded, runId, ...turn }) => turn);
    if (persistable.length > 0) {
      saveLocalChatTurns(sessionKey, persistable);
    }
  }, [chatTurns, sessionKey]);

  useEffect(() => {
    const cache = getChatCache(sessionKey);
    const local = loadLocalChatTurns(sessionKey);
    const base = cache.chatTurns.length > 0 ? cache.chatTurns : local;
    const settled = base.map(turn =>
      turn.role === "assistant" && turn.streaming
        ? { ...turn, streaming: false, text: turn.text || "[interrupted by navigation]" }
        : turn,
    );
    setChatTurns(settled);
    setActiveRunId(cache.activeRunId);
    setLastResult(cache.lastResult);
    setLastTier(cache.lastTier);
    setSending(false);
    setExpectingRun(false);
    setTimelineRunId("");
    setCancelError(null);
    if (settled.length > 0) {
      cache.chatTurns = settled;
    }
  }, [sessionKey]);

  useEffect(() => {
    if (!gatewayOnline) {
      return;
    }
    const cache = getChatCache(sessionKey);
    if (cache.hydrated) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const hydrated = await hydrateChatHistory(client, sessionKey);
        if (cancelled || !hydrated.length) {
          return;
        }
        setChatTurns(current => {
          if (current.length > 0 && current.length >= hydrated.length) {
            return current;
          }
          cache.chatTurns = hydrated;
          return hydrated;
        });
      } catch {
        // Keep whatever local state we already have.
      } finally {
        if (!cancelled) {
          cache.hydrated = true;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, gatewayOnline, sessionKey]);

  const lastSequenceRef = useRef(0);
  const activeRunIdRef = useRef("");
  const expectingRunRef = useRef(false);
  const streamBufferRef = useRef("");
  const receivedStreamDeltaRef = useRef(false);
  const pendingRpcAssistantRef = useRef("");
  const pendingRunFailureRef = useRef<RunFailureInfo | null>(null);
  const lifecycleEndedRef = useRef(false);
  const rpcSettledRef = useRef(false);
  const runFinalizedRef = useRef(false);
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activitiesRef = useRef<ChatActivityStep[]>([]);
  const activityCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearActivityCollapseTimer = useCallback(() => {
    if (activityCollapseTimerRef.current !== undefined) {
      clearTimeout(activityCollapseTimerRef.current);
      activityCollapseTimerRef.current = undefined;
    }
  }, []);

  const syncAssistantActivities = useCallback((
    steps: readonly ChatActivityStep[],
    runId: string,
    patch?: { activitiesExpanded?: boolean },
  ) => {
    activitiesRef.current = [...steps];
    setChatTurns(turns => {
      const next = [...turns];
      const last = next[next.length - 1];
      if (last?.role !== "assistant") {
        return turns;
      }
      next[next.length - 1] = {
        ...last,
        runId,
        activities: steps,
        activitiesExpanded: patch?.activitiesExpanded ?? last.activitiesExpanded ?? true,
      };
      return trimChatTurns(next);
    });
  }, []);

  const scheduleActivityCollapse = useCallback(() => {
    clearActivityCollapseTimer();
    if (!activityPreferences.showActivities || activityPreferences.autoCollapseMs <= 0) {
      return;
    }
    activityCollapseTimerRef.current = setTimeout(() => {
      activityCollapseTimerRef.current = undefined;
      setChatTurns(turns => {
        const next = [...turns];
        const last = next[next.length - 1];
        if (last?.role !== "assistant") {
          return turns;
        }
        next[next.length - 1] = { ...last, activitiesExpanded: false };
        return next;
      });
    }, activityPreferences.autoCollapseMs);
  }, [activityPreferences.autoCollapseMs, activityPreferences.showActivities, clearActivityCollapseTimer]);

  const clearFinalizeTimer = useCallback(() => {
    if (finalizeTimerRef.current !== undefined) {
      clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = undefined;
    }
  }, []);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  useEffect(() => {
    expectingRunRef.current = expectingRun;
  }, [expectingRun]);

  useEffect(() => {
    lastSequenceRef.current = 0;
    streamBufferRef.current = "";
    receivedStreamDeltaRef.current = false;
    pendingRpcAssistantRef.current = "";
    pendingRunFailureRef.current = null;
    lifecycleEndedRef.current = false;
    rpcSettledRef.current = false;
    runFinalizedRef.current = false;
    activitiesRef.current = [];
    clearFinalizeTimer();
  }, [clearFinalizeTimer, connectionEpoch]);

  useEffect(() => () => {
    clearFinalizeTimer();
    clearActivityCollapseTimer();
  }, [clearActivityCollapseTimer, clearFinalizeTimer]);

  const replaceAssistant = useCallback((text: string) => {
    if (!text) {
      return;
    }
    setChatTurns(turns => {
      const next = [...turns];
      const last = next[next.length - 1];
      if (last?.role === "assistant" && last.streaming) {
        next[next.length - 1] = { ...last, text };
      } else {
        next.push({ role: "assistant", text, streaming: true });
      }
      return trimChatTurns(next);
    });
  }, []);

  const finalizeAssistant = useCallback((text: string, failure?: RunFailureInfo) => {
    const failureFields = failure ? buildErrorDetail(failure) : {};
    setChatTurns(turns => {
      const next = [...turns];
      const last = next[next.length - 1];
      const body = (text || stripTextToolBlocks(last?.text || "")).trim();
      if (last?.role === "assistant") {
        if (failure) {
          next[next.length - 1] = {
            ...last,
            streaming: false,
            text: body,
            ...failureFields,
          };
        } else {
          const { outcome: _outcome, errorDetail: _detail, ...rest } = last;
          next[next.length - 1] = { ...rest, streaming: false, text: body };
        }
      } else if (body || failure) {
        next.push({
          role: "assistant",
          text: body,
          streaming: false,
          ...failureFields,
        });
      } else {
        next.push({ role: "assistant", text: "", streaming: false });
      }
      return trimChatTurns(next);
    });
  }, []);

  const completeRun = useCallback((text: string, failure?: RunFailureInfo) => {
    if (runFinalizedRef.current) {
      return;
    }
    runFinalizedRef.current = true;
    clearFinalizeTimer();
    const resolvedFailure = failure ?? pendingRunFailureRef.current ?? undefined;
    const runId = activeRunIdRef.current;
    if (runId) {
      setTimelineRunId(runId);
      if (activityPreferences.showActivities) {
        syncAssistantActivities(activitiesRef.current, runId);
        scheduleActivityCollapse();
      }
    }
    finalizeAssistant(text, resolvedFailure);
    pendingRpcAssistantRef.current = "";
    pendingRunFailureRef.current = null;
    activeRunIdRef.current = "";
    setActiveRunId("");
    expectingRunRef.current = false;
    setExpectingRun(false);
    streamBufferRef.current = "";
    receivedStreamDeltaRef.current = false;
    lifecycleEndedRef.current = false;
    rpcSettledRef.current = false;
  }, [activityPreferences.showActivities, clearFinalizeTimer, finalizeAssistant, scheduleActivityCollapse, syncAssistantActivities]);

  const tryFinalizeRun = useCallback((failure?: RunFailureInfo, options?: { force?: boolean }) => {
    if (runFinalizedRef.current) {
      return;
    }
    if (!options?.force && (!lifecycleEndedRef.current || !rpcSettledRef.current)) {
      return;
    }
    completeRun(
      pickAssistantDisplayText(pendingRpcAssistantRef.current, streamBufferRef.current),
      failure,
    );
  }, [completeRun]);

  const scheduleRunFinalizeFallback = useCallback((runId: string) => {
    clearFinalizeTimer();
    finalizeTimerRef.current = setTimeout(() => {
      finalizeTimerRef.current = undefined;
      if (activeRunIdRef.current !== runId) {
        return;
      }
      tryFinalizeRun(pendingRunFailureRef.current ?? undefined, { force: true });
    }, RUN_FINALIZE_TIMEOUT_MS);
  }, [clearFinalizeTimer, tryFinalizeRun]);

  const appendDelta = useCallback((text: string) => {
    if (!text) {
      return;
    }
    receivedStreamDeltaRef.current = true;
    clearFinalizeTimer();
    setChatTurns(turns => {
      const next = [...turns];
      const last = next[next.length - 1];
      if (last?.role === "assistant" && last.streaming) {
        next[next.length - 1] = { ...last, text: (last.text || "") + text };
      } else {
        next.push({ role: "assistant", text, streaming: true });
      }
      return trimChatTurns(next);
    });
  }, [clearFinalizeTimer]);

  const handleActivityEnvelope = useCallback((envelope: GatewayEventEnvelope) => {
    const event = envelope.event;
    if (!isActivityEvent(event)) {
      return;
    }
    const runId = event.runId;
    if (!runId) {
      return;
    }
    const isStartingRun = event.type === "lifecycle"
      && event.phase === "start"
      && expectingRunRef.current;
    if (!isStartingRun && activeRunIdRef.current && runId !== activeRunIdRef.current) {
      return;
    }
    if (!activityPreferences.showActivities) {
      return;
    }
    if (isStartingRun) {
      activeRunIdRef.current = runId;
      activitiesRef.current = [];
    }
    const steps = applyActivityEvent(activitiesRef.current, event, {
      granularity: activityPreferences.granularity,
      translate,
      sequence: envelope.sequence,
    });
    syncAssistantActivities(steps, runId, isStartingRun ? { activitiesExpanded: true } : undefined);
  }, [
    activityPreferences.granularity,
    activityPreferences.showActivities,
    syncAssistantActivities,
    translate,
  ]);

  const handleStreamEvent = useCallback((event: {
    type?: string;
    phase?: string;
    runId?: string;
    text?: string;
    message?: string;
    metadata?: Record<string, unknown>;
  }) => {
    if (event.type === "lifecycle" && event.phase === "start" && expectingRunRef.current && event.runId) {
      activeRunIdRef.current = event.runId;
      setActiveRunId(event.runId);
      expectingRunRef.current = false;
      setExpectingRun(false);
      if (activityPreferences.showActivities) {
        activitiesRef.current = [];
        setChatTurns(turns => {
          const next = [...turns];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && event.runId) {
            next[next.length - 1] = {
              ...last,
              runId: event.runId,
              activities: [],
              activitiesExpanded: true,
            };
          }
          return trimChatTurns(next);
        });
      }
      const meta = event.metadata ?? {};
      const tierRaw = meta.tier;
      if (tierRaw === "fast" || tierRaw === "standard" || tierRaw === "deep") {
        const info: LastTierInfo = { tier: tierRaw, source: "heuristic" };
        if (meta.tierSource === "heuristic" || meta.tierSource === "fixed" || meta.tierSource === "inherited" || meta.tierSource === "explicit-input") {
          info.source = meta.tierSource;
        }
        if (typeof meta.tierScore === "number") info.score = meta.tierScore;
        if (typeof meta.tierReason === "string") info.reason = meta.tierReason;
        if (typeof meta.tierMaxContextChars === "number") info.maxContextChars = meta.tierMaxContextChars;
        if (meta.tierThinking === "none" || meta.tierThinking === "low" || meta.tierThinking === "medium" || meta.tierThinking === "high") {
          info.thinking = meta.tierThinking;
        }
        setLastTier(info);
      } else {
        setLastTier(null);
      }
    }
    if (
      event.type === "assistant_delta"
      && event.text
      && activeRunIdRef.current
      && event.runId === activeRunIdRef.current
    ) {
      streamBufferRef.current += event.text;
      appendDelta(event.text);
    }
    if (
      event.type === "assistant_replace"
      && event.text
      && activeRunIdRef.current
      && event.runId === activeRunIdRef.current
    ) {
      streamBufferRef.current = event.text;
      replaceAssistant(event.text);
    }
    if (
      event.type === "lifecycle"
      && activeRunIdRef.current
      && event.runId === activeRunIdRef.current
      && event.phase
      && ["end", "error", "cancelled"].includes(event.phase)
    ) {
      const failure: RunFailureInfo | undefined = event.phase === "error" || event.phase === "cancelled"
        ? {
            phase: event.phase,
            ...(event.message ? { message: event.message } : {}),
          }
        : undefined;
      // Prefer lifecycle message over RPC-cached failure when both exist.
      if (failure) {
        pendingRunFailureRef.current = null;
      }
      lifecycleEndedRef.current = true;
      tryFinalizeRun(failure);
    }
  }, [activityPreferences.showActivities, appendDelta, replaceAssistant, tryFinalizeRun]);

  useEffect(() => {
    const fresh = events.filter(envelope => envelope.sequence > lastSequenceRef.current);
    if (!fresh.length) {
      return;
    }
    lastSequenceRef.current = Math.max(...fresh.map(envelope => envelope.sequence));
    for (const envelope of fresh) {
      handleActivityEnvelope(envelope);
    }
    for (const envelope of [...fresh].reverse()) {
      handleStreamEvent(envelope.event);
    }
  }, [connectionEpoch, events, handleActivityEnvelope, handleStreamEvent]);

  const sendMessage = useCallback(async (rawMessage: string, attachments: ReadonlyArray<{ kind: "image" | "text" | "document"; mimeType: string; data: string; name: string; size: number }> = []) => {
    const message = rawMessage.trim();
    if ((!message && attachments.length === 0) || sending || expectingRunRef.current) {
      return;
    }

    clearFinalizeTimer();
    setSending(true);
    setCancelError(null);
    expectingRunRef.current = true;
    setExpectingRun(true);
    activeRunIdRef.current = "";
    setActiveRunId("");
    streamBufferRef.current = "";
    receivedStreamDeltaRef.current = false;
    pendingRpcAssistantRef.current = "";
    pendingRunFailureRef.current = null;
    lifecycleEndedRef.current = false;
    rpcSettledRef.current = false;
    runFinalizedRef.current = false;
    activitiesRef.current = [];
    clearActivityCollapseTimer();

    const attachmentSummary = attachments.length > 0
      ? "\n\n" + attachments.map(a => `📎 ${a.name} (${a.kind}, ${a.mimeType})`).join("\n")
      : "";
    setChatTurns(turns => trimChatTurns([
      ...turns,
      { role: "user", text: message + attachmentSummary, streaming: false },
      activityPreferences.showActivities
        ? {
            role: "assistant",
            text: "",
            streaming: true,
            activities: [],
            activitiesExpanded: true,
          }
        : {
            role: "assistant",
            text: "",
            streaming: true,
          },
    ]));

    let completedRunId = "";
    try {
      const params: Record<string, unknown> = {
        sessionId: settings.sessionId.trim() || "dashboard",
        message,
        source: "web",
        metadata: {
          source: "dashboard",
          workspaceScope: resolveEffectiveWorkspace(workspaceScope, profileWorkspace).scope,
        },
      };
      const scoped = resolveEffectiveWorkspace(workspaceScope, profileWorkspace);
      if (scoped.scopePath) {
        (params.metadata as Record<string, unknown>).workspaceScopePath = scoped.scopePath;
      }
      const profileId = settings.profileId.trim() || selectedProfile?.id || "";
      if (profileId) {
        params.profileId = profileId;
      }
      if (settings.employeeId.trim()) {
        params.employeeId = settings.employeeId.trim();
      }
      if (settings.workspace.trim()) {
        params.workspace = settings.workspace.trim();
      } else if (scoped.workspace) {
        params.workspace = scoped.workspace;
      }
      if (settings.model.trim()) {
        params.model = settings.model.trim();
      }
      if (settings.thinking) {
        params.thinking = settings.thinking;
      }
      if (settings.finishTask || settings.queryLoop) {
        params.queryLoop = true;
      }
      if (settings.finishTask) {
        params.forceQueryLoop = true;
      }
      if (settings.queryLoopMaxTurns > 0) {
        params.queryLoopMaxTurns = Math.min(10, Math.max(1, Math.floor(settings.queryLoopMaxTurns)));
      }
      if (attachments.length > 0) {
        params.attachments = attachments.map(a => ({
          kind: a.kind,
          mimeType: a.mimeType,
          data: a.data,
          name: a.name,
          size: a.size,
        }));
      }

      type AgentRpcPayload =
        | { result: AgentRunResult; events?: unknown[] }
        | { queued: true; queueTurnId: string; sessionId: string; position: number };
      let payload = await client.rpc<AgentRpcPayload>("agent", params);
      if (payload && typeof payload === "object" && "queued" in payload && payload.queued) {
        payload = await client.rpc<{ result: AgentRunResult; events?: unknown[] }>("agent.wait", {
          queueTurnId: payload.queueTurnId,
        });
      }
      if (!payload || typeof payload !== "object" || !("result" in payload)) {
        return;
      }
      const result = payload.result;
      if (result?.runId) {
        completedRunId = result.runId;
        activeRunIdRef.current = result.runId;
        setActiveRunId(result.runId);
        expectingRunRef.current = false;
        setExpectingRun(false);
        if (activityPreferences.showActivities) {
          setChatTurns(turns => {
            const next = [...turns];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, runId: result.runId };
            }
            return trimChatTurns(next);
          });
        }
      }
      setLastResult(result ?? null);
      const assistant = [...(result?.messages ?? [])]
        .reverse()
        .find(entry => entry.role === "assistant");
      pendingRpcAssistantRef.current = assistant?.content || "";
      rpcSettledRef.current = true;
      // agent.run is synchronous — turn is done when RPC returns even if SSE lifecycle is late.
      lifecycleEndedRef.current = true;

      if (result?.status === "error" || result?.status === "cancelled" || result?.status === "timeout") {
        pendingRunFailureRef.current = {
          phase: result.status === "timeout" ? "timeout" : result.status,
          ...(result.error ? { message: result.error } : {}),
        };
      }

      if (result?.runId) {
        scheduleRunFinalizeFallback(result.runId);
        if (result.status === "error" || result.status === "cancelled" || result.status === "timeout") {
          // Sync / fast-fail paths may not emit SSE lifecycle; finalize when no stream arrives.
          if (!receivedStreamDeltaRef.current && !pendingRpcAssistantRef.current) {
            tryFinalizeRun(pendingRunFailureRef.current ?? undefined, { force: true });
          }
        }
        tryFinalizeRun(pendingRunFailureRef.current ?? undefined);
      } else {
        tryFinalizeRun(pendingRunFailureRef.current ?? undefined, { force: true });
      }
    } catch (error) {
      expectingRunRef.current = false;
      setExpectingRun(false);
      pendingRpcAssistantRef.current = "";
      clearFinalizeTimer();
      const messageText = error instanceof GatewayApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
      finalizeAssistant("", { phase: "error", message: messageText });
    } finally {
      setSending(false);
      if (!completedRunId) {
        expectingRunRef.current = false;
        setExpectingRun(false);
      }
    }
  }, [
    activityPreferences,
    activityPreferences.granularity,
    activityPreferences.showActivities,
    clearActivityCollapseTimer,
    clearFinalizeTimer,
    client,
    finalizeAssistant,
    scheduleRunFinalizeFallback,
    workspaceScope,
    profileWorkspace,
    selectedProfile,
    sending,
    settings,
    tryFinalizeRun,
  ]);

  const cancelActiveRun = useCallback(async () => {
    const runId = activeRunIdRef.current;
    if (!runId) {
      return;
    }
    setCancelError(null);
    try {
      await client.rpc("run.cancel", { runId, reason: "Cancelled from dashboard." });
    } catch (error) {
      const message = error instanceof GatewayApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
      setCancelError(message);
    }
  }, [client]);

  const toggleTurnActivitiesExpanded = useCallback((turnIndex: number) => {
    setChatTurns(turns => {
      const next = [...turns];
      const turn = next[turnIndex];
      if (!turn || turn.role !== "assistant") {
        return turns;
      }
      next[turnIndex] = {
        ...turn,
        activitiesExpanded: !turn.activitiesExpanded,
      };
      return next;
    });
  }, []);

  return {
    chatTurns,
    sending,
    expectingRun,
    activeRunId,
    timelineRunId,
    lastResult,
    lastTier,
    showRaw,
    setShowRaw,
    cancelError,
    sendMessage,
    cancelActiveRun,
    activityPreferences,
    updateActivityPreferences,
    toggleTurnActivitiesExpanded,
  };
}
