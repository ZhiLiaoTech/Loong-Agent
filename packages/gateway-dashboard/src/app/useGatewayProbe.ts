import { useCallback, useEffect, useState } from "react";
import {
  GatewayApiError,
  type GatewayConnectPayload,
  type GatewayProviderSummary,
} from "../api/index.js";
import { useGatewayClient } from "./auth/useGatewayClient.js";

export interface GatewayProbeState {
  loading: boolean;
  healthOk: boolean;
  healthDetail: string;
  connect: GatewayConnectPayload | null;
  providers: readonly GatewayProviderSummary[];
  error: string | null;
}

const initialState: GatewayProbeState = {
  loading: true,
  healthOk: false,
  healthDetail: "checking",
  connect: null,
  providers: [],
  error: null,
};

export function useGatewayProbe(): GatewayProbeState {
  const client = useGatewayClient();
  const [state, setState] = useState<GatewayProbeState>(initialState);

  const refresh = useCallback(async () => {
    setState(current => ({
      ...current,
      loading: true,
      error: null,
    }));
    try {
      const health = await client.fetchHealth();
      if (health.ok !== true) {
        setState(current => ({
          ...current,
          loading: false,
          healthOk: false,
          healthDetail: health.status === 401 ? "auth required" : "unavailable",
          connect: null,
          providers: [],
          error: null,
        }));
        return;
      }

      const [connect, providers] = await Promise.all([
        client.connect(),
        client.listProviders(),
      ]);

      setState(current => ({
        ...current,
        loading: false,
        healthOk: true,
        healthDetail: `${health.name} · ${Math.round((health.uptimeMs ?? 0) / 1000)}s uptime`,
        connect,
        providers,
        error: null,
      }));
    } catch (error) {
      const message = error instanceof GatewayApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
      setState(current => ({
        ...current,
        loading: false,
        healthOk: false,
        healthDetail: "offline",
        connect: null,
        providers: [],
        error: message,
      }));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return state;
}
