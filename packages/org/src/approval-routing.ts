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

  if (step.scope === "manager" && requester) {
    const managerId = resolveManagerId(requester, org);
    if (!managerId) {
      return findEmployeeByPosition(employees, step.approverRole, requester.unitId);
    }
    const manager = findActiveEmployee(employees, managerId);
    if (manager && matchesApproverRole(manager, step.approverRole)) {
      return manager;
    }
    const delegate = requester.approvalDelegateId
      ? findActiveEmployee(employees, requester.approvalDelegateId)
      : undefined;
    if (delegate && matchesApproverRole(delegate, step.approverRole)) {
      return delegate;
    }
    return findEmployeeByPosition(employees, step.approverRole, requester.unitId);
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

function resolveManagerId(requester: DigitalEmployee, org: OrgDocument): string | undefined {
  if (requester.managerId) {
    return requester.managerId;
  }
  return org.reporting.find(line => line.employeeId === requester.id)?.managerId;
}

function matchesApproverRole(employee: DigitalEmployee, approverRole: string | undefined): boolean {
  if (!approverRole) {
    return true;
  }
  return employee.positionId === approverRole;
}
