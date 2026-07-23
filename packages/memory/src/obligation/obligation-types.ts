import type { MemoryIdentity } from "@loong/core";

/**
 * Phase 3.0/3.1 of the Obligation + Evidence Chain design
 * (docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md §3): core obligation data models.
 *
 * Phase 3.0 was RECORDING ONLY (先记录不裁定); Phase 3.1 turns on verdicts:
 * persisted transitions follow OBLIGATION_ALLOWED_TRANSITIONS (§3.2, the full
 * 8-state machine incl. fulfilled / blocked_* / expired), item verdicts have a
 * write path, and retry_budget / deadline sweeps are live. The 3.0 allow-list
 * stays exported for compatibility only.
 *
 * Truth-source boundaries (§5.2) honored by this module:
 * - Obligation tables hold契约状态与证据「指针」only — never evidence excerpts
 *   (`excerpt` stays in the ontology store, inside the Loong process boundary).
 * - Obligation verdicts/status are NEVER written into `ontology_assertions`
 *   (assertions are facts about the user/world; obligations are task events).
 */

/** §3.1 契约状态机（8 态完整枚举）. */
export type ObligationStatus =
  | "pending"               // 已列出契约，待派发
  | "dispatched"            // 已派发执行载体，待回执
  | "evidence_collecting"   // 执行产出回流，证据收集中
  | "validating"            // 按契约逐项验证中（3.0 终态：等待 3.1 裁定）
  | "fulfilled"             // 放行（3.1+）
  | "blocked_recoverable"   // 可恢复阻断（3.1+）
  | "blocked_hard"          // 硬阻断（3.1+）
  | "expired";              // 超时未收敛（3.1+；3.0 仅 overdue 查询识别）

/** §3.1 单项验收裁定（3.0 定义但不写入）。 */
export type ObligationVerdict = "pass" | "recoverable_block" | "hard_block";

/** §6.1 验证器类型。 */
export type ObligationValidatorKind =
  | "schema"           // 结构校验（复用 suite schema 闸门）
  | "tool_assertion"   // 工具结果断言（确定性表达式）
  | "test_command"     // 测试命令执行（exit code，沙箱内）
  | "human_confirm"    // 人工确认（复用审批链）
  | "model_review";    // 模型评审（辅助，不可单独定论）

/** §3.1 契约级预算硬限（§8 Loop 预留）。 */
export interface ObligationBudget {
  maxTokens?: number;
  maxCostUsd?: number;
}

/** §3.1 验收项：契约的「完成标准」最小单元。 */
export interface ObligationItem {
  id: string;
  obligationId: string;
  seq: number;                         // 验收项顺序
  acceptance: string;                  // 验收项陈述（"满足哪些条件"）
  validator: ObligationValidatorKind;
  validatorConfig: Record<string, unknown>; // schemaRef / 断言表达式 / 命令 / 审批链 / rubric
  required: boolean;                   // false = 建议项，不阻断 fulfilled
  deadlineAt?: string;                 // 项级超时
  /** Phase 3.1 裁定结果（recordItemVerdict 写入）；3.0 记录中始终为空。 */
  verdict?: ObligationVerdict;
  verdictReason?: string;
  validatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * §3.1 任务契约：一份「施工合同 + 验收清单」。
 *
 * `identity` 是请求归属的租户/用户维度（§9：每行强制 tenant_id + user_id）；
 * `employeeId` / `requesterUserId` / `source` 是请求归属的数据维度。
 */
export interface Obligation {
  id: string;
  identity: MemoryIdentity;
  // —— 身份一：请求归属 ——
  employeeId: string;
  requesterUserId?: string;            // 渠道侧真实用户（纯系统任务可空）
  source: string;                      // 入口渠道：rpc / webhook / orchestration / cron
  // —— 身份二：任务契约 ——
  statement: string;                   // 任务声明："需要完成什么"
  budget?: ObligationBudget;
  deadlineAt?: string;                 // 契约级超时
  // —— 身份三：执行载体 ——
  instanceId?: string;                 // wf_instance.id（编排面派发时回填）
  runId?: string;                      // GatewayStepResult.runId / 渠道 run
  idempotencyKey?: string;             // step.execute 幂等键（重放归并）
  // —— 状态 ——
  status: ObligationStatus;
  retryBudget: number;                 // 可恢复阻断剩余重试次数（3.1 错误放大防护）
  createdAt: string;
  updatedAt: string;
  fulfilledAt?: string;                // 3.1+
}

/** §3.1 证据指针：跨 store 逻辑外键（§5.2），不做 DB 级 FK。 */
export type ObligationEvidenceRef =
  | { kind: "wf_event"; instanceId: string; seq: number }
  | { kind: "ontology_evidence"; tenantId: string; userId: string; evidenceId: string }
  | { kind: "ontology_episode"; tenantId: string; userId: string; episodeId: string }
  | { kind: "step_result"; idempotencyKey: string };  // 幂等键结果快照指针

export type ObligationEvidenceRefKind = ObligationEvidenceRef["kind"];

export const OBLIGATION_EVIDENCE_REF_KINDS: readonly ObligationEvidenceRefKind[] = [
  "wf_event",
  "ontology_evidence",
  "ontology_episode",
  "step_result",
];

export const OBLIGATION_STATUSES: readonly ObligationStatus[] = [
  "pending",
  "dispatched",
  "evidence_collecting",
  "validating",
  "fulfilled",
  "blocked_recoverable",
  "blocked_hard",
  "expired",
];

export const OBLIGATION_VALIDATOR_KINDS: readonly ObligationValidatorKind[] = [
  "schema",
  "tool_assertion",
  "test_command",
  "human_confirm",
  "model_review",
];

export function isObligationStatus(value: unknown): value is ObligationStatus {
  return typeof value === "string" && (OBLIGATION_STATUSES as readonly string[]).includes(value);
}

export function isObligationValidatorKind(value: unknown): value is ObligationValidatorKind {
  return typeof value === "string" && (OBLIGATION_VALIDATOR_KINDS as readonly string[]).includes(value);
}

export function isObligationEvidenceRefKind(value: unknown): value is ObligationEvidenceRefKind {
  return typeof value === "string" && (OBLIGATION_EVIDENCE_REF_KINDS as readonly string[]).includes(value);
}

/**
 * Phase 3.0 允许的持久化状态迁移（先记录不裁定）—— 历史快照，仅保留给
 * 外部兼容引用；3.1 起 store 统一使用 OBLIGATION_ALLOWED_TRANSITIONS。
 */
export const OBLIGATION_PHASE30_ALLOWED_TRANSITIONS: Readonly<Record<ObligationStatus, readonly ObligationStatus[]>> = {
  pending: ["dispatched"],
  dispatched: ["evidence_collecting"],
  evidence_collecting: ["validating"],
  validating: [],
  fulfilled: [],
  blocked_recoverable: [],
  blocked_hard: [],
  expired: [],
};

/** Same-status is an idempotent no-op; otherwise must appear in the 3.0 allow-list. */
export function isObligationTransitionAllowedInPhase30(from: ObligationStatus, to: ObligationStatus): boolean {
  if (from === to) {
    return true;
  }
  return OBLIGATION_PHASE30_ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Phase 3.1 允许的持久化状态迁移（三态裁定生效，§3.2 状态机）。
 *
 * 与 §3.2 mermaid 图一一对应：
 * - pending → dispatched（派发执行载体）
 * - dispatched → evidence_collecting（回执/证据回流）| expired（超时兜底）
 * - evidence_collecting → validating（覆盖齐套）| expired
 * - validating → fulfilled（全部 required pass）| blocked_recoverable
 *   （retry_budget > 0 的可恢复阻断）| blocked_hard | expired
 * - blocked_recoverable → dispatched（扣减 retry_budget 后重新派发，§6.2）
 *   | blocked_hard（重试预算耗尽）| expired
 * - fulfilled / blocked_hard / expired：终态，无出边（expired 人工重开留待后续阶段）。
 *
 * 文档图未画 validating / blocked_recoverable 的 expired 出边；这里按 §6.3
 * 「契约级超时 → expired」的无条件语义与 §10「无静默悬挂」指标补齐——
 * 等待人工确认或等待重试的契约同样不允许无限期悬挂。
 */
export const OBLIGATION_ALLOWED_TRANSITIONS: Readonly<Record<ObligationStatus, readonly ObligationStatus[]>> = {
  pending: ["dispatched"],
  dispatched: ["evidence_collecting", "expired"],
  evidence_collecting: ["validating", "expired"],
  validating: ["fulfilled", "blocked_recoverable", "blocked_hard", "expired"],
  fulfilled: [],
  blocked_recoverable: ["dispatched", "blocked_hard", "expired"],
  blocked_hard: [],
  expired: [],
};

/** Same-status is an idempotent no-op; otherwise must appear in the 3.1 allow-list. */
export function isObligationTransitionAllowed(from: ObligationStatus, to: ObligationStatus): boolean {
  if (from === to) {
    return true;
  }
  return OBLIGATION_ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * §7 / §12 R4：系统/编排任务的证据归属命名空间。当 obligation 没有渠道侧
 * 真实用户（requesterUserId 为空）时，其记录与证据挂在
 * `employee:{employeeId}` 这个 user_id 命名空间下；step 执行回执的自动归集
 * （gateway step recorder）也只在该命名空间内查找契约，人工渠道契约走显式
 * RPC 归集，两条路径互不越权。
 */
export function obligationEmployeeUserId(employeeId: string): string {
  return `employee:${employeeId.trim()}`;
}
