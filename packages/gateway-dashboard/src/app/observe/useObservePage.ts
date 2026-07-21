import { useCallback, useEffect, useRef, useState } from "react";
import { GatewayApiError } from "../../api/index.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import { useLoongEvents } from "../events/EventsContext.js";
import type { GatewayRunRecord } from "../run/types.js";
import type {
  ApprovalInboxItem,
  KpiMetricView,
  OrgTicketView,
  MemoryCandidate,
  MemoryReviewState,
  OntologyKnowledgeView,
  TrajectorySummary,
} from "./types.js";
import { isStaleApprovalError } from "./approvalErrors.js";

const DEFAULT_SESSION = "dashboard";

export function useObservePage() {
  const client = useGatewayClient();
  const { events, connectionEpoch } = useLoongEvents();
  const [sessionId, setSessionId] = useState(DEFAULT_SESSION);
  const [runs, setRuns] = useState<readonly GatewayRunRecord[]>([]);
  const [trajectories, setTrajectories] = useState<readonly TrajectorySummary[]>([]);
  const [memoryCandidates, setMemoryCandidates] = useState<readonly MemoryCandidate[]>([]);
  const [memoryReview, setMemoryReview] = useState<MemoryReviewState>({
    canPromote: false,
    canReject: false,
  });
  const [memoryResult, setMemoryResult] = useState<string | null>(null);
  const [ontologyUserId, setOntologyUserId] = useState("");
  const [ontologyKnowledge, setOntologyKnowledge] = useState<OntologyKnowledgeView | null>(null);
  const [ontologyCanWrite, setOntologyCanWrite] = useState(false);
  const [ontologySupported, setOntologySupported] = useState(true);
  const [ontologyResult, setOntologyResult] = useState<string | null>(null);
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

  // Phase 5 (FR-12/13/14): ontology user-control surface. Degrades silently
  // when the gateway predates the ontology RPC family.
  const refreshOntology = useCallback(async () => {
    const userId = ontologyUserId.trim();
    if (!userId) {
      setOntologyKnowledge(null);
      setOntologyCanWrite(false);
      return;
    }
    try {
      const payload = await client.rpc<OntologyKnowledgeView & { permissions?: { canWrite?: boolean } }>(
        "ontology.knowledge.list",
        { userId },
      );
      setOntologySupported(true);
      setOntologyKnowledge({
        groups: payload.groups ?? [],
        activeCount: payload.activeCount ?? 0,
        candidateCount: payload.candidateCount ?? 0,
        disputedCount: payload.disputedCount ?? 0,
        inferredActiveCount: payload.inferredActiveCount ?? 0,
      });
      setOntologyCanWrite(payload.permissions?.canWrite === true);
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      if (message.includes("Unknown Gateway RPC type")) {
        setOntologySupported(false);
      }
      setOntologyKnowledge(null);
      setOntologyCanWrite(false);
    }
  }, [client, ontologyUserId]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        refreshRuns(),
        refreshTrajectories(),
        refreshMemory(),
        refreshOntology(),
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
    refreshOntology,
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

  const dismissRequest = useCallback(async (id: string) => {
    setApprovalResult("Clearing stale approval…");
    try {
      await client.rpc("approval.dismiss", { id, resolvedBy: "dashboard" });
      setApprovalResult("Stale approval cleared.");
      await refreshApprovals();
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setApprovalResult(message);
    }
  }, [client, refreshApprovals]);

  const approveRequest = useCallback(async (id: string) => {
    setApprovalResult("Approving…");
    try {
      await client.rpc("approval.approve", { id, resolvedBy: "dashboard" });
      setApprovalResult(`Approved ${id}`);
      await refreshApprovals();
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      if (isStaleApprovalError(message)) {
        await dismissRequest(id);
        setApprovalResult("该审批已过期（运行已结束或 Gateway 重启），已自动清除。");
        return;
      }
      setApprovalResult(message);
    }
  }, [client, dismissRequest, refreshApprovals]);

  const rejectRequest = useCallback(async (id: string) => {
    setApprovalResult("Rejecting…");
    try {
      await client.rpc("approval.reject", { id, resolvedBy: "dashboard", note: "Rejected from dashboard." });
      setApprovalResult(`Rejected ${id}`);
      await refreshApprovals();
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      if (isStaleApprovalError(message)) {
        await dismissRequest(id);
        setApprovalResult("该审批已过期（运行已结束或 Gateway 重启），已自动清除。");
        return;
      }
      setApprovalResult(message);
    }
  }, [client, dismissRequest, refreshApprovals]);

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

  const explainOntologyFact = useCallback(async (assertionId: string) => {
    const userId = ontologyUserId.trim();
    if (!userId) {
      return;
    }
    setOntologyResult("Loading explanation…");
    try {
      const payload = await client.rpc("ontology.assertion.explain", { userId, assertionId });
      setOntologyResult(JSON.stringify(payload, null, 2));
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setOntologyResult(message);
    }
  }, [client, ontologyUserId]);

  const correctOntologyFact = useCallback(async (assertionId: string) => {
    const userId = ontologyUserId.trim();
    if (!userId) {
      return;
    }
    const objectValue = window.prompt("纠正后的新值：");
    if (objectValue === null || !objectValue.trim()) {
      return;
    }
    const excerpt = window.prompt("你的原话（作为纠正的证据记录）：");
    if (excerpt === null || !excerpt.trim()) {
      return;
    }
    setOntologyResult("Correcting…");
    try {
      const payload = await client.rpc("ontology.assertion.correct", {
        userId,
        assertionId,
        correction: { objectValue: objectValue.trim(), excerpt: excerpt.trim() },
        reason: "Corrected from dashboard.",
      });
      setOntologyResult(JSON.stringify(payload, null, 2));
      await refreshOntology();
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setOntologyResult(message);
    }
  }, [client, ontologyUserId, refreshOntology]);

  const retractOntologyFact = useCallback(async (assertionId: string) => {
    const userId = ontologyUserId.trim();
    if (!userId || !window.confirm("撤回这条事实？它将不再被召回。")) {
      return;
    }
    setOntologyResult("Retracting…");
    try {
      const payload = await client.rpc("ontology.assertion.retract", {
        userId,
        assertionId,
        reason: "Retracted from dashboard.",
      });
      setOntologyResult(JSON.stringify(payload, null, 2));
      await refreshOntology();
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setOntologyResult(message);
    }
  }, [client, ontologyUserId, refreshOntology]);

  const deleteAllOntology = useCallback(async () => {
    const userId = ontologyUserId.trim();
    if (!userId || !window.confirm(`确定删除 ${userId} 的全部本体记忆？此操作不可恢复（审计日志会保留）。`)) {
      return;
    }
    setOntologyResult("Deleting all…");
    try {
      const payload = await client.rpc("ontology.deleteAll", { userId, reason: "Deleted from dashboard." });
      setOntologyResult(JSON.stringify(payload, null, 2));
      await refreshOntology();
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setOntologyResult(message);
    }
  }, [client, ontologyUserId, refreshOntology]);

  const exportOntology = useCallback(async () => {
    const userId = ontologyUserId.trim();
    if (!userId) {
      return;
    }
    setOntologyResult("Exporting…");
    try {
      const payload = await client.rpc("ontology.export", { userId });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ontology-export-${userId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setOntologyResult("导出完成。");
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setOntologyResult(message);
    }
  }, [client, ontologyUserId]);

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
    ontologyUserId,
    setOntologyUserId,
    ontologyKnowledge,
    ontologyCanWrite,
    ontologySupported,
    ontologyResult,
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
    refreshOntology,
    refreshApprovals,
    refreshKpi,
    refreshTickets,
    cancelRun,
    loadTrajectory,
    promoteMemory,
    rejectMemory,
    explainOntologyFact,
    correctOntologyFact,
    retractOntologyFact,
    deleteAllOntology,
    exportOntology,
    approveRequest,
    rejectRequest,
    dismissRequest,
  };
}
