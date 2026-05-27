import {
  QUERY_LOOP_CONTINUE_MESSAGE,
  isForceQueryLoopMetadata,
  resolveQueryLoopMaxTurns,
  shouldContinueQueryLoop,
  type ShouldContinueQueryLoopOptions,
} from "./query-loop.js";
import type { DragonAgentRuntime, DragonTurnInput, DragonTurnResult } from "./types.js";

export interface RunTurnWithQueryLoopOptions {
  queryLoop?: boolean;
  queryLoopMaxTurns?: number;
  forceQueryLoop?: boolean;
}

export interface RunTurnWithQueryLoopResult {
  result: DragonTurnResult;
  turnCount: number;
}

export interface QueryLoopContinuationContext {
  turnIndex: number;
  previousResult: DragonTurnResult;
  reason: string;
}

export function buildQueryLoopContinuationInput(
  baseInput: DragonTurnInput,
  context: QueryLoopContinuationContext,
): DragonTurnInput {
  return {
    ...baseInput,
    message: QUERY_LOOP_CONTINUE_MESSAGE,
    metadata: {
      ...(baseInput.metadata ?? {}),
      queryLoopContinuation: context.turnIndex + 1,
      queryLoopReason: context.reason,
    },
  };
}

function resolveQueryLoopReason(
  previousResult: DragonTurnResult,
  forceQueryLoop: boolean,
): string {
  const assistant = [...previousResult.messages].reverse().find(message => message.role === "assistant");
  if (assistant?.metadata?.toolIterationLimitReached === true) {
    return "tool_iteration_limit";
  }
  if (forceQueryLoop) {
    return "force_query_loop";
  }
  return "query_loop_continue";
}

export async function runTurnWithQueryLoop(
  runtime: DragonAgentRuntime,
  baseInput: DragonTurnInput,
  options: RunTurnWithQueryLoopOptions = {},
): Promise<RunTurnWithQueryLoopResult> {
  const queryLoopEnabled = options.queryLoop === true || baseInput.queryLoop === true;
  const maxTurns = resolveQueryLoopMaxTurns(queryLoopEnabled, options.queryLoopMaxTurns);
  const forceQueryLoop = options.forceQueryLoop === true || isForceQueryLoopMetadata(baseInput.metadata);
  const continueOptions: ShouldContinueQueryLoopOptions = { forceQueryLoop };

  let activeInput = baseInput;
  let lastResult: DragonTurnResult | undefined;
  let turnCount = 0;

  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
    turnCount += 1;
    lastResult = await runtime.runTurn(activeInput);
    if (!shouldContinueQueryLoop(lastResult, turnIndex, maxTurns, continueOptions)) {
      break;
    }
    activeInput = buildQueryLoopContinuationInput(baseInput, {
      turnIndex,
      previousResult: lastResult,
      reason: resolveQueryLoopReason(lastResult, forceQueryLoop),
    });
  }

  if (!lastResult) {
    throw new Error("runTurnWithQueryLoop produced no result.");
  }
  return { result: lastResult, turnCount };
}
