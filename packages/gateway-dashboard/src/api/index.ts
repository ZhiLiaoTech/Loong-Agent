export type { GatewayClientConfig } from "@dragon/client";
export {
  apiUrl,
  buildAuthHeaders,
  createGatewayClient,
  createRequestId,
  type GatewayClient,
  GatewayApiError,
  gatewayRpc,
  fetchGatewayHealth,
  type GatewayHealthResult,
  openDragonEventStream,
  type DragonEventStreamHandle,
  type DragonEventStreamOptions,
  resolveBaseUrl,
  resolveGatewayUrl,
  DEFAULT_GATEWAY_HOST,
  DEFAULT_GATEWAY_PORT,
} from "@dragon/client";
export type {
  DragonEvent,
  GatewayConnectPayload,
  GatewayEventEnvelope,
  GatewayHealthPayload,
  GatewayProviderSummary,
  GatewayProvidersListPayload,
  SseConnectionStatus,
} from "@dragon/client";
