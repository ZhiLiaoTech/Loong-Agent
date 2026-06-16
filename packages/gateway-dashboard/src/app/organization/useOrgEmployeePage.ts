import { useCallback, useEffect, useState } from "react";
import { GatewayApiError } from "../../api/index.js";
import { getPositionCapabilityPreset } from "./positionPresets.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import { useWorkbenchT } from "../i18n/WorkbenchI18nContext.js";
import type { AgentProfile } from "../run/types.js";
import {
  bootstrapOrgExample,
  fetchMemoryCandidates,
  fetchSkillOptions,
  fetchWorkspaceSnapshot,
  saveWorkspaceSnapshot,
} from "./orgEmployeeApi.js";
import { mergeRoleAndWorkflow, splitRoleAndWorkflow } from "./promptParts.js";
import {
  createDefaultIds,
  resolveLocalEmployeeRecord,
  resolveLocalProfile,
} from "./resolveLocalEmployee.js";
import type { MemoryCandidateRow, SkillOption } from "./skillTypes.js";
import {
  EMPTY_ORG_EMPLOYEE_FORM,
  type OrgEmployeeFormState,
  type OrgPeerEmployee,
  type OrgPositionOption,
  type OrgUnitOption,
} from "./types.js";
import { useToolPolicyEditor } from "./useToolPolicyEditor.js";

interface EmployeeListPayload {
  employees: Array<{
    id: string;
    displayName: string;
    profileId: string;
    positionId: string;
    unitId: string;
    status: "active" | "inactive";
    toolPolicyId?: string;
    managerId?: string;
    approvalDelegateId?: string;
  }>;
  defaultEmployeeId?: string;
}

interface LoadOrgEmployeeOptions {
  preferredEmployeeId?: string;
  preferredProfileId?: string;
}

function fallbackOrgLabel(id: string): string {
  if (id === "suites") {
    return "Suites";
  }
  if (id === "suite") {
    return "Suite";
  }
  return id;
}

function mergeSelectedOrgOptions(
  units: readonly OrgUnitOption[],
  positions: readonly OrgPositionOption[],
  employee: EmployeeListPayload["employees"][number] | undefined,
): { units: OrgUnitOption[]; positions: OrgPositionOption[] } {
  const nextUnits = [...units];
  const nextPositions = [...positions];
  if (employee?.unitId && !nextUnits.some(unit => unit.id === employee.unitId)) {
    nextUnits.push({ id: employee.unitId, name: fallbackOrgLabel(employee.unitId) });
  }
  if (employee?.positionId && !nextPositions.some(position => position.id === employee.positionId)) {
    nextPositions.push({
      id: employee.positionId,
      name: fallbackOrgLabel(employee.positionId),
      unitId: employee.unitId,
    });
  }
  return { units: nextUnits, positions: nextPositions };
}

function applyWorkspaceToForm(
  base: OrgEmployeeFormState,
  workspace: Awaited<ReturnType<typeof fetchWorkspaceSnapshot>>,
): OrgEmployeeFormState {
  if (!workspace) {
    return base;
  }
  const hasRoleFile = Boolean(workspace.role.trim());
  const hasWorkflowFile = Boolean(workspace.workflow.trim());
  return {
    ...base,
    workspacePath: workspace.workspace,
    roleText: hasRoleFile ? workspace.role : base.roleText,
    workflowText: hasWorkflowFile ? workspace.workflow : base.workflowText,
    memoryText: workspace.memory || base.memoryText,
    enabledSkills: workspace.enabledSkills.length ? [...workspace.enabledSkills] : base.enabledSkills,
  };
}

function applyPositionPresetToForm(
  form: OrgEmployeeFormState,
  positionId: string,
  overwrite: boolean,
): OrgEmployeeFormState {
  const preset = getPositionCapabilityPreset(positionId);
  if (!preset) {
    return form;
  }
  return {
    ...form,
    roleText: overwrite || !form.roleText.trim() ? preset.role : form.roleText,
    workflowText: overwrite || !form.workflowText.trim() ? preset.workflow : form.workflowText,
    memoryText: overwrite || !form.memoryText.trim() ? preset.memory : form.memoryText,
    enabledSkills: overwrite ? [...preset.enabledSkills] : form.enabledSkills,
  };
}

function formFromSources(
  employee: EmployeeListPayload["employees"][number],
  profile: AgentProfile | undefined,
): OrgEmployeeFormState {
  const { role, workflow } = splitRoleAndWorkflow(profile?.systemPrompt);
  return {
    employeeId: employee.id,
    profileId: employee.profileId || profile?.id || employee.id,
    displayName: employee.displayName || profile?.name || "",
    roleText: role,
    workflowText: workflow,
    memoryText: "",
    enabledSkills: [],
    workspacePath: "",
    memoryEnabled: profile?.memoryEnabled !== false,
    aiSummarizationEnabled: profile?.aiSummarization !== false && profile?.aiSummarization?.enabled === true,
    toolsEnabled: profile?.toolsEnabled !== false,
    unitId: employee.unitId,
    positionId: employee.positionId,
    workspace: profile?.workspace ?? "",
    workScope: profile?.description ?? "",
    toolPolicyId: employee.toolPolicyId ?? "",
    managerId: employee.managerId ?? "",
    approvalDelegateId: employee.approvalDelegateId ?? "",
    status: employee.status,
    defaultModel: profile?.defaultModel ?? "",
    thinking: profile?.thinking ?? "",
  };
}

function buildProfileFromForm(form: OrgEmployeeFormState): AgentProfile {
  const profile: AgentProfile = {
    id: form.profileId.trim(),
    name: form.displayName.trim(),
    memoryEnabled: form.memoryEnabled,
    toolsEnabled: form.toolsEnabled,
    aiSummarization: form.aiSummarizationEnabled ? { enabled: true } : { enabled: false },
  };
  const systemPrompt = mergeRoleAndWorkflow(form.roleText, form.workflowText);
  const workScope = form.workScope.trim();
  const workspace = form.workspace.trim();
  const defaultModel = form.defaultModel.trim();
  if (systemPrompt) {
    profile.systemPrompt = systemPrompt;
  }
  if (workScope) {
    profile.description = workScope;
  }
  if (workspace) {
    profile.workspace = workspace;
  }
  if (defaultModel) {
    profile.defaultModel = defaultModel;
  }
  if (form.thinking) {
    profile.thinking = form.thinking;
  }
  return profile;
}

function buildEmployeeFromForm(form: OrgEmployeeFormState) {
  const employee = {
    id: form.employeeId.trim(),
    displayName: form.displayName.trim(),
    profileId: form.profileId.trim(),
    positionId: form.positionId.trim(),
    unitId: form.unitId.trim(),
    status: form.status,
    toolPolicyId: form.toolPolicyId.trim(),
  };
  return {
    ...employee,
    ...(form.managerId.trim() ? { managerId: form.managerId.trim() } : {}),
    ...(form.approvalDelegateId.trim()
      ? { approvalDelegateId: form.approvalDelegateId.trim() }
      : {}),
  };
}

export function useOrgEmployeePage() {
  const client = useGatewayClient();
  const t = useWorkbenchT();
  const [form, setForm] = useState<OrgEmployeeFormState>(EMPTY_ORG_EMPLOYEE_FORM);
  const [units, setUnits] = useState<readonly OrgUnitOption[]>([]);
  const [positions, setPositions] = useState<readonly OrgPositionOption[]>([]);
  const [peers, setPeers] = useState<readonly OrgPeerEmployee[]>([]);
  const [skills, setSkills] = useState<readonly SkillOption[]>([]);
  const [skillsAvailable, setSkillsAvailable] = useState(true);
  const [skillWarning, setSkillWarning] = useState<string | null>(null);
  const [memoryCandidates, setMemoryCandidates] = useState<readonly MemoryCandidateRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);

  const {
    policyJsonText,
    policyDirty,
    policies,
    savingPolicies,
    setPolicyJsonText,
    applyPoliciesFromServer,
    confirmDiscardIfDirty,
    reloadPolicies,
    savePolicies: saveToolPolicies,
  } = useToolPolicyEditor(client, {
    messages: {
      reloaded: t("org.policyEditor.reloaded"),
      saved: t("org.policyEditor.saved"),
      invalidJson: t("org.policyEditor.invalidJson"),
      syntaxError: t("org.policyEditor.syntaxError"),
      discardConfirm: t("org.policyEditor.discardConfirm"),
      missingAssignedPolicy: t("org.policyEditor.missingAssignedPolicy"),
    },
    onStatus: setStatus,
    onError: setError,
  });

  const savePolicies = useCallback(async () => {
    await saveToolPolicies(form.toolPolicyId);
  }, [form.toolPolicyId, saveToolPolicies]);

  const load = useCallback(async (options: LoadOrgEmployeeOptions = {}) => {
    if (!confirmDiscardIfDirty()) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [orgPayload, employeePayload, agentPayload, policyPayload, skillPayload, memoryRows] =
        await Promise.all([
          client.rpc<{
            units?: OrgUnitOption[];
            positions?: OrgPositionOption[];
          }>("org.get"),
          client.rpc<EmployeeListPayload>("employee.list").catch((): EmployeeListPayload => ({ employees: [] })),
          client.rpc<{
            profiles?: AgentProfile[];
            defaultProfileId?: string;
          }>("agent.config.get"),
          client.rpc<{ policies: Array<{ id: string; description?: string; rules?: unknown[] }> }>(
            "policy.tool.get",
          ).catch(() => ({ policies: [] })),
          fetchSkillOptions(client),
          fetchMemoryCandidates(client),
        ]);

      const profiles = agentPayload.profiles ?? [];
      const employees = employeePayload.employees ?? [];
      const preferredEmployeeId = options.preferredEmployeeId?.trim();
      const preferredProfileId = options.preferredProfileId?.trim();
      const preferredEmployee = preferredEmployeeId
        ? employees.find(entry => entry.id === preferredEmployeeId)
        : undefined;
      const localEmployee = preferredEmployee
        ?? resolveLocalEmployeeRecord(employees, employeePayload.defaultEmployeeId);
      const localProfile =
        (preferredProfileId
          ? profiles.find(entry => entry.id === preferredProfileId)
          : undefined)
        ?? resolveLocalProfile(
          profiles,
          agentPayload.defaultProfileId,
          localEmployee?.profileId,
        );
      const orgOptions = mergeSelectedOrgOptions(
        orgPayload.units ?? [],
        orgPayload.positions ?? [],
        localEmployee,
      );

      setUnits(orgOptions.units);
      setPositions(orgOptions.positions);
      applyPoliciesFromServer(policyPayload.policies ?? []);
      setPeers(
        employees
          .filter(entry => entry.status === "active")
          .map(entry => ({ id: entry.id, displayName: entry.displayName })),
      );
      setSkills(skillPayload.skills);
      setSkillsAvailable(skillPayload.available);
      setSkillWarning(skillPayload.warning ?? null);
      setMemoryCandidates(memoryRows);

      let nextForm: OrgEmployeeFormState;
      if (localEmployee) {
        nextForm = formFromSources(localEmployee, localProfile);
      } else if (localProfile) {
        const ids = createDefaultIds(localProfile.name);
        const policyList = policyPayload.policies ?? [];
        nextForm = formFromSources(
          {
            id: ids.employeeId,
            displayName: localProfile.name,
            profileId: localProfile.id,
            positionId: orgOptions.positions[0]?.id ?? "",
            unitId: orgOptions.positions[0]?.unitId ?? orgOptions.units[0]?.id ?? "",
            status: "active",
            toolPolicyId: policyList[0]?.id ?? "",
          },
          localProfile,
        );
      } else {
        const ids = createDefaultIds(t("org.defaultName"));
        nextForm = {
          ...EMPTY_ORG_EMPLOYEE_FORM,
          employeeId: ids.employeeId,
          profileId: ids.profileId,
          displayName: t("org.defaultName"),
          unitId: orgOptions.units[0]?.id ?? "",
          positionId: orgOptions.positions[0]?.id ?? "",
          toolPolicyId: policyPayload.policies?.[0]?.id ?? "",
        };
      }

      const workspaceSnapshot = await fetchWorkspaceSnapshot(client, nextForm);
      const withWorkspace = applyWorkspaceToForm(nextForm, workspaceSnapshot);
      setForm(applyPositionPresetToForm(withWorkspace, withWorkspace.positionId, false));
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [applyPoliciesFromServer, client, confirmDiscardIfDirty, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    const displayName = form.displayName.trim();
    if (!displayName) {
      setError(t("org.nameRequired"));
      return;
    }

    const ids = createDefaultIds(displayName);
    const employeeId = form.employeeId.trim() || ids.employeeId;
    const profileId = form.profileId.trim() || ids.profileId;
    const nextForm = { ...form, employeeId, profileId };

    if (!nextForm.unitId.trim() || !nextForm.positionId.trim() || !nextForm.toolPolicyId.trim()) {
      setError(t("org.orgFieldsRequired"));
      return;
    }

    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const profile = buildProfileFromForm(nextForm);
      const employee = buildEmployeeFromForm(nextForm);

      await client.rpc("agent.config.save", {
        profiles: [profile],
        defaultProfileId: profile.id,
      });
      await client.rpc("employee.save", {
        employees: [employee],
        defaultEmployeeId: employee.id,
      });

      const workspaceSnapshot = await fetchWorkspaceSnapshot(client, nextForm);
      const workspace =
        workspaceSnapshot?.workspace
        || nextForm.workspacePath
        || nextForm.workspace.trim();
      if (workspace) {
        const savedWorkspace = await saveWorkspaceSnapshot(client, workspace, {
          role: nextForm.roleText,
          workflow: nextForm.workflowText,
          memory: nextForm.memoryText,
          enabledSkills: nextForm.enabledSkills,
        });
        nextForm.workspacePath = savedWorkspace.workspace;
      }

      setForm(nextForm);
      setStatus(t("org.statusSaved"));
      await load();
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
      throw caught;
    } finally {
      setSaving(false);
    }
  }, [client, form, load, t]);

  const applyPositionPreset = useCallback(() => {
    if (!form.positionId.trim()) {
      return;
    }
    setForm(current => applyPositionPresetToForm(current, current.positionId, true));
    setStatus(t("org.capability.positionPresetApplied"));
  }, [form.positionId, t]);

  const updateForm = useCallback((patch: Partial<OrgEmployeeFormState>) => {
    setForm(current => {
      let next = { ...current, ...patch };
      if (patch.positionId && patch.positionId !== current.positionId) {
        next = applyPositionPresetToForm(next, patch.positionId, false);
      }
      return next;
    });
  }, []);

  const bootstrapExample = useCallback(async () => {
    setBootstrapping(true);
    setError(null);
    setStatus(null);
    try {
      const result = await bootstrapOrgExample(client);
      if (result.bootstrapped) {
        setStatus(t("org.bootstrapSuccess"));
        await load();
        return;
      }
      setStatus(t("org.bootstrapSkipped"));
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
    } finally {
      setBootstrapping(false);
    }
  }, [client, load, t]);

  const unitName = units.find(unit => unit.id === form.unitId)?.name;
  const positionName = positions.find(position => position.id === form.positionId)?.name;
  const policy = policies.find(entry => entry.id === form.toolPolicyId);
  const managerName = peers.find(peer => peer.id === form.managerId)?.displayName;

  return {
    form,
    setForm,
    updateForm,
    units,
    positions,
    policies,
    peers,
    skills,
    skillsAvailable,
    skillWarning,
    memoryCandidates,
    unitName,
    positionName,
    policy,
    managerName,
    policyJsonText,
    policyDirty,
    status,
    error,
    loading,
    saving,
    savingPolicies,
    bootstrapping,
    load,
    save,
    setPolicyJsonText,
    reloadPolicies,
    savePolicies,
    applyPositionPreset,
    bootstrapExample,
  };
}
