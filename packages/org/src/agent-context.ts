import type { DigitalEmployee } from "./types.js";

export interface AgentEmployeeMetadata {
  employeeId: string;
  employeeDisplayName: string;
  employeePositionId: string;
  employeeUnitId: string;
  employeeManagerId?: string;
}

export function buildEmployeeMetadata(
  employee: DigitalEmployee,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    employeeId: employee.id,
    employeeDisplayName: employee.displayName,
    employeePositionId: employee.positionId,
    employeeUnitId: employee.unitId,
    ...(employee.managerId ? { employeeManagerId: employee.managerId } : {}),
    ...extra,
  };
}

export function mergeEmployeeIntoAgentParams<T extends {
  profileId?: string;
  employeeId?: string;
  metadata?: Record<string, unknown>;
}>(
  params: T,
  employee: DigitalEmployee,
  extraMetadata: Record<string, unknown> = {},
): T {
  return {
    ...params,
    employeeId: employee.id,
    profileId: params.profileId ?? employee.profileId,
    metadata: {
      ...(params.metadata ?? {}),
      ...buildEmployeeMetadata(employee, extraMetadata),
    },
  };
}
