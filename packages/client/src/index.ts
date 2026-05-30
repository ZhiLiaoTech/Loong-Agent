export type { GatewayClientConfig } from "./config.js";
export { resolveBaseUrl } from "./config.js";
export { apiUrl, buildAuthHeaders, createRequestId } from "./request.js";
export { createGatewayClient, type GatewayClient } from "./client.js";
export { createLoongClient, type LoongClient, type LoongClientOptions } from "./create-loong-client.js";
export { GatewayApiError } from "./errors.js";
export { gatewayRpc } from "./rpc.js";
export { fetchGatewayHealth, type GatewayHealthResult } from "./health.js";
export {
  openLoongEventStream,
  type LoongEventStreamHandle,
  type LoongEventStreamOptions,
} from "./sse.js";
export {
  DEFAULT_GATEWAY_HOST,
  DEFAULT_GATEWAY_PORT,
  resolveGatewayUrl,
} from "./gateway-url.js";
export type {
  LoongEvent,
  GatewayConnectPayload,
  GatewayEventEnvelope,
  GatewayHealthPayload,
  GatewayProviderSummary,
  GatewayProvidersListPayload,
  SseConnectionStatus,
} from "./types.js";
