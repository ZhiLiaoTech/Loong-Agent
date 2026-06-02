import type { GatewayHealthResult } from "@loong/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHost } from "../context/HostContext.js";
import { useLoongClient } from "../context/LoongClientContext.js";
import { waitForGatewayHealth } from "../services/gatewayReadiness.js";

export type GatewayConnectionState = "checking" | "online" | "offline" | "auth_required";

export function useGatewayReadiness(pollIntervalMs = 5000) {
  const { client, secret } = useLoongClient();
  const host = useHost();
  const [connectionState, setConnectionState] = useState<GatewayConnectionState>("checking");
  const [statusLabel, setStatusLabel] = useState("Checking gateway…");
  const [lastHealth, setLastHealth] = useState<GatewayHealthResult | null>(null);
  const recoveryRef = useRef<Promise<void> | null>(null);

  const recoverGateway = useCallback(async () => {
    if (!host.capabilities.gatewayLifecycle) {
      return;
    }
    if (recoveryRef.current) {
      await recoveryRef.current;
      return;
    }
    const recovery = (async () => {
      setConnectionState("checking");
      setStatusLabel("Starting Gateway…");
      try {
        await host.startGateway();
        const ready = await waitForGatewayHealth(client.gateway, { timeoutMs: 15_000 });
        if (ready) {
          const health = await client.gateway.fetchHealth();
          setLastHealth(health);
          if (health.ok === true) {
            setConnectionState("online");
            setStatusLabel(`Gateway: ${health.name}`);
            return;
          }
        }
      } catch (error) {
        setStatusLabel(error instanceof Error ? error.message : String(error));
      }
      setConnectionState("offline");
    })();
    recoveryRef.current = recovery.finally(() => {
      recoveryRef.current = null;
    });
    await recoveryRef.current;
  }, [client.gateway, host]);

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

    if (host.capabilities.gatewayLifecycle) {
      await recoverGateway();
      const recovered = await client.gateway.fetchHealth().catch(() => null);
      if (recovered?.ok === true) {
        setLastHealth(recovered);
        setConnectionState("online");
        setStatusLabel(`Gateway: ${recovered.name}`);
        return { connectionState: "online" as const, health: recovered };
      }
    }

    setConnectionState("offline");
    setStatusLabel(health.ok === false ? health.error : "Gateway offline");
    return { connectionState: "offline" as const, health };
  }, [client, host, recoverGateway, secret]);

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
