import { createContext, useContext, type ReactNode } from "react";
import type { GatewayClient } from "../../api/index.js";

const GatewayClientContext = createContext<GatewayClient | null>(null);

export function GatewayClientProvider({
  client,
  children,
}: {
  client: GatewayClient;
  children: ReactNode;
}) {
  return <GatewayClientContext.Provider value={client}>{children}</GatewayClientContext.Provider>;
}

export function useInjectedGatewayClient(): GatewayClient | null {
  return useContext(GatewayClientContext);
}
