/** Minimal Loong event shape from Gateway SSE envelopes. */
export interface LoongEvent {
  type: string;
  runId?: string;
  phase?: string;
  text?: string;
  message?: string;
  toolName?: string;
  [key: string]: unknown;
}

export interface GatewayEventEnvelope {
  type: "event";
  sequence: number;
  timestamp: string;
  sessionId?: string;
  event: LoongEvent;
}

export interface GatewayRpcResponse<T = unknown> {
  type: "response";
  id: string;
  ok: boolean;
  payload?: T;
  error?: string;
}

export interface GatewayHealthAddress {
  url?: string;
}

export interface GatewayHealthPayload {
  ok: true;
  name: string;
  startedAt?: string;
  uptimeMs?: number;
  address?: string | GatewayHealthAddress;
  pluginCount?: number;
  providerCount?: number;
}

export interface GatewayConnectPayload {
  protocolVersion: number;
  serverTime: string;
  capabilities: readonly string[];
}

export interface GatewayProviderSummary {
  id: string;
  displayName: string;
  defaultModel?: string;
  supportsToolCalling: boolean;
  models?: readonly {
    id: string;
    displayName?: string;
    default?: boolean;
    contextWindow?: number;
    capabilities?: { toolCalling?: boolean };
    aliases?: readonly string[];
  }[];
}

export interface GatewayProvidersListPayload {
  providers: readonly GatewayProviderSummary[];
}

export type SseConnectionStatus = "connecting" | "live" | "disconnected" | "error";
