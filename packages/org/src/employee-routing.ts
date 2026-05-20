import type { DigitalEmployee, EmployeeRegistry, OrgDocument, OrgEmployeeRoutingRule } from "./types.js";

export interface EmployeeRouteResult {
  employeeId: string;
  employee: DigitalEmployee;
  ruleId?: string;
  reason: string;
}

export function resolveEmployeeForMessage(
  message: string,
  org: OrgDocument,
  registry: EmployeeRegistry,
): EmployeeRouteResult | undefined {
  const text = message.trim().toLowerCase();
  if (!text) {
    return resolveDefaultEmployee(registry, "Empty message uses default employee.");
  }

  const rules = org.employeeRouting ?? [];
  for (const [index, rule] of rules.entries()) {
    if (matchesRoutingRule(text, rule)) {
      const employee = registry.employees.find(
        entry => entry.id === rule.employeeId && entry.status === "active",
      );
      if (employee) {
        return {
          employeeId: employee.id,
          employee,
          ruleId: rule.id ?? `rule-${index + 1}`,
          reason: `Matched employee routing rule ${rule.id ?? index + 1}.`,
        };
      }
    }
  }

  return resolveDefaultEmployee(registry, "No routing rule matched; using default employee.");
}

function matchesRoutingRule(text: string, rule: OrgEmployeeRoutingRule): boolean {
  if (rule.match.profileId) {
    return false;
  }
  const keywords = rule.match.keywords ?? [];
  if (!keywords.length) {
    return false;
  }
  return keywords.some(keyword => text.includes(keyword.trim().toLowerCase()));
}

function resolveDefaultEmployee(
  registry: EmployeeRegistry,
  reason: string,
): EmployeeRouteResult | undefined {
  const defaultId = registry.defaultEmployeeId;
  if (!defaultId) {
    return undefined;
  }
  const employee = registry.employees.find(entry => entry.id === defaultId && entry.status === "active");
  if (!employee) {
    return undefined;
  }
  return { employeeId: employee.id, employee, reason };
}
