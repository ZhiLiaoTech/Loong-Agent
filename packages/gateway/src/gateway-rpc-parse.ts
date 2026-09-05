import { parseCronSchedule } from "@loong/cron";
import type { ApprovalStatus, EmployeeRegistry, OrgTicket, ToolPolicyDocument } from "@loong/org";
import { parseGatewayAgentParams } from "./agent-params.js";
import { parseAgentConfigSaveParams } from "./gateway-agent-config.js";
import { badRequest } from "./gateway-http.js";
import {
  isLoongThinking,
  isRecord,
  normalizeBoundedText,
  normalizeShortText,
} from "./gateway-parse.js";
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
  GatewayModelConfigSaveParams,
  GatewayModelProviderConfig,
  GatewayModelProviderType,
  GatewayOntologyAssertionCorrectParams,
  GatewayOntologyAssertionExplainParams,
  GatewayOntologyAssertionRetractParams,
  GatewayOntologyCandidateListParams,
  GatewayOntologyCandidatePromoteParams,
  GatewayOntologyCandidateRejectParams,
  GatewayOntologyCategoryDeleteParams,
  GatewayOntologyConflictsListParams,
  GatewayOntologyDeleteAllParams,
  GatewayOntologyEntityDeleteParams,
  GatewayOntologyEntityUnmergeParams,
  GatewayOntologyEvidenceDeleteParams,
  GatewayOntologyExportParams,
  GatewayOntologyImportParams,
  GatewayOntologyKnowledgeListParams,
  GatewayOntologySnapshotRegenerateParams,
  GatewayObligationAttachEvidenceParams,
  GatewayObligationCreateParams,
  GatewayObligationEvidenceRef,
  GatewayObligationExplainParams,
  GatewayObligationGetParams,
  GatewayObligationHumanVerdictParams,
  GatewayObligationListParams,
  GatewayObligationOverdueListParams,
  GatewayObligationRetryParams,
  GatewayObligationStatus,
  GatewayObligationValidateParams,
  GatewayObligationValidatorKind,
  GatewaySuiteInstallParams,
  GatewaySuiteInstanceMaterializeParams,
  GatewaySuiteReleaseInstallParams,
  GatewayTierClassifyParams,
  GatewayTierConfigSaveParams,
  GatewayTierKeywordHint,
  GatewayTierSpec,
  GatewayToolInvokeParams,
  GatewayTicketUpsertParams,
  GatewayToolPolicySaveParams,
  GatewayTrajectoryGetParams,
  GatewayTrajectoryListParams,
} from "./gateway-rpc-params.js";
import type { GatewayRequest } from "./gateway-rpc-types.js";
import type { LoongTurnResult } from "@loong/core";

export function parseGatewayRequest(value: unknown): GatewayRequest {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.id !== "string" || !value.id.trim()) {
    badRequest("Gateway RPC request requires type and id.");
  }
  if (value.type === "health") {
    return { type: "health", id: value.id };
  }
  if (value.type === "connect") {
    return {
      type: "connect",
      id: value.id,
      ...(isRecord(value.params) ? { params: value.params } : {}),
    };
  }
  if (value.type === "agent") {
    return {
      type: "agent",
      id: value.id,
      params: parseGatewayAgentParams(value.params),
    };
  }
  if (value.type === "agent.wait") {
    if (!isRecord(value.params) || typeof value.params.queueTurnId !== "string" || !value.params.queueTurnId.trim()) {
      badRequest("agent.wait requires params.queueTurnId.");
    }
    return {
      type: "agent.wait",
      id: value.id,
      params: { queueTurnId: value.params.queueTurnId.trim() },
    };
  }
  if (value.type === "run.status") {
    return {
      type: "run.status",
      id: value.id,
      params: parseRunStatusParams(value.params),
    };
  }
  if (value.type === "run.cancel") {
    return {
      type: "run.cancel",
      id: value.id,
      params: parseRunCancelParams(value.params),
    };
  }
  if (value.type === "runs.list") {
    const params = parseRunsListParams(value.params);
    const request: GatewayRequest = {
      type: "runs.list",
      id: value.id,
    };
    if (params !== undefined) {
      request.params = params;
    }
    return request;
  }
  if (value.type === "providers.list") {
    return { type: "providers.list", id: value.id };
  }
  if (value.type === "model.config.get") {
    return { type: "model.config.get", id: value.id };
  }
  if (value.type === "model.config.save") {
    return {
      type: "model.config.save",
      id: value.id,
      params: parseModelConfigSaveParams(value.params),
    };
  }
  if (value.type === "agent.config.get") {
    return { type: "agent.config.get", id: value.id };
  }
  if (value.type === "agent.config.save") {
    return {
      type: "agent.config.save",
      id: value.id,
      params: parseAgentConfigSaveParams(value.params),
    };
  }
  if (value.type === "org.get") {
    return { type: "org.get", id: value.id };
  }
  if (value.type === "employee.list") {
    return { type: "employee.list", id: value.id };
  }
  if (value.type === "employee.save") {
    return {
      type: "employee.save",
      id: value.id,
      params: parseEmployeeSaveParams(value.params),
    };
  }
  if (value.type === "employee.workspace.get") {
    return {
      type: "employee.workspace.get",
      id: value.id,
      ...(value.params !== undefined ? { params: parseEmployeeWorkspaceGetParams(value.params) } : {}),
    };
  }
  if (value.type === "employee.workspace.save") {
    return {
      type: "employee.workspace.save",
      id: value.id,
      params: parseEmployeeWorkspaceSaveParams(value.params),
    };
  }
  if (value.type === "skills.list") {
    return { type: "skills.list", id: value.id };
  }
  if (value.type === "org.bootstrap.example") {
    return { type: "org.bootstrap.example", id: value.id };
  }
  if (value.type === "policy.tool.get") {
    return { type: "policy.tool.get", id: value.id };
  }
  if (value.type === "policy.tool.save") {
    return {
      type: "policy.tool.save",
      id: value.id,
      params: parseToolPolicySaveParams(value.params),
    };
  }
  if (value.type === "approval.list") {
    return {
      type: "approval.list",
      id: value.id,
      ...(value.params !== undefined ? { params: parseApprovalListParams(value.params) } : {}),
    };
  }
  if (value.type === "approval.approve") {
    return {
      type: "approval.approve",
      id: value.id,
      params: parseApprovalResolveParams(value.params),
    };
  }
  if (value.type === "approval.reject") {
    return {
      type: "approval.reject",
      id: value.id,
      params: parseApprovalResolveParams(value.params),
    };
  }
  if (value.type === "approval.dismiss") {
    return {
      type: "approval.dismiss",
      id: value.id,
      params: parseApprovalResolveParams(value.params),
    };
  }
  if (value.type === "ticket.list") {
    return { type: "ticket.list", id: value.id };
  }
  if (value.type === "ticket.upsert") {
    return {
      type: "ticket.upsert",
      id: value.id,
      params: parseTicketUpsertParams(value.params),
    };
  }
  if (value.type === "kpi.template.list") {
    return { type: "kpi.template.list", id: value.id };
  }
  if (value.type === "kpi.snapshot.get") {
    return {
      type: "kpi.snapshot.get",
      id: value.id,
      params: parseKpiSnapshotParams(value.params),
    };
  }
  if (value.type === "tier.config.get") {
    return { type: "tier.config.get", id: value.id };
  }
  if (value.type === "tier.config.save") {
    return {
      type: "tier.config.save",
      id: value.id,
      params: parseTierConfigSaveParams(value.params),
    };
  }
  if (value.type === "tier.classify") {
    return {
      type: "tier.classify",
      id: value.id,
      params: parseTierClassifyParams(value.params),
    };
  }
  if (value.type === "plugins.list") {
    return { type: "plugins.list", id: value.id };
  }
  if (value.type === "mcp.servers.list") {
    return { type: "mcp.servers.list", id: value.id };
  }
  if (value.type === "pairing.token.create") {
    const params = parsePairingTokenCreateParams(value.params);
    const request: GatewayRequest = {
      type: "pairing.token.create",
      id: value.id,
    };
    if (params !== undefined) {
      request.params = params;
    }
    return request;
  }
  if (value.type === "pairing.devices.list") {
    return { type: "pairing.devices.list", id: value.id };
  }
  if (value.type === "pairing.device.register") {
    return {
      type: "pairing.device.register",
      id: value.id,
      params: parsePairingDeviceRegisterParams(value.params),
    };
  }
  if (value.type === "pairing.device.revoke") {
    return {
      type: "pairing.device.revoke",
      id: value.id,
      params: parsePairingDeviceRevokeParams(value.params),
    };
  }
  if (value.type === "tools.catalog") {
    const params = parseToolsCatalogParams(value.params);
    const request: GatewayRequest = {
      type: "tools.catalog",
      id: value.id,
    };
    if (params !== undefined) {
      request.params = params;
    }
    return request;
  }
  if (value.type === "tool.invoke") {
    return {
      type: "tool.invoke",
      id: value.id,
      params: parseToolInvokeParams(value.params),
    };
  }
  if (value.type === "suite.install") {
    return {
      type: "suite.install",
      id: value.id,
      params: parseSuiteInstallParams(value.params),
    };
  }
  if (value.type === "suite.release.install") {
    return {
      type: "suite.release.install",
      id: value.id,
      params: parseSuiteReleaseInstallParams(value.params),
    };
  }
  if (value.type === "suite.instance.materialize") {
    return {
      type: "suite.instance.materialize",
      id: value.id,
      params: parseSuiteInstanceMaterializeParams(value.params),
    };
  }
  if (value.type === "memory.candidates.list") {
    const params = parseMemoryCandidateListParams(value.params);
    const request: GatewayRequest = {
      type: "memory.candidates.list",
      id: value.id,
    };
    if (params !== undefined) {
      request.params = params;
    }
    return request;
  }
  if (value.type === "memory.candidate.promote") {
    return {
      type: "memory.candidate.promote",
      id: value.id,
      params: parseMemoryCandidatePromoteParams(value.params),
    };
  }
  if (value.type === "memory.candidate.reject") {
    return {
      type: "memory.candidate.reject",
      id: value.id,
      params: parseMemoryCandidateRejectParams(value.params),
    };
  }
  if (value.type === "ontology.knowledge.list") {
    return {
      type: "ontology.knowledge.list",
      id: value.id,
      params: parseOntologyKnowledgeListParams(value.params),
    };
  }
  if (value.type === "ontology.assertion.explain") {
    return {
      type: "ontology.assertion.explain",
      id: value.id,
      params: parseOntologyAssertionExplainParams(value.params),
    };
  }
  if (value.type === "ontology.conflicts.list") {
    return {
      type: "ontology.conflicts.list",
      id: value.id,
      params: parseOntologyConflictsListParams(value.params),
    };
  }
  if (value.type === "ontology.candidates.list") {
    return {
      type: "ontology.candidates.list",
      id: value.id,
      params: parseOntologyCandidateListParams(value.params),
    };
  }
  if (value.type === "ontology.candidate.promote") {
    return {
      type: "ontology.candidate.promote",
      id: value.id,
      params: parseOntologyCandidatePromoteParams(value.params),
    };
  }
  if (value.type === "ontology.candidate.reject") {
    return {
      type: "ontology.candidate.reject",
      id: value.id,
      params: parseOntologyCandidateRejectParams(value.params),
    };
  }
  if (value.type === "ontology.assertion.correct") {
    return {
      type: "ontology.assertion.correct",
      id: value.id,
      params: parseOntologyAssertionCorrectParams(value.params),
    };
  }
  if (value.type === "ontology.assertion.retract") {
    return {
      type: "ontology.assertion.retract",
      id: value.id,
      params: parseOntologyAssertionRetractParams(value.params),
    };
  }
  if (value.type === "ontology.evidence.delete") {
    return {
      type: "ontology.evidence.delete",
      id: value.id,
      params: parseOntologyEvidenceDeleteParams(value.params),
    };
  }
  if (value.type === "ontology.entity.delete") {
    return {
      type: "ontology.entity.delete",
      id: value.id,
      params: parseOntologyEntityDeleteParams(value.params),
    };
  }
  if (value.type === "ontology.category.delete") {
    return {
      type: "ontology.category.delete",
      id: value.id,
      params: parseOntologyCategoryDeleteParams(value.params),
    };
  }
  if (value.type === "ontology.deleteAll") {
    return {
      type: "ontology.deleteAll",
      id: value.id,
      params: parseOntologyDeleteAllParams(value.params),
    };
  }
  if (value.type === "ontology.entity.unmerge") {
    return {
      type: "ontology.entity.unmerge",
      id: value.id,
      params: parseOntologyEntityUnmergeParams(value.params),
    };
  }
  if (value.type === "ontology.snapshot.regenerate") {
    return {
      type: "ontology.snapshot.regenerate",
      id: value.id,
      params: parseOntologySnapshotRegenerateParams(value.params),
    };
  }
  if (value.type === "ontology.export") {
    return {
      type: "ontology.export",
      id: value.id,
      params: parseOntologyExportParams(value.params),
    };
  }
  if (value.type === "ontology.import") {
    return {
      type: "ontology.import",
      id: value.id,
      params: parseOntologyImportParams(value.params),
    };
  }
  if (value.type === "obligation.create") {
    return {
      type: "obligation.create",
      id: value.id,
      params: parseObligationCreateParams(value.params),
    };
  }
  if (value.type === "obligation.list") {
    return {
      type: "obligation.list",
      id: value.id,
      params: parseObligationListParams(value.params),
    };
  }
  if (value.type === "obligation.get") {
    return {
      type: "obligation.get",
      id: value.id,
      params: parseObligationGetParams(value.params),
    };
  }
  if (value.type === "obligation.attachEvidence") {
    return {
      type: "obligation.attachEvidence",
      id: value.id,
      params: parseObligationAttachEvidenceParams(value.params),
    };
  }
  if (value.type === "obligation.overdue.list") {
    return {
      type: "obligation.overdue.list",
      id: value.id,
      params: parseObligationOverdueListParams(value.params),
    };
  }
  if (value.type === "obligation.validate") {
    return {
      type: "obligation.validate",
      id: value.id,
      params: parseObligationValidateParams(value.params),
    };
  }
  if (value.type === "obligation.verdict.human") {
    return {
      type: "obligation.verdict.human",
      id: value.id,
      params: parseObligationHumanVerdictParams(value.params),
    };
  }
  if (value.type === "obligation.retry") {
    return {
      type: "obligation.retry",
      id: value.id,
      params: parseObligationRetryParams(value.params),
    };
  }
  if (value.type === "obligation.explain") {
    return {
      type: "obligation.explain",
      id: value.id,
      params: parseObligationExplainParams(value.params),
    };
  }
  if (value.type === "trajectory.list") {
    return {
      type: "trajectory.list",
      id: value.id,
      params: parseTrajectoryListParams(value.params),
    };
  }
  if (value.type === "trajectory.get") {
    return {
      type: "trajectory.get",
      id: value.id,
      params: parseTrajectoryGetParams(value.params),
    };
  }
  if (value.type === "cron.jobs.list") {
    return { type: "cron.jobs.list", id: value.id };
  }
  if (value.type === "cron.job.upsert") {
    return {
      type: "cron.job.upsert",
      id: value.id,
      params: parseCronJobUpsertParams(value.params),
    };
  }
  if (value.type === "cron.job.remove") {
    return {
      type: "cron.job.remove",
      id: value.id,
      params: parseCronJobRemoveParams(value.params),
    };
  }
  if (value.type === "cron.tick") {
    return { type: "cron.tick", id: value.id };
  }
  if (typeof value.type === "string" && value.type.startsWith("cooking.video.")) {
    const supported = new Set([
      "cooking.video.jobs.list", "cooking.video.workspace.get", "cooking.video.edit.save",
      "cooking.video.review.submit", "cooking.video.rerender", "cooking.video.preview.read",
      "cooking.video.queue.list", "cooking.video.queue.enqueue", "cooking.video.queue.cancel",
      "cooking.video.metrics.get",
    ]);
    if (!supported.has(value.type)) badRequest(`Unsupported cooking video RPC: ${value.type}.`);
    if (!isRecord(value.params)) badRequest(`${value.type} params must be an object.`);
    return { type: value.type, id: value.id, params: value.params } as GatewayRequest;
  }
  if (value.type === "fs.directory.browse") {
    const params = parseDirectoryBrowseParams(value.params);
    const request: GatewayRequest = {
      type: "fs.directory.browse",
      id: value.id,
    };
    if (params !== undefined) {
      request.params = params;
    }
    return request;
  }
  badRequest(`Unknown Gateway RPC type: ${value.type}`);
}

function parseDirectoryBrowseParams(value: unknown): { path?: string } | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    badRequest("fs.directory.browse params must be an object.");
  }
  const params: { path?: string } = {};
  if (value.path !== undefined) {
    if (typeof value.path !== "string") {
      badRequest("fs.directory.browse params.path must be a string.");
    }
    params.path = value.path;
  }
  return params;
}

function parsePairingTokenCreateParams(value: unknown): { label?: string; ttlMs?: number } | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    badRequest("pairing.token.create params must be an object.");
  }
  const params: { label?: string; ttlMs?: number } = {};
  if (value.label !== undefined) {
    if (typeof value.label !== "string") {
      badRequest("pairing.token.create params.label must be a string.");
    }
    params.label = value.label;
  }
  if (value.ttlMs !== undefined) {
    if (typeof value.ttlMs !== "number" || !Number.isFinite(value.ttlMs) || value.ttlMs <= 0) {
      badRequest("pairing.token.create params.ttlMs must be a positive number.");
    }
    params.ttlMs = value.ttlMs;
  }
  return params;
}

function parsePairingDeviceRegisterParams(value: unknown): { token: string } {
  if (!isRecord(value) || typeof value.token !== "string" || !value.token.trim()) {
    badRequest("pairing.device.register requires params.token.");
  }
  return { token: value.token.trim() };
}

function parsePairingDeviceRevokeParams(value: unknown): { deviceId: string } {
  if (!isRecord(value) || typeof value.deviceId !== "string" || !value.deviceId.trim()) {
    badRequest("pairing.device.revoke requires params.deviceId.");
  }
  return { deviceId: value.deviceId.trim() };
}

function parseRunStatusParams(value: unknown): { runId: string } {
  if (!isRecord(value) || typeof value.runId !== "string" || !value.runId.trim()) {
    badRequest("run.status requires params.runId.");
  }
  return { runId: value.runId };
}

function parseRunCancelParams(value: unknown): { runId: string; reason?: string } {
  if (!isRecord(value) || typeof value.runId !== "string" || !value.runId.trim()) {
    badRequest("run.cancel requires params.runId.");
  }
  return {
    runId: value.runId,
    ...(typeof value.reason === "string" && value.reason.trim() ? { reason: value.reason } : {}),
  };
}

function parseRunsListParams(value: unknown): { sessionId?: string; limit?: number } | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    badRequest("runs.list params must be an object.");
  }
  return {
    ...(typeof value.sessionId === "string" && value.sessionId.trim() ? { sessionId: value.sessionId } : {}),
    ...(typeof value.limit === "number" ? { limit: value.limit } : {}),
  };
}

function parseToolsCatalogParams(value: unknown): { includeSchemas?: boolean } | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    badRequest("tools.catalog params must be an object.");
  }
  return {
    ...(typeof value.includeSchemas === "boolean" ? { includeSchemas: value.includeSchemas } : {}),
  };
}

function parseModelConfigSaveParams(value: unknown): GatewayModelConfigSaveParams {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    badRequest("model.config.save requires params.providers.");
  }
  return {
    providers: value.providers.map((provider, index) => parseModelProviderConfig(provider, index)),
  };
}

function normalizeProviderBaseUrl(input: string, index: number): string {
  const trimmed = normalizeShortText(input, "baseUrl", 1000);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    badRequest(`model.config.save provider ${index + 1} baseUrl is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    badRequest(`model.config.save provider ${index + 1} baseUrl must use http or https.`);
  }
  if (url.username || url.password) {
    badRequest(`model.config.save provider ${index + 1} baseUrl must not contain credentials.`);
  }
  if (url.search || url.hash) {
    badRequest(`model.config.save provider ${index + 1} baseUrl must not contain query string or fragment.`);
  }
  return trimmed;
}

function parseModelProviderConfig(value: unknown, index: number): GatewayModelProviderConfig {
  if (!isRecord(value)) {
    badRequest(`model.config.save provider ${index + 1} must be an object.`);
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    badRequest(`model.config.save provider ${index + 1} requires id.`);
  }
  if (!isGatewayModelProviderType(value.type)) {
    badRequest(`model.config.save provider ${index + 1} type is invalid.`);
  }
  const provider: GatewayModelProviderConfig = {
    id: normalizeShortText(value.id, "provider id", 120),
    type: value.type,
  };
  if (typeof value.displayName === "string" && value.displayName.trim()) {
    provider.displayName = normalizeShortText(value.displayName, "displayName", 160);
  }
  if (typeof value.apiKey === "string" && value.apiKey.trim()) {
    provider.apiKey = normalizeBoundedText(value.apiKey, "apiKey", 4000);
  }
  if (typeof value.apiKeyConfigured === "boolean") {
    provider.apiKeyConfigured = value.apiKeyConfigured;
  }
  if (typeof value.baseUrl === "string" && value.baseUrl.trim()) {
    provider.baseUrl = normalizeProviderBaseUrl(value.baseUrl, index);
  }
  if (typeof value.defaultModel === "string" && value.defaultModel.trim()) {
    provider.defaultModel = normalizeShortText(value.defaultModel, "defaultModel", 200);
  }
  if (typeof value.supportsToolCalling === "boolean") {
    provider.supportsToolCalling = value.supportsToolCalling;
  }
  if (typeof value.enabled === "boolean") {
    provider.enabled = value.enabled;
  }
  return provider;
}

function parseEmployeeWorkspaceGetParams(value: unknown): GatewayEmployeeWorkspaceGetParams {
  if (!isRecord(value)) {
    badRequest("employee.workspace.get params must be an object.");
  }
  const params: GatewayEmployeeWorkspaceGetParams = {};
  if (typeof value.workspace === "string" && value.workspace.trim()) {
    params.workspace = normalizeShortText(value.workspace, "workspace", 4000);
  }
  if (typeof value.employeeId === "string" && value.employeeId.trim()) {
    params.employeeId = normalizeShortText(value.employeeId, "employeeId", 120);
  }
  if (typeof value.profileId === "string" && value.profileId.trim()) {
    params.profileId = normalizeShortText(value.profileId, "profileId", 120);
  }
  return params;
}

function parseEmployeeWorkspaceSaveParams(value: unknown): GatewayEmployeeWorkspaceSaveParams {
  if (!isRecord(value) || typeof value.workspace !== "string" || !value.workspace.trim()) {
    badRequest("employee.workspace.save requires params.workspace.");
  }
  const params: GatewayEmployeeWorkspaceSaveParams = {
    workspace: normalizeShortText(value.workspace, "workspace", 4000),
  };
  if (typeof value.role === "string") {
    params.role = normalizeBoundedText(value.role, "role", 32_000);
  }
  if (typeof value.workflow === "string") {
    params.workflow = normalizeBoundedText(value.workflow, "workflow", 32_000);
  }
  if (typeof value.memory === "string") {
    params.memory = normalizeBoundedText(value.memory, "memory", 32_000);
  }
  if (Array.isArray(value.enabledSkills)) {
    params.enabledSkills = value.enabledSkills
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map(entry => normalizeShortText(entry, "enabledSkills", 120));
  }
  return params;
}

function parseEmployeeSaveParams(value: unknown): GatewayEmployeeSaveParams {
  if (!isRecord(value) || !Array.isArray(value.employees)) {
    badRequest("employee.save requires params.employees.");
  }
  const params: GatewayEmployeeSaveParams = {
    employees: value.employees as GatewayEmployeeSaveParams["employees"],
  };
  if (typeof value.defaultEmployeeId === "string" && value.defaultEmployeeId.trim()) {
    params.defaultEmployeeId = normalizeShortText(value.defaultEmployeeId, "defaultEmployeeId", 120);
  }
  return params;
}

function parseToolPolicySaveParams(value: unknown): GatewayToolPolicySaveParams {
  if (!isRecord(value) || !Array.isArray(value.policies)) {
    badRequest("policy.tool.save requires params.policies.");
  }
  return {
    policies: value.policies as GatewayToolPolicySaveParams["policies"],
  };
}

function parseApprovalListParams(value: unknown): GatewayApprovalListParams {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    badRequest("approval.list params must be an object.");
  }
  const status = value.status;
  const params: GatewayApprovalListParams = {};
  if (status !== undefined) {
    if (status !== "pending" && status !== "approved" && status !== "rejected" && status !== "expired") {
      badRequest("approval.list status is invalid.");
    }
    params.status = status;
  }
  if (typeof value.assignedApproverId === "string" && value.assignedApproverId.trim()) {
    params.assignedApproverId = normalizeShortText(value.assignedApproverId, "assignedApproverId", 120);
  }
  if (typeof value.runId === "string" && value.runId.trim()) {
    params.runId = normalizeShortText(value.runId, "runId", 120);
  }
  if (typeof value.toolCallId === "string" && value.toolCallId.trim()) {
    params.toolCallId = normalizeShortText(value.toolCallId, "toolCallId", 120);
  }
  if (typeof value.sessionId === "string" && value.sessionId.trim()) {
    params.sessionId = normalizeShortText(value.sessionId, "sessionId", 120);
  }
  return params;
}

function parseTicketUpsertParams(value: unknown): GatewayTicketUpsertParams {
  if (!isRecord(value)) {
    badRequest("ticket.upsert params must be an object.");
  }
  const status = value.status;
  if (
    status !== "open"
    && status !== "in_progress"
    && status !== "blocked"
    && status !== "done"
    && status !== "cancelled"
  ) {
    badRequest("ticket.upsert status is invalid.");
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    badRequest("ticket.upsert requires params.id.");
  }
  if (typeof value.title !== "string" || !value.title.trim()) {
    badRequest("ticket.upsert requires params.title.");
  }
  const ticket: GatewayTicketUpsertParams = {
    id: normalizeShortText(value.id, "ticketId", 120),
    title: normalizeShortText(value.title, "ticketTitle", 240),
    status,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
  if (typeof value.assigneeEmployeeId === "string" && value.assigneeEmployeeId.trim()) {
    ticket.assigneeEmployeeId = normalizeShortText(value.assigneeEmployeeId, "assigneeEmployeeId", 120);
  }
  if (typeof value.createdByEmployeeId === "string" && value.createdByEmployeeId.trim()) {
    ticket.createdByEmployeeId = normalizeShortText(value.createdByEmployeeId, "createdByEmployeeId", 120);
  }
  if (typeof value.runId === "string" && value.runId.trim()) {
    ticket.runId = normalizeShortText(value.runId, "runId", 120);
  }
  if (typeof value.toolName === "string" && value.toolName.trim()) {
    ticket.toolName = normalizeShortText(value.toolName, "toolName", 120);
  }
  if (typeof value.description === "string" && value.description.trim()) {
    ticket.description = normalizeShortText(value.description, "description", 2000);
  }
  return ticket;
}

function parseKpiSnapshotParams(value: unknown): GatewayKpiSnapshotParams {
  if (!isRecord(value) || typeof value.templateId !== "string" || !value.templateId.trim()) {
    badRequest("kpi.snapshot.get requires params.templateId.");
  }
  const params: GatewayKpiSnapshotParams = {
    templateId: normalizeShortText(value.templateId, "templateId", 120),
  };
  if (typeof value.employeeId === "string" && value.employeeId.trim()) {
    params.employeeId = normalizeShortText(value.employeeId, "employeeId", 120);
  }
  return params;
}

function parseApprovalResolveParams(value: unknown): GatewayApprovalResolveParams {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    badRequest("approval resolve requires params.id.");
  }
  const params: GatewayApprovalResolveParams = {
    id: normalizeShortText(value.id, "approvalId", 120),
  };
  if (typeof value.resolvedBy === "string" && value.resolvedBy.trim()) {
    params.resolvedBy = normalizeShortText(value.resolvedBy, "resolvedBy", 120);
  }
  if (typeof value.note === "string" && value.note.trim()) {
    params.note = normalizeShortText(value.note, "note", 500);
  }
  return params;
}

function parseTierConfigSaveParams(value: unknown): GatewayTierConfigSaveParams {
  if (!isRecord(value)) {
    badRequest("tier.config.save params must be an object.");
  }
  const enabled = typeof value.enabled === "boolean" ? value.enabled : false;
  const tiers: GatewayTierConfigSaveParams["tiers"] = {};
  if (isRecord(value.tiers)) {
    for (const name of ["fast", "standard", "deep"] as const) {
      const spec = parseTierSpec((value.tiers as Record<string, unknown>)[name], `tier.config.save tiers.${name}`);
      if (spec !== undefined) tiers[name] = spec;
    }
  }
  const classifier: GatewayTierConfigSaveParams["classifier"] = { mode: "heuristic" };
  if (isRecord(value.classifier)) {
    const raw = value.classifier;
    if (raw.mode === "heuristic" || raw.mode === "fixed") {
      classifier.mode = raw.mode;
    }
    if (raw.fixedTier === "fast" || raw.fixedTier === "standard" || raw.fixedTier === "deep") {
      classifier.fixedTier = raw.fixedTier;
    }
    if (Array.isArray(raw.keywordHints)) {
      const hints: GatewayTierKeywordHint[] = [];
      for (const [index, item] of raw.keywordHints.entries()) {
        if (!isRecord(item)) {
          badRequest(`tier.config.save classifier.keywordHints[${index}] must be an object.`);
        }
        if (item.tier !== "fast" && item.tier !== "standard" && item.tier !== "deep") {
          badRequest(`tier.config.save classifier.keywordHints[${index}].tier is invalid.`);
        }
        if (!Array.isArray(item.words)) {
          badRequest(`tier.config.save classifier.keywordHints[${index}].words must be an array.`);
        }
        const words: string[] = [];
        for (const [wi, word] of item.words.entries()) {
          if (typeof word !== "string" || !word.trim()) {
            badRequest(`tier.config.save classifier.keywordHints[${index}].words[${wi}] must be a non-empty string.`);
          }
          words.push(normalizeShortText(word, "keyword", 80));
        }
        if (words.length > 0) {
          hints.push({ tier: item.tier, words });
        }
      }
      if (hints.length > 0) classifier.keywordHints = hints;
    }
  }
  return { enabled, tiers, classifier };
}

function parseTierSpec(value: unknown, ctx: string): GatewayTierSpec | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    badRequest(`${ctx} must be an object.`);
  }
  const spec: GatewayTierSpec = {};
  if (typeof value.model === "string" && value.model.trim()) {
    spec.model = normalizeShortText(value.model, "model", 200);
  }
  if (Array.isArray(value.modelFallbacks)) {
    const fallbacks: string[] = [];
    for (const [i, fb] of value.modelFallbacks.entries()) {
      if (typeof fb !== "string" || !fb.trim()) {
        badRequest(`${ctx}.modelFallbacks[${i}] must be a non-empty string.`);
      }
      fallbacks.push(normalizeShortText(fb, "modelFallback", 200));
    }
    if (fallbacks.length > 0) spec.modelFallbacks = fallbacks;
  }
  if (value.thinking !== undefined) {
    if (!isLoongThinking(value.thinking)) {
      badRequest(`${ctx}.thinking is invalid.`);
    }
    spec.thinking = value.thinking;
  }
  if (value.maxContextChars !== undefined) {
    if (typeof value.maxContextChars !== "number" || !Number.isFinite(value.maxContextChars) || value.maxContextChars <= 0) {
      badRequest(`${ctx}.maxContextChars must be a positive number.`);
    }
    spec.maxContextChars = Math.floor(Math.min(value.maxContextChars, 200_000));
  }
  if (typeof value.toolsEnabled === "boolean") {
    spec.toolsEnabled = value.toolsEnabled;
  }
  if (typeof value.memoryEnabled === "boolean") {
    spec.memoryEnabled = value.memoryEnabled;
  }
  if (typeof value.systemPromptAddendum === "string" && value.systemPromptAddendum.trim()) {
    spec.systemPromptAddendum = normalizeBoundedText(value.systemPromptAddendum, "systemPromptAddendum", 16_000);
  }
  return Object.keys(spec).length > 0 ? spec : undefined;
}

function parseTierClassifyParams(value: unknown): GatewayTierClassifyParams {
  if (!isRecord(value)) {
    badRequest("tier.classify params must be an object.");
  }
  if (typeof value.message !== "string") {
    badRequest("tier.classify requires params.message.");
  }
  const params: GatewayTierClassifyParams = {
    message: normalizeBoundedText(value.message, "message", 64_000),
  };
  if (Array.isArray(value.attachments)) {
    const atts: { kind: "image" | "text" | "document"; mimeType: string; size?: number }[] = [];
    for (const [i, att] of value.attachments.entries()) {
      if (!isRecord(att)) {
        badRequest(`tier.classify attachments[${i}] must be an object.`);
      }
      if (att.kind !== "image" && att.kind !== "text" && att.kind !== "document") {
        badRequest(`tier.classify attachments[${i}].kind is invalid.`);
      }
      if (typeof att.mimeType !== "string" || !att.mimeType.trim()) {
        badRequest(`tier.classify attachments[${i}].mimeType is invalid.`);
      }
      const entry: { kind: "image" | "text" | "document"; mimeType: string; size?: number } = {
        kind: att.kind,
        mimeType: normalizeShortText(att.mimeType, "mimeType", 200),
      };
      if (typeof att.size === "number" && att.size >= 0) {
        entry.size = att.size;
      }
      atts.push(entry);
    }
    params.attachments = atts;
  }
  if (typeof value.workspace === "string" && value.workspace.trim()) {
    params.workspace = normalizeShortText(value.workspace, "workspace", 4000);
  }
  if (typeof value.toolsEnabled === "boolean") params.toolsEnabled = value.toolsEnabled;
  if (typeof value.memoryRecallCount === "number" && value.memoryRecallCount >= 0) {
    params.memoryRecallCount = Math.floor(value.memoryRecallCount);
  }
  if (typeof value.hasSkillLoaded === "boolean") params.hasSkillLoaded = value.hasSkillLoaded;
  return params;
}

function parseToolInvokeParams(value: unknown): GatewayToolInvokeParams {
  if (!isRecord(value)) {
    badRequest("tool.invoke params must be an object.");
  }
  if (typeof value.toolName !== "string" || !value.toolName.trim()) {
    badRequest("tool.invoke requires params.toolName.");
  }
  const params: GatewayToolInvokeParams = {
    toolName: normalizeShortText(value.toolName, "toolName", 120),
    input: value.input ?? {},
  };
  if (typeof value.sessionId === "string" && value.sessionId.trim()) {
    params.sessionId = normalizeShortText(value.sessionId, "sessionId", 200);
  }
  if (typeof value.workspace === "string" && value.workspace.trim()) {
    params.workspace = normalizeShortText(value.workspace, "workspace", 4000);
  }
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) {
      badRequest("tool.invoke metadata must be an object.");
    }
    params.metadata = value.metadata;
  }
  return params;
}

function parseSuiteInstallParams(value: unknown): GatewaySuiteInstallParams {
  return parseSuiteReleaseInstallParams(value);
}

function parseSuiteReleaseInstallParams(value: unknown): GatewaySuiteReleaseInstallParams {
  if (!isRecord(value) || typeof value.sourceDir !== "string" || !value.sourceDir.trim()) {
    badRequest("suite.release.install requires params.sourceDir.");
  }
  const params: GatewaySuiteReleaseInstallParams = {
    sourceDir: normalizeBoundedText(value.sourceDir, "sourceDir", 4000),
  };
  if (typeof value.overwrite === "boolean") {
    params.overwrite = value.overwrite;
  }
  if (typeof value.installedAt === "string" && value.installedAt.trim()) {
    params.installedAt = normalizeIsoTimestamp(value.installedAt, "installedAt");
  }
  const maxTextFileBytes = parseMaxTextFileBytes(value.maxTextFileBytes, "maxTextFileBytes");
  if (maxTextFileBytes !== undefined) {
    params.maxTextFileBytes = maxTextFileBytes;
  }
  return params;
}

function parseSuiteInstanceMaterializeParams(value: unknown): GatewaySuiteInstanceMaterializeParams {
  if (!isRecord(value)) {
    badRequest("suite.instance.materialize params must be an object.");
  }
  const tenantId = parseRequiredShortString(value.tenantId, "tenantId", "suite.instance.materialize");
  const agentInstanceId = parseRequiredShortString(value.agentInstanceId, "agentInstanceId", "suite.instance.materialize");
  const suiteId = parseRequiredShortString(value.suiteId, "suiteId", "suite.instance.materialize");
  const suiteVersion = parseRequiredShortString(value.suiteVersion, "suiteVersion", "suite.instance.materialize");
  const params: GatewaySuiteInstanceMaterializeParams = {
    tenantId,
    agentInstanceId,
    suiteId,
    suiteVersion,
  };
  if (typeof value.employeeId === "string" && value.employeeId.trim()) {
    params.employeeId = normalizeShortText(value.employeeId, "employeeId", 200);
  }
  if (typeof value.overwrite === "boolean") {
    params.overwrite = value.overwrite;
  }
  if (typeof value.createdAt === "string" && value.createdAt.trim()) {
    params.createdAt = normalizeIsoTimestamp(value.createdAt, "createdAt");
  }
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) {
      badRequest("suite.instance.materialize metadata must be an object.");
    }
    params.metadata = value.metadata;
  }
  const maxTextFileBytes = parseMaxTextFileBytes(value.maxTextFileBytes, "maxTextFileBytes");
  if (maxTextFileBytes !== undefined) {
    params.maxTextFileBytes = maxTextFileBytes;
  }
  return params;
}

function parseRequiredShortString(value: unknown, fieldName: string, rpcName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    badRequest(`${rpcName} requires params.${fieldName}.`);
  }
  return normalizeShortText(value, fieldName, 200);
}

function parseMaxTextFileBytes(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    badRequest(`${fieldName} must be a positive number.`);
  }
  return Math.min(Math.floor(value), 10 * 1024 * 1024);
}

function parseMemoryCandidateListParams(value: unknown): GatewayMemoryCandidateListParams | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    badRequest("memory.candidates.list params must be an object.");
  }
  const params: GatewayMemoryCandidateListParams = {};
  if (value.status !== undefined) {
    if (!isMemoryCandidateStatusFilter(value.status)) {
      badRequest("memory.candidates.list status is invalid.");
    }
    params.status = value.status;
  }
  if (value.dateFrom !== undefined) {
    if (typeof value.dateFrom !== "string" || !value.dateFrom.trim()) {
      badRequest("memory.candidates.list dateFrom must use YYYY-MM-DD.");
    }
    params.dateFrom = normalizeDate(value.dateFrom, "dateFrom");
  }
  if (value.dateTo !== undefined) {
    if (typeof value.dateTo !== "string" || !value.dateTo.trim()) {
      badRequest("memory.candidates.list dateTo must use YYYY-MM-DD.");
    }
    params.dateTo = normalizeDate(value.dateTo, "dateTo");
  }
  if (params.dateFrom !== undefined && params.dateTo !== undefined && params.dateFrom > params.dateTo) {
    badRequest("memory.candidates.list dateFrom must be before or equal to dateTo.");
  }
  if (value.limit !== undefined) {
    if (typeof value.limit !== "number" || !Number.isFinite(value.limit)) {
      badRequest("memory.candidates.list limit must be a number.");
    }
    params.limit = Math.min(Math.max(1, Math.floor(value.limit)), 100);
  }
  return params;
}

function parseMemoryCandidatePromoteParams(value: unknown): GatewayMemoryCandidatePromoteParams {
  if (!isRecord(value)) {
    badRequest("memory.candidate.promote params must be an object.");
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    badRequest("memory.candidate.promote requires params.id.");
  }
  const params: GatewayMemoryCandidatePromoteParams = {
    id: normalizeShortText(value.id, "id", 200),
  };
  if (value.scope !== undefined) {
    if (!isMemoryScope(value.scope)) {
      badRequest("memory.candidate.promote scope is invalid.");
    }
    params.scope = value.scope;
  }
  if (value.content !== undefined) {
    if (typeof value.content !== "string" || !value.content.trim()) {
      badRequest("memory.candidate.promote content must be a non-empty string.");
    }
    params.content = normalizeBoundedText(value.content, "content", 4000);
  }
  if (value.source !== undefined) {
    if (typeof value.source !== "string" || !value.source.trim()) {
      badRequest("memory.candidate.promote source must be a non-empty string.");
    }
    params.source = normalizeShortText(value.source, "source", 200);
  }
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) {
      badRequest("memory.candidate.promote metadata must be an object.");
    }
    params.metadata = value.metadata;
  }
  return params;
}

function parseMemoryCandidateRejectParams(value: unknown): GatewayMemoryCandidateRejectParams {
  if (!isRecord(value)) {
    badRequest("memory.candidate.reject params must be an object.");
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    badRequest("memory.candidate.reject requires params.id.");
  }
  const params: GatewayMemoryCandidateRejectParams = {
    id: normalizeShortText(value.id, "id", 200),
  };
  if (value.reason !== undefined) {
    if (typeof value.reason !== "string" || !value.reason.trim()) {
      badRequest("memory.candidate.reject reason must be a non-empty string.");
    }
    params.reason = normalizeBoundedText(value.reason, "reason", 1000);
  }
  return params;
}

// ---------------------------------------------------------------------------
// Phase 5 (FR-12/13/14, §10/§11): ontology user-control RPC params.
// Every parser requires an explicit non-empty `userId`; the gateway resolves
// it to the gateway-scoped identity and the store enforces tenant/user
// isolation on every query.
// ---------------------------------------------------------------------------

function parseOntologyUserId(value: unknown, rpcName: string): string {
  if (!isRecord(value)) {
    badRequest(`${rpcName} params must be an object.`);
  }
  if (typeof value.userId !== "string" || !value.userId.trim()) {
    badRequest(`${rpcName} requires params.userId.`);
  }
  return normalizeShortText(value.userId, "userId", 200);
}

function parseOntologyOptionalReason(value: Record<string, unknown>, rpcName: string): string | undefined {
  if (value.reason === undefined) {
    return undefined;
  }
  if (typeof value.reason !== "string" || !value.reason.trim()) {
    badRequest(`${rpcName} reason must be a non-empty string.`);
  }
  return normalizeBoundedText(value.reason, "reason", 1000);
}

function parseOntologyRequiredId(value: Record<string, unknown>, field: string, rpcName: string): string {
  if (typeof value[field] !== "string" || !(value[field] as string).trim()) {
    badRequest(`${rpcName} requires params.${field}.`);
  }
  return normalizeShortText(value[field] as string, field, 200);
}

function parseOntologyKnowledgeListParams(value: unknown): GatewayOntologyKnowledgeListParams {
  return { userId: parseOntologyUserId(value, "ontology.knowledge.list") };
}

function parseOntologyAssertionExplainParams(value: unknown): GatewayOntologyAssertionExplainParams {
  const userId = parseOntologyUserId(value, "ontology.assertion.explain");
  return { userId, assertionId: parseOntologyRequiredId(value as Record<string, unknown>, "assertionId", "ontology.assertion.explain") };
}

function parseOntologyConflictsListParams(value: unknown): GatewayOntologyConflictsListParams {
  return { userId: parseOntologyUserId(value, "ontology.conflicts.list") };
}

function parseOntologyCandidateListParams(value: unknown): GatewayOntologyCandidateListParams {
  const userId = parseOntologyUserId(value, "ontology.candidates.list");
  const record = value as Record<string, unknown>;
  const params: GatewayOntologyCandidateListParams = { userId };
  if (record.status !== undefined) {
    if (!isOntologyAssertionStatusFilter(record.status)) {
      badRequest("ontology.candidates.list status is invalid.");
    }
    params.status = record.status;
  }
  if (record.limit !== undefined) {
    if (typeof record.limit !== "number" || !Number.isFinite(record.limit)) {
      badRequest("ontology.candidates.list limit must be a number.");
    }
    params.limit = Math.min(Math.max(1, Math.floor(record.limit)), 100);
  }
  return params;
}

function parseOntologyCandidatePromoteParams(value: unknown): GatewayOntologyCandidatePromoteParams {
  const userId = parseOntologyUserId(value, "ontology.candidate.promote");
  return { userId, id: parseOntologyRequiredId(value as Record<string, unknown>, "id", "ontology.candidate.promote") };
}

function parseOntologyCandidateRejectParams(value: unknown): GatewayOntologyCandidateRejectParams {
  const userId = parseOntologyUserId(value, "ontology.candidate.reject");
  const record = value as Record<string, unknown>;
  const params: GatewayOntologyCandidateRejectParams = {
    userId,
    id: parseOntologyRequiredId(record, "id", "ontology.candidate.reject"),
  };
  const reason = parseOntologyOptionalReason(record, "ontology.candidate.reject");
  if (reason !== undefined) {
    params.reason = reason;
  }
  if (record.dontAskAgain !== undefined) {
    if (typeof record.dontAskAgain !== "boolean") {
      badRequest("ontology.candidate.reject dontAskAgain must be a boolean.");
    }
    params.dontAskAgain = record.dontAskAgain;
  }
  return params;
}

function parseOntologyAssertionCorrectParams(value: unknown): GatewayOntologyAssertionCorrectParams {
  const userId = parseOntologyUserId(value, "ontology.assertion.correct");
  const record = value as Record<string, unknown>;
  const params: GatewayOntologyAssertionCorrectParams = {
    userId,
    assertionId: parseOntologyRequiredId(record, "assertionId", "ontology.assertion.correct"),
    correction: parseOntologyCorrection(record.correction),
  };
  const reason = parseOntologyOptionalReason(record, "ontology.assertion.correct");
  if (reason !== undefined) {
    params.reason = reason;
  }
  return params;
}

function parseOntologyCorrection(value: unknown): GatewayOntologyAssertionCorrectParams["correction"] {
  if (!isRecord(value)) {
    badRequest("ontology.assertion.correct requires a correction object.");
  }
  const hasObjectEntity = value.objectEntity !== undefined;
  const hasObjectValue = value.objectValue !== undefined;
  if (hasObjectEntity === hasObjectValue) {
    badRequest("ontology.assertion.correct correction requires exactly one of objectEntity or objectValue.");
  }
  const correction: GatewayOntologyAssertionCorrectParams["correction"] = {
    excerpt: "",
  };
  if (hasObjectEntity) {
    if (!isRecord(value.objectEntity)
      || typeof value.objectEntity.type !== "string" || !value.objectEntity.type.trim()
      || typeof value.objectEntity.name !== "string" || !value.objectEntity.name.trim()) {
      badRequest("ontology.assertion.correct correction.objectEntity requires non-empty type and name.");
    }
    const objectEntity: { type: string; name: string; aliases?: string[] } = {
      type: normalizeShortText(value.objectEntity.type, "objectEntity.type", 120),
      name: normalizeShortText(value.objectEntity.name, "objectEntity.name", 240),
    };
    if (value.objectEntity.aliases !== undefined) {
      if (!Array.isArray(value.objectEntity.aliases)
        || value.objectEntity.aliases.some(alias => typeof alias !== "string" || !alias.trim())) {
        badRequest("ontology.assertion.correct correction.objectEntity.aliases must be an array of non-empty strings.");
      }
      objectEntity.aliases = value.objectEntity.aliases.map(alias => normalizeShortText(alias as string, "alias", 240));
    }
    correction.objectEntity = objectEntity;
  }
  if (hasObjectValue) {
    if (typeof value.objectValue !== "string" && typeof value.objectValue !== "number" && typeof value.objectValue !== "boolean") {
      badRequest("ontology.assertion.correct correction.objectValue must be a string, number, or boolean.");
    }
    correction.objectValue = typeof value.objectValue === "string"
      ? normalizeBoundedText(value.objectValue, "objectValue", 4000)
      : value.objectValue;
  }
  if (typeof value.excerpt !== "string" || !value.excerpt.trim()) {
    badRequest("ontology.assertion.correct correction requires a non-empty excerpt (the user's own words).");
  }
  correction.excerpt = normalizeBoundedText(value.excerpt, "excerpt", 4000);
  if (value.confidence !== undefined) {
    if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
      badRequest("ontology.assertion.correct correction.confidence must be a number between 0 and 1.");
    }
    correction.confidence = value.confidence;
  }
  return correction;
}

function parseOntologyAssertionRetractParams(value: unknown): GatewayOntologyAssertionRetractParams {
  const userId = parseOntologyUserId(value, "ontology.assertion.retract");
  const record = value as Record<string, unknown>;
  const params: GatewayOntologyAssertionRetractParams = {
    userId,
    assertionId: parseOntologyRequiredId(record, "assertionId", "ontology.assertion.retract"),
  };
  const reason = parseOntologyOptionalReason(record, "ontology.assertion.retract");
  if (reason !== undefined) {
    params.reason = reason;
  }
  return params;
}

function parseOntologyEvidenceDeleteParams(value: unknown): GatewayOntologyEvidenceDeleteParams {
  const userId = parseOntologyUserId(value, "ontology.evidence.delete");
  const record = value as Record<string, unknown>;
  const params: GatewayOntologyEvidenceDeleteParams = {
    userId,
    evidenceId: parseOntologyRequiredId(record, "evidenceId", "ontology.evidence.delete"),
  };
  const reason = parseOntologyOptionalReason(record, "ontology.evidence.delete");
  if (reason !== undefined) {
    params.reason = reason;
  }
  return params;
}

function parseOntologyEntityDeleteParams(value: unknown): GatewayOntologyEntityDeleteParams {
  const userId = parseOntologyUserId(value, "ontology.entity.delete");
  const record = value as Record<string, unknown>;
  const params: GatewayOntologyEntityDeleteParams = {
    userId,
    entityId: parseOntologyRequiredId(record, "entityId", "ontology.entity.delete"),
  };
  const reason = parseOntologyOptionalReason(record, "ontology.entity.delete");
  if (reason !== undefined) {
    params.reason = reason;
  }
  return params;
}

function parseOntologyCategoryDeleteParams(value: unknown): GatewayOntologyCategoryDeleteParams {
  const userId = parseOntologyUserId(value, "ontology.category.delete");
  const record = value as Record<string, unknown>;
  const params: GatewayOntologyCategoryDeleteParams = { userId };
  if (record.predicate !== undefined) {
    if (typeof record.predicate !== "string" || !record.predicate.trim()) {
      badRequest("ontology.category.delete predicate must be a non-empty string.");
    }
    params.predicate = normalizeShortText(record.predicate, "predicate", 120);
  }
  if (record.sourceType !== undefined) {
    if (!isOntologySourceType(record.sourceType)) {
      badRequest("ontology.category.delete sourceType is invalid.");
    }
    params.sourceType = record.sourceType;
  }
  if (record.entityType !== undefined) {
    if (typeof record.entityType !== "string" || !record.entityType.trim()) {
      badRequest("ontology.category.delete entityType must be a non-empty string.");
    }
    params.entityType = normalizeShortText(record.entityType, "entityType", 120);
  }
  const reason = parseOntologyOptionalReason(record, "ontology.category.delete");
  if (reason !== undefined) {
    params.reason = reason;
  }
  return params;
}

function parseOntologyDeleteAllParams(value: unknown): GatewayOntologyDeleteAllParams {
  const userId = parseOntologyUserId(value, "ontology.deleteAll");
  const params: GatewayOntologyDeleteAllParams = { userId };
  const reason = parseOntologyOptionalReason(value as Record<string, unknown>, "ontology.deleteAll");
  if (reason !== undefined) {
    params.reason = reason;
  }
  return params;
}

function parseOntologyEntityUnmergeParams(value: unknown): GatewayOntologyEntityUnmergeParams {
  const userId = parseOntologyUserId(value, "ontology.entity.unmerge");
  return { userId, entityId: parseOntologyRequiredId(value as Record<string, unknown>, "entityId", "ontology.entity.unmerge") };
}

function parseOntologySnapshotRegenerateParams(value: unknown): GatewayOntologySnapshotRegenerateParams {
  return { userId: parseOntologyUserId(value, "ontology.snapshot.regenerate") };
}

function parseOntologyExportParams(value: unknown): GatewayOntologyExportParams {
  const userId = parseOntologyUserId(value, "ontology.export");
  const record = value as Record<string, unknown>;
  const params: GatewayOntologyExportParams = { userId };
  if (record.includeSensitiveEvidence !== undefined) {
    if (typeof record.includeSensitiveEvidence !== "boolean") {
      badRequest("ontology.export includeSensitiveEvidence must be a boolean.");
    }
    params.includeSensitiveEvidence = record.includeSensitiveEvidence;
  }
  return params;
}

function parseOntologyImportParams(value: unknown): GatewayOntologyImportParams {
  const userId = parseOntologyUserId(value, "ontology.import");
  const record = value as Record<string, unknown>;
  if (record.payload === undefined || record.payload === null) {
    badRequest("ontology.import requires params.payload.");
  }
  return { userId, payload: record.payload };
}

// ---------------------------------------------------------------------------
// Phase 3.0: obligation（任务契约）RPC params — 先记录不裁定
// (docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md §3/§11). Deep validation (item
// coverage, evidence existence, transition guards) lives in the obligation
// service/store; this layer validates shapes only.
// ---------------------------------------------------------------------------

function parseObligationCreateParams(value: unknown): GatewayObligationCreateParams {
  const userId = parseOntologyUserId(value, "obligation.create");
  const record = value as Record<string, unknown>;
  if (typeof record.employeeId !== "string" || !record.employeeId.trim()) {
    badRequest("obligation.create requires params.employeeId.");
  }
  if (typeof record.statement !== "string" || !record.statement.trim()) {
    badRequest("obligation.create requires params.statement.");
  }
  const params: GatewayObligationCreateParams = {
    userId,
    employeeId: normalizeShortText(record.employeeId, "employeeId", 200),
    statement: normalizeBoundedText(record.statement, "statement", 4000),
    items: parseObligationCreateItems(record.items),
  };
  if (record.requesterUserId !== undefined) {
    if (typeof record.requesterUserId !== "string" || !record.requesterUserId.trim()) {
      badRequest("obligation.create requesterUserId must be a non-empty string.");
    }
    params.requesterUserId = normalizeShortText(record.requesterUserId, "requesterUserId", 200);
  }
  if (record.source !== undefined) {
    if (typeof record.source !== "string" || !record.source.trim()) {
      badRequest("obligation.create source must be a non-empty string.");
    }
    params.source = normalizeShortText(record.source, "source", 64);
  }
  if (record.budget !== undefined) {
    if (!isRecord(record.budget)) {
      badRequest("obligation.create budget must be an object.");
    }
    const budget: { maxTokens?: number; maxCostUsd?: number } = {};
    if (record.budget.maxTokens !== undefined) {
      if (typeof record.budget.maxTokens !== "number" || !Number.isFinite(record.budget.maxTokens) || record.budget.maxTokens <= 0) {
        badRequest("obligation.create budget.maxTokens must be a positive number.");
      }
      budget.maxTokens = record.budget.maxTokens;
    }
    if (record.budget.maxCostUsd !== undefined) {
      if (typeof record.budget.maxCostUsd !== "number" || !Number.isFinite(record.budget.maxCostUsd) || record.budget.maxCostUsd < 0) {
        badRequest("obligation.create budget.maxCostUsd must be a non-negative number.");
      }
      budget.maxCostUsd = record.budget.maxCostUsd;
    }
    params.budget = budget;
  }
  if (record.deadlineAt !== undefined) {
    params.deadlineAt = parseObligationIsoTimestamp(record.deadlineAt, "deadlineAt", "obligation.create");
  }
  if (record.retryBudget !== undefined) {
    if (typeof record.retryBudget !== "number" || !Number.isInteger(record.retryBudget) || record.retryBudget < 0) {
      badRequest("obligation.create retryBudget must be a non-negative integer.");
    }
    params.retryBudget = record.retryBudget;
  }
  if (record.dispatch !== undefined) {
    if (!isRecord(record.dispatch)) {
      badRequest("obligation.create dispatch must be an object.");
    }
    const dispatch: { instanceId?: string; runId?: string; idempotencyKey?: string } = {};
    if (record.dispatch.instanceId !== undefined) {
      if (typeof record.dispatch.instanceId !== "string" || !record.dispatch.instanceId.trim()) {
        badRequest("obligation.create dispatch.instanceId must be a non-empty string.");
      }
      dispatch.instanceId = normalizeShortText(record.dispatch.instanceId, "dispatch.instanceId", 200);
    }
    if (record.dispatch.runId !== undefined) {
      if (typeof record.dispatch.runId !== "string" || !record.dispatch.runId.trim()) {
        badRequest("obligation.create dispatch.runId must be a non-empty string.");
      }
      dispatch.runId = normalizeShortText(record.dispatch.runId, "dispatch.runId", 200);
    }
    if (record.dispatch.idempotencyKey !== undefined) {
      if (typeof record.dispatch.idempotencyKey !== "string" || !record.dispatch.idempotencyKey.trim()) {
        badRequest("obligation.create dispatch.idempotencyKey must be a non-empty string.");
      }
      dispatch.idempotencyKey = normalizeShortText(record.dispatch.idempotencyKey, "dispatch.idempotencyKey", 200);
    }
    params.dispatch = dispatch;
  }
  return params;
}

function parseObligationCreateItems(value: unknown): GatewayObligationCreateParams["items"] {
  if (!Array.isArray(value) || value.length === 0) {
    badRequest("obligation.create requires a non-empty params.items array.");
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      badRequest(`obligation.create items[${index}] must be an object.`);
    }
    if (typeof entry.acceptance !== "string" || !entry.acceptance.trim()) {
      badRequest(`obligation.create items[${index}].acceptance is required.`);
    }
    if (!isObligationValidatorKindValue(entry.validator)) {
      badRequest(`obligation.create items[${index}].validator is invalid.`);
    }
    const item: GatewayObligationCreateParams["items"][number] = {
      acceptance: normalizeBoundedText(entry.acceptance, `items[${index}].acceptance`, 2000),
      validator: entry.validator,
    };
    if (entry.seq !== undefined) {
      if (typeof entry.seq !== "number" || !Number.isInteger(entry.seq) || entry.seq < 1) {
        badRequest(`obligation.create items[${index}].seq must be a positive integer.`);
      }
      item.seq = entry.seq;
    }
    if (entry.validatorConfig !== undefined) {
      if (!isRecord(entry.validatorConfig)) {
        badRequest(`obligation.create items[${index}].validatorConfig must be an object.`);
      }
      item.validatorConfig = entry.validatorConfig;
    }
    if (entry.required !== undefined) {
      if (typeof entry.required !== "boolean") {
        badRequest(`obligation.create items[${index}].required must be a boolean.`);
      }
      item.required = entry.required;
    }
    if (entry.deadlineAt !== undefined) {
      item.deadlineAt = parseObligationIsoTimestamp(entry.deadlineAt, `items[${index}].deadlineAt`, "obligation.create");
    }
    return item;
  });
}

function parseObligationListParams(value: unknown): GatewayObligationListParams {
  const userId = parseOntologyUserId(value, "obligation.list");
  const record = value as Record<string, unknown>;
  const params: GatewayObligationListParams = { userId };
  if (record.status !== undefined) {
    if (!isObligationStatusValue(record.status)) {
      badRequest("obligation.list status is invalid.");
    }
    params.status = record.status;
  }
  if (record.limit !== undefined) {
    params.limit = parseObligationLimit(record.limit, "obligation.list");
  }
  return params;
}

function parseObligationGetParams(value: unknown): GatewayObligationGetParams {
  const userId = parseOntologyUserId(value, "obligation.get");
  return { userId, id: parseOntologyRequiredId(value as Record<string, unknown>, "id", "obligation.get") };
}

function parseObligationAttachEvidenceParams(value: unknown): GatewayObligationAttachEvidenceParams {
  const userId = parseOntologyUserId(value, "obligation.attachEvidence");
  const record = value as Record<string, unknown>;
  const params: GatewayObligationAttachEvidenceParams = {
    userId,
    obligationId: parseOntologyRequiredId(record, "obligationId", "obligation.attachEvidence"),
    ref: parseObligationEvidenceRef(record.ref),
  };
  if (record.itemId !== undefined) {
    params.itemId = parseOntologyRequiredId(record, "itemId", "obligation.attachEvidence");
  }
  return params;
}

function parseObligationOverdueListParams(value: unknown): GatewayObligationOverdueListParams {
  const userId = parseOntologyUserId(value, "obligation.overdue.list");
  const record = value as Record<string, unknown>;
  const params: GatewayObligationOverdueListParams = { userId };
  if (record.kind !== undefined) {
    if (!isObligationDanglingKindValue(record.kind)) {
      badRequest("obligation.overdue.list kind is invalid.");
    }
    params.kind = record.kind;
  }
  if (record.now !== undefined) {
    params.now = parseObligationIsoTimestamp(record.now, "now", "obligation.overdue.list");
  }
  if (record.olderThan !== undefined) {
    params.olderThan = parseObligationIsoTimestamp(record.olderThan, "olderThan", "obligation.overdue.list");
  }
  if (record.limit !== undefined) {
    params.limit = parseObligationLimit(record.limit, "obligation.overdue.list");
  }
  return params;
}

// Phase 3.1: 三态裁定 RPC parsers — verdict 语义/聚合在 obligation service。
function parseObligationValidateParams(value: unknown): GatewayObligationValidateParams {
  const userId = parseOntologyUserId(value, "obligation.validate");
  return {
    userId,
    obligationId: parseOntologyRequiredId(value as Record<string, unknown>, "obligationId", "obligation.validate"),
  };
}

function parseObligationHumanVerdictParams(value: unknown): GatewayObligationHumanVerdictParams {
  const userId = parseOntologyUserId(value, "obligation.verdict.human");
  const record = value as Record<string, unknown>;
  if (!isObligationVerdictValue(record.verdict)) {
    badRequest("obligation.verdict.human verdict is invalid.");
  }
  const params: GatewayObligationHumanVerdictParams = {
    userId,
    obligationId: parseOntologyRequiredId(record, "obligationId", "obligation.verdict.human"),
    itemId: parseOntologyRequiredId(record, "itemId", "obligation.verdict.human"),
    verdict: record.verdict,
  };
  if (record.reason !== undefined) {
    if (typeof record.reason !== "string" || !record.reason.trim()) {
      badRequest("obligation.verdict.human reason must be a non-empty string.");
    }
    params.reason = normalizeShortText(record.reason, "reason", 2000);
  }
  return params;
}

function parseObligationRetryParams(value: unknown): GatewayObligationRetryParams {
  const userId = parseOntologyUserId(value, "obligation.retry");
  return {
    userId,
    obligationId: parseOntologyRequiredId(value as Record<string, unknown>, "obligationId", "obligation.retry"),
  };
}

function parseObligationExplainParams(value: unknown): GatewayObligationExplainParams {
  const userId = parseOntologyUserId(value, "obligation.explain");
  return {
    userId,
    obligationId: parseOntologyRequiredId(value as Record<string, unknown>, "obligationId", "obligation.explain"),
  };
}

function isObligationVerdictValue(value: unknown): value is "pass" | "recoverable_block" | "hard_block" {
  return ["pass", "recoverable_block", "hard_block"].includes(String(value));
}

function parseObligationEvidenceRef(value: unknown): GatewayObligationEvidenceRef {
  if (!isRecord(value) || typeof value.kind !== "string") {
    badRequest("obligation.attachEvidence requires a ref object with a kind.");
  }
  switch (value.kind) {
    case "wf_event": {
      if (typeof value.instanceId !== "string" || !value.instanceId.trim()) {
        badRequest("obligation.attachEvidence wf_event ref requires instanceId.");
      }
      if (typeof value.seq !== "number" || !Number.isInteger(value.seq) || value.seq < 0) {
        badRequest("obligation.attachEvidence wf_event ref seq must be a non-negative integer.");
      }
      return { kind: "wf_event", instanceId: normalizeShortText(value.instanceId, "ref.instanceId", 200), seq: value.seq };
    }
    case "ontology_evidence":
      return {
        kind: "ontology_evidence",
        tenantId: parseOntologyRequiredId(value, "tenantId", "obligation.attachEvidence"),
        userId: parseOntologyRequiredId(value, "userId", "obligation.attachEvidence"),
        evidenceId: parseOntologyRequiredId(value, "evidenceId", "obligation.attachEvidence"),
      };
    case "ontology_episode":
      return {
        kind: "ontology_episode",
        tenantId: parseOntologyRequiredId(value, "tenantId", "obligation.attachEvidence"),
        userId: parseOntologyRequiredId(value, "userId", "obligation.attachEvidence"),
        episodeId: parseOntologyRequiredId(value, "episodeId", "obligation.attachEvidence"),
      };
    case "step_result":
      return {
        kind: "step_result",
        idempotencyKey: parseOntologyRequiredId(value, "idempotencyKey", "obligation.attachEvidence"),
      };
    default:
      badRequest("obligation.attachEvidence ref.kind is invalid.");
  }
}

function parseObligationIsoTimestamp(value: unknown, field: string, rpcName: string): string {
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) {
    badRequest(`${rpcName} ${field} must be an ISO timestamp.`);
  }
  return value.trim();
}

function parseObligationLimit(value: unknown, rpcName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    badRequest(`${rpcName} limit must be a positive integer.`);
  }
  return value;
}

function isObligationStatusValue(value: unknown): value is GatewayObligationStatus {
  return [
    "pending",
    "dispatched",
    "evidence_collecting",
    "validating",
    "fulfilled",
    "blocked_recoverable",
    "blocked_hard",
    "expired",
  ].includes(String(value));
}

function isObligationValidatorKindValue(value: unknown): value is GatewayObligationValidatorKind {
  return ["schema", "tool_assertion", "test_command", "human_confirm", "model_review"].includes(String(value));
}

function isObligationDanglingKindValue(value: unknown): value is NonNullable<GatewayObligationOverdueListParams["kind"]> {
  return ["untouched", "silent", "unvalidated"].includes(String(value));
}

function isOntologyAssertionStatusFilter(value: unknown): value is NonNullable<GatewayOntologyCandidateListParams["status"]> {
  return ["candidate", "active", "disputed", "superseded", "retracted", "all"].includes(String(value));
}

function isOntologySourceType(value: unknown): value is NonNullable<GatewayOntologyCategoryDeleteParams["sourceType"]> {
  return ["explicit", "observed", "inferred", "imported"].includes(String(value));
}

function parseTrajectoryListParams(value: unknown): GatewayTrajectoryListParams {
  if (!isRecord(value)) {
    badRequest("trajectory.list params must be an object.");
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    badRequest("trajectory.list requires params.sessionId.");
  }
  const params: GatewayTrajectoryListParams = {
    sessionId: normalizeShortText(value.sessionId, "sessionId", 200),
  };
  if (value.status !== undefined) {
    if (!isTurnStatus(value.status)) {
      badRequest("trajectory.list status is invalid.");
    }
    params.status = value.status;
  }
  if (value.dateFrom !== undefined) {
    if (typeof value.dateFrom !== "string" || !value.dateFrom.trim()) {
      badRequest("trajectory.list dateFrom must use YYYY-MM-DD.");
    }
    params.dateFrom = normalizeDate(value.dateFrom, "dateFrom");
  }
  if (value.dateTo !== undefined) {
    if (typeof value.dateTo !== "string" || !value.dateTo.trim()) {
      badRequest("trajectory.list dateTo must use YYYY-MM-DD.");
    }
    params.dateTo = normalizeDate(value.dateTo, "dateTo");
  }
  if (params.dateFrom !== undefined && params.dateTo !== undefined && params.dateFrom > params.dateTo) {
    badRequest("trajectory.list dateFrom must be before or equal to dateTo.");
  }
  if (value.limit !== undefined) {
    if (typeof value.limit !== "number" || !Number.isFinite(value.limit)) {
      badRequest("trajectory.list limit must be a number.");
    }
    params.limit = Math.min(Math.max(1, Math.floor(value.limit)), 100);
  }
  return params;
}

function parseTrajectoryGetParams(value: unknown): GatewayTrajectoryGetParams {
  if (!isRecord(value)) {
    badRequest("trajectory.get params must be an object.");
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    badRequest("trajectory.get requires params.sessionId.");
  }
  if (typeof value.runId !== "string" || !value.runId.trim()) {
    badRequest("trajectory.get requires params.runId.");
  }
  const params: GatewayTrajectoryGetParams = {
    sessionId: normalizeShortText(value.sessionId, "sessionId", 200),
    runId: normalizeShortText(value.runId, "runId", 200),
  };
  if (value.maxEvents !== undefined) {
    if (typeof value.maxEvents !== "number" || !Number.isFinite(value.maxEvents)) {
      badRequest("trajectory.get maxEvents must be a number.");
    }
    params.maxEvents = Math.min(Math.max(1, Math.floor(value.maxEvents)), 1000);
  }
  return params;
}

function parseCronJobUpsertParams(value: unknown): GatewayCronJobUpsertParams {
  if (!isRecord(value)) {
    badRequest("cron.job.upsert params must be an object.");
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    badRequest("cron.job.upsert requires params.id.");
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    badRequest("cron.job.upsert requires params.sessionId.");
  }
  if (typeof value.message !== "string" || !value.message.trim()) {
    badRequest("cron.job.upsert requires params.message.");
  }
  if (typeof value.schedule !== "string" || !value.schedule.trim()) {
    badRequest("cron.job.upsert requires params.schedule.");
  }
  const schedule = normalizeShortText(value.schedule, "schedule", 200);
  try {
    parseCronSchedule(schedule);
  } catch (error) {
    badRequest(`cron.job.upsert schedule is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const params: GatewayCronJobUpsertParams = {
    id: normalizeShortText(value.id, "id", 200),
    sessionId: normalizeShortText(value.sessionId, "sessionId", 200),
    message: normalizeBoundedText(value.message, "message", 16_000),
    schedule,
  };
  if (typeof value.enabled === "boolean") {
    params.enabled = value.enabled;
  }
  if (typeof value.workspace === "string" && value.workspace.trim()) {
    params.workspace = normalizeShortText(value.workspace, "workspace", 4000);
  }
  if (typeof value.model === "string" && value.model.trim()) {
    params.model = normalizeShortText(value.model, "model", 200);
  }
  if (typeof value.nextRunAt === "string" && value.nextRunAt.trim()) {
    params.nextRunAt = normalizeIsoTimestamp(value.nextRunAt, "nextRunAt");
  }
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) {
      badRequest("cron.job.upsert metadata must be an object.");
    }
    params.metadata = value.metadata;
  }
  return params;
}

function parseCronJobRemoveParams(value: unknown): GatewayCronJobRemoveParams {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    badRequest("cron.job.remove requires params.id.");
  }
  return { id: normalizeShortText(value.id, "id", 200) };
}

function isMemoryCandidateStatusFilter(value: unknown): value is NonNullable<GatewayMemoryCandidateListParams["status"]> {
  return ["pending", "promoted", "rejected", "all"].includes(String(value));
}

function isMemoryScope(value: unknown): value is NonNullable<GatewayMemoryCandidatePromoteParams["scope"]> {
  return ["user", "project", "session", "skill"].includes(String(value));
}

function isGatewayModelProviderType(value: unknown): value is GatewayModelProviderType {
  return value === "openai-compatible" || value === "anthropic";
}

function normalizeDate(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    badRequest(`${fieldName} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    badRequest(`${fieldName} must use YYYY-MM-DD.`);
  }
  return trimmed;
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const trimmed = value.trim();
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    badRequest(`${fieldName} must be a valid ISO timestamp.`);
  }
  return parsed.toISOString();
}

function isTurnStatus(value: unknown): value is LoongTurnResult["status"] {
  return ["ok", "error", "cancelled", "timeout"].includes(String(value));
}
