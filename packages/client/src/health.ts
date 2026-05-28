import type { GatewayClientConfig } from "./config.js";
import { GatewayApiError } from "./errors.js";
import { apiUrl, buildAuthHeaders } from "./request.js";
import type { GatewayHealthPayload } from "./types.js";

export type GatewayHealthResult =
  | GatewayHealthPayload
  | { ok: false; error: string; status: number };

export async function fetchGatewayHealth(
  config: GatewayClientConfig,
  options: { authorized?: boolean } = {},
): Promise<GatewayHealthResult> {
  const authorized = options.authorized !== false;
  const headers = authorized ? buildAuthHeaders(config.getSecret) : {};

  const response = await fetch(apiUrl(config, "/health"), { headers });
  let json: Record<string, unknown>;
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new GatewayApiError("Gateway returned a non-JSON health response.", {
      status: response.status,
    });
  }

  if (!response.ok || json.ok !== true) {
    return {
      ok: false,
      error: typeof json.error === "string" ? json.error : "health failed",
      status: response.status,
    };
  }

  return json as unknown as GatewayHealthPayload;
}
