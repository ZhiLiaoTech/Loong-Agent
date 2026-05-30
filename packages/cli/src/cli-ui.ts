import { createInterface } from "node:readline/promises";
import type { LoongEvent, LoongPermissionHandler, LoongPermissionRequest } from "@loong/core";
import { DEFAULT_REDACTION, isSensitiveKey, redactSecretsInText } from "@loong/security";

export function createCliPermissionHandler(): LoongPermissionHandler | undefined {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    return undefined;
  }

  return async request => {
    process.stderr.write(formatPermissionRequest(request));
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      const answer = await rl.question("Allow this tool call? [y/N] ");
      const approved = /^(y|yes)$/i.test(answer.trim());
      return {
        decision: approved ? "allow" : "deny",
        reason: approved ? "User approved in CLI prompt." : "User denied in CLI prompt.",
        metadata: { surface: "cli" },
      };
    } finally {
      rl.close();
    }
  };
}

export function renderEvent(event: LoongEvent): void {
  if (event.type === "lifecycle" && event.phase === "start") {
    process.stderr.write("Loong is thinking...\n");
  }
  if (event.type === "tool") {
    process.stderr.write(`Tool ${event.phase}: ${event.toolName}\n`);
  }
}

export function formatMetadata(metadata: Record<string, unknown>): string {
  return Object.entries(metadata)
    .map(([key, value]) => `${key}: ${formatMetadataValue(key, value)}`)
    .join("\n");
}

function formatPermissionRequest(request: LoongPermissionRequest): string {
  return [
    "",
    `Permission required for tool: ${request.toolName}`,
    `Reason: ${request.reason}`,
    `Input: ${summarizePermissionInput(request)}`,
    "",
  ].join("\n");
}

function summarizePermissionInput(request: LoongPermissionRequest): string {
  if (request.toolName === "file_patch" && isRecord(request.input)) {
    return stringifyPreview({
      path: request.input.path,
      replaceAll: request.input.replaceAll,
      oldText: previewText(request.input.oldText),
      newText: previewText(request.input.newText),
    });
  }
  return stringifyPreview(request.input);
}

function stringifyPreview(value: unknown): string {
  const json = JSON.stringify(value, (key, item) => {
    if (isSensitiveKey(key)) {
      return DEFAULT_REDACTION;
    }
    return previewText(item);
  });
  if (!json) {
    return String(value);
  }
  return json.length > 1200 ? `${json.slice(0, 1200)}... [truncated]` : json;
}

function previewText(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return value.length > 300
    ? `${value.slice(0, 300)}... [${value.length} chars]`
    : value;
}

function formatMetadataValue(key: string, value: unknown): string {
  const text = String(value);
  if (isSensitiveKey(key) || /body/i.test(key)) {
    return redactSecretsInText(text, { compactWhitespace: true });
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
