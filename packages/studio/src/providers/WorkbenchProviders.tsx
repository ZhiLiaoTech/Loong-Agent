import type { ReactNode } from "react";
import { EventsProvider } from "@dashboard/app/events/EventsContext.js";
import { GatewayClientProvider } from "@dashboard/app/auth/GatewayClientContext.js";
import { useLoongClient } from "../context/LoongClientContext.js";

function GatewayClientBridge({ children }: { children: ReactNode }) {
  const { client } = useLoongClient();
  return <GatewayClientProvider client={client.gateway}>{children}</GatewayClientProvider>;
}

/** Shared providers for migrated gateway-dashboard workspaces. */
export function WorkbenchProviders({ children }: { children: ReactNode }) {
  return (
    <GatewayClientBridge>
      <EventsProvider>{children}</EventsProvider>
    </GatewayClientBridge>
  );
}
