import type { GatewayClientConfig } from "./config.js";
import { GatewayApiError } from "./errors.js";
import { apiUrl, buildAuthHeaders, createRequestId } from "./request.js";
import type { GatewayRpcResponse } from "./types.js";

export async function gatewayRpc<TResult = unknown, TParams = unknown>(
  config: GatewayClientConfig,
  type: string,
  params?: TParams,
): Promise<TResult> {
  const body: { type: string; id: string; params?: TParams } = {
    type,
    id: createRequestId(),
  };
  if (params !== undefined) {
    body.params = params;
  }

  const response = await fetch(apiUrl(config, "/rpc"), {
    method: "POST",
    headers: buildAuthHeaders(config.getSecret, true),
    body: JSON.stringify(body),
  });

  let json: GatewayRpcResponse<TResult>;
  try {
    json = (await response.json()) as GatewayRpcResponse<TResult>;
  } catch {
    throw new GatewayApiError("Gateway returned a non-JSON RPC response.", {
      status: response.status,
      rpcType: type,
    });
  }

  if (!response.ok || !json.ok) {
    throw new GatewayApiError(json.error || "RPC failed", {
      status: response.status,
      rpcType: type,
    });
  }

  return json.payload as TResult;
}
