import type { GatewayClientConfig } from "./config.js";
import { resolveBaseUrl } from "./config.js";

export function createRequestId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function buildAuthHeaders(
  getSecret: GatewayClientConfig["getSecret"],
  json = false,
): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) {
    headers["content-type"] = "application/json";
  }
  const secret = getSecret().trim();
  if (secret) {
    headers.authorization = `Bearer ${secret}`;
  }
  return headers;
}

export function apiUrl(config: GatewayClientConfig, path: string): string {
  const base = resolveBaseUrl(config.baseUrl);
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}
