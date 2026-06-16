import type { GatewayAgentConfigSaveParams, GatewayAgentParams } from "./gateway-agent-types.js";
import type {
  GatewayApprovalListParams,
  GatewayApprovalResolveParams,
  GatewayCronJobRemoveParams,
  GatewayCronJobUpsertParams,
  GatewayEmployeeSaveParams,
  GatewayEmployeeWorkspaceGetParams,
  GatewayEmployeeWorkspaceSaveParams,
  GatewayKpiSnapshotParams,
  GatewayMemoryCandidateListParams,
  GatewayMemoryCandidatePromoteParams,
  GatewayMemoryCandidateRejectParams,
  GatewaySuiteInstallParams,
  GatewaySuiteInstanceMaterializeParams,
  GatewaySuiteReleaseInstallParams,
  GatewayModelConfigSaveParams,
  GatewayTicketUpsertParams,
  GatewayTierClassifyParams,
  GatewayTierConfigSaveParams,
  GatewayToolInvokeParams,
  GatewayToolPolicySaveParams,
  GatewayTrajectoryGetParams,
  GatewayTrajectoryListParams,
} from "./gateway-rpc-params.js";

export type GatewayRequest =
  | { type: "connect"; id: string; params?: Record<string, unknown> }
  | { type: "agent"; id: string; params: GatewayAgentParams }
  | { type: "agent.wait"; id: string; params: { queueTurnId: string } }
  | { type: "health"; id: string }
  | { type: "run.status"; id: string; params: { runId: string } }
  | { type: "run.cancel"; id: string; params: { runId: string; reason?: string } }
  | { type: "runs.list"; id: string; params?: { sessionId?: string; limit?: number } }
  | { type: "providers.list"; id: string }
  | { type: "model.config.get"; id: string }
  | { type: "model.config.save"; id: string; params: GatewayModelConfigSaveParams }
  | { type: "agent.config.get"; id: string }
  | { type: "agent.config.save"; id: string; params: GatewayAgentConfigSaveParams }
  | { type: "org.get"; id: string }
  | { type: "employee.list"; id: string }
  | { type: "employee.save"; id: string; params: GatewayEmployeeSaveParams }
  | { type: "employee.workspace.get"; id: string; params?: GatewayEmployeeWorkspaceGetParams }
  | { type: "employee.workspace.save"; id: string; params: GatewayEmployeeWorkspaceSaveParams }
  | { type: "skills.list"; id: string }
  | { type: "org.bootstrap.example"; id: string }
  | { type: "policy.tool.get"; id: string }
  | { type: "policy.tool.save"; id: string; params: GatewayToolPolicySaveParams }
  | { type: "approval.list"; id: string; params?: GatewayApprovalListParams }
  | { type: "approval.approve"; id: string; params: GatewayApprovalResolveParams }
  | { type: "approval.reject"; id: string; params: GatewayApprovalResolveParams }
  | { type: "approval.dismiss"; id: string; params: GatewayApprovalResolveParams }
  | { type: "ticket.list"; id: string }
  | { type: "ticket.upsert"; id: string; params: GatewayTicketUpsertParams }
  | { type: "kpi.template.list"; id: string }
  | { type: "kpi.snapshot.get"; id: string; params: GatewayKpiSnapshotParams }
  | { type: "tier.config.get"; id: string }
  | { type: "tier.config.save"; id: string; params: GatewayTierConfigSaveParams }
  | { type: "tier.classify"; id: string; params: GatewayTierClassifyParams }
  | { type: "plugins.list"; id: string }
  | { type: "mcp.servers.list"; id: string }
  | { type: "pairing.token.create"; id: string; params?: { label?: string; ttlMs?: number } }
  | { type: "pairing.devices.list"; id: string }
  | { type: "pairing.device.register"; id: string; params: { token: string } }
  | { type: "pairing.device.revoke"; id: string; params: { deviceId: string } }
  | { type: "tools.catalog"; id: string; params?: { includeSchemas?: boolean } }
  | { type: "tool.invoke"; id: string; params: GatewayToolInvokeParams }
  | { type: "suite.install"; id: string; params: GatewaySuiteInstallParams }
  | { type: "suite.release.install"; id: string; params: GatewaySuiteReleaseInstallParams }
  | { type: "suite.instance.materialize"; id: string; params: GatewaySuiteInstanceMaterializeParams }
  | { type: "memory.candidates.list"; id: string; params?: GatewayMemoryCandidateListParams }
  | { type: "memory.candidate.promote"; id: string; params: GatewayMemoryCandidatePromoteParams }
  | { type: "memory.candidate.reject"; id: string; params: GatewayMemoryCandidateRejectParams }
  | { type: "trajectory.list"; id: string; params: GatewayTrajectoryListParams }
  | { type: "trajectory.get"; id: string; params: GatewayTrajectoryGetParams }
  | { type: "cron.jobs.list"; id: string }
  | { type: "cron.job.upsert"; id: string; params: GatewayCronJobUpsertParams }
  | { type: "cron.job.remove"; id: string; params: GatewayCronJobRemoveParams }
  | { type: "cron.tick"; id: string }
  | { type: "fs.directory.browse"; id: string; params?: { path?: string } };

export type GatewayResponse =
  | { type: "response"; id: string; ok: true; payload?: unknown }
  | { type: "response"; id: string; ok: false; error: string };
