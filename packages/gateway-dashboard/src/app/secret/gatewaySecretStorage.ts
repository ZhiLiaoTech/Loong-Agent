/** Session-scoped storage for the gateway shared secret (not provider API keys). */
export const GATEWAY_SECRET_STORAGE_KEY = "loong.gateway.secret";

export function readStoredGatewaySecret(): string {
  try {
    return globalThis.sessionStorage?.getItem(GATEWAY_SECRET_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function writeStoredGatewaySecret(value: string): void {
  try {
    const trimmed = value.trim();
    if (trimmed) {
      globalThis.sessionStorage?.setItem(GATEWAY_SECRET_STORAGE_KEY, trimmed);
    } else {
      globalThis.sessionStorage?.removeItem(GATEWAY_SECRET_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}
