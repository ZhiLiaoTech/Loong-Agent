import type { ModelMessage } from "@dragon/providers";
import { applyTurnPrep, buildTurnPrepOptions, type TurnPrepReport } from "./turn-prep.js";

const SESSION_HISTORY_TOOL_MAX_CHARS = 2_000;
const SESSION_HISTORY_ASSISTANT_MAX_CHARS = 4_000;
const SESSION_HISTORY_BUDGET_MULTIPLIER = 4;

export interface SessionHistoryPrepReport extends TurnPrepReport {
  providerName: "session_history_prep";
}

/**
 * Cross-turn prep applied to persisted session history before the current user
 * message is appended. Complements in-turn {@link applyTurnPrep}.
 */
export function prepareSessionHistoryForModel(
  history: readonly ModelMessage[],
  turnMaxContextChars: number,
): { messages: ModelMessage[]; report: SessionHistoryPrepReport } {
  const totalBudget = Math.max(turnMaxContextChars * SESSION_HISTORY_BUDGET_MULTIPLIER, 16_000);
  const { messages, report } = applyTurnPrep(history, buildTurnPrepOptions(turnMaxContextChars, {
    toolResultMaxChars: SESSION_HISTORY_TOOL_MAX_CHARS,
    assistantContentMaxChars: SESSION_HISTORY_ASSISTANT_MAX_CHARS,
    totalEstimatedMaxChars: totalBudget,
  }));
  return {
    messages,
    report: {
      ...report,
      providerName: "session_history_prep",
    },
  };
}
