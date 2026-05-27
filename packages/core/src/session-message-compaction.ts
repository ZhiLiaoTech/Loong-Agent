import type { ModelMessage } from "@dragon/providers";

const DEFAULT_KEEP_RECENT_TURNS = 4;
const DEFAULT_OLDER_TOOL_MAX_CHARS = 400;
const COMPACTED_TOOL_SUFFIX = "\n\n[Dragon: older tool output compacted for context budget]";

export interface SessionMessageCompactionOptions {
  /** Full user-assistant-tool turns kept without turn-level compaction (default 4). */
  keepRecentTurns?: number;
  /** Max chars per tool message in older turns (default 400). */
  olderToolMaxChars?: number;
}

export interface SessionMessageCompactionReport {
  providerName: "session_message_compaction";
  totalTurns: number;
  keptRecentTurns: number;
  compactedToolMessages: number;
}

export function compactSessionMessagesByTurn(
  messages: readonly ModelMessage[],
  options: SessionMessageCompactionOptions = {},
): { messages: ModelMessage[]; report: SessionMessageCompactionReport } {
  const keepRecentTurns = clampPositiveInt(options.keepRecentTurns, DEFAULT_KEEP_RECENT_TURNS, 32);
  const olderToolMaxChars = clampPositiveInt(options.olderToolMaxChars, DEFAULT_OLDER_TOOL_MAX_CHARS, 8_000);
  const turns = splitModelMessagesIntoTurns(messages);
  const compactedTurnIndex = Math.max(0, turns.length - keepRecentTurns);
  let compactedToolMessages = 0;
  const out: ModelMessage[] = [];

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const turn = turns[turnIndex] ?? [];
    if (turnIndex >= compactedTurnIndex) {
      out.push(...turn);
      continue;
    }
    for (const message of turn) {
      if (message.role !== "tool") {
        out.push(message);
        continue;
      }
      const content = stringifyModelContent(message.content);
      if (content.length <= olderToolMaxChars) {
        out.push(message);
        continue;
      }
      compactedToolMessages += 1;
      out.push({
        ...message,
        content: `${content.slice(0, olderToolMaxChars)}${COMPACTED_TOOL_SUFFIX}`,
      });
    }
  }

  return {
    messages: out,
    report: {
      providerName: "session_message_compaction",
      totalTurns: turns.length,
      keptRecentTurns: Math.min(keepRecentTurns, turns.length),
      compactedToolMessages,
    },
  };
}

/** Each turn begins at a `user` message and runs until the next `user` (exclusive). */
export function splitModelMessagesIntoTurns(messages: readonly ModelMessage[]): ModelMessage[][] {
  const turns: ModelMessage[][] = [];
  let current: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === "user" && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(message);
  }
  if (current.length > 0) {
    turns.push(current);
  }
  return turns;
}

function stringifyModelContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map(part => {
      if (part.type === "text") {
        return part.text;
      }
      return `[${part.type}]`;
    })
    .join("\n");
}

function clampPositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.min(max, Math.floor(value));
}
