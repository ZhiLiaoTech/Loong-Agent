import type { GatewayHealthResult } from "@dragon/client";
import { useCallback, useEffect, useState } from "react";
import { useHost } from "../context/HostContext.js";
import { useLoongClient } from "../context/LoongClientContext.js";

export type GatewayConnectionState = "checking" | "online" | "offline" | "auth_required";

export function useGatewayReadiness(pollIntervalMs = 5000) {
  const { client, secret } = useLoongClient();
  const host = useHost();
  const [connectionState, setConnectionState] = useState<GatewayConnectionState>("checking");
  const [statusLabel, setStatusLabel] = useState("Checking gateway…");
  const [lastHealth, setLastHealth] = useState<GatewayHealthResult | null>(null);

  const refresh = useCallback(async () => {
    const unauthenticated = await client.gateway.fetchHealth({ authorized: false });
    const needsAuth =
      unauthenticated.ok === false && unauthenticated.status === 401 && !secret.trim();

    if (needsAuth) {
      setConnectionState("auth_required");
      setStatusLabel("Auth required");
      setLastHealth(unauthenticated);
      return { connectionState: "auth_required" as const, health: unauthenticated };
    }

    const health = await client.gateway.fetchHealth();
    setLastHealth(health);

    if (health.ok === true) {
      setConnectionState("online");
      setStatusLabel(`Gateway: ${health.name}`);
      return { connectionState: "online" as const, health };
    }

    setConnectionState("offline");
    setStatusLabel(health.ok === false ? health.error : "Gateway offline");
    return { connectionState: "offline" as const, health };
  }, [client, secret]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [pollIntervalMs, refresh]);

  return {
    client,
    host,
    connectionState,
    statusLabel,
    lastHealth,
    refresh,
    authRequired: connectionState === "auth_required",
    gatewayOnline: connectionState === "online",
  };
}
