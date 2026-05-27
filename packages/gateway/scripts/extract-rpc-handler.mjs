import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const indexPath = path.join(srcDir, "index.ts");
const lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/);

const start = lines.findIndex(l => l.trim() === "try {" && lines[lines.findIndex(x => x.includes("async #handleRpc")) + 1]?.includes("try"));
const handleRpcLine = lines.findIndex(l => l.includes("async #handleRpc"));
const tryStart = handleRpcLine + 1;
const catchLine = lines.findIndex((l, i) => i > handleRpcLine && l.trim().startsWith("} catch (error)"));
const end = catchLine + 6; // through closing brace of method

let body = lines.slice(tryStart + 1, catchLine).join("\n");
body = body.replace(/this\.#(\w+)/g, "deps.$1");

// capabilities block: replace dynamic spread with deps.capabilities
const capStart = body.indexOf("capabilities: [");
const capEnd = body.indexOf("],", capStart) + 2;
if (capStart >= 0 && capEnd > capStart) {
  body = `${body.slice(0, capStart)}capabilities: [...deps.capabilities]${body.slice(capEnd)}`;
}

const header = `import type { GatewayRequest, GatewayResponse } from "./gateway-rpc-types.js";
import type { GatewayRunRecord } from "./index.js";

export interface GatewayRpcHandlerDeps {
  capabilities: readonly string[];
  healthPayload(): Record<string, unknown>;
  getRunStatus(runId: string): GatewayRunRecord;
  cancelRun(runId: string, reason: string | undefined): { cancelled: boolean; run: GatewayRunRecord };
  listRuns(params: { sessionId?: string; limit?: number } | undefined): { runs: GatewayRunRecord[] };
  listProviders(): { providers: readonly import("./index.js").GatewayProviderSummary[] };
  loadModelConfig(): Promise<import("./index.js").GatewayModelConfig>;
  saveModelConfig(params: import("./gateway-rpc-params.js").GatewayModelConfigSaveParams): Promise<unknown>;
  loadAgentConfig(): Promise<import("./index.js").GatewayAgentConfig>;
  saveAgentConfig(params: import("./gateway-agent-types.js").GatewayAgentConfigSaveParams): Promise<unknown>;
  loadOrg(): Promise<unknown>;
  loadEmployees(): Promise<unknown>;
  saveEmployees(params: import("./gateway-rpc-params.js").GatewayEmployeeSaveParams): Promise<unknown>;
  loadToolPolicies(): Promise<unknown>;
  saveToolPolicies(params: import("./gateway-rpc-params.js").GatewayToolPolicySaveParams): Promise<unknown>;
  listApprovals(params: import("./gateway-rpc-params.js").GatewayApprovalListParams | undefined): Promise<unknown>;
  approveRequest(params: import("./gateway-rpc-params.js").GatewayApprovalResolveParams): Promise<unknown>;
  rejectRequest(params: import("./gateway-rpc-params.js").GatewayApprovalResolveParams): Promise<unknown>;
  loadTickets(): Promise<unknown>;
  upsertTicket(params: import("./gateway-rpc-params.js").GatewayTicketUpsertParams): Promise<unknown>;
  loadKpiTemplates(): Promise<unknown>;
  loadKpiSnapshot(params: import("./gateway-rpc-params.js").GatewayKpiSnapshotGetParams): Promise<unknown>;
  loadTierConfig(): Promise<import("./index.js").GatewayTierConfig>;
  saveTierConfig(params: import("./gateway-rpc-params.js").GatewayTierConfigSaveParams): Promise<unknown>;
  classifyTier(params: import("./gateway-rpc-params.js").GatewayTierClassifyParams): Promise<unknown>;
  listPlugins(): { plugins: readonly import("./index.js").GatewayPluginSummary[] };
  listMcpServers(): Promise<unknown>;
  createPairingToken(params: import("./gateway-rpc-params.js").GatewayPairingTokenCreateParams | undefined): Promise<unknown>;
  listPairedDevices(): Promise<unknown>;
  registerPairedDevice(token: string): Promise<unknown>;
  revokePairedDevice(deviceId: string): Promise<unknown>;
  listTools(params: import("./gateway-rpc-params.js").GatewayToolsCatalogParams | undefined): { tools: readonly import("./index.js").GatewayToolSummary[] };
  invokeTool(params: import("./gateway-rpc-params.js").GatewayToolInvokeParams): Promise<unknown>;
  listMemoryCandidates(params: import("./gateway-rpc-params.js").GatewayMemoryCandidatesListParams | undefined): Promise<unknown>;
  promoteMemoryCandidate(params: import("./gateway-rpc-params.js").GatewayMemoryCandidatePromoteParams): Promise<unknown>;
  rejectMemoryCandidate(params: import("./gateway-rpc-params.js").GatewayMemoryCandidateRejectParams): Promise<unknown>;
  listTrajectories(params: import("./gateway-rpc-params.js").GatewayTrajectoryListParams): Promise<unknown>;
  getTrajectory(params: import("./gateway-rpc-params.js").GatewayTrajectoryGetParams): Promise<unknown>;
  listCronJobs(): Promise<{ jobs: unknown[] }>;
  upsertCronJob(params: import("./gateway-rpc-params.js").GatewayCronJobUpsertParams): Promise<{ job: unknown }>;
  removeCronJob(params: import("./gateway-rpc-params.js").GatewayCronJobRemoveParams): Promise<{ removed: boolean }>;
  tickCron(): Promise<unknown>;
  waitForQueuedTurn(queueTurnId: string): Promise<unknown>;
  runAgent(params: import("./gateway-agent-types.js").GatewayAgentParams): Promise<unknown>;
}

export async function handleGatewayRpc(
  deps: GatewayRpcHandlerDeps,
  request: GatewayRequest,
): Promise<GatewayResponse> {
  try {
`;

const footer = `
  } catch (error) {
    return {
      type: "response",
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
`;

fs.writeFileSync(path.join(srcDir, "gateway-rpc-handler.ts"), `${header}${body}${footer}`);

// Replace handleRpc in index
const methodStart = handleRpcLine;
const methodEnd = end;
const replacement = `  #rpcCapabilities(): readonly string[] {
    return [
      "health",
      "connect",
      "agent.run",
      "agent.wait",
      "events.in-response",
      "events.sse",
      "events.websocket",
      "channels.webhook",
      "run.status",
      "run.cancel",
      "runs.list",
      "providers.list",
      ...(this.#modelConfigStore ? ["model.config.get", "model.config.save"] : []),
      ...(this.#agentConfigStore ? ["agent.config.get", "agent.config.save"] : []),
      ...(this.#orgStore ? ["org.get"] : []),
      ...(this.#employeeStore ? ["employee.list", "employee.save"] : []),
      ...(this.#toolPolicyStore ? ["policy.tool.get", "policy.tool.save"] : []),
      ...(this.#approvalService ? ["approval.list", "approval.approve", "approval.reject"] : []),
      ...(this.#ticketStore ? ["ticket.list", "ticket.upsert"] : []),
      ...(this.#kpiTemplateStore ? ["kpi.template.list", "kpi.snapshot.get"] : []),
      ...(this.#tierConfigStore ? ["tier.config.get", "tier.config.save", "tier.classify"] : []),
      "plugins.list",
      "mcp.servers.list",
      "pairing.token.create",
      "pairing.devices.list",
      "pairing.device.register",
      "pairing.device.revoke",
      "tools.catalog",
      "tool.invoke",
      ...(this.#toolRegistry.has("memory_candidates_list") ? ["memory.candidates.list"] : []),
      ...(this.#toolRegistry.has("memory_candidate_promote") ? ["memory.candidate.promote"] : []),
      ...(this.#toolRegistry.has("memory_candidate_reject") ? ["memory.candidate.reject"] : []),
      ...(this.#trajectoryStore ? ["trajectory.list", "trajectory.get"] : []),
      ...(this.#cronStore ? ["cron.jobs.list", "cron.job.upsert", "cron.job.remove"] : []),
      ...(this.#cronRunner ? ["cron.tick"] : []),
    ];
  }

  #rpcDeps(): import("./gateway-rpc-handler.js").GatewayRpcHandlerDeps {
    return {
      capabilities: this.#rpcCapabilities(),
      healthPayload: () => this.#healthPayload(),
      getRunStatus: runId => this.#getRunStatus(runId),
      cancelRun: (runId, reason) => this.#cancelRun(runId, reason),
      listRuns: params => this.#listRuns(params),
      listProviders: () => this.#listProviders(),
      loadModelConfig: () => this.#loadModelConfig(),
      saveModelConfig: params => this.#saveModelConfig(params),
      loadAgentConfig: () => this.#loadAgentConfig(),
      saveAgentConfig: params => this.#saveAgentConfig(params),
      loadOrg: () => this.#loadOrg(),
      loadEmployees: () => this.#loadEmployees(),
      saveEmployees: params => this.#saveEmployees(params),
      loadToolPolicies: () => this.#loadToolPolicies(),
      saveToolPolicies: params => this.#saveToolPolicies(params),
      listApprovals: params => this.#listApprovals(params),
      approveRequest: params => this.#approveRequest(params),
      rejectRequest: params => this.#rejectRequest(params),
      loadTickets: () => this.#loadTickets(),
      upsertTicket: params => this.#upsertTicket(params),
      loadKpiTemplates: () => this.#loadKpiTemplates(),
      loadKpiSnapshot: params => this.#loadKpiSnapshot(params),
      loadTierConfig: () => this.#loadTierConfig(),
      saveTierConfig: params => this.#saveTierConfig(params),
      classifyTier: params => this.#classifyTier(params),
      listPlugins: () => this.#listPlugins(),
      listMcpServers: () => this.#listMcpServers(),
      createPairingToken: params => this.#createPairingToken(params),
      listPairedDevices: () => this.#listPairedDevices(),
      registerPairedDevice: token => this.#registerPairedDevice(token),
      revokePairedDevice: deviceId => this.#revokePairedDevice(deviceId),
      listTools: params => this.#listTools(params),
      invokeTool: params => this.#invokeTool(params),
      listMemoryCandidates: params => this.#listMemoryCandidates(params),
      promoteMemoryCandidate: params => this.#promoteMemoryCandidate(params),
      rejectMemoryCandidate: params => this.#rejectMemoryCandidate(params),
      listTrajectories: params => this.#listTrajectories(params),
      getTrajectory: params => this.#getTrajectory(params),
      listCronJobs: () => this.#listCronJobs(),
      upsertCronJob: params => this.#upsertCronJob(params),
      removeCronJob: params => this.#removeCronJob(params),
      tickCron: () => this.#tickCron(),
      waitForQueuedTurn: queueTurnId => this.#sessionCoordinator.waitForQueuedTurn(queueTurnId),
      runAgent: params => this.#runAgent(params),
    };
  }

  async #handleRpc(request: GatewayRequest): Promise<GatewayResponse> {
    return handleGatewayRpc(this.#rpcDeps(), request);
  }
`;

let newLines = [...lines];
newLines.splice(methodStart, methodEnd - methodStart, ...replacement.split("\n"));

const importLine = newLines.findIndex(l => l.includes('from "./gateway-http-handler.js"'));
newLines.splice(importLine + 1, 0, 'import { handleGatewayRpc } from "./gateway-rpc-handler.js";');

fs.writeFileSync(indexPath, `${newLines.join("\n")}\n`);
console.log("gateway index lines:", newLines.length);
