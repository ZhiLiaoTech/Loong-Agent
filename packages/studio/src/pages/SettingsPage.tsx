import { useCallback, useEffect, useState } from "react";
import { resolveGatewayUrl } from "@dragon/client";
import { theme } from "@dragon/ui";
import { useLoongClient } from "../context/LoongClientContext.js";
import { useStudioGatewayReadiness } from "../context/GatewayReadinessContext.js";

export function SettingsPage() {
  const { secret, setSecret, client } = useLoongClient();
  const { ensureReady } = useStudioGatewayReadiness();
  const [modelConfigPath, setModelConfigPath] = useState<string | null>(null);
  const [agentConfigPath, setAgentConfigPath] = useState<string | null>(null);
  const [readinessMessage, setReadinessMessage] = useState<string | null>(null);

  const loadPaths = useCallback(async () => {
    try {
      const [modelConfig, agentConfig] = await Promise.all([
        client.gateway.rpc<{ configPath?: string }>("model.config.get"),
        client.gateway.rpc<{ configPath?: string }>("agent.config.get"),
      ]);
      setModelConfigPath(modelConfig.configPath ?? null);
      setAgentConfigPath(agentConfig.configPath ?? null);
    } catch {
      setModelConfigPath(null);
      setAgentConfigPath(null);
    }
  }, [client]);

  useEffect(() => {
    void loadPaths();
  }, [loadPaths]);

  return (
    <section style={{ maxWidth: 520 }}>
      <h1 style={{ color: theme.text }}>Settings</h1>
      <p style={{ color: theme.textSecondary }}>
        Gateway URL: <code>{resolveGatewayUrl(client.gatewayConfig.baseUrl)}</code>
      </p>

      <h2 style={{ fontSize: 14, color: theme.text, marginTop: 24 }}>Authentication</h2>
      <label style={{ display: "block", marginTop: 8, color: theme.textSecondary }}>
        Shared secret (Bearer)
        <input
          type="password"
          value={secret}
          onChange={event => setSecret(event.target.value)}
          autoComplete="off"
          style={{
            display: "block",
            width: "100%",
            marginTop: 6,
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${theme.border}`,
            background: theme.surface2,
            color: theme.text,
          }}
        />
      </label>
      <p style={{ fontSize: 12, color: theme.textMuted, marginTop: 8 }}>
        Stored in sessionStorage for this tab (<code>dragon.gateway.secret</code>).
      </p>

      <h2 style={{ fontSize: 14, color: theme.text, marginTop: 24 }}>Config on disk</h2>
      <ul style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 1.7, paddingLeft: 20 }}>
        <li>
          Model providers:{" "}
          <code>{modelConfigPath ?? "(unavailable — is Gateway running?)"}</code>
        </li>
        <li>
          Agent profiles:{" "}
          <code>{agentConfigPath ?? "(unavailable — is Gateway running?)"}</code>
        </li>
      </ul>
      <button
        type="button"
        onClick={() => void loadPaths()}
        style={{
          marginTop: 8,
          padding: "8px 14px",
          borderRadius: 8,
          border: `1px solid ${theme.border}`,
          background: theme.surface2,
          color: theme.text,
          cursor: "pointer",
        }}
      >
        Refresh paths
      </button>

      <h2 style={{ fontSize: 14, color: theme.text, marginTop: 24 }}>Gateway readiness</h2>
      <p style={{ color: theme.textSecondary, fontSize: 13 }}>
        After saving model config, Studio waits for Gateway hot reload (browser mode does not start
        the process for you).
      </p>
      <button
        type="button"
        onClick={() => {
          void ensureReady({
            onProgress: progress => setReadinessMessage(progress.message ?? progress.stage),
          }).then(ok => {
            setReadinessMessage(current =>
              ok ? "Gateway ready." : current ?? "Gateway not ready.",
            );
          });
        }}
        style={{
          marginTop: 8,
          padding: "8px 14px",
          borderRadius: 8,
          border: "none",
          background: theme.accent,
          color: "#fff",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        Check Gateway readiness
      </button>
      {readinessMessage ? (
        <p style={{ fontSize: 12, color: theme.textMuted, marginTop: 8 }}>{readinessMessage}</p>
      ) : null}
    </section>
  );
}
