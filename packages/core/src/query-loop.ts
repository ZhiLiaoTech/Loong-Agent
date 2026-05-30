import type { LoongTurnResult } from "./types.js";

export const QUERY_LOOP_CONTINUE_MESSAGE =
  "[loong-query-loop] Continue from where you left off. Finish the user request. "
  + "Avoid further tool calls unless strictly necessary.";

export const DEFAULT_QUERY_LOOP_MAX_TURNS = 3;
export const MAX_QUERY_LOOP_TURNS = 10;

export interface ShouldContinueQueryLoopOptions {
  /** When true, continue while turns remain unless the assistant sets queryLoopDone. */
  forceQueryLoop?: boolean;
}

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
  result: LoongTurnResult,
  turnIndex: number,
  maxTurns: number,
  options: ShouldContinueQueryLoopOptions = {},
): boolean {
  if (turnIndex >= maxTurns - 1) {
    return false;
  }
  if (result.status !== "ok") {
    return false;
  }
  const assistant = [...result.messages].reverse().find(message => message.role === "assistant");
  if (assistant?.metadata?.queryLoopDone === true) {
    return false;
  }
  if (assistant?.metadata?.queryLoopContinue === true) {
    return true;
  }
  if (options.forceQueryLoop === true) {
    return true;
  }
  return false;
}

export function isForceQueryLoopMetadata(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.forceQueryLoop === true;
}
