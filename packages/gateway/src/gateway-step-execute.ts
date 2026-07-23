import { createHash } from "node:crypto";
import type { LoongMessage, LoongTurnResult } from "@loong/core";
import type { GatewayAgentParams } from "./gateway-agent-types.js";
import {
  executeGatewaySingleAgentTurn,
  type GatewayAgentTurnDeps,
} from "./gateway-agent-turn.js";
import type { AgentTurnResultPayload } from "./session-coordinator.js";
import type { StepIdempotencyStore } from "./gateway-step-idempotency.js";
import type {
  GatewayStepExecuteParams,
  GatewayStepHistoryMessage,
  GatewayStepProposal,
  GatewayStepResult,
} from "./gateway-step-types.js";

export interface GatewayStepExecuteDeps {
  idempotencyStore: StepIdempotencyStore;
  agentTurnDeps: GatewayAgentTurnDeps;
  resolveAgentParams(params: GatewayAgentParams): Promise<GatewayAgentParams>;
  /**
   * Phase 3.0 (docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md §11): optional
   * obligation recording hook. When present AND the step carries both
   * tenantId and employeeId, the step result is reported after execution so
   * the recorder can attach a `step_result` evidence ref to any obligation
   * registered under this idempotencyKey. Recording is best-effort: a
   * recorder failure never fails the step.
   */
  obligationRecorder?: GatewayStepObligationRecorder;
}

/** Phase 3.0 step→obligation recording surface (adapter lives in gateway-step-obligation.ts). */
export interface GatewayStepObligationRecorder {
  attachStepResult(input: {
    tenantId: string;
    employeeId: string;
    idempotencyKey: string;
    runId?: string;
  }): Promise<unknown>;
}

export async function executeGatewayStep(
  deps: GatewayStepExecuteDeps,
  params: GatewayStepExecuteParams,
): Promise<GatewayStepResult> {
  const cached = await deps.idempotencyStore.get(params.idempotencyKey);
  if (cached) {
    return { ...cached, replayed: true };
  }

  const startedAt = Date.now();
  const agentParams = await deps.resolveAgentParams(stepParamsFromRequest(params));
  const payload = await executeGatewaySingleAgentTurn(deps.agentTurnDeps, agentParams);
  const result = toStepResult(payload, Date.now() - startedAt, params.mode);
  await deps.idempotencyStore.put(params.idempotencyKey, result);
  await recordStepResultForObligation(deps, params, result);
  return result;
}

/** Best-effort Phase 3.0 recording: never throw into the step execution path. */
async function recordStepResultForObligation(
  deps: GatewayStepExecuteDeps,
  params: GatewayStepExecuteParams,
  result: GatewayStepResult,
): Promise<void> {
  const recorder = deps.obligationRecorder;
  const tenantId = params.tenantId?.trim();
  const employeeId = params.employeeId?.trim();
  if (recorder === undefined || !tenantId || !employeeId) {
    return;
  }
  try {
    await recorder.attachStepResult({
      tenantId,
      employeeId,
      idempotencyKey: params.idempotencyKey,
      ...(result.runId !== undefined ? { runId: result.runId } : {}),
    });
  } catch {
    // Recording must not break execution; dangling detection (obligation.overdue.list)
    // is the 3.0 safety net for missed receipts.
  }
}

export function stepParamsFromRequest(params: GatewayStepExecuteParams): GatewayAgentParams {
  const sessionId = params.sessionId?.trim()
    || `step:${createHash("sha256").update(params.idempotencyKey).digest("hex").slice(0, 24)}`;
  const intent = params.stepContext?.intent?.trim()
    || params.message?.trim()
    || "";
  const message = buildStepMessage(intent, params.stepContext?.history);
  const metadata: Record<string, unknown> = {
    ...(params.metadata ?? {}),
    ...(params.stepContext?.metadata ?? {}),
    orchestration: {
      idempotencyKey: params.idempotencyKey,
      mode: params.mode ?? "propose",
      statelessStep: true,
    },
    ...(params.tenantId ? { tenantId: params.tenantId } : {}),
    ...(params.suiteRef ? { suiteRef: params.suiteRef } : {}),
    ...(params.stepContext?.schemaRef ? { schemaRef: params.stepContext.schemaRef } : {}),
    ...(params.allowedTools ? { allowedTools: params.allowedTools } : {}),
    ...(params.budget ? { budget: params.budget } : {}),
  };

  const agentParams: GatewayAgentParams = {
    sessionId,
    message,
    source: "gateway",
    toolsEnabled: params.mode === "tool" ? true : params.toolsEnabled ?? false,
    memoryEnabled: false,
    queryLoop: false,
    metadata,
  };

  if (params.employeeId?.trim()) {
    agentParams.employeeId = params.employeeId.trim();
  }
  if (params.workspace?.trim()) {
    agentParams.workspace = params.workspace.trim();
  }
  if (params.profileId?.trim()) {
    agentParams.profileId = params.profileId.trim();
  }
  if (params.modelPolicy?.tier) {
    agentParams.tier = params.modelPolicy.tier;
  }
  if (params.modelPolicy?.model?.trim()) {
    agentParams.model = params.modelPolicy.model.trim();
  }

  return agentParams;
}

function buildStepMessage(
  intent: string,
  history: readonly GatewayStepHistoryMessage[] | undefined,
): string {
  if (!history || history.length === 0) {
    return intent;
  }
  const lines = history.map(entry => `${entry.role}: ${entry.content}`);
  return `Context:\n${lines.join("\n")}\n\nIntent:\n${intent}`;
}

function toStepResult(
  payload: AgentTurnResultPayload,
  latencyMs: number,
  mode: GatewayStepExecuteParams["mode"],
): GatewayStepResult {
  const turn = payload.result as LoongTurnResult;
  const tokens = turn.usage?.totalTokens
    ?? ((turn.usage?.inputTokens ?? 0) + (turn.usage?.outputTokens ?? 0));
  const result: GatewayStepResult = {
    status: turn.status,
    events: payload.events,
    usage: {
      tokens,
      costUsd: turn.usage?.costUsd ?? 0,
      latencyMs,
    },
    runId: turn.runId,
    ...(turn.error !== undefined ? { error: turn.error } : {}),
  };

  if (mode === "tool") {
    const toolMessage = [...turn.messages].reverse().find(message => message.role === "tool");
    if (toolMessage) {
      result.toolResult = tryParseJson(toolMessage.content) ?? toolMessage.content;
    }
    return result;
  }

  const proposal = extractProposalFromTurn(turn);
  if (proposal) {
    result.proposal = proposal;
  }
  return result;
}

export function extractProposalFromTurn(turn: LoongTurnResult): GatewayStepProposal | undefined {
  for (const message of [...turn.messages].reverse()) {
    if (message.role !== "assistant") {
      continue;
    }
    const fromMetadata = readProposalMetadata(message);
    if (fromMetadata) {
      return fromMetadata;
    }
    const fromToolCalls = readProposalFromToolCalls(message);
    if (fromToolCalls) {
      return fromToolCalls;
    }
    const fromContent = readProposalFromAssistantContent(message.content);
    if (fromContent) {
      return fromContent;
    }
  }
  return undefined;
}

function readProposalMetadata(message: LoongMessage): GatewayStepProposal | undefined {
  const proposal = message.metadata?.proposal;
  if (!isRecord(proposal) || typeof proposal.action !== "string" || !proposal.action.trim()) {
    return undefined;
  }
  return { action: proposal.action.trim(), params: proposal.params ?? {} };
}

function readProposalFromToolCalls(message: LoongMessage): GatewayStepProposal | undefined {
  const toolCalls = message.metadata?.toolCalls;
  if (!Array.isArray(toolCalls)) {
    return undefined;
  }
  for (const raw of toolCalls) {
    if (!isRecord(raw)) {
      continue;
    }
    const name = typeof raw.name === "string" ? raw.name : typeof raw.function === "object" && raw.function && isRecord(raw.function) && typeof raw.function.name === "string"
      ? raw.function.name
      : undefined;
    if (!name || !/(^propose$|_propose$|\.propose$)/i.test(name)) {
      continue;
    }
    const args = typeof raw.arguments === "string"
      ? tryParseJson(raw.arguments)
      : isRecord(raw.function) && typeof raw.function.arguments === "string"
        ? tryParseJson(raw.function.arguments)
        : undefined;
    if (!isRecord(args)) {
      continue;
    }
    const action = typeof args.action === "string" && args.action.trim()
      ? args.action.trim()
      : name;
    const params = args.params !== undefined ? args.params : args;
    return { action, params };
  }
  return undefined;
}

function readProposalFromAssistantContent(content: string): GatewayStepProposal | undefined {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  const parsed = tryParseJson(trimmed);
  if (!isRecord(parsed) || typeof parsed.action !== "string" || !parsed.action.trim()) {
    return undefined;
  }
  return { action: parsed.action.trim(), params: parsed.params ?? {} };
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
