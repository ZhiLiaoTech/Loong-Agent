import type { ModelContentPart, ModelMessage } from "@dragon/providers";

const DEFAULT_TOOL_RESULT_MAX_CHARS = 8_000;
const DEFAULT_ASSISTANT_CONTENT_MAX_CHARS = 16_000;
const TOTAL_BUDGET_MULTIPLIER = 8;
const TRUNCATED_TOOL_SUFFIX = "\n\n[Dragon: tool output truncated for context budget]";
const TRUNCATED_ASSISTANT_SUFFIX = "\n\n[Dragon: assistant text truncated for context budget]";

export interface TurnPrepOptions {
  /** Per `tool` message content cap. */
  toolResultMaxChars: number;
  /** Per `assistant` text content cap (toolCalls preserved). */
  assistantContentMaxChars: number;
  /** Estimated char budget for the full message list sent to the provider. */
  totalEstimatedMaxChars: number;
  /** Second-pass compaction when reactive retry or overflow recovery runs. */
  aggressive?: boolean;
}

export interface TurnPrepReport {
  truncatedToolResults: number;
  truncatedAssistantMessages: number;
  strippedReasoningMessages: number;
  estimatedCharsBefore: number;
  estimatedCharsAfter: number;
  aggressive: boolean;
}

export function buildTurnPrepOptions(
  turnMaxContextChars: number,
  overrides: Partial<Pick<TurnPrepOptions, "toolResultMaxChars" | "assistantContentMaxChars" | "totalEstimatedMaxChars">> = {},
  aggressive = false,
): TurnPrepOptions {
  const baseBudget = Math.max(turnMaxContextChars * TOTAL_BUDGET_MULTIPLIER, 32_000);
  return {
    toolResultMaxChars: overrides.toolResultMaxChars ?? DEFAULT_TOOL_RESULT_MAX_CHARS,
    assistantContentMaxChars: overrides.assistantContentMaxChars ?? DEFAULT_ASSISTANT_CONTENT_MAX_CHARS,
    totalEstimatedMaxChars: overrides.totalEstimatedMaxChars ?? baseBudget,
    aggressive,
  };
}

export function estimateModelMessagesChars(messages: readonly ModelMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateMessageChars(message);
  }
  return total;
}

export function applyTurnPrep(
  messages: readonly ModelMessage[],
  options: TurnPrepOptions,
): { messages: ModelMessage[]; report: TurnPrepReport } {
  const toolCap = options.aggressive
    ? Math.max(512, Math.floor(options.toolResultMaxChars / 2))
    : options.toolResultMaxChars;
  const assistantCap = options.aggressive
    ? Math.max(512, Math.floor(options.assistantContentMaxChars / 2))
    : options.assistantContentMaxChars;
  const totalCap = options.aggressive
    ? Math.max(8_000, Math.floor(options.totalEstimatedMaxChars / 2))
    : options.totalEstimatedMaxChars;

  const cloned: ModelMessage[] = messages.map(cloneModelMessage);
  const report: TurnPrepReport = {
    truncatedToolResults: 0,
    truncatedAssistantMessages: 0,
    strippedReasoningMessages: 0,
    estimatedCharsBefore: estimateModelMessagesChars(cloned),
    estimatedCharsAfter: 0,
    aggressive: options.aggressive === true,
  };

  for (const message of cloned) {
    if (message.role === "tool" && typeof message.content === "string") {
      const next = truncateString(message.content, toolCap, TRUNCATED_TOOL_SUFFIX);
      if (next !== message.content) {
        message.content = next;
        report.truncatedToolResults += 1;
      }
    }
    if (message.role === "assistant") {
      if (typeof message.content === "string") {
        const next = truncateString(message.content, assistantCap, TRUNCATED_ASSISTANT_SUFFIX);
        if (next !== message.content) {
          message.content = next;
          report.truncatedAssistantMessages += 1;
        }
      }
      if (options.aggressive && message.reasoningContent !== undefined && message.reasoningContent.length > 0) {
        delete message.reasoningContent;
        report.strippedReasoningMessages += 1;
      }
    }
  }

  shrinkMessagesToTotalBudget(cloned, totalCap, toolCap);
  report.estimatedCharsAfter = estimateModelMessagesChars(cloned);
  return { messages: cloned, report };
}

/** Heuristic: provider/context overflow errors that benefit from a reactive prep retry. */
export function isLikelyContextOverflowError(error: unknown): boolean {
  const text = errorMessageText(error).toLowerCase();
  if (text.length === 0) {
    return false;
  }
  const patterns = [
    "prompt is too long",
    "prompt too long",
    "context length",
    "maximum context",
    "context window",
    "token limit",
    "too many tokens",
    "request too large",
    "payload too large",
    "exceeds the context",
  ];
  if (patterns.some(pattern => text.includes(pattern))) {
    return true;
  }
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (status === 413 || status === 400) {
      return text.includes("context") || text.includes("token") || text.includes("length");
    }
  }
  return false;
}

function shrinkMessagesToTotalBudget(
  messages: ModelMessage[],
  totalCap: number,
  toolFloor: number,
): void {
  const placeholder = "[Dragon: tool output omitted to fit context budget]";
  let guard = 0;
  while (estimateModelMessagesChars(messages) > totalCap && guard < messages.length * 4) {
    guard += 1;
    const index = findLongestToolMessageIndex(messages);
    if (index === -1) {
      break;
    }
    const message = messages[index]!;
    if (typeof message.content !== "string") {
      break;
    }
    if (message.content.length <= placeholder.length) {
      break;
    }
    if (message.content.length > toolFloor) {
      message.content = truncateString(message.content, toolFloor, TRUNCATED_TOOL_SUFFIX);
      continue;
    }
    message.content = placeholder;
  }
}

function findLongestToolMessageIndex(messages: readonly ModelMessage[]): number {
  let bestIndex = -1;
  let bestLength = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role !== "tool" || typeof message.content !== "string") {
      continue;
    }
    if (message.content.length > bestLength) {
      bestLength = message.content.length;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function cloneModelMessage(message: ModelMessage): ModelMessage {
  const cloned: ModelMessage = { role: message.role };
  if (message.content !== undefined) {
    cloned.content = typeof message.content === "string"
      ? message.content
      : message.content.map(part => ({ ...part }));
  }
  if (message.name !== undefined) {
    cloned.name = message.name;
  }
  if (message.toolCallId !== undefined) {
    cloned.toolCallId = message.toolCallId;
  }
  if (message.toolCalls !== undefined) {
    cloned.toolCalls = message.toolCalls.map(call => ({
      ...call,
      ...(call.function !== undefined
        ? { function: { ...call.function } }
        : {}),
    }));
  }
  if (message.reasoningContent !== undefined) {
    cloned.reasoningContent = message.reasoningContent;
  }
  return cloned;
}

function estimateMessageChars(message: ModelMessage): number {
  let total = 32;
  if (typeof message.content === "string") {
    total += message.content.length;
  } else if (Array.isArray(message.content)) {
    total += estimateContentPartsChars(message.content);
  }
  if (message.reasoningContent !== undefined) {
    total += message.reasoningContent.length;
  }
  if (message.toolCalls !== undefined) {
    for (const call of message.toolCalls) {
      total += 48;
      if (call.function?.name !== undefined) {
        total += call.function.name.length;
      }
      if (call.function?.arguments !== undefined) {
        total += call.function.arguments.length;
      }
    }
  }
  return total;
}

function estimateContentPartsChars(parts: readonly ModelContentPart[]): number {
  let total = 0;
  for (const part of parts) {
    if (part.type === "text") {
      total += part.text.length;
    } else if (part.type === "image") {
      total += part.dataBase64.length;
    }
  }
  return total;
}

function truncateString(value: string, maxChars: number, suffix: string): string {
  if (maxChars <= 0 || value.length <= maxChars) {
    return value;
  }
  if (suffix.length >= maxChars) {
    return suffix.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - suffix.length)}${suffix}`;
}

function errorMessageText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
