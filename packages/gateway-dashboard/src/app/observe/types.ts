import type { GatewayRunRecord } from "../run/types.js";

export interface TrajectorySummary {
  runId: string;
  status?: string;
  userPreview?: string;
  createdAt?: string;
}

export interface MemoryCandidate {
  id: string;
  content?: string;
  scope?: string;
  sessionId?: string;
  createdAt?: string;
  reason?: string;
}

export interface MemoryReviewState {
  canPromote: boolean;
  canReject: boolean;
}

export interface KpiMetricView {
  id: string;
  name: string;
  value: number;
}

export interface ApprovalInboxItem {
  id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  chainId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  sessionId: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  employeeId?: string;
  employeeDisplayName?: string;
  assignedApproverId?: string;
  assignedApproverDisplayName?: string;
  chainName?: string;
  inputSummary?: string;
  awaitingLiveRun?: boolean;
}

export interface OrgTicketView {
  id: string;
  title: string;
  status: string;
  assigneeEmployeeId?: string;
  runId?: string;
  createdAt?: string;
}

export interface OntologyFactView {
  assertionId: string;
  line: string;
  predicate: string;
  confidence: number;
  sourceType: string;
  status: string;
  evidenceCount: number;
  validFrom?: string;
  validTo?: string;
}

export interface OntologyKnowledgeGroupView {
  predicate: string;
  facts: OntologyFactView[];
}

export interface OntologyKnowledgeView {
  groups: OntologyKnowledgeGroupView[];
  activeCount: number;
  candidateCount: number;
  disputedCount: number;
  inferredActiveCount: number;
}

export type { GatewayRunRecord };
