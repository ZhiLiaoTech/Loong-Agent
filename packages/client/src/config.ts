export interface GatewayClientConfig {
  /** Origin prefix, e.g. "http://127.0.0.1:17357". Empty string uses same host. */
  baseUrl?: string;
  getSecret: () => string;
}

export function resolveBaseUrl(baseUrl?: string): string {
  if (baseUrl === undefined || baseUrl === "") {
    return "";
  }
  return baseUrl.replace(/\/+$/, "");
}
