import { isTauriDesktopEnvironment } from "./tauri.js";

export interface ApprovalNotificationOptions {
  approvalId: string;
  toolName: string;
  reason: string;
  navigatePath?: string;
}

const NAVIGATE_EVENT = "loong:navigate";

let permissionRequested = false;

async function focusDesktopWindow(): Promise<void> {
  if (!isTauriDesktopEnvironment()) {
    return;
  }
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window = getCurrentWindow();
    await window.show();
    await window.setFocus();
  } catch {
    // Ignore focus failures on unsupported hosts.
  }
}

function dispatchNavigate(path: string): void {
  if (typeof globalThis.dispatchEvent !== "function") {
    return;
  }
  globalThis.dispatchEvent(new CustomEvent<{ path: string }>(NAVIGATE_EVENT, { detail: { path } }));
}

async function ensureWebNotificationPermission(): Promise<boolean> {
  if (typeof globalThis.Notification === "undefined") {
    return false;
  }
  if (Notification.permission === "granted") {
    return true;
  }
  if (Notification.permission === "denied") {
    return false;
  }
  if (!permissionRequested) {
    permissionRequested = true;
    const result = await Notification.requestPermission();
    return result === "granted";
  }
  return false;
}

export async function notifyApprovalRequired(options: ApprovalNotificationOptions): Promise<void> {
  const title = `Loong · ${options.toolName}`;
  const body = options.reason.trim() || "A tool call is waiting for your approval.";
  const navigatePath = options.navigatePath ?? `/observe?approval=${encodeURIComponent(options.approvalId)}`;

  const handleClick = () => {
    void focusDesktopWindow();
    dispatchNavigate(navigatePath);
  };

  if (!(await ensureWebNotificationPermission())) {
    return;
  }

  const notification = new Notification(title, {
    body,
    tag: options.approvalId,
  });
  notification.onclick = () => {
    handleClick();
    notification.close();
  };
}

export { NAVIGATE_EVENT };
