import { theme } from "../tokens.js";

export type GatewayDisplayStatus = "running" | "starting" | "stopped" | "offline" | "degraded";

export interface StatusBarProps {
  status?: GatewayDisplayStatus;
  statusLabel?: string;
  gatewayUrl?: string;
  uptime?: string;
}

const statusColors: Record<GatewayDisplayStatus, string> = {
  running: theme.success,
  starting: theme.warning,
  stopped: theme.error,
  offline: theme.textMuted,
  degraded: theme.warning,
};

export function StatusBar({
  status = "offline",
  statusLabel,
  gatewayUrl,
  uptime,
}: StatusBarProps) {
  const label =
    statusLabel
    ?? (status === "running"
      ? "Gateway online"
      : status === "starting"
        ? "Starting…"
        : status === "stopped"
          ? "Gateway stopped"
          : "Gateway offline");

  return (
    <footer
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "6px 14px",
        borderTop: `1px solid ${theme.border}`,
        background: theme.surface2,
        fontSize: 12,
        color: theme.textSecondary,
      }}
    >
      <span style={{ color: statusColors[status], fontWeight: 600 }}>{label}</span>
      {gatewayUrl ? <span>URL: {gatewayUrl}</span> : null}
      {uptime ? <span>Uptime: {uptime}</span> : null}
    </footer>
  );
}
