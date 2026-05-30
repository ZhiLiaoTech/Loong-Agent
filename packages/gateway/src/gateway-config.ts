import { applyProductionAuthDefaults, requiresSharedSecret } from "./auth-policy.js";

export interface GatewayConfig {
  host?: string;
  port?: number;
  authMode?: "none" | "shared-secret";
  sharedSecret?: string;
  /** When true, refuse to start on non-loopback binds without an explicit sharedSecret. */
  requireExplicitSecret?: boolean;
  /** Tool names allowed for direct `tool.invoke` (defaults to conservative git read tools). */
  toolInvokeAllowlist?: readonly string[];
}

export interface NormalizedGatewayConfig {
  host: string;
  port: number;
  authMode: "none" | "shared-secret";
  sharedSecret?: string;
  requireExplicitSecret: boolean;
  toolInvokeAllowlist: readonly string[];
}

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 17357;
export const DEFAULT_DIRECT_TOOL_NAMES = Object.freeze(["git_status", "git_diff", "git_log"]);

export function normalizeConfig(config: GatewayConfig): NormalizedGatewayConfig {
  const host = config.host ?? DEFAULT_HOST;
  if (config.requireExplicitSecret === true && requiresSharedSecret(host) && !config.sharedSecret?.trim()) {
    throw new Error(
      "Gateway requireExplicitSecret is enabled but sharedSecret is missing. "
      + "Set sharedSecret in gateway.json, --secret, or LOONG_GATEWAY_SECRET before binding beyond loopback.",
    );
  }
  const withAuth = applyProductionAuthDefaults({
    ...config,
    host,
  });
  const authMode = withAuth.authMode ?? (withAuth.sharedSecret ? "shared-secret" : "none");
  if (authMode === "shared-secret" && !withAuth.sharedSecret) {
    throw new Error("Gateway shared-secret auth requires sharedSecret.");
  }
  const toolInvokeAllowlist = config.toolInvokeAllowlist?.length
    ? Object.freeze([...config.toolInvokeAllowlist])
    : DEFAULT_DIRECT_TOOL_NAMES;
  const normalized: NormalizedGatewayConfig = {
    host: withAuth.host ?? DEFAULT_HOST,
    port: normalizePort(config.port),
    authMode,
    requireExplicitSecret: config.requireExplicitSecret === true,
    toolInvokeAllowlist,
  };
  if (withAuth.sharedSecret !== undefined) {
    normalized.sharedSecret = withAuth.sharedSecret;
  }
  return normalized;
}

export function normalizePort(port: number | undefined): number {
  if (port === undefined) {
    return DEFAULT_PORT;
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid gateway port: ${port}`);
  }
  return port;
}
