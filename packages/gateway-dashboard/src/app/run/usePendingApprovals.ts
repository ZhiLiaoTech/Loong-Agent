import { useCallback, useEffect, useRef, useState } from "react";
import type { LoongEvent } from "../../api/index.js";
import type { GatewayEventEnvelope } from "../../api/index.js";
import { GatewayApiError } from "../../api/index.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import { isStaleApprovalError } from "../observe/approvalErrors.js";

export interface PendingApprovalItem {
  id: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  sessionId: string;
  reason: string;
  inputSummary?: string;
  createdAt: string;
}

interface ApprovalApiItem {
  id: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  sessionId: string;
  reason: string;
  createdAt: string;
  inputSummary?: string;
  awaitingLiveRun?: boolean;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPayloadString(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function upsertPending(list: readonly PendingApprovalItem[], item: PendingApprovalItem): PendingApprovalItem[] {
  const index = list.findIndex(entry => entry.id === item.id);
  if (index >= 0) {
    const next = [...list];
    next[index] = item;
    return next;
  }
  return [...list, item];
}

export function usePendingApprovals(options: {
  events: readonly GatewayEventEnvelope[];
  sessionId?: string;
  onApprovalQueued?: (item: PendingApprovalItem) => void;
}) {
  const client = useGatewayClient();
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalItem[]>([]);
  const processedSequencesRef = useRef(0);
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const notifiedIdsRef = useRef(new Set<string>());

  const mapFromApi = useCallback((item: ApprovalApiItem): PendingApprovalItem => ({
    id: item.id,
    runId: item.runId,
    toolCallId: item.toolCallId,
    toolName: item.toolName,
    sessionId: item.sessionId,
    reason: item.reason,
    createdAt: item.createdAt,
    ...(item.inputSummary ? { inputSummary: item.inputSummary } : {}),
  }), []);

  const queueApproval = useCallback((item: PendingApprovalItem) => {
    setPendingApprovals(current => upsertPending(current, item));
    if (!notifiedIdsRef.current.has(item.id)) {
      notifiedIdsRef.current.add(item.id);
      options.onApprovalQueued?.(item);
    }
  }, [options.onApprovalQueued]);

  const refreshPending = useCallback(async () => {
    try {
      const params: Record<string, string> = { status: "pending" };
      if (options.sessionId?.trim()) {
        params.sessionId = options.sessionId.trim();
      }
      const payload = await client.rpc<{ requests: ApprovalApiItem[] }>("approval.list", params);
      const mapped = (payload.requests ?? [])
        .filter(item => item.awaitingLiveRun !== false)
        .map(mapFromApi);
      setPendingApprovals(mapped);
      for (const item of mapped) {
        if (!notifiedIdsRef.current.has(item.id)) {
          notifiedIdsRef.current.add(item.id);
          options.onApprovalQueued?.(item);
        }
      }
    } catch {
      // Gateway offline or approval RPC unavailable.
    }
  }, [client, mapFromApi, options.onApprovalQueued, options.sessionId]);

  useEffect(() => {
    void refreshPending();
    const timer = globalThis.setInterval(() => {
      void refreshPending();
    }, 15_000);
    return () => globalThis.clearInterval(timer);
  }, [refreshPending]);

  const startPollForMatch = useCallback((runId: string, toolCallId: string) => {
    const key = `${runId}:${toolCallId}`;
    if (pollingRef.current.has(key)) {
      return;
    }
    let attempts = 0;
    const timer = globalThis.setInterval(() => {
      attempts += 1;
      if (attempts > 20) {
        globalThis.clearInterval(timer);
        pollingRef.current.delete(key);
        return;
      }
      void client.rpc<{ requests: ApprovalApiItem[] }>("approval.list", {
        status: "pending",
        runId,
        toolCallId,
      }).then(payload => {
        const match = payload.requests?.[0];
        if (match) {
          queueApproval(mapFromApi(match));
          globalThis.clearInterval(timer);
          pollingRef.current.delete(key);
        }
      }).catch(() => undefined);
    }, 500);
    pollingRef.current.set(key, timer);
  }, [client, mapFromApi, queueApproval]);

  useEffect(() => {
    const fresh = options.events.filter(envelope => envelope.sequence > processedSequencesRef.current);
    if (!fresh.length) {
      return;
    }
    processedSequencesRef.current = Math.max(...fresh.map(envelope => envelope.sequence));

    for (const envelope of fresh) {
      const event = envelope.event as LoongEvent;
      if (event.type !== "permission") {
        continue;
      }

      if (event.phase === "queued") {
        const approvalId = readPayloadString(event.payload, "approvalId");
        const runId = readString(event.runId);
        const toolCallId = readString(event.toolCallId);
        const toolName = readString(event.toolName);
        if (!approvalId || !runId || !toolCallId || !toolName) {
          continue;
        }
        const inputSummary = readPayloadString(event.payload, "inputSummary");
        queueApproval({
          id: approvalId,
          runId,
          toolCallId,
          toolName,
          sessionId: readPayloadString(event.payload, "sessionId") ?? options.sessionId ?? "",
          reason: readPayloadString(event.payload, "reason") ?? "",
          createdAt: envelope.timestamp,
          ...(inputSummary ? { inputSummary } : {}),
        });
        continue;
      }

      if (event.phase === "request") {
        const runId = readString(event.runId);
        const toolCallId = readString(event.toolCallId);
        if (runId && toolCallId) {
          startPollForMatch(runId, toolCallId);
        }
        continue;
      }

      if (event.phase === "resolved") {
        const runId = readString(event.runId);
        const toolCallId = readString(event.toolCallId);
        if (!runId || !toolCallId) {
          continue;
        }
        setPendingApprovals(current =>
          current.filter(entry => entry.toolCallId !== toolCallId || entry.runId !== runId),
        );
      }
    }
  }, [options.events, options.sessionId, queueApproval, startPollForMatch]);

  useEffect(() => () => {
    for (const timer of pollingRef.current.values()) {
      globalThis.clearInterval(timer);
    }
    pollingRef.current.clear();
  }, []);

  const dismissApproval = useCallback(async (id: string) => {
    await client.rpc("approval.dismiss", { id, resolvedBy: "dashboard" });
    setPendingApprovals(current => current.filter(entry => entry.id !== id));
  }, [client]);

  const approveApproval = useCallback(async (id: string) => {
    try {
      await client.rpc("approval.approve", { id, resolvedBy: "dashboard" });
      setPendingApprovals(current => current.filter(entry => entry.id !== id));
    } catch (error) {
      const message = error instanceof GatewayApiError ? error.message : String(error);
      if (isStaleApprovalError(message)) {
        await dismissApproval(id);
        return;
      }
      throw error;
    }
  }, [client, dismissApproval]);

  const rejectApproval = useCallback(async (id: string) => {
    try {
      await client.rpc("approval.reject", {
        id,
        resolvedBy: "dashboard",
        note: "Rejected from chat.",
      });
      setPendingApprovals(current => current.filter(entry => entry.id !== id));
    } catch (error) {
      const message = error instanceof GatewayApiError ? error.message : String(error);
      if (isStaleApprovalError(message)) {
        await dismissApproval(id);
        return;
      }
      throw error;
    }
  }, [client, dismissApproval]);

  return {
    pendingApprovals,
    approveApproval,
    rejectApproval,
    refreshPendingApprovals: refreshPending,
  };
}
