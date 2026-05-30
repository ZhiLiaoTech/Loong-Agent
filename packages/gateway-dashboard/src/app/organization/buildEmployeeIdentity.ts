import type { DigitalEmployeeSummary } from "../run/types.js";
import type { OrgPositionOption, OrgUnitOption } from "../organization/types.js";
import { resolveLocalEmployeeRecord } from "../organization/resolveLocalEmployee.js";

export interface EmployeeIdentity {
  employeeId: string;
  profileId: string;
  displayName: string;
  unitName: string;
  positionName: string;
  subtitle: string;
}

export function buildEmployeeIdentity(
  employees: readonly DigitalEmployeeSummary[],
  defaultEmployeeId: string | undefined,
  units: readonly OrgUnitOption[],
  positions: readonly OrgPositionOption[],
): EmployeeIdentity | undefined {
  const employee = resolveLocalEmployeeRecord(employees, defaultEmployeeId);
  if (!employee) {
    return undefined;
  }

  const unitName = units.find(unit => unit.id === employee.unitId)?.name ?? "";
  const positionName = positions.find(position => position.id === employee.positionId)?.name ?? "";
  const subtitle = [unitName, positionName].filter(Boolean).join(" · ");

  return {
    employeeId: employee.id,
    profileId: employee.profileId,
    displayName: employee.displayName,
    unitName,
    positionName,
    subtitle,
  };
}
