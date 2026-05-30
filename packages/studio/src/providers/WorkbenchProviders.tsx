import type { ReactNode } from "react";
import { EventsProvider } from "@dashboard/app/events/EventsContext.js";
import { GatewayClientProvider } from "@dashboard/app/auth/GatewayClientContext.js";
import { WorkbenchI18nProvider } from "@dashboard/app/i18n/WorkbenchI18nContext.js";
import { useLoongClient } from "../context/LoongClientContext.js";
import { I18nProvider, useI18n } from "../i18n/I18nContext.js";

function GatewayClientBridge({ children }: { children: ReactNode }) {
  const { client } = useLoongClient();
  return <GatewayClientProvider client={client.gateway}>{children}</GatewayClientProvider>;
}

function WorkbenchI18nBridge({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return <WorkbenchI18nProvider translate={t}>{children}</WorkbenchI18nProvider>;
}

/** Shared providers for migrated gateway-dashboard workspaces. */
export function WorkbenchProviders({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <WorkbenchI18nBridge>
        <GatewayClientBridge>
          <EventsProvider>{children}</EventsProvider>
        </GatewayClientBridge>
      </WorkbenchI18nBridge>
    </I18nProvider>
  );
}
