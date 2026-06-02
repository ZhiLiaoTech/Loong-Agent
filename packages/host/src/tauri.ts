import type { GatewayHealthSnapshot, HostCapabilities, HostRuntime } from "./types.js";

const DEFAULT_DESKTOP_GATEWAY_URL = "http://127.0.0.1:17357";

const DESKTOP_CAPABILITIES: HostCapabilities = {
  surface: "desktop",
  gatewayLifecycle: true,
  secureStorage: false,
  systemTray: true,
  minimizeToTrayOnClose: true,
  autostart: false,
  appUpdate: false,
  pickDataDirectory: false,
  exportDiagnostics: false,
  openPathInShell: false,
};

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function getGlobalRecord(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>;
}

export function isTauriDesktopEnvironment(): boolean {
  const globalRecord = getGlobalRecord();
  return "__TAURI_INTERNALS__" in globalRecord || "__TAURI__" in globalRecord;
}

async function loadInvoke(): Promise<TauriInvoke> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke as TauriInvoke;
}

async function invokeGatewayCommand<T>(command: string): Promise<T> {
  const invoke = await loadInvoke();
  return invoke<T>(command);
}

export function createTauriHost(options: { gatewayUrl?: string } = {}): HostRuntime {
  const gatewayUrl = options.gatewayUrl?.replace(/\/+$/, "") || DEFAULT_DESKTOP_GATEWAY_URL;

  return {
    capabilities: DESKTOP_CAPABILITIES,

    async getDataRoot() {
      return "";
    },

    async getGatewayUrl() {
      return gatewayUrl;
    },

    async getGatewayHealth() {
      return invokeGatewayCommand<GatewayHealthSnapshot>("get_gateway_health");
    },

    async startGateway() {
      return invokeGatewayCommand<GatewayHealthSnapshot>("start_gateway");
    },

    async restartGateway() {
      return invokeGatewayCommand<GatewayHealthSnapshot>("restart_gateway");
    },

    async stopGateway() {
      await invokeGatewayCommand<GatewayHealthSnapshot>("stop_gateway");
    },

    async getAuthToken() {
      return "";
    },

    async setAuthToken() {
      // TODO: wire to desktop secure storage once keyring lands.
    },

    async clearAuthToken() {
      // TODO: wire to desktop secure storage once keyring lands.
    },
  };
}
