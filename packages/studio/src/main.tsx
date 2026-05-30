import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@loong/ui/global.css";
import { App } from "./App.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { HostProvider } from "./context/HostContext.js";
import { GatewayReadinessProvider } from "./context/GatewayReadinessContext.js";
import { LoongClientProvider } from "./context/LoongClientContext.js";
import { WorkbenchProviders } from "./providers/WorkbenchProviders.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <HostProvider>
          <LoongClientProvider>
            <GatewayReadinessProvider>
              <WorkbenchProviders>
                <App />
              </WorkbenchProviders>
            </GatewayReadinessProvider>
          </LoongClientProvider>
        </HostProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
