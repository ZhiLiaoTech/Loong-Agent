import { useCallback, useEffect, useState } from "react";
import { GatewayApiError } from "../../api/errors.js";
import type { GatewayProviderSummary } from "../../api/types.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import type { AgentConfigState, GatewayRunRecord } from "./types.js";

export function useRunCatalog(sessionId: string) {
  const client = useGatewayClient();
  const [agentConfig, setAgentConfig] = useState<AgentConfigState>({ profiles: [] });
  const [providers, setProviders] = useState<readonly GatewayProviderSummary[]>([]);
  const [runs, setRuns] = useState<readonly GatewayRunRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshRuns = useCallback(async () => {
    try {
      const payload = await client.rpc<{ runs: GatewayRunRecord[] }>("runs.list", {
        sessionId: sessionId.trim() || undefined,
        limit: 20,
      });
      setRuns(payload.runs ?? []);
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
    }
  }, [client, sessionId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [configPayload, providerList] = await Promise.all([
        client.rpc<AgentConfigState>("agent.config.get").catch((): AgentConfigState => ({ profiles: [] })),
        client.listProviders(),
      ]);
      setAgentConfig({
        profiles: configPayload.profiles ?? [],
        ...(configPayload.defaultProfileId
          ? { defaultProfileId: configPayload.defaultProfileId }
          : {}),
      });
      setProviders(providerList);
      await refreshRuns();
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
      setProviders(await client.listProviders().catch(() => []));
    }
  }, [client, refreshRuns]);

  useEffect(() => {
    void load();
  }, [load]);

  const modelSuggestions = providers.flatMap(provider => {
    const models = provider.models?.map(model => model.id) ?? [];
    if (provider.defaultModel && !models.includes(provider.defaultModel)) {
      return [provider.defaultModel, ...models];
    }
    return models;
  });

  return {
    agentConfig,
    providers,
    runs,
    modelSuggestions,
    error,
    refreshRuns,
    reload: load,
  };
}
