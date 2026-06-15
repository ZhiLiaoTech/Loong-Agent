import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { Sidebar, type SidebarStatusTone } from "@loong/ui";

import { NAVIGATE_EVENT } from "@loong/host";

import { useLoongEvents } from "@dashboard/app/events/EventsContext.js";

import { useNavCounts } from "@dashboard/app/shell/useNavCounts.js";

import { AuthBanner } from "./components/AuthBanner.js";

import { GatewayOffline } from "./components/GatewayOffline.js";

import { useGatewayReadiness } from "./hooks/useGatewayReadiness.js";

import { useI18n } from "./i18n/I18nContext.js";

import { ConnectionsPage } from "./pages/ConnectionsPage.js";

import { OrgPage } from "./pages/OrgPage.js";

import { ChatPage } from "./pages/ChatPage.js";

import { ObservePage } from "./pages/ObservePage.js";

import { ModelsPage } from "./pages/ModelsPage.js";

import { SettingsPage } from "./pages/SettingsPage.js";



const PATH_TO_NAV: Record<string, string> = {

  "/chat": "chat",

  "/models": "models",

  "/org": "org",

  "/connections": "connections",

  "/observe": "observe",

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

  const { connectionState, authRequired, refresh } = useGatewayReadiness();

  const { sseStatus } = useLoongEvents();

  const navCounts = useNavCounts();



  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string }>).detail;
      if (detail?.path) {
        navigate(detail.path);
      }
    };
    globalThis.addEventListener(NAVIGATE_EVENT, handler);
    return () => globalThis.removeEventListener(NAVIGATE_EVENT, handler);
  }, [navigate]);



  const pendingApprovals = navCounts.observePending ?? 0;

  const navItems = [

    { id: "chat", label: t("nav.chat"), path: "/chat", icon: "chat" as const },

    { id: "models", label: t("nav.models"), path: "/models", icon: "models" as const },

    { id: "org", label: t("nav.org"), path: "/org", icon: "org" as const },

    { id: "observe", label: t("nav.observe"), path: "/observe", icon: "observe" as const, ...(pendingApprovals > 0 ? { badge: pendingApprovals } : {}) },

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



  const sidebarStatusLabel = authRequired
    ? t("status.gatewayAuthRequired")
    : connectionState === "online" && sseStatus === "live"
      ? t("status.gatewayOnline")
      : connectionState === "checking" || sseStatus === "connecting"
        ? t("status.gatewayConnecting")
        : t("status.gatewayOffline");



  return (

    <div className="loong-app">

      <AuthBanner visible={authRequired} />



      <div className="loong-app-body">

        <Sidebar

          items={navItems}

          footerItem={settingsNavItem}

          activeId={activeNav}

          variant="icon"

          productName="Loong"

          status={{

            label: sidebarStatusLabel,

            tone: resolveSidebarTone(connectionState, sseStatus),

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
              <Route path="/observe" element={<ObservePage />} />
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

