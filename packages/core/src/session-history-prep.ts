import type { ModelMessage } from "@loong/providers";
import {
  summarizeOldTurnsWithAI,
  type AISummarizationOptions,
  type AISummarizationReport,
} from "./ai-summarization.js";
import {
  compactSessionMessagesByTurn,
  type SessionMessageCompactionOptions,
  type SessionMessageCompactionReport,
} from "./session-message-compaction.js";
import { applyTurnPrep, buildTurnPrepOptions, type TurnPrepReport } from "./turn-prep.js";

const SESSION_HISTORY_TOOL_MAX_CHARS = 2_000;
const SESSION_HISTORY_ASSISTANT_MAX_CHARS = 4_000;
const SESSION_HISTORY_BUDGET_MULTIPLIER = 4;

export interface SessionHistoryPrepOptions {
  aiSummarization?: AISummarizationOptions;
}

export interface SessionHistoryPrepReport extends TurnPrepReport {
  providerName: "session_history_prep";
  aiSummarization?: AISummarizationReport;
  sessionCompaction?: SessionMessageCompactionReport;
}

/**
 * Cross-turn prep applied to persisted session history before the current user
 * message is appended. L1 AI summarization, L2 turn compaction, then char-budget prep (L3).
 */
export async function prepareSessionHistoryForModel(
  history: readonly ModelMessage[],
  turnMaxContextChars: number,
  compaction: SessionMessageCompactionOptions | false = {},
  prepOptions: SessionHistoryPrepOptions = {},
): Promise<{ messages: ModelMessage[]; report: SessionHistoryPrepReport }> {
  const aiSummarized = prepOptions.aiSummarization
    ? await summarizeOldTurnsWithAI(history, prepOptions.aiSummarization)
    : { messages: [...history], report: undefined };

  const turnCompacted = compaction === false
    ? { messages: aiSummarized.messages, report: undefined }
    : compactSessionMessagesByTurn(aiSummarized.messages, compaction);

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
      ...(aiSummarized.report !== undefined ? { aiSummarization: aiSummarized.report } : {}),
      ...(turnCompacted.report !== undefined ? { sessionCompaction: turnCompacted.report } : {}),
    },
  };
}
