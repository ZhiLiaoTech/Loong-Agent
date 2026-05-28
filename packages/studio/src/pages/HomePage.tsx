import { theme } from "@dragon/ui";
import { useHost } from "../context/HostContext.js";
import { useLoongClient } from "../context/LoongClientContext.js";

export function HomePage({ onRefreshHealth }: { onRefreshHealth: () => void }) {
  const { client } = useLoongClient();
  const host = useHost();

  return (
    <section>
      <h1 style={{ margin: "0 0 8px", color: theme.text }}>Loong Studio</h1>
      <p style={{ color: theme.textSecondary, maxWidth: 560 }}>
        Unified workbench for the Dragon agent platform. Browser surface is active; desktop host
        capabilities arrive in <code>@dragon/desktop</code> (P4).
      </p>
      <ul style={{ color: theme.textSecondary, lineHeight: 1.7 }}>
        <li>
          Surface: <strong>{host.capabilities.surface}</strong>
        </li>
        <li>
          Gateway lifecycle managed by host:{" "}
          <strong>{host.capabilities.gatewayLifecycle ? "yes" : "no (start dragon gateway)"}</strong>
        </li>
      </ul>
      <button
        type="button"
        onClick={async () => {
          onRefreshHealth();
          try {
            const caps = await client.gateway.connect();
            alert(`Connected. Capabilities: ${caps.capabilities.length}`);
          } catch (error) {
            alert(error instanceof Error ? error.message : String(error));
          }
        }}
        style={{
          marginTop: 12,
          padding: "10px 16px",
          borderRadius: 8,
          border: "none",
          background: theme.accent,
          color: "#fff",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        Test Gateway connect
      </button>
    </section>
  );
}
