import type { DragonGatewayWebhookPayload } from "@dragon/channels";

export type { DragonGatewayWebhookPayload } from "@dragon/channels";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertDragonGatewayWebhookPayload(
  value: unknown,
): asserts value is DragonGatewayWebhookPayload {
  if (!isRecord(value)) {
    throw new Error("Webhook payload must be a JSON object.");
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    throw new Error("Webhook payload requires non-empty sessionId.");
  }
  if (typeof value.message !== "string" || !value.message.trim()) {
    throw new Error("Webhook payload requires non-empty message.");
  }
  if (typeof value.channel !== "string" || !value.channel.trim()) {
    throw new Error("Webhook payload requires non-empty channel.");
  }
  if (value.thinking !== undefined) {
    const allowed = new Set(["none", "low", "medium", "high"]);
    if (!allowed.has(String(value.thinking))) {
      throw new Error(`Invalid webhook thinking level: ${String(value.thinking)}`);
    }
  }
  if (value.toolsEnabled !== undefined && typeof value.toolsEnabled !== "boolean") {
    throw new Error("Webhook toolsEnabled must be a boolean.");
  }
  if (value.memoryEnabled !== undefined && typeof value.memoryEnabled !== "boolean") {
    throw new Error("Webhook memoryEnabled must be a boolean.");
  }
}
