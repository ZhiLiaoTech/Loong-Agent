import { useCallback, useEffect, useRef, useState } from "react";
import { GatewayApiError } from "../../api/errors.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import { useDragonEvents } from "../events/EventsContext.js";
import type { GatewayRunRecord } from "../run/types.js";
import type {
  ApprovalInboxItem,
  KpiMetricView,
  OrgTicketView,
  MemoryCandidate,
  MemoryReviewState,
  TrajectorySummary,
} from "./types.js";

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
  const [approvals, setApprovals] = useState<readonly ApprovalInboxItem[]>([]);
  const [approvalResult, setApprovalResult] = useState<string | null>(null);
  const [tickets, setTickets] = useState<readonly OrgTicketView[]>([]);
  const [approvalMineOnly, setApprovalMineOnly] = useState(false);
  const [approverEmployeeId, setApproverEmployeeId] = useState("");
  const [employeeOptions, setEmployeeOptions] = useState<readonly { id: string; displayName: string }[]>([]);
  const [kpiTemplateName, setKpiTemplateName] = useState("");
  const [kpiEmployeeId, setKpiEmployeeId] = useState("");
  const [kpiMetrics, setKpiMetrics] = useState<readonly KpiMetricView[]>([]);
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

  const refreshKpi = useCallback(async () => {
    const [employeesPayload, templatesPayload] = await Promise.all([
      client.rpc<{ employees: Array<{ id: string; kpiTemplateId?: string }>; defaultEmployeeId?: string }>("employee.list").catch(
        (): { employees: []; defaultEmployeeId?: string } => ({ employees: [] }),
      ),
      client.rpc<{ templates: Array<{ id: string; name: string }> }>("kpi.template.list").catch(() => ({ templates: [] })),
    ]);
    const employees = employeesPayload.employees ?? [];
    const defaultId = employeesPayload.defaultEmployeeId;
    const employee = employees.find(entry => entry.id === defaultId)
      ?? employees.find(entry => entry.kpiTemplateId)
      ?? employees[0];
    if (!employee?.kpiTemplateId) {
      setKpiTemplateName("");
      setKpiEmployeeId(employee?.id ?? "");
      setKpiMetrics([]);
      return;
    }
    const template = (templatesPayload.templates ?? []).find(entry => entry.id === employee.kpiTemplateId);
    const snapshot = await client.rpc<{ metrics: KpiMetricView[]; templateId: string }>("kpi.snapshot.get", {
      templateId: employee.kpiTemplateId,
      employeeId: employee.id,
    }).catch(() => ({ metrics: [], templateId: employee.kpiTemplateId }));
    setKpiTemplateName(template?.name ?? employee.kpiTemplateId);
    setKpiEmployeeId(employee.id);
    setKpiMetrics(snapshot.metrics ?? []);
  }, [client]);

  const refreshTickets = useCallback(async () => {
    const payload = await client.rpc<{ tickets: OrgTicketView[] }>("ticket.list").catch(
      (): { tickets: OrgTicketView[] } => ({ tickets: [] }),
    );
    setTickets(payload.tickets ?? []);
  }, [client]);

  const refreshEmployeeOptions = useCallback(async () => {
    const payload = await client.rpc<{
      employees: Array<{ id: string; displayName: string; status: string }>;
      defaultEmployeeId?: string;
    }>("employee.list").catch(
      (): { employees: Array<{ id: string; displayName: string; status: string }>; defaultEmployeeId?: string } => ({
        employees: [],
      }),
    );
    const active = (payload.employees ?? []).filter(entry => entry.status === "active");
    setEmployeeOptions(active.map(entry => ({ id: entry.id, displayName: entry.displayName })));
    setApproverEmployeeId(current => {
      if (current && active.some(entry => entry.id === current)) {
        return current;
      }
      const fallback = payload.defaultEmployeeId && active.some(entry => entry.id === payload.defaultEmployeeId)
        ? payload.defaultEmployeeId
        : active[0]?.id;
      return fallback ?? "";
    });
  }, [client]);

  const refreshApprovals = useCallback(async () => {
    const listParams: { status: "pending"; assignedApproverId?: string } = { status: "pending" };
    if (approvalMineOnly && approverEmployeeId.trim()) {
      listParams.assignedApproverId = approverEmployeeId.trim();
    }
    const payload = await client.rpc<{ requests: ApprovalInboxItem[] }>("approval.list", listParams).catch(
      (): { requests: ApprovalInboxItem[] } => ({ requests: [] }),
    );
    setApprovals(payload.requests ?? []);
  }, [approvalMineOnly, approverEmployeeId, client]);

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
        refreshEmployeeOptions(),
        refreshApprovals(),
        refreshKpi(),
        refreshTickets(),
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
  }, [
    refreshApprovals,
    refreshEmployeeOptions,
    refreshKpi,
    refreshMemory,
    refreshRuns,
    refreshTickets,
    refreshTrajectories,
  ]);

  useEffect(() => {
    void refreshApprovals();
  }, [approvalMineOnly, approverEmployeeId, refreshApprovals]);

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

  const approveRequest = useCallback(async (id: string) => {
    setApprovalResult("Approving…");
    try {
      await client.rpc("approval.approve", { id, resolvedBy: "dashboard" });
      setApprovalResult(`Approved ${id}`);
      await refreshApprovals();
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setApprovalResult(message);
    }
  }, [client, refreshApprovals]);

  const rejectRequest = useCallback(async (id: string) => {
    setApprovalResult("Rejecting…");
    try {
      await client.rpc("approval.reject", { id, resolvedBy: "dashboard", note: "Rejected from dashboard." });
      setApprovalResult(`Rejected ${id}`);
      await refreshApprovals();
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setApprovalResult(message);
    }
  }, [client, refreshApprovals]);

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
    approvals,
    approvalResult,
    approvalMineOnly,
    setApprovalMineOnly,
    approverEmployeeId,
    setApproverEmployeeId,
    employeeOptions,
    kpiTemplateName,
    kpiEmployeeId,
    kpiMetrics,
    tickets,
    trajectoryDetail,
    error,
    loading,
    activeRuns,
    refreshAll,
    refreshRuns,
    refreshTrajectories,
    refreshMemory,
    refreshApprovals,
    refreshKpi,
    refreshTickets,
    cancelRun,
    loadTrajectory,
    promoteMemory,
    rejectMemory,
    approveRequest,
    rejectRequest,
  };
}
