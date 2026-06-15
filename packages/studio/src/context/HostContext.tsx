import {
  createBrowserHost,
  createTauriHost,
  isTauriDesktopEnvironment,
  type HostRuntime,
} from "@loong/host";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { resolveGatewayUrl } from "@loong/client";

const HostContext = createContext<HostRuntime | null>(null);

export function HostProvider({ children }: { children: ReactNode }) {
  const gatewayUrl = resolveGatewayUrl();
  const host = useMemo(
    () =>
      isTauriDesktopEnvironment()
        ? createTauriHost({ gatewayUrl })
        : createBrowserHost({ gatewayUrl }),
    [gatewayUrl],
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
