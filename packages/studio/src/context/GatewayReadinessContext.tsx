import { registerStudioGatewayReadiness } from "@dashboard/app/studioBridge.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  ensureGatewayReadyAfterConfigChange,
  type EnsureGatewayReadyOptions,
  type GatewayReadinessProgress,
} from "../services/gatewayReadiness.js";
import { useHost } from "./HostContext.js";
import { useLoongClient } from "./LoongClientContext.js";

interface GatewayReadinessContextValue {
  ensureReady: (options?: EnsureGatewayReadyOptions) => Promise<boolean>;
}

const GatewayReadinessContext = createContext<GatewayReadinessContextValue | null>(null);

export function GatewayReadinessProvider({ children }: { children: ReactNode }) {
  const { client } = useLoongClient();
  const host = useHost();

  const ensureReady = useCallback(
    (options?: EnsureGatewayReadyOptions) =>
      ensureGatewayReadyAfterConfigChange({ client: client.gateway, host }, options),
    [client, host],
  );

  const value = useMemo(() => ({ ensureReady }), [ensureReady]);

  useEffect(() => {
    registerStudioGatewayReadiness(ensureReady);
    return () => registerStudioGatewayReadiness(null);
  }, [ensureReady]);

  return (
    <GatewayReadinessContext.Provider value={value}>{children}</GatewayReadinessContext.Provider>
  );
}

export function useStudioGatewayReadiness(): GatewayReadinessContextValue {
  const context = useContext(GatewayReadinessContext);
  if (!context) {
    throw new Error("useStudioGatewayReadiness must be used within GatewayReadinessProvider.");
  }
  return context;
}

export type { GatewayReadinessProgress };
