import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { resolveGatewayUrl } from "@loong/client";

import { Sidebar, type SidebarStatusTone } from "@loong/ui";

import { useLoongEvents } from "@dashboard/app/events/EventsContext.js";

import { AuthBanner } from "./components/AuthBanner.js";

import { GatewayOffline } from "./components/GatewayOffline.js";

import { useGatewayReadiness } from "./hooks/useGatewayReadiness.js";

import { useI18n } from "./i18n/I18nContext.js";

import { ConnectionsPage } from "./pages/ConnectionsPage.js";

import { OrgPage } from "./pages/OrgPage.js";

import { ChatPage } from "./pages/ChatPage.js";

import { ModelsPage } from "./pages/ModelsPage.js";

import { SettingsPage } from "./pages/SettingsPage.js";



const PATH_TO_NAV: Record<string, string> = {

  "/chat": "chat",

  "/models": "models",

  "/org": "org",

  "/connections": "connections",

  "/settings": "settings",

};



const CHAT_PATH = "/chat";



function resolveSidebarTone(

  connectionState: string,

  sseStatus: string,

): SidebarStatusTone {

  if (connectionState === "online" && sseStatus === "live") {

    return "online";

  }

  if (connectionState === "checking" || sseStatus === "connecting") {

    return "starting";

  }

  return "offline";

}



function AppRoutes() {

  const { t } = useI18n();

  const location = useLocation();

  const navigate = useNavigate();

  const { client, connectionState, statusLabel, authRequired, refresh } = useGatewayReadiness();

  const { sseStatus } = useLoongEvents();



  const navItems = [

    { id: "chat", label: t("nav.chat"), path: "/chat", icon: "chat" as const },

    { id: "models", label: t("nav.models"), path: "/models", icon: "models" as const },

    { id: "org", label: t("nav.org"), path: "/org", icon: "org" as const },

    { id: "connections", label: t("nav.connections"), path: "/connections", icon: "connections" as const },

  ] as const;

  const settingsNavItem = {

    id: "settings",

    label: t("nav.settings"),

    path: "/settings",

    icon: "settings" as const,

  };



  const activeNav = PATH_TO_NAV[location.pathname] ?? "chat";

  const isChat = location.pathname === CHAT_PATH;

  const showOffline = connectionState === "offline";



  const sidebarStatusLabel = `${statusLabel}${

    sseStatus === "live"

      ? t("status.sseLive")

      : sseStatus === "connecting"

        ? t("status.sseConnecting")

        : ""

  }`;



  return (

    <div className="loong-app">

      <AuthBanner visible={authRequired} />



      <div className="loong-app-body">

        <Sidebar

          items={navItems}

          footerItem={settingsNavItem}

          activeId={activeNav}

          productName="Loong"

          status={{

            label: sidebarStatusLabel,

            tone: resolveSidebarTone(connectionState, sseStatus),

            gatewayUrl: resolveGatewayUrl(client.gatewayConfig.baseUrl),

          }}

          collapseLabel={t("sidebar.collapse")}

          expandLabel={t("sidebar.expand")}

          onSelect={id => {

            const item =

              id === settingsNavItem.id

                ? settingsNavItem

                : navItems.find(entry => entry.id === id);

            if (item) {

              navigate(item.path);

            }

          }}

        />



        <main className={`loong-main${isChat ? " loong-main--chat" : ""}`}>

          {showOffline ? (

            <GatewayOffline onRetry={() => void refresh()} />

          ) : (

            <Routes>

              <Route path="/" element={<Navigate to="/chat" replace />} />

              <Route path="/about" element={<Navigate to="/settings" replace />} />

              <Route path="/chat" element={<ChatPage />} />

              <Route path="/models" element={<ModelsPage />} />

              <Route path="/org" element={<OrgPage />} />
              <Route path="/connections" element={<ConnectionsPage />} />
              <Route path="/agents" element={<Navigate to="/org" replace />} />

              <Route path="/settings" element={<SettingsPage />} />

              <Route path="*" element={<Navigate to="/chat" replace />} />

            </Routes>

          )}

        </main>

      </div>

    </div>

  );

}



export function App() {

  return <AppRoutes />;

}

