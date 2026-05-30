import type { AgentProfile } from "../run/types.js";
import type { OrgEmployeeRecord } from "../org/types.js";
import { agentIdFromName } from "../agents/agentIdFromName.js";

interface EmployeePayload {
  id: string;
  displayName: string;
  profileId: string;
  positionId: string;
  unitId: string;
  status: "active" | "inactive";
  toolPolicyId?: string;
  managerId?: string;
  approvalDelegateId?: string;
}

export function resolveLocalEmployeeRecord(
  employees: readonly EmployeePayload[],
  defaultEmployeeId: string | undefined,
): EmployeePayload | undefined {
  if (!employees.length) {
    return undefined;
  }
  if (defaultEmployeeId) {
    const match = employees.find(entry => entry.id === defaultEmployeeId);
    if (match) {
      return match;
    }
  }
  return employees.find(entry => entry.status === "active") ?? employees[0];
}

export function resolveLocalProfile(
  profiles: readonly AgentProfile[],
  defaultProfileId: string | undefined,
  preferredProfileId?: string,
): AgentProfile | undefined {
  if (preferredProfileId) {
    const preferred = profiles.find(entry => entry.id === preferredProfileId);
    if (preferred) {
      return preferred;
    }
  }
  if (defaultProfileId) {
    const match = profiles.find(entry => entry.id === defaultProfileId);
    if (match) {
      return match;
    }
  }
  return profiles[0];
}

export function createDefaultIds(displayName: string): { employeeId: string; profileId: string } {
  const base = agentIdFromName(displayName || "assistant");
  return {
    employeeId: base,
    profileId: base,
  };
}

export function employeeToOrgRecord(employee: EmployeePayload): OrgEmployeeRecord {
  return {
    id: employee.id,
    displayName: employee.displayName,
    profileId: employee.profileId,
    positionId: employee.positionId,
    unitId: employee.unitId,
    status: employee.status,
    toolPolicyId: employee.toolPolicyId ?? "",
    ...(employee.managerId ? { managerId: employee.managerId } : {}),
    ...(employee.approvalDelegateId ? { approvalDelegateId: employee.approvalDelegateId } : {}),
  };
}
