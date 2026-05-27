import type { GatewayAgentParams } from "./gateway-agent-types.js";
import type { GatewayRequest, GatewayResponse } from "./gateway-rpc-types.js";

export interface GatewayRpcHandlerDeps {
  capabilities: readonly string[];
  healthPayload(): Record<string, unknown>;
  getRunStatus(runId: string): unknown;
  cancelRun(runId: string, reason: string | undefined): unknown;
  listRuns(params: { sessionId?: string; limit?: number } | undefined): unknown;
  listProviders(): unknown;
  loadModelConfig(): Promise<unknown>;
  saveModelConfig(params: unknown): Promise<unknown>;
  loadAgentConfig(): Promise<unknown>;
  saveAgentConfig(params: unknown): Promise<unknown>;
  loadOrg(): Promise<unknown>;
  loadEmployees(): Promise<unknown>;
  saveEmployees(params: unknown): Promise<unknown>;
  loadToolPolicies(): Promise<unknown>;
  saveToolPolicies(params: unknown): Promise<unknown>;
  listApprovals(params: unknown): Promise<unknown>;
  approveRequest(params: unknown): Promise<unknown>;
  rejectRequest(params: unknown): Promise<unknown>;
  loadTickets(): Promise<unknown>;
  upsertTicket(params: unknown): Promise<unknown>;
  loadKpiTemplates(): Promise<unknown>;
  loadKpiSnapshot(params: unknown): Promise<unknown>;
  loadTierConfig(): Promise<unknown>;
  saveTierConfig(params: unknown): Promise<unknown>;
  classifyTier(params: unknown): Promise<unknown>;
  listPlugins(): unknown;
  listMcpServers(): Promise<unknown>;
  createPairingToken(params: unknown): Promise<unknown>;
  listPairedDevices(): Promise<unknown>;
  registerPairedDevice(token: string): Promise<unknown>;
  revokePairedDevice(deviceId: string): Promise<unknown>;
  listTools(params: unknown): unknown;
  invokeTool(params: unknown): Promise<unknown>;
  listMemoryCandidates(params: unknown): Promise<unknown>;
  promoteMemoryCandidate(params: unknown): Promise<unknown>;
  rejectMemoryCandidate(params: unknown): Promise<unknown>;
  listTrajectories(params: unknown): Promise<unknown>;
  getTrajectory(params: unknown): Promise<unknown>;
  listCronJobs(): Promise<unknown>;
  upsertCronJob(params: unknown): Promise<unknown>;
  removeCronJob(params: unknown): Promise<unknown>;
  tickCron(): Promise<unknown>;
  waitForQueuedTurn(queueTurnId: string): Promise<unknown>;
  runAgent(params: GatewayAgentParams): Promise<unknown>;
}

export async function handleGatewayRpc(
  deps: GatewayRpcHandlerDeps,
  request: GatewayRequest,
): Promise<GatewayResponse> {
  try {
      if (request.type === "health") {
        return { type: "response", id: request.id, ok: true, payload: deps.healthPayload() };
      }
      if (request.type === "connect") {
        return {
          type: "response",
          id: request.id,
          ok: true,
          payload: {
            protocolVersion: 1,
            serverTime: new Date().toISOString(),
            capabilities: [...deps.capabilities]
          },
        };
      }
      if (request.type === "run.status") {
        return { type: "response", id: request.id, ok: true, payload: deps.getRunStatus(request.params.runId) };
      }
      if (request.type === "run.cancel") {
        return { type: "response", id: request.id, ok: true, payload: deps.cancelRun(request.params.runId, request.params.reason) };
      }
      if (request.type === "runs.list") {
        return { type: "response", id: request.id, ok: true, payload: deps.listRuns(request.params) };
      }
      if (request.type === "providers.list") {
        return { type: "response", id: request.id, ok: true, payload: deps.listProviders() };
      }
      if (request.type === "model.config.get") {
        return { type: "response", id: request.id, ok: true, payload: await deps.loadModelConfig() };
      }
      if (request.type === "model.config.save") {
        return { type: "response", id: request.id, ok: true, payload: await deps.saveModelConfig(request.params) };
      }
      if (request.type === "agent.config.get") {
        return { type: "response", id: request.id, ok: true, payload: await deps.loadAgentConfig() };
      }
      if (request.type === "agent.config.save") {
        return { type: "response", id: request.id, ok: true, payload: await deps.saveAgentConfig(request.params) };
      }
      if (request.type === "org.get") {
        return { type: "response", id: request.id, ok: true, payload: await deps.loadOrg() };
      }
      if (request.type === "employee.list") {
        return { type: "response", id: request.id, ok: true, payload: await deps.loadEmployees() };
      }
      if (request.type === "employee.save") {
        return { type: "response", id: request.id, ok: true, payload: await deps.saveEmployees(request.params) };
      }
      if (request.type === "policy.tool.get") {
        return { type: "response", id: request.id, ok: true, payload: await deps.loadToolPolicies() };
      }
      if (request.type === "policy.tool.save") {
        return { type: "response", id: request.id, ok: true, payload: await deps.saveToolPolicies(request.params) };
      }
      if (request.type === "approval.list") {
        return { type: "response", id: request.id, ok: true, payload: await deps.listApprovals(request.params) };
      }
      if (request.type === "approval.approve") {
        return { type: "response", id: request.id, ok: true, payload: await deps.approveRequest(request.params) };
      }
      if (request.type === "approval.reject") {
        return { type: "response", id: request.id, ok: true, payload: await deps.rejectRequest(request.params) };
      }
      if (request.type === "ticket.list") {
        return { type: "response", id: request.id, ok: true, payload: await deps.loadTickets() };
      }
      if (request.type === "ticket.upsert") {
        return { type: "response", id: request.id, ok: true, payload: await deps.upsertTicket(request.params) };
      }
      if (request.type === "kpi.template.list") {
        return { type: "response", id: request.id, ok: true, payload: await deps.loadKpiTemplates() };
      }
      if (request.type === "kpi.snapshot.get") {
        return { type: "response", id: request.id, ok: true, payload: await deps.loadKpiSnapshot(request.params) };
      }
      if (request.type === "tier.config.get") {
        return { type: "response", id: request.id, ok: true, payload: await deps.loadTierConfig() };
      }
      if (request.type === "tier.config.save") {
        return { type: "response", id: request.id, ok: true, payload: await deps.saveTierConfig(request.params) };
      }
      if (request.type === "tier.classify") {
        return { type: "response", id: request.id, ok: true, payload: await deps.classifyTier(request.params) };
      }
      if (request.type === "plugins.list") {
        return { type: "response", id: request.id, ok: true, payload: deps.listPlugins() };
      }
      if (request.type === "mcp.servers.list") {
        return { type: "response", id: request.id, ok: true, payload: await deps.listMcpServers() };
      }
      if (request.type === "pairing.token.create") {
        return { type: "response", id: request.id, ok: true, payload: await deps.createPairingToken(request.params) };
      }
      if (request.type === "pairing.devices.list") {
        return { type: "response", id: request.id, ok: true, payload: await deps.listPairedDevices() };
      }
      if (request.type === "pairing.device.register") {
        return { type: "response", id: request.id, ok: true, payload: await deps.registerPairedDevice(request.params.token) };
      }
      if (request.type === "pairing.device.revoke") {
        return { type: "response", id: request.id, ok: true, payload: await deps.revokePairedDevice(request.params.deviceId) };
      }
      if (request.type === "tools.catalog") {
        return { type: "response", id: request.id, ok: true, payload: deps.listTools(request.params) };
      }
      if (request.type === "tool.invoke") {
        return { type: "response", id: request.id, ok: true, payload: await deps.invokeTool(request.params) };
      }
      if (request.type === "memory.candidates.list") {
        return { type: "response", id: request.id, ok: true, payload: await deps.listMemoryCandidates(request.params) };
      }
      if (request.type === "memory.candidate.promote") {
        return { type: "response", id: request.id, ok: true, payload: await deps.promoteMemoryCandidate(request.params) };
      }
      if (request.type === "memory.candidate.reject") {
        return { type: "response", id: request.id, ok: true, payload: await deps.rejectMemoryCandidate(request.params) };
      }
      if (request.type === "trajectory.list") {
        return { type: "response", id: request.id, ok: true, payload: await deps.listTrajectories(request.params) };
      }
      if (request.type === "trajectory.get") {
        return { type: "response", id: request.id, ok: true, payload: await deps.getTrajectory(request.params) };
      }
      if (request.type === "cron.jobs.list") {
        return { type: "response", id: request.id, ok: true, payload: await deps.listCronJobs() };
      }
      if (request.type === "cron.job.upsert") {
        return { type: "response", id: request.id, ok: true, payload: await deps.upsertCronJob(request.params) };
      }
      if (request.type === "cron.job.remove") {
        return { type: "response", id: request.id, ok: true, payload: await deps.removeCronJob(request.params) };
      }
      if (request.type === "cron.tick") {
        return { type: "response", id: request.id, ok: true, payload: await deps.tickCron() };
      }
      if (request.type === "agent.wait") {
        const payload = await deps.waitForQueuedTurn(request.params.queueTurnId);
        return { type: "response", id: request.id, ok: true, payload };
      }
      const payload = await deps.runAgent(request.params);
      return { type: "response", id: request.id, ok: true, payload };
  } catch (error) {
    return {
      type: "response",
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
