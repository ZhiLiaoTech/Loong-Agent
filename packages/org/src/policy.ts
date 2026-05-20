import type { ToolDefinition, ToolInvocation } from "@dragon/tools";
import type {
  DigitalEmployee,
  OrgToolDecision,
  OrgToolPolicyResult,
  ToolPolicyDefinition,
  ToolPolicyRule,
} from "./types.js";

export function resolveEmployeeToolPolicy(
  policy: ToolPolicyDefinition | undefined,
  tool: ToolDefinition,
  invocation: ToolInvocation,
): OrgToolPolicyResult {
  if (!policy) {
    return { decision: "allow", reason: "No employee tool policy configured; default allow." };
  }

  for (const [index, rule] of policy.rules.entries()) {
    if (!ruleMatches(rule, tool, invocation)) {
      continue;
    }
    const ruleId = rule.id ?? `rule-${index + 1}`;
    return {
      decision: rule.decision,
      reason: rule.reason ?? `Matched tool policy rule ${ruleId}.`,
      policyId: policy.id,
      matchedRuleId: ruleId,
      ...(rule.risk !== undefined ? { risk: rule.risk } : {}),
      ...(rule.chainId !== undefined ? { chainId: rule.chainId } : {}),
    };
  }

  return {
    decision: "allow",
    reason: `No rule matched in policy "${policy.id}"; default allow.`,
    policyId: policy.id,
  };
}

function ruleMatches(rule: ToolPolicyRule, tool: ToolDefinition, invocation: ToolInvocation): boolean {
  const match = rule.match;
  if (match.toolName !== undefined && match.toolName !== tool.name) {
    return false;
  }
  if (match.capability !== undefined) {
    const caps = tool.capabilities ?? [];
    if (!caps.includes(match.capability as (typeof caps)[number])) {
      return false;
    }
  }
  if (match.inputPathContains !== undefined) {
    const haystack = JSON.stringify(invocation.input ?? {}).toLowerCase();
    if (!haystack.includes(match.inputPathContains.toLowerCase())) {
      return false;
    }
  }
  return true;
}

export function mergeOrgDecisionWithBaseline(
  org: OrgToolPolicyResult,
  baseline: OrgToolDecision,
): OrgToolPolicyResult {
  const rank: Record<OrgToolDecision, number> = {
    deny: 4,
    approval: 3,
    ask: 2,
    allow: 1,
  };
  if (rank[org.decision] >= rank[baseline]) {
    return org;
  }
  return {
    decision: baseline,
    reason: `Org policy allowed but baseline is stricter (${baseline}).`,
    ...(org.policyId !== undefined ? { policyId: org.policyId } : {}),
  };
}

export function findEmployeePolicy(
  policies: readonly ToolPolicyDefinition[],
  employee: DigitalEmployee | undefined,
): ToolPolicyDefinition | undefined {
  if (!employee) {
    return undefined;
  }
  return policies.find(policy => policy.id === employee.toolPolicyId);
}

export function readEmployeeId(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) {
    return undefined;
  }
  const raw = metadata.employeeId;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}
