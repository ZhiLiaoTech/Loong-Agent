import { randomBytes } from "node:crypto";
import type { ModelResponse, ModelToolCall } from "@dragon/providers";

const XML_TOOL_BLOCK = /<([a-z][a-z0-9_]*)\s*>([\s\S]*?)<\/\1>/gi;

const TOOL_NAME_ALIASES: Record<string, string> = {
  bash: "shell_exec",
  shell: "shell_exec",
  sh: "shell_exec",
  read_file: "file_read",
  read: "file_read",
  search: "file_search",
  grep: "file_search",
};

export interface AugmentedModelResponse extends ModelResponse {
  textToolCallsExtracted?: boolean;
}

export function stripTextToolBlocks(text: string): string {
  return text.replace(XML_TOOL_BLOCK, "").trim();
}

export function extractTextToolCalls(text: string): ModelToolCall[] {
  if (!text.includes("<")) {
    return [];
  }

  const calls: ModelToolCall[] = [];
  let index = 0;
  for (const match of text.matchAll(XML_TOOL_BLOCK)) {
    const rawName = match[1]?.trim().toLowerCase();
    const inner = match[2]?.trim() ?? "";
    if (!rawName) {
      continue;
    }
    const toolName = TOOL_NAME_ALIASES[rawName] ?? rawName;
    const args = parseInnerToolFields(inner);
    if (!Object.keys(args).length) {
      continue;
    }
    calls.push({
      id: `text-tool-${index}-${randomBytes(4).toString("hex")}`,
      type: "function",
      function: {
        name: toolName,
        arguments: JSON.stringify(args),
      },
    });
    index += 1;
  }
  return calls;
}

function parseInnerToolFields(inner: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const fieldPattern = /<([a-z][a-z0-9_-]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of inner.matchAll(fieldPattern)) {
    const key = match[1]?.trim();
    const value = match[2]?.trim();
    if (key && value !== undefined) {
      fields[key] = value;
    }
  }
  if (!Object.keys(fields).length) {
    const body = inner.trim();
    if (body) {
      fields.command = body;
    }
  }
  return fields;
}

export function augmentResponseWithTextToolCalls(
  response: ModelResponse,
  toolsEnabled?: boolean,
): AugmentedModelResponse {
  if (toolsEnabled === false || response.toolCalls?.length) {
    return response;
  }
  const extracted = extractTextToolCalls(response.text ?? "");
  if (!extracted.length) {
    return response;
  }
  const cleanedText = stripTextToolBlocks(response.text ?? "");
  return {
    ...response,
    toolCalls: extracted,
    textToolCallsExtracted: true,
    ...(cleanedText.length > 0 ? { text: cleanedText } : { text: "" }),
  };
}
