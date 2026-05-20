import { useCallback, useEffect, useState } from "react";
import { GatewayApiError } from "../../api/errors.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import type { DigitalEmployeeSummary } from "../run/types.js";

export interface OrgUnitView {
  id: string;
  name: string;
  parentId?: string;
}

export interface OrgPositionView {
  id: string;
  name: string;
  unitId: string;
  level?: string;
}

export interface ApprovalChainView {
  id: string;
  name: string;
  steps: readonly Record<string, unknown>[];
}

export interface EmployeeRoutingRuleView {
  id?: string;
  employeeId: string;
  match: {
    keywords?: readonly string[];
    profileId?: string;
  };
}

export interface ToolPolicyView {
  id: string;
  description?: string;
  ruleCount: number;
}

export interface OrgPageState {
  units: readonly OrgUnitView[];
  positions: readonly OrgPositionView[];
  approvalChains: readonly ApprovalChainView[];
  employeeRouting: readonly EmployeeRoutingRuleView[];
  employees: readonly DigitalEmployeeSummary[];
  toolPolicies: readonly ToolPolicyView[];
  defaultEmployeeId?: string;
}

export function useOrgPage() {
  const client = useGatewayClient();
  const [state, setState] = useState<OrgPageState>({
    units: [],
    positions: [],
    approvalChains: [],
    employeeRouting: [],
    employees: [],
    toolPolicies: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [orgPayload, employeePayload, policyPayload] = await Promise.all([
        client.rpc<{
          units?: OrgUnitView[];
          positions?: OrgPositionView[];
          approvalChains?: ApprovalChainView[];
          employeeRouting?: EmployeeRoutingRuleView[];
        }>("org.get"),
        client.rpc<{ employees: DigitalEmployeeSummary[]; defaultEmployeeId?: string }>("employee.list"),
        client.rpc<{ policies: Array<{ id: string; description?: string; rules?: unknown[] }> }>(
          "policy.tool.get",
        ).catch(() => ({ policies: [] })),
      ]);
      setState({
        units: orgPayload.units ?? [],
        positions: orgPayload.positions ?? [],
        approvalChains: orgPayload.approvalChains ?? [],
        employeeRouting: orgPayload.employeeRouting ?? [],
        toolPolicies: (policyPayload.policies ?? []).map(policy => ({
          id: policy.id,
          ...(policy.description ? { description: policy.description } : {}),
          ruleCount: policy.rules?.length ?? 0,
        })),
        employees: (employeePayload.employees ?? []).filter(entry => entry.status === "active"),
        ...(employeePayload.defaultEmployeeId
          ? { defaultEmployeeId: employeePayload.defaultEmployeeId }
          : {}),
      });
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, error, loading, reload: load };
}
