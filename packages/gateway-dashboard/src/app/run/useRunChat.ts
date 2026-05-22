import { useCallback, useEffect, useRef, useState } from "react";
import { GatewayApiError } from "../../api/errors.js";
import { useDragonEvents } from "../events/EventsContext.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import { pickAssistantDisplayText, stripTextToolBlocks } from "./chatDisplay.js";
import { buildErrorDetail, type RunFailureInfo } from "./runFailure.js";
import type { AgentProfile, AgentRunResult, ChatTurn, RunSettings } from "./types.js";

const MAX_CHAT_TURNS = 80;
/** Fallback when Gateway returns runId but no SSE lifecycle (sync-only providers). */
const RUN_FINALIZE_TIMEOUT_MS = 30_000;

function trimChatTurns(turns: ChatTurn[]): ChatTurn[] {
  return turns.length > MAX_CHAT_TURNS ? turns.slice(-MAX_CHAT_TURNS) : turns;
}

// Module-level cache so chat state survives RunWorkspace unmount when the user
// navigates to Models/Agents/etc. and returns. This is intentionally NOT
// sessionStorage — the smoke test forbids browser storage for secret-safety,
// and a module-scoped variable already gives us cross-route persistence
// within a single tab load (cleared on full refresh, which is the right
// trust boundary).
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
}
const chatStateCache: CachedChatState = {
  chatTurns: [],
  activeRunId: "",
  lastResult: null,
  lastTier: null,
};

export function useRunChat(
  settings: RunSettings,
  selectedProfile: AgentProfile | undefined,
) {
  const client = useGatewayClient();
  const { events, connectionEpoch } = useDragonEvents();
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

  // Mirror current chat state into the module cache so the next mount can
  // restore it after a navigation.
  useEffect(() => {
    chatStateCache.chatTurns = chatTurns;
    chatStateCache.activeRunId = activeRunId;
    chatStateCache.lastResult = lastResult;
    chatStateCache.lastTier = lastTier;
  }, [chatTurns, activeRunId, lastResult, lastTier]);
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
    clearFinalizeTimer();
  }, [clearFinalizeTimer, connectionEpoch]);

  useEffect(() => () => {
    clearFinalizeTimer();
  }, [clearFinalizeTimer]);

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
    if (activeRunIdRef.current) {
      setTimelineRunId(activeRunIdRef.current);
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
  }, [clearFinalizeTimer, finalizeAssistant]);

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
  }, [appendDelta, replaceAssistant, tryFinalizeRun]);

  useEffect(() => {
    const fresh = events.filter(envelope => envelope.sequence > lastSequenceRef.current);
    if (!fresh.length) {
      return;
    }
    lastSequenceRef.current = Math.max(...fresh.map(envelope => envelope.sequence));
    for (const envelope of [...fresh].reverse()) {
      handleStreamEvent(envelope.event);
    }
  }, [connectionEpoch, events, handleStreamEvent]);

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

    const attachmentSummary = attachments.length > 0
      ? "\n\n" + attachments.map(a => `📎 ${a.name} (${a.kind}, ${a.mimeType})`).join("\n")
      : "";
    setChatTurns(turns => trimChatTurns([
      ...turns,
      { role: "user", text: message + attachmentSummary, streaming: false },
      { role: "assistant", text: "", streaming: true },
    ]));

    let completedRunId = "";
    try {
      const params: Record<string, unknown> = {
        sessionId: settings.sessionId.trim() || "dashboard",
        message,
        source: "web",
        metadata: { source: "dashboard" },
      };
      const profileId = settings.profileId.trim() || selectedProfile?.id || "";
      if (profileId) {
        params.profileId = profileId;
      }
      if (settings.employeeId.trim()) {
        params.employeeId = settings.employeeId.trim();
      }
      if (selectedProfile?.systemPrompt) {
        params.systemPrompt = selectedProfile.systemPrompt;
      }
      if (selectedProfile?.toolsEnabled === false) {
        params.toolsEnabled = false;
      }
      if (selectedProfile?.memoryEnabled === false) {
        params.memoryEnabled = false;
      }
      const workspace = settings.workspace.trim() || selectedProfile?.workspace || "";
      if (workspace) {
        params.workspace = workspace;
      }
      const model = settings.model.trim() || selectedProfile?.defaultModel || "";
      if (model) {
        params.model = model;
      }
      if (settings.thinking) {
        params.thinking = settings.thinking;
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

      const payload = await client.rpc<{ result: AgentRunResult }>("agent", params);
      const result = payload.result;
      if (result?.runId) {
        completedRunId = result.runId;
        activeRunIdRef.current = result.runId;
        setActiveRunId(result.runId);
        expectingRunRef.current = false;
        setExpectingRun(false);
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
    clearFinalizeTimer,
    client,
    finalizeAssistant,
    scheduleRunFinalizeFallback,
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
  };
}
