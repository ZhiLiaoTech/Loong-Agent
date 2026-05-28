import { useCallback, useEffect, useState } from "react";
import { fetchGatewayHealth } from "../../api/index.js";
import { useSecret } from "../secret/SecretContext.js";
import { useGatewayClient } from "./useGatewayClient.js";

export type AuthGateState = {
  authRequired: boolean;
  healthOk: boolean;
  healthLabel: string;
  checking: boolean;
};

export function useAuthGate(): AuthGateState {
  const { secret, getSecret } = useSecret();
  const client = useGatewayClient();
  const [state, setState] = useState<AuthGateState>({
    authRequired: false,
    healthOk: false,
    healthLabel: "checking",
    checking: true,
  });

  const refresh = useCallback(async () => {
    setState(current => ({ ...current, checking: true }));
    const unauthenticated = await fetchGatewayHealth({ getSecret: () => "" }, { authorized: false });
    const needsAuth = unauthenticated.ok === false && unauthenticated.status === 401;

    if (needsAuth && !getSecret()) {
      setState({
        authRequired: true,
        healthOk: false,
        healthLabel: "auth required",
        checking: false,
      });
      return;
    }

    const health = await client.fetchHealth();
    if (health.ok === true) {
      setState({
        authRequired: false,
        healthOk: true,
        healthLabel: "online",
        checking: false,
      });
      return;
    }

    if (health.ok === false && health.status === 401) {
      setState({
        authRequired: true,
        healthOk: false,
        healthLabel: "auth required",
        checking: false,
      });
      return;
    }

    setState({
      authRequired: needsAuth,
      healthOk: false,
      healthLabel: "offline",
      checking: false,
    });
  }, [client, secret, getSecret]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return state;
}
