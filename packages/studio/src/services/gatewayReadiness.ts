import type { GatewayClient } from "@dragon/client";
import type { HostRuntime } from "@dragon/host";

export type GatewayReadinessStage =
  | "checking"
  | "hot_reload_waiting"
  | "polling"
  | "starting"
  | "ready"
  | "failed";

export interface GatewayReadinessProgress {
  stage: GatewayReadinessStage;
  message?: string;
}

export interface WaitForGatewayHealthOptions {
  timeoutMs?: number;
  intervalMs?: number;
  authorized?: boolean;
  onProgress?: (progress: GatewayReadinessProgress) => void;
}

const DEFAULT_HOT_RELOAD_SETTLE_MS = 400;
const DEFAULT_RECOVERY_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 500;

export async function waitForGatewayHealth(
  client: GatewayClient,
  options: WaitForGatewayHealthOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RECOVERY_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    options.onProgress?.({ stage: "polling", message: "Waiting for Gateway…" });
    try {
      const health = await client.fetchHealth({
        ...(options.authorized === undefined ? {} : { authorized: options.authorized }),
      });
      if (health.ok === true) {
        return true;
      }
      if (health.ok === false && health.status === 401) {
        return false;
      }
    } catch {
      // network error — keep polling
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return false;
}

export interface EnsureGatewayReadyOptions {
  hotReloadSettleMs?: number;
  recoveryTimeoutMs?: number;
  onProgress?: (progress: GatewayReadinessProgress) => void;
}

/**
 * After model/agent config changes: wait for hot reload, or start Gateway via Host when available.
 */
export async function ensureGatewayReadyAfterConfigChange(
  deps: { client: GatewayClient; host: HostRuntime },
  options: EnsureGatewayReadyOptions = {},
): Promise<boolean> {
  const hotReloadSettleMs = options.hotReloadSettleMs ?? DEFAULT_HOT_RELOAD_SETTLE_MS;
  const recoveryTimeoutMs = options.recoveryTimeoutMs ?? DEFAULT_RECOVERY_TIMEOUT_MS;
  const onProgress = options.onProgress;

  onProgress?.({ stage: "checking", message: "Checking Gateway…" });
  const before = await deps.client.fetchHealth().catch(() => null);

  if (before?.ok === true) {
    onProgress?.({ stage: "hot_reload_waiting", message: "Waiting for config hot reload…" });
    await new Promise(resolve => setTimeout(resolve, hotReloadSettleMs));
    const after = await deps.client.fetchHealth().catch(() => null);
    if (after?.ok === true) {
      onProgress?.({ stage: "ready", message: "Gateway ready (hot reload)." });
      return true;
    }
  }

  if (deps.host.capabilities.gatewayLifecycle) {
    onProgress?.({ stage: "starting", message: "Starting Gateway…" });
    try {
      const started = await deps.host.startGateway();
      if (started.status === "running") {
        onProgress?.({ stage: "ready", message: "Gateway started." });
        return true;
      }
    } catch (error) {
      onProgress?.({
        stage: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const recovered = await waitForGatewayHealth(deps.client, {
    timeoutMs: recoveryTimeoutMs,
    ...(onProgress ? { onProgress } : {}),
  });
  if (recovered) {
    onProgress?.({ stage: "ready", message: "Gateway is online." });
  } else {
    onProgress?.({ stage: "failed", message: "Gateway did not become ready in time." });
  }
  return recovered;
}
