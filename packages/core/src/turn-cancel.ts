import type { ModelMessage, ModelToolCall } from "@loong/providers";

export const TOOL_CANCELLED_CODE = "turn_cancelled";

export function buildCancelledToolResultContent(toolCallId: string, reason?: string): string {
  return JSON.stringify({
    ok: false,
    code: TOOL_CANCELLED_CODE,
    error: reason ?? "Tool execution was cancelled before completion.",
    toolCallId,
  });
}

export function collectSatisfiedToolCallIds(messages: ModelMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role === "tool" && message.toolCallId) {
      ids.add(message.toolCallId);
    }
  }
  return ids;
}

/** Append synthetic tool results for tool calls that do not yet have a result message. */
export function appendCancelledToolResults(
  modelMessages: ModelMessage[],
  toolCalls: ModelToolCall[],
  reason?: string,
): number {
  const satisfied = collectSatisfiedToolCallIds(modelMessages);
  let appended = 0;
  for (const toolCall of toolCalls) {
    if (satisfied.has(toolCall.id)) {
      continue;
    }
    modelMessages.push({
      role: "tool",
      toolCallId: toolCall.id,
      content: buildCancelledToolResultContent(toolCall.id, reason),
    });
    satisfied.add(toolCall.id);
    appended += 1;
  }
  return appended;
}

/**
 * Insert missing tool results immediately after each assistant toolCalls block.
 * Providers require every tool_use id to have a tool_result before the next turn.
 */
export function repairModelMessagesAfterCancel(messages: ModelMessage[]): number {
  let repaired = 0;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role !== "assistant" || !message.toolCalls?.length) {
      continue;
    }

    const satisfied = new Set<string>();
    let scan = index + 1;
    while (scan < messages.length) {
      const next = messages[scan]!;
      if (next.role !== "tool") {
        break;
      }
      if (next.toolCallId) {
        satisfied.add(next.toolCallId);
      }
      scan += 1;
    }

    const inserts: ModelMessage[] = [];
    for (const toolCall of message.toolCalls) {
      if (satisfied.has(toolCall.id)) {
        continue;
      }
      inserts.push({
        role: "tool",
        toolCallId: toolCall.id,
        content: buildCancelledToolResultContent(toolCall.id),
      });
      repaired += 1;
    }

    if (inserts.length > 0) {
      messages.splice(scan, 0, ...inserts);
      index = scan + inserts.length - 1;
    }
  }
  return repaired;
}

export function isTurnCancelled(signal: AbortSignal | undefined, error?: unknown): boolean {
  if (signal?.aborted) {
    return true;
  }
  if (error instanceof Error && error.name === "LoongCancelledError") {
    return true;
  }
  return false;
}
