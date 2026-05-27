import {
  buildQueryLoopContinuationInput,
  resolveQueryLoopMaxTurns,
  shouldContinueQueryLoop,
  isForceQueryLoopMetadata,
  type DragonAgentRuntime,
  type DragonEvent,
  type DragonTurnInput,
  type DragonTurnResult,
} from "@dragon/core";
import type { AgentTurnResultPayload } from "./session-coordinator.js";
import type { GatewayAgentParams } from "./gateway-agent-types.js";
import { toTurnInput } from "./agent-params.js";

export interface GatewayRunLifecycle {
  registerRunStart(runId: string, input: DragonTurnInput, controller: AbortController): void;
  completeRun(runId: string, result: DragonTurnResult): void;
  failRun(runId: string, error: unknown, state: "cancelled" | "error"): void;
  deleteRunSession(runId: string): void;
}

export interface GatewayAgentTurnDeps {
  runtime: DragonAgentRuntime;
  runInLane<T>(sessionId: string, task: () => Promise<T>): Promise<T>;
  runs: GatewayRunLifecycle;
}

/** Query-loop wrapper around a single agent turn (shared by RPC and webhooks). */
export async function executeGatewayAgentTurn(
  deps: GatewayAgentTurnDeps,
  params: GatewayAgentParams,
): Promise<AgentTurnResultPayload> {
  const maxTurns = resolveQueryLoopMaxTurns(params.queryLoop, params.queryLoopMaxTurns);
  const allEvents: DragonEvent[] = [];
  let lastPayload: AgentTurnResultPayload | undefined;
  let activeParams = params;

  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
    const payload = await executeGatewaySingleAgentTurn(deps, activeParams);
    allEvents.push(...payload.events);
    lastPayload = payload;
    const result = payload.result as DragonTurnResult;
    const forceQueryLoop = params.metadata?.forceQueryLoop === true
      || isForceQueryLoopMetadata(params.metadata);
    if (!shouldContinueQueryLoop(result, turnIndex, maxTurns, { forceQueryLoop })) {
      break;
    }
    const assistant = [...result.messages].reverse().find(message => message.role === "assistant");
    const continuationReason = assistant?.metadata?.toolIterationLimitReached === true
      ? "tool_iteration_limit"
      : forceQueryLoop
        ? "force_query_loop"
        : "query_loop_continue";
    const continuationInput = buildQueryLoopContinuationInput(toTurnInput(params), {
      turnIndex,
      previousResult: result,
      reason: continuationReason,
    });
    activeParams = {
      ...params,
      message: continuationInput.message,
      ...(continuationInput.metadata !== undefined ? { metadata: continuationInput.metadata } : {}),
    };
  }

  if (!lastPayload) {
    throw new Error("Agent turn produced no result.");
  }
  return {
    result: lastPayload.result,
    events: allEvents,
  };
}

export async function executeGatewaySingleAgentTurn(
  deps: GatewayAgentTurnDeps,
  params: GatewayAgentParams,
): Promise<AgentTurnResultPayload> {
  const input = toTurnInput(params);
  return await deps.runInLane(input.sessionId, async () => {
    const events: DragonEvent[] = [];
    const controller = new AbortController();
    const unsubscribe = deps.runtime.subscribe(event => {
      events.push(event);
    });
    let untrackRun: () => void = () => {};
    try {
      let runId: string | undefined;
      untrackRun = deps.runtime.subscribe(event => {
        if (event.type === "lifecycle" && event.phase === "start") {
          runId = event.runId;
          deps.runs.registerRunStart(event.runId, input, controller);
          untrackRun();
        }
      });
      try {
        const result = await deps.runtime.runTurn({ ...input, signal: controller.signal });
        deps.runs.completeRun(result.runId, result);
        deps.runs.deleteRunSession(result.runId);
        if (runId !== undefined && runId !== result.runId) {
          deps.runs.deleteRunSession(runId);
        }
        return {
          result,
          events: events.filter(event => event.runId === result.runId),
        };
      } catch (error) {
        if (runId !== undefined) {
          deps.runs.failRun(runId, error, controller.signal.aborted ? "cancelled" : "error");
          deps.runs.deleteRunSession(runId);
        }
        throw error;
      }
    } finally {
      untrackRun();
      unsubscribe();
    }
  });
}
