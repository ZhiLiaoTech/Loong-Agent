export type {
  GatewayHealthSnapshot,
  HostCapabilities,
  HostRuntime,
  HostSurface,
} from "./types.js";
export { createBrowserHost, probeGatewayHealth } from "./browser.js";
export { createTauriHost, isTauriDesktopEnvironment } from "./tauri.js";
export { notifyApprovalRequired, NAVIGATE_EVENT, type ApprovalNotificationOptions } from "./notifications.js";
