import type { GatewayClientConfig } from "./config.js";
import { fetchGatewayHealth, type GatewayHealthResult } from "./health.js";
import { gatewayRpc } from "./rpc.js";
import { openLoongEventStream, type LoongEventStreamOptions, type LoongEventStreamHandle } from "./sse.js";
import type {
  GatewayConnectPayload,
  GatewayProviderSummary,
  GatewayProvidersListPayload,
} from "./types.js";

export interface GatewayClient {
  rpc<TResult = unknown, TParams = unknown>(type: string, params?: TParams): Promise<TResult>;
  fetchHealth(options?: { authorized?: boolean }): Promise<GatewayHealthResult>;
  connect(): Promise<GatewayConnectPayload>;
  listProviders(): Promise<readonly GatewayProviderSummary[]>;
  openEvents(options: LoongEventStreamOptions): LoongEventStreamHandle;
}

export function createGatewayClient(config: GatewayClientConfig): GatewayClient {
  return {
    rpc: (type, params) => gatewayRpc(config, type, params),
    fetchHealth: (options) => fetchGatewayHealth(config, options),
    connect: () => gatewayRpc<GatewayConnectPayload>(config, "connect"),
    listProviders: async () => {
      const payload = await gatewayRpc<GatewayProvidersListPayload>(config, "providers.list");
      return payload.providers ?? [];
    },
    openEvents: (options) => openLoongEventStream(config, options),
  };
}
