export type { GatewayClientConfig } from "./config.js";
export { createGatewayClient, type GatewayClient } from "./client.js";
export { GatewayApiError } from "./errors.js";
export { gatewayRpc } from "./rpc.js";
export { fetchGatewayHealth, type GatewayHealthResult } from "./health.js";
export { openDragonEventStream, type DragonEventStreamHandle, type DragonEventStreamOptions } from "./sse.js";
export type {
  DragonEvent,
  GatewayConnectPayload,
  GatewayEventEnvelope,
  GatewayHealthPayload,
  GatewayProviderSummary,
  GatewayProvidersListPayload,
  SseConnectionStatus,
} from "./types.js";
