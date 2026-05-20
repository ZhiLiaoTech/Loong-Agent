import type {
  ToolDefinition,
  ToolInvocation,
  ToolPermissionEngine,
  ToolPermissionResult,
} from "@dragon/tools";
import { createToolPermissionEngine } from "@dragon/tools";
import type { EmployeeRegistry, ToolPolicyDocument } from "./types.js";
import {
  findEmployeePolicy,
  mergeOrgDecisionWithBaseline,
  readEmployeeId,
  resolveEmployeeToolPolicy,
} from "./policy.js";

export interface OrgPermissionEngineOptions {
  baseline?: ToolPermissionEngine;
  getEmployees: () => Promise<EmployeeRegistry>;
  getToolPolicies: () => Promise<ToolPolicyDocument>;
}

/** Async evaluation used by runtime (org stores are loaded from disk). */
export async function evaluateOrgAwarePermission(
  options: OrgPermissionEngineOptions,
  tool: ToolDefinition,
  invocation: ToolInvocation,
): Promise<ToolPermissionResult> {
  const baseline = options.baseline ?? createToolPermissionEngine({ defaultDecision: "ask" });
  const base = baseline.decide(tool, invocation);
  const employeeId = readEmployeeId(invocation.metadata);
  if (!employeeId) {
    return base;
  }

  const [employees, policies] = await Promise.all([options.getEmployees(), options.getToolPolicies()]);
  const employee = employees.employees.find(entry => entry.id === employeeId);
  if (!employee) {
    return {
      decision: "deny",
      reason: `Unknown employee "${employeeId}".`,
    };
  }
  if (employee.status === "inactive") {
    return {
      decision: "deny",
      reason: `Employee "${employeeId}" is inactive.`,
    };
  }

  const policy = findEmployeePolicy(policies.policies, employee);
  const org = resolveEmployeeToolPolicy(policy, tool, invocation);
  const merged = mergeOrgDecisionWithBaseline(org, base.decision);

  if (merged.decision === "approval" || (merged.decision === "ask" && merged.chainId)) {
    return {
      decision: "ask",
      reason: `[approval:${merged.chainId ?? "default"}] ${merged.reason}`,
    };
  }
  return {
    decision: merged.decision === "allow" ? "allow" : merged.decision === "deny" ? "deny" : "ask",
    reason: merged.reason,
  };
}
