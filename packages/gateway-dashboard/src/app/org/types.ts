export interface OrgEmployeeRecord {
  id: string;
  displayName: string;
  profileId: string;
  positionId: string;
  unitId: string;
  status: "active" | "inactive";
  toolPolicyId: string;
  managerId?: string;
  kpiTemplateId?: string;
  approvalDelegateId?: string;
}

export interface EmployeeFormState {
  editingId: string;
  id: string;
  displayName: string;
  profileId: string;
  positionId: string;
  unitId: string;
  status: "active" | "inactive";
  toolPolicyId: string;
  managerId: string;
  kpiTemplateId: string;
  approvalDelegateId: string;
  isDefault: boolean;
}

export const EMPTY_EMPLOYEE_FORM: EmployeeFormState = {
  editingId: "",
  id: "",
  displayName: "",
  profileId: "dev",
  positionId: "engineer",
  unitId: "eng",
  status: "active",
  toolPolicyId: "engineer-standard",
  managerId: "",
  kpiTemplateId: "",
  approvalDelegateId: "",
  isDefault: false,
};
