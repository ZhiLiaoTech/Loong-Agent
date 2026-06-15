import type { IncomingMessage } from "node:http";

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export type RateLimitRouteClass = "health" | "rpc" | "webhook" | "events" | "websocket";

const DEFAULT_LIMITS: Record<RateLimitRouteClass, RateLimitConfig> = {
  health: { windowMs: 60_000, maxRequests: 300 },
  rpc: { windowMs: 60_000, maxRequests: 1_200 },
  webhook: { windowMs: 60_000, maxRequests: 60 },
  events: { windowMs: 60_000, maxRequests: 30 },
  websocket: { windowMs: 60_000, maxRequests: 20 },
};

export class SlidingWindowRateLimiter {
  readonly #limits: Record<RateLimitRouteClass, RateLimitConfig>;
  readonly #buckets = new Map<string, number[]>();

  constructor(limits: Partial<Record<RateLimitRouteClass, RateLimitConfig>> = {}) {
    this.#limits = { ...DEFAULT_LIMITS, ...limits };
  }

  tryConsume(route: RateLimitRouteClass, clientKey: string): boolean {
    if (isLoopbackClientKey(clientKey)) {
      return true;
    }

    const config = this.#limits[route];
    const bucketKey = `${route}:${clientKey}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;
    const timestamps = (this.#buckets.get(bucketKey) ?? []).filter(timestamp => timestamp > windowStart);
    if (timestamps.length >= config.maxRequests) {
      this.#buckets.set(bucketKey, timestamps);
      return false;
    }
    timestamps.push(now);
    this.#buckets.set(bucketKey, timestamps);
    return true;
  }
}

export function clientRateLimitKey(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]!.trim();
  }
  return request.socket.remoteAddress ?? "unknown";
}

export function isLoopbackClientKey(clientKey: string): boolean {
  const normalized = clientKey.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "localhost" ||
    normalized === "::ffff:127.0.0.1" ||
    normalized.startsWith("127.")
  );
}

export function classifyHttpRoute(method: string | undefined, pathname: string): RateLimitRouteClass | undefined {
  if (method === "GET" && pathname === "/health") {
    return "health";
  }
  if (method === "GET" && pathname === "/events") {
    return "events";
  }
  if (method === "POST" && pathname === "/channels/webhook") {
    return "webhook";
  }
  if (method === "POST" && pathname === "/rpc") {
    return "rpc";
  }
  return undefined;
}
