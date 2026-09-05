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
  loadEmployeeWorkspace(params: unknown): Promise<unknown>;
  saveEmployeeWorkspace(params: unknown): Promise<unknown>;
  listSkills(): Promise<unknown>;
  bootstrapOrgExample(): Promise<unknown>;
  loadToolPolicies(): Promise<unknown>;
  saveToolPolicies(params: unknown): Promise<unknown>;
  listApprovals(params: unknown): Promise<unknown>;
  approveRequest(params: unknown): Promise<unknown>;
  rejectRequest(params: unknown): Promise<unknown>;
  dismissRequest(params: unknown): Promise<unknown>;
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
  installSuite?(params: unknown): Promise<unknown>;
  installSuiteRelease?(params: unknown): Promise<unknown>;
  materializeSuiteInstance?(params: unknown): Promise<unknown>;
  listMemoryCandidates(params: unknown): Promise<unknown>;
  promoteMemoryCandidate(params: unknown): Promise<unknown>;
  rejectMemoryCandidate(params: unknown): Promise<unknown>;
  listOntologyKnowledge(params: unknown): Promise<unknown>;
  explainOntologyAssertion(params: unknown): Promise<unknown>;
  listOntologyConflicts(params: unknown): Promise<unknown>;
  listOntologyCandidates(params: unknown): Promise<unknown>;
  promoteOntologyCandidate(params: unknown): Promise<unknown>;
  rejectOntologyCandidate(params: unknown): Promise<unknown>;
  correctOntologyAssertion(params: unknown): Promise<unknown>;
  retractOntologyAssertion(params: unknown): Promise<unknown>;
  deleteOntologyEvidence(params: unknown): Promise<unknown>;
  deleteOntologyEntity(params: unknown): Promise<unknown>;
  deleteOntologyCategory(params: unknown): Promise<unknown>;
  deleteAllOntology(params: unknown): Promise<unknown>;
  unmergeOntologyEntity(params: unknown): Promise<unknown>;
  regenerateOntologySnapshot(params: unknown): Promise<unknown>;
  exportOntology(params: unknown): Promise<unknown>;
  importOntology(params: unknown): Promise<unknown>;
  createObligation(params: unknown): Promise<unknown>;
  listObligations(params: unknown): Promise<unknown>;
  getObligation(params: unknown): Promise<unknown>;
  attachObligationEvidence(params: unknown): Promise<unknown>;
  listOverdueObligations(params: unknown): Promise<unknown>;
  validateObligation(params: unknown): Promise<unknown>;
  submitObligationHumanVerdict(params: unknown): Promise<unknown>;
  retryObligation(params: unknown): Promise<unknown>;
  explainObligation(params: unknown): Promise<unknown>;
  listTrajectories(params: unknown): Promise<unknown>;
  getTrajectory(params: unknown): Promise<unknown>;
  listCronJobs(): Promise<unknown>;
  upsertCronJob(params: unknown): Promise<unknown>;
  removeCronJob(params: unknown): Promise<unknown>;
  tickCron(): Promise<unknown>;
  handleCookingVideoRpc(type: string, params: Record<string, unknown>): Promise<unknown>;
  waitForQueuedTurn(queueTurnId: string): Promise<unknown>;
  runAgent(params: GatewayAgentParams): Promise<unknown>;
  browseDirectory(params: unknown): Promise<unknown>;
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
      if (request.type === "employee.workspace.get") {
        return { type: "response", id: request.id, ok: true, payload: await deps.loadEmployeeWorkspace(request.params) };
      }
      if (request.type === "employee.workspace.save") {
        return { type: "response", id: request.id, ok: true, payload: await deps.saveEmployeeWorkspace(request.params) };
      }
      if (request.type === "skills.list") {
        return { type: "response", id: request.id, ok: true, payload: await deps.listSkills() };
      }
      if (request.type === "org.bootstrap.example") {
        return { type: "response", id: request.id, ok: true, payload: await deps.bootstrapOrgExample() };
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
      if (request.type === "approval.dismiss") {
        return { type: "response", id: request.id, ok: true, payload: await deps.dismissRequest(request.params) };
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
      if (request.type === "suite.install") {
        if (!deps.installSuite) {
          throw new Error("suite.install is not configured for this gateway.");
        }
        return { type: "response", id: request.id, ok: true, payload: await deps.installSuite(request.params) };
      }
      if (request.type === "suite.release.install") {
        if (!deps.installSuiteRelease) {
          throw new Error("suite.release.install is not configured for this gateway.");
        }
        return { type: "response", id: request.id, ok: true, payload: await deps.installSuiteRelease(request.params) };
      }
      if (request.type === "suite.instance.materialize") {
        if (!deps.materializeSuiteInstance) {
          throw new Error("suite.instance.materialize is not configured for this gateway.");
        }
        return { type: "response", id: request.id, ok: true, payload: await deps.materializeSuiteInstance(request.params) };
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
      if (request.type === "ontology.knowledge.list") {
        return { type: "response", id: request.id, ok: true, payload: await deps.listOntologyKnowledge(request.params) };
      }
      if (request.type === "ontology.assertion.explain") {
        return { type: "response", id: request.id, ok: true, payload: await deps.explainOntologyAssertion(request.params) };
      }
      if (request.type === "ontology.conflicts.list") {
        return { type: "response", id: request.id, ok: true, payload: await deps.listOntologyConflicts(request.params) };
      }
      if (request.type === "ontology.candidates.list") {
        return { type: "response", id: request.id, ok: true, payload: await deps.listOntologyCandidates(request.params) };
      }
      if (request.type === "ontology.candidate.promote") {
        return { type: "response", id: request.id, ok: true, payload: await deps.promoteOntologyCandidate(request.params) };
      }
      if (request.type === "ontology.candidate.reject") {
        return { type: "response", id: request.id, ok: true, payload: await deps.rejectOntologyCandidate(request.params) };
      }
      if (request.type === "ontology.assertion.correct") {
        return { type: "response", id: request.id, ok: true, payload: await deps.correctOntologyAssertion(request.params) };
      }
      if (request.type === "ontology.assertion.retract") {
        return { type: "response", id: request.id, ok: true, payload: await deps.retractOntologyAssertion(request.params) };
      }
      if (request.type === "ontology.evidence.delete") {
        return { type: "response", id: request.id, ok: true, payload: await deps.deleteOntologyEvidence(request.params) };
      }
      if (request.type === "ontology.entity.delete") {
        return { type: "response", id: request.id, ok: true, payload: await deps.deleteOntologyEntity(request.params) };
      }
      if (request.type === "ontology.category.delete") {
        return { type: "response", id: request.id, ok: true, payload: await deps.deleteOntologyCategory(request.params) };
      }
      if (request.type === "ontology.deleteAll") {
        return { type: "response", id: request.id, ok: true, payload: await deps.deleteAllOntology(request.params) };
      }
      if (request.type === "ontology.entity.unmerge") {
        return { type: "response", id: request.id, ok: true, payload: await deps.unmergeOntologyEntity(request.params) };
      }
      if (request.type === "ontology.snapshot.regenerate") {
        return { type: "response", id: request.id, ok: true, payload: await deps.regenerateOntologySnapshot(request.params) };
      }
      if (request.type === "ontology.export") {
        return { type: "response", id: request.id, ok: true, payload: await deps.exportOntology(request.params) };
      }
      if (request.type === "ontology.import") {
        return { type: "response", id: request.id, ok: true, payload: await deps.importOntology(request.params) };
      }
      if (request.type === "obligation.create") {
        return { type: "response", id: request.id, ok: true, payload: await deps.createObligation(request.params) };
      }
      if (request.type === "obligation.list") {
        return { type: "response", id: request.id, ok: true, payload: await deps.listObligations(request.params) };
      }
      if (request.type === "obligation.get") {
        return { type: "response", id: request.id, ok: true, payload: await deps.getObligation(request.params) };
      }
      if (request.type === "obligation.attachEvidence") {
        return { type: "response", id: request.id, ok: true, payload: await deps.attachObligationEvidence(request.params) };
      }
      if (request.type === "obligation.overdue.list") {
        return { type: "response", id: request.id, ok: true, payload: await deps.listOverdueObligations(request.params) };
      }
      if (request.type === "obligation.validate") {
        return { type: "response", id: request.id, ok: true, payload: await deps.validateObligation(request.params) };
      }
      if (request.type === "obligation.verdict.human") {
        return { type: "response", id: request.id, ok: true, payload: await deps.submitObligationHumanVerdict(request.params) };
      }
      if (request.type === "obligation.retry") {
        return { type: "response", id: request.id, ok: true, payload: await deps.retryObligation(request.params) };
      }
      if (request.type === "obligation.explain") {
        return { type: "response", id: request.id, ok: true, payload: await deps.explainObligation(request.params) };
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
      if (
        request.type === "cooking.video.jobs.list" ||
        request.type === "cooking.video.workspace.get" ||
        request.type === "cooking.video.edit.save" ||
        request.type === "cooking.video.review.submit" ||
        request.type === "cooking.video.rerender" ||
        request.type === "cooking.video.preview.read" ||
        request.type === "cooking.video.queue.list" ||
        request.type === "cooking.video.queue.enqueue" ||
        request.type === "cooking.video.queue.cancel" ||
        request.type === "cooking.video.metrics.get" ||
        request.type === "cooking.video.feedback.summary"
      ) {
        return { type: "response", id: request.id, ok: true, payload: await deps.handleCookingVideoRpc(request.type, request.params) };
      }
      if (request.type === "fs.directory.browse") {
        return { type: "response", id: request.id, ok: true, payload: await deps.browseDirectory(request.params) };
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
