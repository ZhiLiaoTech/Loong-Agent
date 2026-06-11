/** Host surface exposed to Studio. */
export type HostSurface = "browser";

export interface HostCapabilities {
  surface: HostSurface;
  /** Start or ensure the local Loong Gateway process. */
  gatewayLifecycle: boolean;
  /** Read/write auth tokens via OS secure storage. */
  secureStorage: boolean;
  systemTray: boolean;
  minimizeToTrayOnClose: boolean;
  autostart: boolean;
  appUpdate: boolean;
  pickDataDirectory: boolean;
  exportDiagnostics: boolean;
  openPathInShell: boolean;
}

export interface GatewayHealthSnapshot {
  status: string;
  port?: number;
  pid?: number | null;
  uptimeMs?: number;
  message?: string;
}

export interface HostRuntime {
  readonly capabilities: HostCapabilities;
  getDataRoot(): Promise<string>;
  getGatewayUrl(): Promise<string>;
  getGatewayHealth(): Promise<GatewayHealthSnapshot>;
  startGateway(): Promise<GatewayHealthSnapshot>;
  restartGateway(): Promise<GatewayHealthSnapshot>;
  stopGateway(): Promise<void>;
  getAuthToken(): Promise<string>;
  setAuthToken(token: string): Promise<void>;
  clearAuthToken(): Promise<void>;
}
