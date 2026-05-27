import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const indexPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "index.ts");
const lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/);
const handleRpcLine = lines.findIndex(l => l.includes("async #handleRpc"));
const runLaneLine = lines.findIndex(l => l.includes("async #runInLane<"));
if (handleRpcLine < 0 || runLaneLine < 0 || runLaneLine <= handleRpcLine) {
  throw new Error(`bad range ${handleRpcLine} ${runLaneLine}`);
}

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
  }`.split("\n");

const newLines = [...lines.slice(0, handleRpcLine), ...replacement, ...lines.slice(runLaneLine)];
fs.writeFileSync(indexPath, `${newLines.join("\n")}\n`);
console.log("gateway index lines:", newLines.length, "removed:", runLaneLine - handleRpcLine);
