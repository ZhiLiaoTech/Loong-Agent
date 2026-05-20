import type {
  DigitalEmployee,
  EmployeeRegistry,
  OrgApprovalChain,
  OrgDocument,
} from "./types.js";

export interface ApprovalAssignee {
  approverId?: string;
  approverDisplayName?: string;
  chainName?: string;
  stepLabel?: string;
}

export function resolveApprovalAssignee(
  org: OrgDocument,
  employees: EmployeeRegistry,
  chainId: string,
  requesterEmployeeId: string | undefined,
): ApprovalAssignee {
  const chain = org.approvalChains.find(entry => entry.id === chainId);
  if (!chain) {
    return {};
  }

  const requester = requesterEmployeeId
    ? employees.employees.find(entry => entry.id === requesterEmployeeId)
    : undefined;

  for (const [index, step] of chain.steps.entries()) {
    const assignee = resolveStepAssignee(step, requester, employees.employees, org);
    if (assignee) {
      return {
        approverId: assignee.id,
        approverDisplayName: assignee.displayName,
        chainName: chain.name,
        stepLabel: `step-${index + 1}`,
      };
    }
    if (!step.optional) {
      break;
    }
  }

  return { chainName: chain.name };
}

function resolveStepAssignee(
  step: OrgApprovalChain["steps"][number],
  requester: DigitalEmployee | undefined,
  employees: readonly DigitalEmployee[],
  org: OrgDocument,
): DigitalEmployee | undefined {
  if (step.approverEmployeeId) {
    return findActiveEmployee(employees, step.approverEmployeeId);
  }

  if (step.scope === "manager" && requester?.managerId) {
    const manager = findActiveEmployee(employees, requester.managerId);
    if (manager && matchesApproverRole(manager, step.approverRole)) {
      return manager;
    }
    const unitLead = findEmployeeByPosition(employees, step.approverRole, requester.unitId);
    if (unitLead) {
      return unitLead;
    }
    return manager;
  }

  if (step.scope === "same-unit" && requester) {
    return findEmployeeByPosition(employees, step.approverRole, requester.unitId);
  }

  if (step.scope === "org") {
    return findEmployeeByPosition(employees, step.approverRole);
  }

  if (step.approverRole) {
    const position = org.positions.find(entry => entry.id === step.approverRole);
    if (position) {
      return findEmployeeByPosition(employees, position.id, position.unitId);
    }
  }

  return undefined;
}

function findActiveEmployee(
  employees: readonly DigitalEmployee[],
  employeeId: string,
): DigitalEmployee | undefined {
  const employee = employees.find(entry => entry.id === employeeId);
  return employee?.status === "active" ? employee : undefined;
}

function findEmployeeByPosition(
  employees: readonly DigitalEmployee[],
  positionId: string | undefined,
  unitId?: string,
): DigitalEmployee | undefined {
  if (!positionId) {
    return undefined;
  }
  return employees.find(
    entry =>
      entry.status === "active"
      && entry.positionId === positionId
      && (unitId === undefined || entry.unitId === unitId),
  );
}

function matchesApproverRole(employee: DigitalEmployee, approverRole: string | undefined): boolean {
  if (!approverRole) {
    return true;
  }
  return employee.positionId === approverRole;
}
