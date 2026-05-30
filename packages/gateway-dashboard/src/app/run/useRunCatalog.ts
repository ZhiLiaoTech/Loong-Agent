import { useCallback, useEffect, useState } from "react";
import { GatewayApiError, type GatewayProviderSummary } from "../../api/index.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import { buildEmployeeIdentity } from "../organization/buildEmployeeIdentity.js";
import type { OrgPositionOption, OrgUnitOption } from "../organization/types.js";
import type { AgentConfigState, EmployeeCatalogState, GatewayRunRecord } from "./types.js";

const EMPTY_EMPLOYEES: EmployeeCatalogState = { employees: [] };

export function useRunCatalog(sessionId: string) {
  const client = useGatewayClient();
  const [units, setUnits] = useState<readonly OrgUnitOption[]>([]);
  const [positions, setPositions] = useState<readonly OrgPositionOption[]>([]);
  const [agentConfig, setAgentConfig] = useState<AgentConfigState>({ profiles: [] });
  const [employeeCatalog, setEmployeeCatalog] = useState<EmployeeCatalogState>(EMPTY_EMPLOYEES);
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
      const [configPayload, providerList, employeePayload, orgPayload] = await Promise.all([
        client.rpc<AgentConfigState>("agent.config.get").catch((): AgentConfigState => ({ profiles: [] })),
        client.listProviders(),
        client.rpc<EmployeeCatalogState>("employee.list").catch((): EmployeeCatalogState => EMPTY_EMPLOYEES),
        client.rpc<{ units?: OrgUnitOption[]; positions?: OrgPositionOption[] }>("org.get").catch(() => ({
          units: [],
          positions: [],
        })),
      ]);
      setUnits(orgPayload.units ?? []);
      setPositions(orgPayload.positions ?? []);
      setAgentConfig({
        profiles: configPayload.profiles ?? [],
        ...(configPayload.defaultProfileId
          ? { defaultProfileId: configPayload.defaultProfileId }
          : {}),
      });
      setEmployeeCatalog({
        employees: (employeePayload.employees ?? []).filter(entry => entry.status === "active"),
        ...(employeePayload.defaultEmployeeId
          ? { defaultEmployeeId: employeePayload.defaultEmployeeId }
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

  const employeeIdentity = buildEmployeeIdentity(
    employeeCatalog.employees,
    employeeCatalog.defaultEmployeeId,
    units,
    positions,
  );

  return {
    agentConfig,
    employeeCatalog,
    employeeIdentity,
    units,
    positions,
    providers,
    runs,
    modelSuggestions,
    error,
    refreshRuns,
    reload: load,
  };
}
