import { createBrowserHost, type HostRuntime } from "@dragon/host";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { resolveGatewayUrl } from "@dragon/client";

const HostContext = createContext<HostRuntime | null>(null);

export function HostProvider({ children }: { children: ReactNode }) {
  const host = useMemo(
    () => createBrowserHost({ gatewayUrl: resolveGatewayUrl() }),
    [],
  );
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

export function useHost(): HostRuntime {
  const context = useContext(HostContext);
  if (!context) {
    throw new Error("useHost must be used within HostProvider.");
  }
  return context;
}
