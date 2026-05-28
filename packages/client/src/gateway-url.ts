export const DEFAULT_GATEWAY_HOST = "127.0.0.1";
export const DEFAULT_GATEWAY_PORT = 17357;

export function resolveGatewayUrl(baseUrl?: string): string {
  const trimmed = baseUrl?.trim();
  if (trimmed) {
    return trimmed.replace(/\/+$/, "");
  }
  return `http://${DEFAULT_GATEWAY_HOST}:${DEFAULT_GATEWAY_PORT}`;
}
