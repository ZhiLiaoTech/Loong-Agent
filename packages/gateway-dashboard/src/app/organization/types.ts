import type { ThinkingLevel } from "../run/types.js";

export interface OrgEmployeeFormState {
  employeeId: string;
  profileId: string;
  displayName: string;
  roleText: string;
  workflowText: string;
  memoryText: string;
  enabledSkills: string[];
  workspacePath: string;
  memoryEnabled: boolean;
  aiSummarizationEnabled: boolean;
  toolsEnabled: boolean;
  unitId: string;
  positionId: string;
  workspace: string;
  workScope: string;
  toolPolicyId: string;
  managerId: string;
  approvalDelegateId: string;
  status: "active" | "inactive";
  defaultModel: string;
  thinking: ThinkingLevel;
}

export interface OrgUnitOption {
  id: string;
  name: string;
}

export interface OrgPositionOption {
  id: string;
  name: string;
  unitId: string;
}

export interface OrgPolicyOption {
  id: string;
  description?: string;
  ruleCount: number;
}

export interface OrgPeerEmployee {
  id: string;
  displayName: string;
}

export const EMPTY_ORG_EMPLOYEE_FORM: OrgEmployeeFormState = {
  employeeId: "",
  profileId: "",
  displayName: "",
  roleText: "",
  workflowText: "",
  memoryText: "",
  enabledSkills: [],
  workspacePath: "",
  memoryEnabled: true,
  aiSummarizationEnabled: false,
  toolsEnabled: true,
  unitId: "",
  positionId: "",
  workspace: "",
  workScope: "",
  toolPolicyId: "",
  managerId: "",
  approvalDelegateId: "",
  status: "active",
  defaultModel: "",
  thinking: "",
};
