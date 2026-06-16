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
  type SessionCompactionPolicy,
} from "./session-message-compaction.js";
import {
  applyTurnPrep,
  buildTurnPrepOptions,
  buildSkippedTurnPrepReport,
  computeTurnMessageBudgetChars,
  estimateModelMessagesChars,
  shouldCompactForContextBudget,
  type TurnPrepReport,
} from "./turn-prep.js";

const SESSION_HISTORY_TOOL_MAX_CHARS = 2_000;
const SESSION_HISTORY_ASSISTANT_MAX_CHARS = 4_000;

export interface SessionHistoryPrepOptions {
  aiSummarization?: AISummarizationOptions;
  compactionPolicy?: SessionCompactionPolicy;
}

export interface SessionHistoryPrepReport extends TurnPrepReport {
  providerName: "session_history_prep";
  aiSummarization?: AISummarizationReport;
  sessionCompaction?: SessionMessageCompactionReport;
  compactionSkipped?: boolean;
}

/**
 * Cross-turn prep applied to persisted session history before the current user
 * message is appended. L1 AI summarization, L2 turn compaction, then char-budget prep (L3).
 * By default compaction runs only when history reaches the message budget (100%).
 */
export async function prepareSessionHistoryForModel(
  history: readonly ModelMessage[],
  turnMaxContextChars: number,
  compaction: SessionMessageCompactionOptions | false = {},
  prepOptions: SessionHistoryPrepOptions = {},
): Promise<{ messages: ModelMessage[]; report: SessionHistoryPrepReport }> {
  const compactionPolicy = prepOptions.compactionPolicy
    ?? (compaction === false ? undefined : compaction.compactionPolicy)
    ?? "whenOverBudget";
  const estimatedBefore = estimateModelMessagesChars(history);
  const shouldCompact = shouldCompactForContextBudget(estimatedBefore, turnMaxContextChars, compactionPolicy);

  if (!shouldCompact) {
    const skipped = buildSkippedTurnPrepReport(history);
    return {
      messages: [...history],
      report: {
        ...skipped,
        providerName: "session_history_prep",
        compactionSkipped: true,
      },
    };
  }

  const aiSummarized = prepOptions.aiSummarization
    ? await summarizeOldTurnsWithAI(history, prepOptions.aiSummarization)
    : { messages: [...history], report: undefined };

  const turnCompacted = compaction === false
    ? { messages: aiSummarized.messages, report: undefined }
    : compactSessionMessagesByTurn(aiSummarized.messages, compaction);

  const totalBudget = computeTurnMessageBudgetChars(turnMaxContextChars);
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
