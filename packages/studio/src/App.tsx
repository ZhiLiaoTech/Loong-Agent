import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { resolveGatewayUrl } from "@dragon/client";
import { Sidebar, StatusBar, theme, type GatewayDisplayStatus } from "@dragon/ui";
import { useDragonEvents } from "@dashboard/app/events/EventsContext.js";
import { AuthBanner } from "./components/AuthBanner.js";
import { GatewayOffline } from "./components/GatewayOffline.js";
import { useGatewayReadiness } from "./hooks/useGatewayReadiness.js";
import { AgentsPage } from "./pages/AgentsPage.js";
import { ChatPage } from "./pages/ChatPage.js";
import { HomePage } from "./pages/HomePage.js";
import { ModelsPage } from "./pages/ModelsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";

const NAV_ITEMS = [
  { id: "chat", label: "Chat", icon: "💬", path: "/chat" },
  { id: "models", label: "Models", icon: "🧠", path: "/models" },
  { id: "agents", label: "Agents", icon: "🤖", path: "/agents" },
  { id: "settings", label: "Settings", icon: "⚙", path: "/settings" },
  { id: "home", label: "About", icon: "⌂", path: "/about" },
] as const;

const PATH_TO_NAV: Record<string, string> = {
  "/about": "home",
  "/chat": "chat",
  "/models": "models",
  "/agents": "agents",
  "/settings": "settings",
};

const WORKSPACE_PATHS = new Set(["/chat", "/models", "/agents"]);

function mapSseStatus(status: string): GatewayDisplayStatus {
  if (status === "live") {
    return "running";
  }
  if (status === "connecting") {
    return "starting";
  }
  return "offline";
}

function AppRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  const { client, connectionState, statusLabel, authRequired, gatewayOnline, refresh } =
    useGatewayReadiness();
  const { sseStatus } = useDragonEvents();

  const activeNav = PATH_TO_NAV[location.pathname] ?? "chat";
  const isWorkspace = WORKSPACE_PATHS.has(location.pathname);
  const showOffline = connectionState === "offline";

  const gatewayStatus: GatewayDisplayStatus =
    connectionState === "online"
      ? mapSseStatus(sseStatus)
      : connectionState === "checking"
        ? "starting"
        : "offline";

  const displayStatus =
    connectionState === "online" && gatewayOnline ? gatewayStatus : gatewayStatus;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <AuthBanner visible={authRequired} />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Sidebar
          items={NAV_ITEMS}
          activeId={activeNav}
          productName="Loong"
          onSelect={id => {
            const item = NAV_ITEMS.find(entry => entry.id === id);
            if (item) {
              navigate(item.path);
            }
          }}
        />
        <main
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "auto",
            background: theme.bg,
            padding: isWorkspace && !showOffline ? 0 : 20,
          }}
        >
          {showOffline ? (
            <GatewayOffline onRetry={() => void refresh()} />
          ) : (
            <Routes>
              <Route path="/" element={<Navigate to="/chat" replace />} />
              <Route path="/about" element={<HomePage onRefreshHealth={() => void refresh()} />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/models" element={<ModelsPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/chat" replace />} />
            </Routes>
          )}
        </main>
      </div>
      <StatusBar
        status={displayStatus}
        statusLabel={`${statusLabel}${sseStatus === "live" ? " · SSE live" : sseStatus === "connecting" ? " · SSE connecting" : ""}`}
        gatewayUrl={resolveGatewayUrl(client.gatewayConfig.baseUrl)}
      />
    </div>
  );
}

export function App() {
  return <AppRoutes />;
}
