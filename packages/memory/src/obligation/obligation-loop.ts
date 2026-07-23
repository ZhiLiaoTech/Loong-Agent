import type { ObligationRecord } from "./obligation-store.js";
import type { ObligationBudget, ObligationStatus } from "./obligation-types.js";

/**
 * Phase 3.2 (docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md §8): Loop Engineering
 * 预留原语 —— 「契约即退出条件」。
 *
 * 本模块不实现 Loop，只提供 Loop/编排面的消费原语：
 * - `evaluateObligationStoppingRule`：从契约状态（+可选的跨 step 聚合用量）
 *   推导停止信号 —— `fulfilled` → 成功停止；`blocked_hard` / `expired` →
 *   失败停止；在途但聚合用量超 `obligation.budget` → 失败停止（§8 预算硬限：
 *   契约级 budget 聚合跨 step 累计，超支应停止继续投入）。
 * - `ObligationUsageAggregate`：跨 step 累计用量（tokens/cost/stepCount）。
 *   仓库内没有用量存储，由编排嵌入方注入 resolver（与 3.1 subjectResolver
 *   同姿态）；未注入时预算评估不激活。
 */

export const OBLIGATION_TERMINAL_STATUSES: readonly ObligationStatus[] = [
  "fulfilled",
  "blocked_hard",
  "expired",
];

/** §8 终态即停止信号（blocked_recoverable 不是终态：等待重试）。 */
export function isObligationTerminalStatus(status: ObligationStatus): boolean {
  return (OBLIGATION_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** 跨 step 聚合用量（§8 预算硬限的消费形态）。 */
export interface ObligationUsageAggregate {
  totalTokens?: number;
  totalCostUsd?: number;
  stepCount?: number;
}

export interface ObligationStoppingRule {
  shouldStop: boolean;
  /** 仅 shouldStop=true 时给出。 */
  outcome?: "success" | "failure";
  reason: string;
  /** 聚合用量超契约 budget 时置 true（终态判定优先于预算判定）。 */
  budgetExceeded?: boolean;
}

/**
 * 契约即退出条件（§8 Stopping Rules）：替代 assistant 自报式的启发式停止。
 * 判定顺序：终态 > 预算超支 > 在途。
 */
export function evaluateObligationStoppingRule(
  record: ObligationRecord,
  usage?: ObligationUsageAggregate,
): ObligationStoppingRule {
  const obligation = record.obligation;
  const budgetExceeded = isObligationBudgetExceeded(obligation.budget, usage);
  const budgetFlag = budgetExceeded ? { budgetExceeded: true } : {};
  switch (obligation.status) {
    case "fulfilled":
      return {
        shouldStop: true,
        outcome: "success",
        reason: "contract fulfilled: all required items passed",
        ...budgetFlag,
      };
    case "blocked_hard":
      return {
        shouldStop: true,
        outcome: "failure",
        reason: "contract blocked hard (manual intervention or compensation required)",
        ...budgetFlag,
      };
    case "expired":
      return {
        shouldStop: true,
        outcome: "failure",
        reason: "contract expired (deadline backstop fired)",
        ...budgetFlag,
      };
    default:
      break;
  }
  if (budgetExceeded) {
    return {
      shouldStop: true,
      outcome: "failure",
      budgetExceeded: true,
      reason: "obligation budget exceeded by aggregated step usage (§8 budget hard limit)",
    };
  }
  if (obligation.status === "blocked_recoverable") {
    return {
      shouldStop: false,
      reason: `recoverable block; ${obligation.retryBudget} retry budget remaining`,
    };
  }
  if (obligation.status === "validating") {
    const awaitingHuman = record.items.some(
      item => item.required && item.validator === "human_confirm" && item.verdict === undefined,
    );
    return { shouldStop: false, reason: awaitingHuman ? "awaiting human confirmation" : "validation in progress" };
  }
  return { shouldStop: false, reason: `in flight (${obligation.status})` };
}

/** 契约 budget（跨 step 硬限） vs 聚合用量。 */
export function isObligationBudgetExceeded(budget: ObligationBudget | undefined, usage: ObligationUsageAggregate | undefined): boolean {
  if (budget === undefined || usage === undefined) {
    return false;
  }
  if (budget.maxTokens !== undefined && usage.totalTokens !== undefined && usage.totalTokens > budget.maxTokens) {
    return true;
  }
  if (budget.maxCostUsd !== undefined && usage.totalCostUsd !== undefined && usage.totalCostUsd > budget.maxCostUsd) {
    return true;
  }
  return false;
}
