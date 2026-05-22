import type { DragonTurnResult } from "@dragon/core";

export const QUERY_LOOP_CONTINUE_MESSAGE =
  "[dragon-query-loop] Continue from where you left off. Finish the user request. "
  + "Avoid further tool calls unless strictly necessary.";

export const DEFAULT_QUERY_LOOP_MAX_TURNS = 3;
export const MAX_QUERY_LOOP_TURNS = 10;

export function resolveQueryLoopMaxTurns(
  queryLoop: boolean | undefined,
  explicitMax: number | undefined,
): number {
  if (!queryLoop) {
    return 1;
  }
  if (explicitMax !== undefined && Number.isFinite(explicitMax)) {
    return Math.min(MAX_QUERY_LOOP_TURNS, Math.max(1, Math.floor(explicitMax)));
  }
  return DEFAULT_QUERY_LOOP_MAX_TURNS;
}

export function shouldContinueQueryLoop(
  result: DragonTurnResult,
  turnIndex: number,
  maxTurns: number,
): boolean {
  if (turnIndex >= maxTurns - 1) {
    return false;
  }
  if (result.status !== "ok") {
    return false;
  }
  const assistant = [...result.messages].reverse().find(message => message.role === "assistant");
  return assistant?.metadata?.queryLoopContinue === true;
}
