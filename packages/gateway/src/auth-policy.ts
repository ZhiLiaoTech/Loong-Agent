import { randomBytes } from "node:crypto";

export interface GatewayAuthInput {
  host?: string;
  authMode?: "none" | "shared-secret";
  sharedSecret?: string;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1"
    || normalized === "localhost"
    || normalized === "::1"
    || normalized === "[::1]";
}

export function isWildcardBind(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "0.0.0.0" || normalized === "::" || normalized === "[::]";
}

export function requiresSharedSecret(host: string): boolean {
  return isWildcardBind(host) || !isLoopbackHost(host);
}

/**
 * Applies bind-aware auth defaults: loopback may stay open; wildcard or LAN bind
 * requires shared-secret (auto-generated when missing).
 */
export function applyProductionAuthDefaults<T extends GatewayAuthInput>(config: T): T {
  const host = config.host ?? "127.0.0.1";
  if (config.authMode === "shared-secret" || config.sharedSecret) {
    return {
      ...config,
      host,
      authMode: "shared-secret",
      sharedSecret: config.sharedSecret,
    };
  }
  if (!requiresSharedSecret(host)) {
    return { ...config, host, authMode: "none" };
  }
  const sharedSecret = config.sharedSecret ?? randomBytes(24).toString("hex");
  return {
    ...config,
    host,
    authMode: "shared-secret",
    sharedSecret,
  };
}

export function describeAuthStartup(config: { host: string; authMode: "none" | "shared-secret"; sharedSecret?: string }): string | undefined {
  if (config.authMode === "none") {
    if (requiresSharedSecret(config.host)) {
      return `[loong-gateway] WARNING: Gateway is bound to ${config.host} without authentication.`;
    }
    return `[loong-gateway] WARNING: Gateway auth is disabled. Set sharedSecret (or authMode: "shared-secret") before exposing this server beyond localhost.`;
  }
  if (requiresSharedSecret(config.host) && config.sharedSecret) {
    return `[loong-gateway] Gateway bound to ${config.host} with shared-secret auth (secret was auto-generated; check logs or config).`;
  }
  return undefined;
}
