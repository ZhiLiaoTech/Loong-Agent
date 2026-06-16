import { useCallback, useEffect, useState } from "react";
import { GatewayApiError } from "../../api/index.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import {
  mapToolPolicyOptions,
  type RawToolPolicy,
  useToolPolicyEditor,
} from "../organization/useToolPolicyEditor.js";
import type { DigitalEmployeeSummary } from "../run/types.js";
import { EMPTY_EMPLOYEE_FORM, type EmployeeFormState, type OrgEmployeeRecord } from "./types.js";

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

function recordToForm(record: OrgEmployeeRecord, isDefault: boolean): EmployeeFormState {
  return {
    editingId: record.id,
    id: record.id,
    displayName: record.displayName,
    profileId: record.profileId,
    positionId: record.positionId,
    unitId: record.unitId,
    status: record.status,
    toolPolicyId: record.toolPolicyId,
    managerId: record.managerId ?? "",
    kpiTemplateId: record.kpiTemplateId ?? "",
    approvalDelegateId: record.approvalDelegateId ?? "",
    isDefault,
  };
}

function formToRecord(form: EmployeeFormState): OrgEmployeeRecord {
  const record: OrgEmployeeRecord = {
    id: form.id.trim(),
    displayName: form.displayName.trim(),
    profileId: form.profileId.trim(),
    positionId: form.positionId.trim(),
    unitId: form.unitId.trim(),
    status: form.status,
    toolPolicyId: form.toolPolicyId.trim(),
  };
  if (form.managerId.trim()) {
    record.managerId = form.managerId.trim();
  }
  if (form.kpiTemplateId.trim()) {
    record.kpiTemplateId = form.kpiTemplateId.trim();
  }
  if (form.approvalDelegateId.trim()) {
    record.approvalDelegateId = form.approvalDelegateId.trim();
  }
  return record;
}

function toSaveEmployee(record: OrgEmployeeRecord) {
  return {
    id: record.id,
    displayName: record.displayName,
    profileId: record.profileId,
    positionId: record.positionId,
    unitId: record.unitId,
    status: record.status,
    toolPolicyId: record.toolPolicyId,
    ...(record.managerId ? { managerId: record.managerId } : {}),
    ...(record.kpiTemplateId ? { kpiTemplateId: record.kpiTemplateId } : {}),
    ...(record.approvalDelegateId ? { approvalDelegateId: record.approvalDelegateId } : {}),
  };
}

function summaryToRecord(employee: DigitalEmployeeSummary & { toolPolicyId?: string }): OrgEmployeeRecord {
  return {
    id: employee.id,
    displayName: employee.displayName,
    profileId: employee.profileId,
    positionId: employee.positionId,
    unitId: employee.unitId,
    status: employee.status,
    toolPolicyId: employee.toolPolicyId ?? "engineer-standard",
  };
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
  const [draftEmployees, setDraftEmployees] = useState<readonly OrgEmployeeRecord[]>([]);
  const [draftDefaultEmployeeId, setDraftDefaultEmployeeId] = useState<string | undefined>(undefined);
  const [employeeForm, setEmployeeForm] = useState<EmployeeFormState>(EMPTY_EMPLOYEE_FORM);
  const [profileIds, setProfileIds] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingEmployees, setSavingEmployees] = useState(false);

  const {
    policyJsonText,
    policyDirty,
    savingPolicies,
    setPolicyJsonText,
    applyPoliciesFromServer,
    confirmDiscardIfDirty,
    reloadPolicies,
    savePolicies: saveToolPolicies,
  } = useToolPolicyEditor(client, {
    onStatus: setStatus,
    onError: setError,
  });

  const load = useCallback(async () => {
    if (!confirmDiscardIfDirty()) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [orgPayload, employeePayload, policyPayload, agentPayload] = await Promise.all([
        client.rpc<{
          units?: OrgUnitView[];
          positions?: OrgPositionView[];
          approvalChains?: ApprovalChainView[];
          employeeRouting?: EmployeeRoutingRuleView[];
        }>("org.get"),
        client.rpc<{
          employees: Array<DigitalEmployeeSummary & { toolPolicyId?: string; managerId?: string; kpiTemplateId?: string; approvalDelegateId?: string }>;
          defaultEmployeeId?: string;
        }>("employee.list"),
        client.rpc<{ policies: unknown[] }>("policy.tool.get").catch(() => ({ policies: [] })),
        client.rpc<{ profiles?: Array<{ id: string }>; defaultProfileId?: string }>("agent.config.get").catch(
          () => ({ profiles: [] }),
        ),
      ]);

      const employees = employeePayload.employees ?? [];
      const defaultId = employeePayload.defaultEmployeeId;
      const draft = employees.map(entry => {
        const base = summaryToRecord(entry);
        if (entry.toolPolicyId) {
          base.toolPolicyId = entry.toolPolicyId;
        }
        if (entry.managerId) {
          base.managerId = entry.managerId;
        }
        if (entry.kpiTemplateId) {
          base.kpiTemplateId = entry.kpiTemplateId;
        }
        if (entry.approvalDelegateId) {
          base.approvalDelegateId = entry.approvalDelegateId;
        }
        return base;
      });

      setDraftEmployees(draft);
      setDraftDefaultEmployeeId(defaultId);
      const rawPolicies = (policyPayload.policies ?? []) as RawToolPolicy[];
      applyPoliciesFromServer(rawPolicies);
      setProfileIds((agentPayload.profiles ?? []).map(profile => profile.id));

      setState({
        units: orgPayload.units ?? [],
        positions: orgPayload.positions ?? [],
        approvalChains: orgPayload.approvalChains ?? [],
        employeeRouting: orgPayload.employeeRouting ?? [],
        toolPolicies: mapToolPolicyOptions(rawPolicies),
        employees: employees.filter(entry => entry.status === "active"),
        ...(defaultId ? { defaultEmployeeId: defaultId } : {}),
      });
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [applyPoliciesFromServer, client, confirmDiscardIfDirty]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePolicies = useCallback(async () => {
    const saved = await saveToolPolicies(employeeForm.toolPolicyId);
    if (saved) {
      await load();
    }
  }, [employeeForm.toolPolicyId, load, saveToolPolicies]);

  const patchForm = useCallback((patch: Partial<EmployeeFormState>) => {
    setEmployeeForm(current => ({ ...current, ...patch }));
  }, []);

  const clearForm = useCallback(() => {
    setEmployeeForm(EMPTY_EMPLOYEE_FORM);
  }, []);

  const upsertDraft = useCallback(() => {
    const record = formToRecord(employeeForm);
    if (!record.id || !record.displayName || !record.toolPolicyId) {
      return;
    }
    setDraftEmployees(current => {
      const next = current.filter(entry => entry.id !== record.id);
      return [...next, record];
    });
    if (employeeForm.isDefault) {
      setDraftDefaultEmployeeId(record.id);
    } else if (draftDefaultEmployeeId === record.id) {
      setDraftDefaultEmployeeId(undefined);
    }
    setEmployeeForm(EMPTY_EMPLOYEE_FORM);
    setStatus(`已加入草稿：${record.displayName}`);
  }, [draftDefaultEmployeeId, employeeForm]);

  const editDraft = useCallback(
    (id: string) => {
      const record = draftEmployees.find(entry => entry.id === id);
      if (!record) {
        return;
      }
      setEmployeeForm(recordToForm(record, draftDefaultEmployeeId === record.id));
    },
    [draftDefaultEmployeeId, draftEmployees],
  );

  const removeDraft = useCallback((id: string) => {
    setDraftEmployees(current => current.filter(entry => entry.id !== id));
    if (draftDefaultEmployeeId === id) {
      setDraftDefaultEmployeeId(undefined);
    }
    if (employeeForm.editingId === id || employeeForm.id === id) {
      setEmployeeForm(EMPTY_EMPLOYEE_FORM);
    }
  }, [draftDefaultEmployeeId, employeeForm.editingId, employeeForm.id]);

  const saveEmployees = useCallback(async () => {
    setSavingEmployees(true);
    setStatus(null);
    setError(null);
    try {
      const defaultId = draftDefaultEmployeeId?.trim();
      await client.rpc("employee.save", {
        employees: draftEmployees.map(toSaveEmployee),
        ...(defaultId ? { defaultEmployeeId: defaultId } : {}),
      });
      setStatus("员工配置已保存。");
      await load();
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
    } finally {
      setSavingEmployees(false);
    }
  }, [client, draftDefaultEmployeeId, draftEmployees, load]);

  const policyIds = state.toolPolicies.map(policy => policy.id);

  return {
    state,
    draftEmployees,
    draftDefaultEmployeeId,
    employeeForm,
    policyJsonText,
    policyDirty,
    profileIds,
    policyIds,
    error,
    status,
    loading,
    savingEmployees,
    savingPolicies,
    reload: load,
    patchForm,
    clearForm,
    upsertDraft,
    editDraft,
    removeDraft,
    saveEmployees,
    setPolicyJsonText,
    reloadPolicies,
    savePolicies,
  };
}
