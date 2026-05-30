import type { GatewayHealthSnapshot, HostCapabilities, HostRuntime } from "./types.js";

const BROWSER_CAPABILITIES: HostCapabilities = {
  surface: "browser",
  gatewayLifecycle: false,
  secureStorage: false,
  systemTray: false,
  minimizeToTrayOnClose: false,
  autostart: false,
  appUpdate: false,
  pickDataDirectory: false,
  exportDiagnostics: false,
  openPathInShell: false,
};

export function createBrowserHost(options: { gatewayUrl?: string } = {}): HostRuntime {
  const gatewayUrl = options.gatewayUrl?.replace(/\/+$/, "") ?? "";

  return {
    capabilities: BROWSER_CAPABILITIES,

    async getDataRoot() {
      return "";
    },

    async getGatewayUrl() {
      return gatewayUrl;
    },

    async getGatewayHealth() {
      return { status: "unknown" };
    },

    async startGateway() {
      throw new Error("Gateway lifecycle is not available in browser mode. Start `loong gateway` manually.");
    },

    async restartGateway() {
      throw new Error("Gateway lifecycle is not available in browser mode.");
    },

    async stopGateway() {
      // no-op
    },

    async getAuthToken() {
      return "";
    },

    async setAuthToken() {
      // Browser Studio uses session storage via SecretProvider.
    },

    async clearAuthToken() {
      // no-op
    },
  };
}

export async function probeGatewayHealth(gatewayUrl: string): Promise<GatewayHealthSnapshot> {
  const base = gatewayUrl.replace(/\/+$/, "");
  try {
    const response = await fetch(`${base}/health`);
    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok || json.ok !== true) {
      return {
        status: "offline",
        message: typeof json.error === "string" ? json.error : `HTTP ${response.status}`,
      };
    }
    const snapshot: GatewayHealthSnapshot = { status: "running" };
    if (typeof json.uptimeMs === "number") {
      snapshot.uptimeMs = json.uptimeMs;
    }
    if (typeof json.name === "string") {
      snapshot.message = json.name;
    }
    return snapshot;
  } catch (error) {
    return {
      status: "offline",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
