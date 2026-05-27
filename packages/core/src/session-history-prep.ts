import type { ModelMessage } from "@dragon/providers";
import {
  compactSessionMessagesByTurn,
  type SessionMessageCompactionOptions,
  type SessionMessageCompactionReport,
} from "./session-message-compaction.js";
import { applyTurnPrep, buildTurnPrepOptions, type TurnPrepReport } from "./turn-prep.js";

const SESSION_HISTORY_TOOL_MAX_CHARS = 2_000;
const SESSION_HISTORY_ASSISTANT_MAX_CHARS = 4_000;
const SESSION_HISTORY_BUDGET_MULTIPLIER = 4;

export interface SessionHistoryPrepReport extends TurnPrepReport {
  providerName: "session_history_prep";
  sessionCompaction?: SessionMessageCompactionReport;
}

/**
 * Cross-turn prep applied to persisted session history before the current user
 * message is appended. L2 turn compaction, then char-budget prep (L3 complement).
 */
export function prepareSessionHistoryForModel(
  history: readonly ModelMessage[],
  turnMaxContextChars: number,
  compaction: SessionMessageCompactionOptions | false = {},
): { messages: ModelMessage[]; report: SessionHistoryPrepReport } {
  const turnCompacted = compaction === false
    ? { messages: [...history], report: undefined }
    : compactSessionMessagesByTurn(history, compaction);
  const totalBudget = Math.max(turnMaxContextChars * SESSION_HISTORY_BUDGET_MULTIPLIER, 16_000);
  const { messages, report } = applyTurnPrep(turnCompacted.messages, buildTurnPrepOptions(turnMaxContextChars, {
    toolResultMaxChars: SESSION_HISTORY_TOOL_MAX_CHARS,
    assistantContentMaxChars: SESSION_HISTORY_ASSISTANT_MAX_CHARS,
    totalEstimatedMaxChars: totalBudget,
  }));
  return {
    messages,
    report: {
      ...report,
      providerName: "session_history_prep",
      ...(turnCompacted.report !== undefined ? { sessionCompaction: turnCompacted.report } : {}),
    },
  };
}
