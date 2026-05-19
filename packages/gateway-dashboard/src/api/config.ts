export interface GatewayClientConfig {
  /** Origin prefix, e.g. "" for same host or "http://127.0.0.1:18787". */
  baseUrl?: string;
  getSecret: () => string;
}

export function resolveBaseUrl(baseUrl?: string): string {
  if (baseUrl === undefined || baseUrl === "") {
    return "";
  }
  return baseUrl.replace(/\/+$/, "");
}
