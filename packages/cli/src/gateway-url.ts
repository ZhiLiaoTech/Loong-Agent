import type { GatewayConfig } from "@dragon/gateway";

export function gatewayUrlFromConfig(config: GatewayConfig): string {
  const configuredHost = config.host ?? "127.0.0.1";
  const host = configuredHost === "0.0.0.0" || configuredHost === "::"
    ? "127.0.0.1"
    : configuredHost.includes(":") && !configuredHost.startsWith("[")
      ? `[${configuredHost}]`
      : configuredHost;
  const port = config.port ?? 17357;
  return `http://${host}:${port}`;
}
