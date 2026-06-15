import type { LoongEvent, LoongPermissionHandler, LoongPermissionRequest, LoongPermissionResponse } from "@loong/core";
import { resolveApprovalAssignee } from "./approval-routing.js";
import { isOrgApprovalReason, parseApprovalChainId, stripApprovalPrefix } from "./approval-reason.js";
import { readEmployeeId } from "./policy.js";
import type {
  ApprovalRegistry,
  ApprovalRequest,
  ApprovalStatus,
  ApprovalStore,
  EmployeeRegistry,
  OrgDocument,
  OrgTicket,
  TicketStore,
} from "./types.js";

const WORKSPACE_DEFAULT_CHAIN_ID = "workspace-default";

interface PendingApproval {
  request: LoongPermissionRequest;
  resolve: (response: LoongPermissionResponse | "allow" | "deny") => void;
}

export interface ApprovalListFilter {
  status?: ApprovalStatus;
  assignedApproverId?: string;
  runId?: string;
  toolCallId?: string;
  sessionId?: string;
}

export interface GatewayApprovalService {
  readonly handler: LoongPermissionHandler;
  list(filter?: ApprovalListFilter): Promise<ApprovalRegistry>;
  approve(id: string, resolvedBy?: string, note?: string): Promise<ApprovalRequest>;
  reject(id: string, resolvedBy?: string, note?: string): Promise<ApprovalRequest>;
  attachEventPublisher(publish: (event: LoongEvent) => void): void;
}

export interface GatewayApprovalServiceOptions {
  store: ApprovalStore;
  getOrg?: () => Promise<OrgDocument>;
  getEmployees?: () => Promise<EmployeeRegistry>;
  ticketStore?: TicketStore;
  defaultTimeoutMs?: number;
}

export function createGatewayApprovalService(
  options: GatewayApprovalServiceOptions,
): GatewayApprovalService {
  const pending = new Map<string, PendingApproval>();
  const timeoutMs = options.defaultTimeoutMs ?? 30 * 60_000;
  let publishEvent: ((event: LoongEvent) => void) | undefined;

  const handler: LoongPermissionHandler = async request => {
    const orgReason = isOrgApprovalReason(request.reason);
    let chainId: string;
    let reason: string;
    let assignee: ReturnType<typeof resolveApprovalAssignee> = {};

    if (orgReason) {
      const parsedChainId = parseApprovalChainId(request.reason);
      if (!parsedChainId) {
        return { decision: "deny", reason: "Invalid approval chain reference." };
      }
      chainId = parsedChainId;
      reason = stripApprovalPrefix(request.reason);
      const employeeId = readEmployeeId(request.metadata);
      if (options.getOrg && options.getEmployees) {
        const [org, employees] = await Promise.all([options.getOrg(), options.getEmployees()]);
        assignee = resolveApprovalAssignee(org, employees, chainId, employeeId);
        if (!assignee.approverId) {
          return {
            decision: "deny",
            reason: `No active approver found for approval chain "${assignee.chainName ?? chainId}".`,
          };
        }
      }
    } else {
      chainId = WORKSPACE_DEFAULT_CHAIN_ID;
      reason = request.reason.trim() || `Tool "${request.toolName}" requires approval.`;
      assignee = { chainName: "Workspace tool approval" };
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const employeeId = readEmployeeId(request.metadata);
    const record: ApprovalRequest = {
      id,
      status: "pending",
      chainId,
      runId: request.runId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      sessionId: request.sessionId,
      reason,
      createdAt: now,
      updatedAt: now,
      ...(employeeId ? { employeeId } : {}),
      ...(typeof request.metadata?.employeeDisplayName === "string"
        ? { employeeDisplayName: request.metadata.employeeDisplayName }
        : {}),
      ...(assignee.approverId ? { assignedApproverId: assignee.approverId } : {}),
      ...(assignee.approverDisplayName ? { assignedApproverDisplayName: assignee.approverDisplayName } : {}),
      ...(assignee.chainName ? { chainName: assignee.chainName } : {}),
      inputSummary: summarizeInput(request.input),
    };

    const registry = await options.store.load();
    await options.store.save({
      requests: [...registry.requests, record],
    });

    publishEvent?.({
      type: "permission",
      runId: record.runId,
      toolName: record.toolName,
      toolCallId: record.toolCallId,
      phase: "queued",
      payload: {
        toolCallId: record.toolCallId,
        toolName: record.toolName,
        sessionId: record.sessionId,
        reason: record.reason,
        approvalId: record.id,
        inputSummary: record.inputSummary,
      },
    });

    return await new Promise<LoongPermissionResponse | "allow" | "deny">(resolve => {
      pending.set(id, { request, resolve });
      const timer = setTimeout(() => {
        if (!pending.has(id)) {
          return;
        }
        pending.delete(id);
        void expireApproval(id).catch(() => undefined);
        resolve({
          decision: "deny",
          reason: "Approval request timed out.",
        });
      }, timeoutMs);
      timer.unref?.();
    });
  };

  async function expireApproval(id: string): Promise<void> {
    const registry = await options.store.load();
    const now = new Date().toISOString();
    const requests = registry.requests.map(entry =>
      entry.id === id && entry.status === "pending"
        ? { ...entry, status: "expired" as const, updatedAt: now, resolvedAt: now }
        : entry,
    );
    await options.store.save({ requests });
  }

  async function resolveApproval(
    id: string,
    status: Extract<ApprovalStatus, "approved" | "rejected">,
    decision: "allow" | "deny",
    resolvedBy?: string,
    note?: string,
  ): Promise<ApprovalRequest> {
    const entry = pending.get(id);
    const registry = await options.store.load();
    const existing = registry.requests.find(request => request.id === id);
    if (!existing) {
      throw new Error(`Approval request "${id}" was not found.`);
    }
    if (existing.status !== "pending") {
      throw new Error(`Approval request "${id}" is already ${existing.status}.`);
    }
    if (!entry) {
      throw new Error(`Approval request "${id}" is no longer awaiting a live run (timed out or gateway restarted).`);
    }

    const now = new Date().toISOString();
    const updated: ApprovalRequest = {
      ...existing,
      status,
      updatedAt: now,
      resolvedAt: now,
      ...(resolvedBy?.trim() ? { resolvedBy: resolvedBy.trim() } : {}),
      ...(note?.trim() ? { resolutionNote: note.trim() } : {}),
    };
    await options.store.save({
      requests: registry.requests.map(request => (request.id === id ? updated : request)),
    });

    pending.delete(id);
    entry.resolve(
      decision === "allow"
        ? {
            decision: "allow",
            reason: note?.trim() || `Approved via dashboard (${status}).`,
          }
        : {
            decision: "deny",
            reason: note?.trim() || `Rejected via dashboard (${status}).`,
          },
    );

    if (status === "rejected" && options.ticketStore) {
      await appendRejectionTicket(options.ticketStore, updated);
    }

    return updated;
  }

  return {
    handler,
    attachEventPublisher(publish) {
      publishEvent = publish;
    },
    async list(filter) {
      const registry = await options.store.load();
      let requests = registry.requests;
      if (filter?.status) {
        requests = requests.filter(request => request.status === filter.status);
      }
      if (filter?.assignedApproverId) {
        requests = requests.filter(
          request => request.assignedApproverId === filter.assignedApproverId,
        );
      }
      if (filter?.runId) {
        requests = requests.filter(request => request.runId === filter.runId);
      }
      if (filter?.toolCallId) {
        requests = requests.filter(request => request.toolCallId === filter.toolCallId);
      }
      if (filter?.sessionId) {
        requests = requests.filter(request => request.sessionId === filter.sessionId);
      }
      return { ...registry, requests };
    },
    approve(id, resolvedBy, note) {
      return resolveApproval(id, "approved", "allow", resolvedBy, note);
    },
    reject(id, resolvedBy, note) {
      return resolveApproval(id, "rejected", "deny", resolvedBy, note);
    },
  };
}

async function appendRejectionTicket(ticketStore: TicketStore, approval: ApprovalRequest): Promise<void> {
  const registry = await ticketStore.load();
  const now = new Date().toISOString();
  const ticket: OrgTicket = {
    id: crypto.randomUUID(),
    title: `审批拒绝: ${approval.toolName}`,
    status: "blocked",
    createdAt: now,
    updatedAt: now,
    runId: approval.runId,
    toolName: approval.toolName,
    ...(approval.employeeId ? { assigneeEmployeeId: approval.employeeId, createdByEmployeeId: approval.employeeId } : {}),
    description: approval.resolutionNote ?? approval.reason,
    tags: ["approval-rejected", approval.chainId],
  };
  await ticketStore.save({ tickets: [...registry.tickets, ticket] });
}

function summarizeInput(input: unknown): string {
  try {
    const text = JSON.stringify(input ?? {});
    return text.length > 240 ? `${text.slice(0, 237)}...` : text;
  } catch {
    return String(input);
  }
}
