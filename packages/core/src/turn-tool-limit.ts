import type { ModelMessage, ModelResponse, ModelToolCall } from "@dragon/providers";

export const TOOL_ITERATION_LIMIT_USER_MESSAGE =
  "You have reached the maximum number of tool iterations for this turn. "
  + "Do not call any more tools. Summarize what was accomplished, what remains blocked, "
  + "and give the user clear next steps.";

export interface ToolIterationLimitFinalizeInput {
  text?: string;
  toolCalls: ModelToolCall[];
  reasoningContent?: string;
}

export function appendToolIterationLimitFinalizeMessages(
  modelMessages: ModelMessage[],
  input: ToolIterationLimitFinalizeInput,
  limit: number,
): number {
  const assistantTurn: ModelMessage = {
    role: "assistant",
    content: input.text ?? "",
    toolCalls: input.toolCalls,
  };
  if (input.reasoningContent !== undefined && input.reasoningContent.length > 0) {
    assistantTurn.reasoningContent = input.reasoningContent;
  }
  modelMessages.push(assistantTurn);

  for (const toolCall of input.toolCalls) {
    modelMessages.push({
      role: "tool",
      toolCallId: toolCall.id,
      content: JSON.stringify({
        ok: false,
        code: "tool_iteration_limit",
        error: `Tool iteration limit (${limit}) reached. Summarize without further tools.`,
        toolCallId: toolCall.id,
      }),
    });
  }

  modelMessages.push({
    role: "user",
    content: TOOL_ITERATION_LIMIT_USER_MESSAGE,
  });
  return input.toolCalls.length;
}

export function toToolLimitFinalizeInput(response: ModelResponse): ToolIterationLimitFinalizeInput | undefined {
  if (!response.toolCalls || response.toolCalls.length === 0) {
    return undefined;
  }
  const input: ToolIterationLimitFinalizeInput = {
    toolCalls: response.toolCalls,
  };
  if (response.text !== undefined) {
    input.text = response.text;
  }
  if (response.reasoningContent !== undefined && response.reasoningContent.length > 0) {
    input.reasoningContent = response.reasoningContent;
  }
  return input;
}
