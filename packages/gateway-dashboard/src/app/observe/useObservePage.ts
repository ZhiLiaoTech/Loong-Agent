import { useCallback, useEffect, useRef, useState } from "react";
import { GatewayApiError } from "../../api/errors.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import { useDragonEvents } from "../events/EventsContext.js";
import type { GatewayRunRecord } from "../run/types.js";
import type { MemoryCandidate, MemoryReviewState, TrajectorySummary } from "./types.js";

const DEFAULT_SESSION = "dashboard";

export function useObservePage() {
  const client = useGatewayClient();
  const { events, connectionEpoch } = useDragonEvents();
  const [sessionId, setSessionId] = useState(DEFAULT_SESSION);
  const [runs, setRuns] = useState<readonly GatewayRunRecord[]>([]);
  const [trajectories, setTrajectories] = useState<readonly TrajectorySummary[]>([]);
  const [memoryCandidates, setMemoryCandidates] = useState<readonly MemoryCandidate[]>([]);
  const [memoryReview, setMemoryReview] = useState<MemoryReviewState>({
    canPromote: false,
    canReject: false,
  });
  const [memoryResult, setMemoryResult] = useState<string | null>(null);
  const [trajectoryDetail, setTrajectoryDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lastLifecycleSequenceRef = useRef(0);

  const refreshRuns = useCallback(async () => {
    const payload = await client.rpc<{ runs: GatewayRunRecord[] }>("runs.list", { limit: 20 });
    setRuns(payload.runs ?? []);
  }, [client]);

  const refreshTrajectories = useCallback(async () => {
    const payload = await client.rpc<{ trajectories: TrajectorySummary[] }>("trajectory.list", {
      sessionId: sessionId.trim() || DEFAULT_SESSION,
      limit: 12,
    });
    setTrajectories(payload.trajectories ?? []);
  }, [client, sessionId]);

  const refreshMemory = useCallback(async () => {
    const payload = await client.rpc<{
      output?: { candidates?: MemoryCandidate[] };
      review?: MemoryReviewState;
    }>("memory.candidates.list", { status: "pending", limit: 20 });
    setMemoryCandidates(payload.output?.candidates ?? []);
    setMemoryReview(payload.review ?? { canPromote: false, canReject: false });
  }, [client]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        refreshRuns(),
        refreshTrajectories(),
        refreshMemory(),
      ]);
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
      try {
        await refreshRuns();
      } catch {
        setRuns([]);
      }
      setTrajectories([]);
      try {
        await refreshMemory();
      } catch {
        setMemoryCandidates([]);
        setMemoryReview({ canPromote: false, canReject: false });
      }
    } finally {
      setLoading(false);
    }
  }, [refreshMemory, refreshRuns, refreshTrajectories]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    lastLifecycleSequenceRef.current = 0;
  }, [connectionEpoch]);

  useEffect(() => {
    const session = sessionId.trim() || DEFAULT_SESSION;
    const fresh = events.filter(envelope => envelope.sequence > lastLifecycleSequenceRef.current);
    if (!fresh.length) {
      return;
    }
    lastLifecycleSequenceRef.current = Math.max(...fresh.map(envelope => envelope.sequence));

    const shouldRefresh = fresh.some(envelope => {
      if (envelope.sessionId !== session) {
        return false;
      }
      const event = envelope.event;
      const phase = event.phase;
      return (
        event.type === "lifecycle"
        && phase !== undefined
        && ["end", "error", "cancelled"].includes(phase)
      );
    });

    if (shouldRefresh) {
      void refreshAll();
    }
  }, [connectionEpoch, events, refreshAll, sessionId]);

  const cancelRun = useCallback(async (runId: string) => {
    try {
      await client.rpc("run.cancel", { runId, reason: "Cancelled from dashboard." });
      await refreshRuns();
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
    }
  }, [client, refreshRuns]);

  const loadTrajectory = useCallback(async (runId: string) => {
    setTrajectoryDetail("Loading…");
    try {
      const payload = await client.rpc<{ record: unknown }>("trajectory.get", {
        sessionId: sessionId.trim() || DEFAULT_SESSION,
        runId,
        maxEvents: 80,
      });
      setTrajectoryDetail(JSON.stringify(payload.record, null, 2));
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setTrajectoryDetail(message);
    }
  }, [client, sessionId]);

  const promoteMemory = useCallback(async (id: string) => {
    setMemoryResult("Promoting…");
    try {
      const payload = await client.rpc<{ output: unknown }>("memory.candidate.promote", {
        id,
        source: "dashboard",
      });
      setMemoryResult(JSON.stringify(payload.output, null, 2));
      await refreshMemory();
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setMemoryResult(message);
    }
  }, [client, refreshMemory]);

  const rejectMemory = useCallback(async (id: string) => {
    setMemoryResult("Rejecting…");
    try {
      const payload = await client.rpc<{ output: unknown }>("memory.candidate.reject", {
        id,
        reason: "Rejected from dashboard.",
      });
      setMemoryResult(JSON.stringify(payload.output, null, 2));
      await refreshMemory();
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setMemoryResult(message);
    }
  }, [client, refreshMemory]);

  const activeRuns = runs.filter(
    run => run.state === "running" || run.state === "cancelling",
  ).length;

  return {
    sessionId,
    setSessionId,
    runs,
    trajectories,
    memoryCandidates,
    memoryReview,
    memoryResult,
    trajectoryDetail,
    error,
    loading,
    activeRuns,
    refreshAll,
    refreshRuns,
    refreshTrajectories,
    refreshMemory,
    cancelRun,
    loadTrajectory,
    promoteMemory,
    rejectMemory,
  };
}
