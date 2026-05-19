import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../app/App.js";
import "../styles/v2-base.css";
import "../styles/workspace.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Dashboard mount point #root is missing.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
