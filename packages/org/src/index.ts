export type {
  DigitalEmployee,
  EmployeeRegistry,
  EmployeeStore,
  OrgApprovalChain,
  OrgApprovalChainStep,
  OrgDocument,
  OrgEmployeeRoutingRule,
  OrgPosition,
  OrgReportingLine,
  OrgRiskLevel,
  OrgStore,
  OrgToolDecision,
  OrgToolPolicyResult,
  OrgUnit,
  ToolPolicyDefinition,
  ToolPolicyDocument,
  ToolPolicyRule,
  ToolPolicyStore,
  ApprovalRegistry,
  ApprovalRequest,
  ApprovalStatus,
  ApprovalStore,
  KpiSnapshot,
  KpiTemplate,
  KpiTemplateDocument,
  KpiTemplateStore,
  OrgTicket,
  TicketDocument,
  TicketStatus,
  TicketStore,
} from "./types.js";

export {
  createGatewayApprovalService,
  type GatewayApprovalService,
  type GatewayApprovalServiceOptions,
} from "./approval-service.js";

export { isOrgApprovalReason, parseApprovalChainId, stripApprovalPrefix } from "./approval-reason.js";
export { resolveApprovalAssignee, type ApprovalAssignee } from "./approval-routing.js";
export { resolveEmployeeForMessage, type EmployeeRouteResult } from "./employee-routing.js";

export {
  findEmployeePolicy,
  mergeOrgDecisionWithBaseline,
  readEmployeeId,
  resolveEmployeeToolPolicy,
} from "./policy.js";

export {
  createFileEmployeeStore,
  createFileOrgStore,
  createFileToolPolicyStore,
} from "./stores/file-stores.js";

export { createFileApprovalStore } from "./stores/file-approval-store.js";
export { createFileTicketStore } from "./stores/file-ticket-store.js";
export { buildKpiSnapshot, createFileKpiTemplateStore } from "./stores/file-kpi-store.js";
export { createTicketLifecycleHook, type TicketLifecycleHookOptions } from "./ticket-lifecycle.js";

export { evaluateOrgAwarePermission, type OrgPermissionEngineOptions } from "./permission.js";

export {
  defaultEmployeeConfigPath,
  defaultOrgConfigPath,
  defaultOrgRoot,
  defaultToolPolicyConfigPath,
  defaultApprovalConfigPath,
  defaultTicketConfigPath,
  defaultKpiTemplateConfigPath,
} from "./paths.js";
