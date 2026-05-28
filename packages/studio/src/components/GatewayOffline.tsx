import { theme } from "@dragon/ui";
import { resolveGatewayUrl } from "@dragon/client";
import { useLoongClient } from "../context/LoongClientContext.js";

export function GatewayOffline({ onRetry }: { onRetry: () => void }) {
  const { client } = useLoongClient();
  const gatewayUrl = resolveGatewayUrl(client.gatewayConfig.baseUrl);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "min(480px, 70vh)",
        padding: 32,
        textAlign: "center",
        color: theme.textSecondary,
      }}
    >
      <h2 style={{ margin: "0 0 8px", color: theme.text, fontSize: 20 }}>Gateway is offline</h2>
      <p style={{ margin: "0 0 20px", maxWidth: 480, lineHeight: 1.6 }}>
        Loong Studio needs a running Dragon Gateway at{" "}
        <code style={{ color: theme.accentLight }}>{gatewayUrl}</code>.
      </p>
      <ol
        style={{
          textAlign: "left",
          maxWidth: 520,
          margin: "0 0 24px",
          paddingLeft: 24,
          lineHeight: 1.8,
        }}
      >
        <li>
          In a terminal at the repo root, run:
          <pre
            style={{
              marginTop: 8,
              padding: "12px 14px",
              background: theme.surface2,
              borderRadius: 8,
              color: theme.text,
              overflow: "auto",
            }}
          >
            {`node packages/cli/dist/index.js gateway`}
          </pre>
        </li>
        <li>Wait until you see “Dragon gateway listening on …”.</li>
        <li>Click Retry below (or refresh this page).</li>
      </ol>
      <button
        type="button"
        onClick={onRetry}
        style={{
          padding: "10px 20px",
          borderRadius: 8,
          border: "none",
          background: theme.accent,
          color: "#fff",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Retry connection
      </button>
    </div>
  );
}
