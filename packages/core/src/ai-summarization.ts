import type { ModelMessage, ModelProvider } from "@loong/providers";
import { createModelTurnAbort } from "./model-timeout.js";
import { splitModelMessagesIntoTurns } from "./session-message-compaction.js";

const DEFAULT_KEEP_RECENT_TURNS = 4;
const DEFAULT_MAX_SUMMARY_CHARS = 2_000;
const DEFAULT_SUMMARY_TIMEOUT_MS = 30_000;

export const DEFAULT_AI_SUMMARY_PROMPT = `You summarize older conversation turns for context compression.

Rules:
1. Extract key decisions, facts, and code changes
2. Preserve file paths, function names, and technical details exactly
3. Omit redundant tool output; keep important results only
4. Keep the same language as the original conversation
5. Stay within the character limit given
6. Group by topic using bullet points`;

const SUMMARY_USER_PREFIX = "[Loong: AI summary of earlier conversation turns]\n\n";

/** Serializable config (context.json / agents.json). Provider is resolved at runtime. */
export interface AISummarizationConfig {
  enabled?: boolean;
  model?: string;
  keepRecentTurns?: number;
  maxSummaryChars?: number;
  summaryPrompt?: string;
  timeoutMs?: number;
}

export interface AISummarizationOptions extends AISummarizationConfig {
  provider?: ModelProvider;
  onSummaryGenerated?: (report: AISummarizationReport) => void;
}

export interface AISummarizationReport {
  providerName: "ai_summarization";
  totalTurns: number;
  summarizedTurns: number;
  keptRecentTurns: number;
  summaryLength: number;
  durationMs: number;
  model: string;
  skipped?: boolean;
  error?: string;
}

export async function summarizeOldTurnsWithAI(
  messages: readonly ModelMessage[],
  options: AISummarizationOptions = {},
): Promise<{ messages: ModelMessage[]; report: AISummarizationReport }> {
  const started = Date.now();
  const keepRecentTurns = clampPositiveInt(options.keepRecentTurns, DEFAULT_KEEP_RECENT_TURNS, 32);
  const turns = splitModelMessagesIntoTurns(messages);
  const model = options.model?.trim() || options.provider?.defaultModel || "unknown";

  const baseReport = (): AISummarizationReport => ({
    providerName: "ai_summarization",
    totalTurns: turns.length,
    summarizedTurns: 0,
    keptRecentTurns: Math.min(keepRecentTurns, turns.length),
    summaryLength: 0,
    durationMs: Date.now() - started,
    model,
  });

  if (options.enabled !== true) {
    const report = { ...baseReport(), skipped: true };
    options.onSummaryGenerated?.(report);
    return { messages: [...messages], report };
  }

  if (turns.length <= keepRecentTurns) {
    const report = { ...baseReport(), skipped: true };
    options.onSummaryGenerated?.(report);
    return { messages: [...messages], report };
  }

  if (!options.provider) {
    const report = {
      ...baseReport(),
      error: "No provider available for AI summarization",
    };
    options.onSummaryGenerated?.(report);
    return { messages: [...messages], report };
  }

  const olderTurns = turns.slice(0, turns.length - keepRecentTurns);
  const recentMessages = turns.slice(turns.length - keepRecentTurns).flat();

  try {
    const maxSummaryChars = clampPositiveInt(options.maxSummaryChars, DEFAULT_MAX_SUMMARY_CHARS, 16_000);
    const transcript = formatTurnsForSummary(olderTurns);
    const summary = await callSummaryProvider(options, transcript, maxSummaryChars, model);
    const summaryMessage: ModelMessage = {
      role: "user",
      content: `${SUMMARY_USER_PREFIX}${summary}`,
    };
    const report: AISummarizationReport = {
      ...baseReport(),
      summarizedTurns: olderTurns.length,
      summaryLength: summary.length,
      durationMs: Date.now() - started,
    };
    options.onSummaryGenerated?.(report);
    return {
      messages: [summaryMessage, ...recentMessages],
      report,
    };
  } catch (error) {
    const report: AISummarizationReport = {
      ...baseReport(),
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
    options.onSummaryGenerated?.(report);
    return { messages: [...messages], report };
  }
}

async function callSummaryProvider(
  options: AISummarizationOptions,
  transcript: string,
  maxSummaryChars: number,
  model: string,
): Promise<string> {
  const provider = options.provider;
  if (!provider) {
    throw new Error("No provider available for AI summarization");
  }
  const prompt = options.summaryPrompt?.trim() || DEFAULT_AI_SUMMARY_PROMPT;
  const timeoutMs = clampPositiveInt(options.timeoutMs, DEFAULT_SUMMARY_TIMEOUT_MS, 300_000);
  const abort = createModelTurnAbort(undefined, timeoutMs);
  try {
    const response = await provider.complete({
      model,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: `Summarize the following conversation history in at most ${maxSummaryChars} characters.\n\n${transcript}`,
        },
      ],
      temperature: 0.2,
      signal: abort.signal,
    });
    const text = response.text?.trim() ?? "";
    if (!text) {
      throw new Error("AI summarization returned empty text");
    }
    if (text.length <= maxSummaryChars) {
      return text;
    }
    return `${text.slice(0, Math.max(0, maxSummaryChars - 3))}...`;
  } finally {
    abort.dispose();
  }
}

function formatTurnsForSummary(turns: readonly ModelMessage[][]): string {
  const lines: string[] = [];
  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    lines.push(`--- Turn ${turnIndex + 1} ---`);
    for (const message of turns[turnIndex] ?? []) {
      const role = message.role.toUpperCase();
      const toolName = message.name ? ` (${message.name})` : "";
      lines.push(`${role}${toolName}: ${stringifyModelContent(message.content)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function stringifyModelContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map(part => (part.type === "text" ? part.text : `[${part.type}]`))
    .join("\n");
}

function clampPositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.min(max, Math.floor(value));
}
