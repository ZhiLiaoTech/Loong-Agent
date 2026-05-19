import { useCallback, useEffect, useRef, useState } from "react";
import { GatewayApiError } from "../../api/errors.js";
import { useDragonEvents } from "../events/EventsContext.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import type { AgentProfile, AgentRunResult, ChatTurn, RunSettings } from "./types.js";

const MAX_CHAT_TURNS = 80;
/** Fallback when Gateway returns runId but no SSE lifecycle (sync-only providers). */
const RUN_FINALIZE_TIMEOUT_MS = 30_000;

function trimChatTurns(turns: ChatTurn[]): ChatTurn[] {
  return turns.length > MAX_CHAT_TURNS ? turns.slice(-MAX_CHAT_TURNS) : turns;
}

export function useRunChat(
  settings: RunSettings,
  selectedProfile: AgentProfile | undefined,
) {
  const client = useGatewayClient();
  const { events, connectionEpoch } = useDragonEvents();
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState("");
  const [expectingRun, setExpectingRun] = useState(false);
  const [lastResult, setLastResult] = useState<AgentRunResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const lastSequenceRef = useRef(0);
  const activeRunIdRef = useRef("");
  const expectingRunRef = useRef(false);
  const streamBufferRef = useRef("");
  const receivedStreamDeltaRef = useRef(false);
  const pendingRpcAssistantRef = useRef("");
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
    clearFinalizeTimer();
  }, [clearFinalizeTimer, connectionEpoch]);

  useEffect(() => () => {
    clearFinalizeTimer();
  }, [clearFinalizeTimer]);

  const finalizeAssistant = useCallback((text: string) => {
    setChatTurns(turns => {
      const next = [...turns];
      const last = next[next.length - 1];
      if (last?.role === "assistant") {
        next[next.length - 1] = {
          ...last,
          streaming: false,
          text: text || last.text,
        };
      } else if (text) {
        next.push({ role: "assistant", text, streaming: false });
      } else {
        next.push({ role: "assistant", text: "", streaming: false });
      }
      return trimChatTurns(next);
    });
  }, []);

  const completeRun = useCallback((text: string) => {
    clearFinalizeTimer();
    finalizeAssistant(text);
    pendingRpcAssistantRef.current = "";
    activeRunIdRef.current = "";
    setActiveRunId("");
    expectingRunRef.current = false;
    setExpectingRun(false);
    streamBufferRef.current = "";
    receivedStreamDeltaRef.current = false;
  }, [clearFinalizeTimer, finalizeAssistant]);

  const scheduleRunFinalizeFallback = useCallback((runId: string) => {
    clearFinalizeTimer();
    finalizeTimerRef.current = setTimeout(() => {
      finalizeTimerRef.current = undefined;
      if (activeRunIdRef.current !== runId) {
        return;
      }
      completeRun(streamBufferRef.current || pendingRpcAssistantRef.current);
    }, RUN_FINALIZE_TIMEOUT_MS);
  }, [clearFinalizeTimer, completeRun]);

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

  const handleStreamEvent = useCallback((event: { type?: string; phase?: string; runId?: string; text?: string }) => {
    if (event.type === "lifecycle" && event.phase === "start" && expectingRunRef.current && event.runId) {
      activeRunIdRef.current = event.runId;
      setActiveRunId(event.runId);
      expectingRunRef.current = false;
      setExpectingRun(false);
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
      event.type === "lifecycle"
      && activeRunIdRef.current
      && event.runId === activeRunIdRef.current
      && event.phase
      && ["end", "error", "cancelled"].includes(event.phase)
    ) {
      completeRun(streamBufferRef.current || pendingRpcAssistantRef.current);
    }
  }, [appendDelta, completeRun]);

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

  const sendMessage = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || sending || expectingRunRef.current) {
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

    setChatTurns(turns => trimChatTurns([
      ...turns,
      { role: "user", text: message, streaming: false },
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
      if (selectedProfile?.id) {
        params.profileId = selectedProfile.id;
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

      if (result?.runId) {
        scheduleRunFinalizeFallback(result.runId);
      } else {
        completeRun(pendingRpcAssistantRef.current);
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
      finalizeAssistant(`Error: ${messageText}`);
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
    completeRun,
    finalizeAssistant,
    scheduleRunFinalizeFallback,
    selectedProfile,
    sending,
    settings,
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
    lastResult,
    showRaw,
    setShowRaw,
    cancelError,
    sendMessage,
    cancelActiveRun,
  };
}
