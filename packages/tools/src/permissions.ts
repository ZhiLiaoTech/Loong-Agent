import type {
  ToolDefinition,
  ToolInvocation,
  ToolPermissionDecision,
  ToolPermissionContext,
  ToolPermissionEngine,
  ToolPermissionPolicy,
  ToolPermissionResult,
  ToolPermissionRule,
} from "./types.js";
import { normalizeToolName } from "./registry.js";

export class DefaultToolPermissionEngine implements ToolPermissionEngine {
  readonly #policy: Required<Pick<ToolPermissionPolicy, "defaultDecision">> & {
    rules: ToolPermissionRule[];
  };

  constructor(policy: ToolPermissionPolicy = {}) {
    this.#policy = {
      defaultDecision: policy.defaultDecision ?? "ask",
      rules: policy.rules ?? [],
    };
  }

  decide(tool: ToolDefinition, invocation: ToolInvocation): ToolPermissionResult {
    const normalizedInvocationName = normalizeToolName(invocation.name);
    const normalizedToolName = normalizeToolName(tool.name);

    if (normalizedToolName !== normalizedInvocationName) {
      return {
        decision: "deny",
        reason: `Invocation name "${invocation.name}" does not match tool "${tool.name}".`,
      };
    }

    const context: ToolPermissionContext = {
      tool,
      invocation: {
        ...invocation,
        name: normalizedInvocationName,
      },
    };

    const matchedRule = selectRule(this.#policy.rules, context);
    if (matchedRule?.decision === "deny") {
      return {
        decision: "deny",
        reason: matchedRule.reason ?? describeDecision("deny", "policy rule"),
        matchedRule,
      };
    }

    if (this.#policy.defaultDecision === "deny") {
      return {
        decision: "deny",
        reason: describeDecision("deny", "global default"),
      };
    }

    if (matchedRule) {
      return {
        decision: matchedRule.decision,
        reason: matchedRule.reason ?? describeDecision(matchedRule.decision, "policy rule"),
        matchedRule,
      };
    }

    const baseline = stricterDecision(tool.permission, this.#policy.defaultDecision);
    return {
      decision: baseline,
      reason: describeDecision(baseline, tool.permission ? "tool default and global default" : "global default"),
    };
  }
}

export function createToolPermissionEngine(
  policy: ToolPermissionPolicy = {},
): ToolPermissionEngine {
  return new DefaultToolPermissionEngine(policy);
}

function selectRule(
  rules: ToolPermissionRule[],
  context: ToolPermissionContext,
): ToolPermissionRule | undefined {
  const matches = rules.filter(rule => matchesRule(rule, context));
  if (matches.length === 0) {
    return undefined;
  }

  const deny = matches
    .filter(rule => rule.decision === "deny")
    .sort((a, b) => ruleSpecificity(b) - ruleSpecificity(a))[0];
  if (deny) {
    return deny;
  }

  return [...matches].sort((a, b) => ruleSpecificity(b) - ruleSpecificity(a))[0];
}

function matchesRule(rule: ToolPermissionRule, context: ToolPermissionContext): boolean {
  if (rule.toolName !== undefined && normalizeToolName(rule.toolName) !== normalizeToolName(context.tool.name)) {
    return false;
  }
  if (rule.capability !== undefined && !context.tool.capabilities?.includes(rule.capability)) {
    return false;
  }
  if (rule.when !== undefined && !rule.when(context)) {
    return false;
  }
  return rule.toolName !== undefined || rule.capability !== undefined || rule.when !== undefined;
}

function ruleSpecificity(rule: ToolPermissionRule): number {
  return Number(rule.toolName !== undefined) * 4
    + Number(rule.capability !== undefined) * 2
    + Number(rule.when !== undefined);
}

function stricterDecision(
  toolDecision: ToolPermissionDecision | undefined,
  policyDecision: ToolPermissionDecision,
): ToolPermissionDecision {
  if (toolDecision === "deny" || policyDecision === "deny") {
    return "deny";
  }
  if (toolDecision === "ask" || policyDecision === "ask") {
    return "ask";
  }
  return "allow";
}

function describeDecision(decision: ToolPermissionDecision, source: string): string {
  return `Permission ${decision} from ${source}.`;
}
