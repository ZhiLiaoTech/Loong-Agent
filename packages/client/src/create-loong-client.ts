import { createBrowserHost, type HostRuntime } from "@loong/host";
import { createGatewayClient, type GatewayClient } from "./client.js";
import type { GatewayClientConfig } from "./config.js";
import { resolveGatewayUrl } from "./gateway-url.js";

export interface LoongClientOptions {
  host?: HostRuntime;
  baseUrl?: string;
  getSecret: () => string;
}

export interface LoongClient {
  host: HostRuntime;
  gateway: GatewayClient;
  readonly gatewayConfig: GatewayClientConfig;
}

export function createLoongClient(options: LoongClientOptions): LoongClient {
  const host = options.host ?? createBrowserHost();
  const baseUrl = options.baseUrl ?? resolveGatewayUrl();
  const gatewayConfig: GatewayClientConfig = {
    baseUrl,
    getSecret: options.getSecret,
  };
  return {
    host,
    gateway: createGatewayClient(gatewayConfig),
    gatewayConfig,
  };
}
