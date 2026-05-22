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
    const rawToolName = TOOL_NAME_ALIASES[rawName] ?? rawName;
    const args = parseInnerToolFields(inner);
    if (!Object.keys(args).length) {
      continue;
    }
    const { name: toolName, args: normalizedArgs } = normalizeExtractedToolCall(rawToolName, args);
    calls.push({
      id: `text-tool-${index}-${randomBytes(4).toString("hex")}`,
      type: "function",
      function: {
        name: toolName,
        arguments: JSON.stringify(normalizedArgs),
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

/** Map common mistaken bash listings to file_read. */
function normalizeExtractedToolCall(
  toolName: string,
  args: Record<string, string>,
): { name: string; args: Record<string, string> } {
  if (toolName !== "shell_exec" || !args.command) {
    return { name: toolName, args };
  }
  const command = args.command.trim();
  if (/^(?:ls|dir)$/i.test(command)) {
    return { name: "file_read", args: { path: "." } };
  }
  if (/^(?:ls|dir)\s+-[a-zA-Z]+\s*$/i.test(command)) {
    return { name: "file_read", args: { path: "." } };
  }
  const flagsThenPath = /^(?:ls|dir)((?:\s+-[a-zA-Z]+)+)\s+(\S+)\s*$/i.exec(command);
  const withPath = flagsThenPath ?? /^(?:ls|dir)\s+(\S+)\s*$/i.exec(command);
  if (!withPath) {
    return { name: toolName, args };
  }
  const arg = flagsThenPath ? (withPath[2] ?? ".") : (withPath[1] ?? ".");
  if (arg.startsWith("-")) {
    return { name: toolName, args };
  }
  let target = arg;
  if (target === "/workspace" || target === "/workspace/") {
    target = ".";
  }
  return { name: "file_read", args: { path: target } };
}

export function appendWorkspaceToolGuidance(systemPrompt: string, workspace?: string): string {
  const root = workspace?.trim();
  if (root) {
    return `${systemPrompt}\n\nTooling: workspace root is "${root}" (there is no /workspace mount). List files with file_read on "." or a relative path. shell_exec only allows read-only git, ripgrep, and version checks — do not use bash/XML for ls, find, or pwd.`;
  }
  return `${systemPrompt}\n\nTooling: no workspace is configured for this turn — do not assume /workspace exists. Ask the user to set a workspace or use file_read only after a workspace path is provided. shell_exec only allows read-only git, ripgrep, and version checks — do not use bash/XML for ls, find, or pwd.`;
}

/** Prefer RPC final text; never fall back to unstripped tool XML. */
export function pickAssistantDisplayText(rpcText: string, streamText: string): string {
  const rpc = stripTextToolBlocks(rpcText).trim();
  const stream = stripTextToolBlocks(streamText).trim();
  return rpc || stream;
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
