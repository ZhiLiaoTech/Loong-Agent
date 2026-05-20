export type OrgToolDecision = "allow" | "deny" | "ask" | "approval";

export type OrgRiskLevel = "low" | "medium" | "high" | "critical";

export interface OrgUnit {
  id: string;
  name: string;
  parentId?: string;
}

export interface OrgPosition {
  id: string;
  name: string;
  unitId: string;
  level?: string;
}

export interface OrgReportingLine {
  employeeId: string;
  managerId: string;
}

export interface OrgApprovalChainStep {
  approverRole?: string;
  approverEmployeeId?: string;
  scope?: "same-unit" | "org" | "manager";
  optional?: boolean;
}

export interface OrgApprovalChain {
  id: string;
  name: string;
  steps: readonly OrgApprovalChainStep[];
}

export interface OrgDocument {
  version: number;
  units: readonly OrgUnit[];
  positions: readonly OrgPosition[];
  reporting: readonly OrgReportingLine[];
  approvalChains: readonly OrgApprovalChain[];
  configPath?: string;
}

export interface DigitalEmployee {
  id: string;
  displayName: string;
  profileId: string;
  positionId: string;
  unitId: string;
  managerId?: string;
  status: "active" | "inactive";
  toolPolicyId: string;
  approvalDelegateId?: string;
  kpiTemplateId?: string;
  budget?: {
    tierDefault?: "fast" | "standard" | "deep";
    maxRunsPerDay?: number;
    maxDelegationDepth?: number;
  };
}

export interface EmployeeRegistry {
  employees: readonly DigitalEmployee[];
  defaultEmployeeId?: string;
  configPath?: string;
}

export interface ToolPolicyRuleMatch {
  toolName?: string;
  capability?: string;
  inputPathContains?: string;
}

export interface ToolPolicyRule {
  id?: string;
  match: ToolPolicyRuleMatch;
  risk?: OrgRiskLevel;
  decision: OrgToolDecision;
  chainId?: string;
  reason?: string;
}

export interface ToolPolicyDocument {
  policies: readonly ToolPolicyDefinition[];
  configPath?: string;
}

export interface ToolPolicyDefinition {
  id: string;
  description?: string;
  rules: readonly ToolPolicyRule[];
}

export interface OrgToolPolicyResult {
  decision: OrgToolDecision;
  reason: string;
  risk?: OrgRiskLevel;
  chainId?: string;
  policyId?: string;
  matchedRuleId?: string;
}

export interface OrgStore {
  load(): Promise<OrgDocument>;
}

export interface EmployeeStore {
  load(): Promise<EmployeeRegistry>;
  save(registry: EmployeeRegistry): Promise<EmployeeRegistry>;
}

export interface ToolPolicyStore {
  load(): Promise<ToolPolicyDocument>;
  save(document: ToolPolicyDocument): Promise<ToolPolicyDocument>;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRequest {
  id: string;
  status: ApprovalStatus;
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
  inputSummary?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
}

export interface ApprovalRegistry {
  requests: readonly ApprovalRequest[];
  configPath?: string;
}

export interface ApprovalStore {
  load(): Promise<ApprovalRegistry>;
  save(registry: ApprovalRegistry): Promise<ApprovalRegistry>;
}

export type TicketStatus = "open" | "in_progress" | "blocked" | "done" | "cancelled";

export interface OrgTicket {
  id: string;
  title: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  assigneeEmployeeId?: string;
  createdByEmployeeId?: string;
  runId?: string;
  toolName?: string;
  description?: string;
  tags?: readonly string[];
}

export interface TicketDocument {
  tickets: readonly OrgTicket[];
  configPath?: string;
}

export interface TicketStore {
  load(): Promise<TicketDocument>;
  save(document: TicketDocument): Promise<TicketDocument>;
}

export type KpiMetricSource =
  | "tickets.open"
  | "tickets.done"
  | "runs.completed"
  | "approvals.pending";

export interface KpiMetricDefinition {
  id: string;
  name: string;
  source: KpiMetricSource;
}

export interface KpiTemplate {
  id: string;
  name: string;
  metrics: readonly KpiMetricDefinition[];
}

export interface KpiTemplateDocument {
  templates: readonly KpiTemplate[];
  configPath?: string;
}

export interface KpiTemplateStore {
  load(): Promise<KpiTemplateDocument>;
}

export interface KpiSnapshotMetric {
  id: string;
  name: string;
  value: number;
}

export interface KpiSnapshot {
  templateId: string;
  employeeId?: string;
  generatedAt: string;
  metrics: readonly KpiSnapshotMetric[];
}
