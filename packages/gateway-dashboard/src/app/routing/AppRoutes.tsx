import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AgentsPage } from "../../pages/AgentsPage.js";
import { ModelsPage } from "../../pages/ModelsPage.js";
import { ObservePage } from "../../pages/ObservePage.js";
import { RunPage } from "../../pages/RunPage.js";
import { SystemPage } from "../../pages/SystemPage.js";
import { EventsProvider } from "../events/EventsContext.js";
import { AppShell } from "../shell/AppShell.js";
import { useNavCounts } from "../shell/useNavCounts.js";
import { useThemeCycle } from "../theme/useThemeCycle.js";

function RoutedApp() {
  const { cycleTheme, themeLabel } = useThemeCycle();
  const navCounts = useNavCounts();

  return (
    <Routes>
      <Route
        element={
          <AppShell
            navCounts={navCounts}
            onThemeCycle={cycleTheme}
            themeLabel={themeLabel}
          />
        }
      >
        <Route index element={<Navigate to="/run" replace />} />
        <Route path="/run" element={<RunPage />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/observe" element={<ObservePage />} />
        <Route path="/system" element={<SystemPage />} />
      </Route>
    </Routes>
  );
}

export function AppRoutes() {
  return (
    <HashRouter>
      <EventsProvider>
        <RoutedApp />
      </EventsProvider>
    </HashRouter>
  );
}
