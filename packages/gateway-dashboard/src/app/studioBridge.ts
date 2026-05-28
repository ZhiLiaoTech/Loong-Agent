export type StudioEnsureGatewayReady = (options?: {
  hotReloadSettleMs?: number;
  recoveryTimeoutMs?: number;
}) => Promise<boolean>;

let ensureGatewayReadyImpl: StudioEnsureGatewayReady | null = null;

export function registerStudioGatewayReadiness(fn: StudioEnsureGatewayReady | null): void {
  ensureGatewayReadyImpl = fn;
}

export function getStudioGatewayReadiness(): { ensureReady: StudioEnsureGatewayReady } | null {
  return ensureGatewayReadyImpl ? { ensureReady: ensureGatewayReadyImpl } : null;
}
