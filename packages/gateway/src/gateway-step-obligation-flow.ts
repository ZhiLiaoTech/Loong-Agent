import type { MemoryIdentity } from "@loong/core";
import {
  evaluateObligationStoppingRule,
  isObligationTerminalStatus,
  obligationEmployeeUserId,
  obligationVerdictStateOf,
  type Obligation,
  type ObligationBudget,
  type ObligationCreateItemInput,
  type ObligationService,
  type ObligationStatus,
  type ObligationStatusReport,
  type ObligationStoppingRule,
  type ObligationUsageAggregate,
  type ObligationVerdictState,
  type ObligationVerdictSummary,
  type ObligationWriteMeta,
} from "@loong/memory";
import {
  executeGatewayStep,
  type GatewayStepExecuteDeps,
} from "./gateway-step-execute.js";
import type {
  GatewayStepExecuteParams,
  GatewayStepResult,
} from "./gateway-step-types.js";

/**
 * Obligation-bound step execution（docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md
 * §4 六环节执行链 + §6.2 重试语义 + §8 停止规则的仓内闭环）。
 *
 * `executeGatewayStep` 是 obligation-free 的无状态单步执行器；
 * `executeObligationBoundStep` 在其上把六环节串成一次调用，让编排嵌入方
 * （ClawWorks-Server 等）无需自写胶水即可获得闭环：
 *
 *   执行（Action）→ step_result 证据挂接（Evidence）→ 显式关闭收集窗
 *   → validating → 逐项验证器裁定（Validation，验证主体 = 本次 step result）
 *   → fulfilled / blocked_* / expired / awaiting —— 全程审计（AuditLog）。
 *
 * 关键语义（与记忆层约定一致，勿改）：
 * - 验证主体：直接把本次 `GatewayStepResult` 作为 subject 传给
 *   `validateObligation`（按次传入，优先于服务构造期的 subjectResolver）。
 *   validatorConfig.subjectPath 例：`"proposal"` / `"toolResult.exitCode"`。
 *   执行产物缺失（如执行出错无 proposal）时，主体型验证器自然给出
 *   recoverable_block（§6.2 可重试错误），无需特殊分支。
 * - 证据覆盖：step 回执是契约级 `step_result` 链接；主体型验证器
 *   （schema / tool_assertion / model_review）的 §10 证据完备由该契约级
 *   链接满足（obligation-verdict.isObligationItemEvidenceCovered），
 *   test_command / human_confirm 仍要求项级链接。
 * - 收集窗：3.0 的覆盖齐套自动推进不变；本流挂接回执后显式
 *   `closeEvidenceCollection`（§3.2「或收集窗关闭」分支）。
 * - 重试（§6.2）：blocked_recoverable 且重试预算未耗尽 → `retryObligation`
 *   （扣减预算、回 dispatched）→ 以派生幂等键
 *   `<key>#obligation-retry-<n>` 进程内重新执行并重走挂接/关窗/裁定；
 *   聚合在 retryBudget = 0 时自动升级为 blocked_hard（错误放大防护）。
 *   重试 = 一次新的执行载体：mode:"tool" 的副作用幂等仍由嵌入方按业务键
 *   兜底（与 §4 Action 行同一姿态）。达到 `maxInProcessRetries` 上限而预算
 *   仍有剩余时，返回 outcome "retryable"，由嵌入方稍后经 obligation.retry
 *   RPC 重新派发（不空转占住进程）。
 * - 幂等/重放：同一 idempotencyKey 重放 → `executeGatewayStep` 命中幂等
 *   缓存；契约按 carrier 幂等键去重（同键不建第二条契约，§10）；证据挂接
 *   与关窗均幂等；契约已在终态时短路返回，不重挂、不重验、不重复沉淀。
 * - 停止规则（§8）：每次返回都带 verdictState + stoppingRule（终态 /
 *   预算超支 → shouldStop）。聚合用量 = deps.usageResolver（可选，既有
 *   跨 step 基数）+ 本次调用各次执行的 usage 之和；仓库内无用量存储，
 *   服务端 usageResolver 保持未接线时，本 helper 的按次聚合仍然生效。
 * - identity 强制：tenantId + employeeId 必填；identity.userId 默认
 *   `employee:{employeeId}` 命名空间（§7/§12 R4），可经 params.userId 覆盖。
 */

export interface GatewayObligationBoundStepDeps {
  /** 复用 obligation-free 执行器的全部依赖（幂等 store / agent turn / 参数解析）。 */
  step: GatewayStepExecuteDeps;
  obligations: ObligationService;
  /**
   * §8 可选：既有跨 step 聚合用量基数（本调用之前已发生的用量）。仓库内无
   * 用量存储，由嵌入方注入；helper 会在其上累加本次调用各次执行的 usage。
   */
  usageResolver?: (
    identity: MemoryIdentity,
    obligation: Obligation,
  ) => ObligationUsageAggregate | undefined | Promise<ObligationUsageAggregate | undefined>;
}

/** 闭环契约声明：绑定既有契约（obligationId）或按规格自动创建（create）。 */
export interface GatewayObligationBoundStepBinding {
  /** 既有契约 id（同 identity 下必须存在）。 */
  obligationId?: string;
  /**
   * 自动创建规格：carrier.idempotencyKey 固定取 step.idempotencyKey；
   * 同键重放时查找既有契约去重，不会建出第二条（§10 幂等）。
   */
  create?: {
    statement: string;
    items: ObligationCreateItemInput[];
    requesterUserId?: string;
    /** 默认 "orchestration"（step.execute 编排入口）。 */
    source?: string;
    budget?: ObligationBudget;
    deadlineAt?: string;
    retryBudget?: number;
  };
}

export interface GatewayObligationBoundStepParams {
  /** step 请求；闭环流强制 tenantId + employeeId（identity mandatory）。 */
  step: GatewayStepExecuteParams;
  obligation: GatewayObligationBoundStepBinding;
  /** identity.userId 覆盖；默认 `employee:{employeeId}`（§7/§12 R4）。 */
  userId?: string;
  /** 进程内自动重试上限（默认 2，钳制 [0, 5]）；上限于 obligation 重试预算之外独立生效。 */
  maxInProcessRetries?: number;
}

/** 闭环裁定终局：completed_verified（放行）/ blocked（硬阻断或超时）/ awaiting（等人工）/ retryable（进程内重试上限触顶，可稍后重新派发）。 */
export type GatewayObligationBoundStepOutcome =
  | "completed_verified"
  | "blocked"
  | "awaiting"
  | "retryable";

/** step 响应上挂的契约裁定与停止信号（指针/计数级，不含证据原文）。 */
export interface GatewayStepObligationVerdict {
  obligationId: string;
  /** 本次调用结束时的契约状态。 */
  status: ObligationStatus;
  verdictState: ObligationVerdictState;
  outcome: GatewayObligationBoundStepOutcome;
  reason: string;
  /** 本次调用内发生的 step 执行次数（1 + 进程内重试）。 */
  attempts: number;
  /** 本次调用内已用的进程内重试次数。 */
  retries: number;
  remainingRetryBudget: number;
  verdictSummary: ObligationVerdictSummary;
  /** §8 契约即退出条件：Loop/编排面据此停机（含 budgetExceeded 标记）。 */
  stoppingRule: ObligationStoppingRule;
  /** 聚合用量（usageResolver 基数 + 本次各次执行之和）。 */
  usage?: ObligationUsageAggregate;
  /** 解释链指针：经 obligation.explain RPC 取全链路（不在此搬运解释体）。 */
  explainRef: { rpc: "obligation.explain"; obligationId: string };
}

export interface GatewayObligationBoundStepResult extends GatewayStepResult {
  obligation: GatewayStepObligationVerdict;
}

const FLOW_WRITE_META: ObligationWriteMeta = {
  operator: "obligation-bound-step",
  source: "step.execute",
};

const DEFAULT_MAX_IN_PROCESS_RETRIES = 2;
const ABSOLUTE_MAX_IN_PROCESS_RETRIES = 5;

export async function executeObligationBoundStep(
  deps: GatewayObligationBoundStepDeps,
  params: GatewayObligationBoundStepParams,
): Promise<GatewayObligationBoundStepResult> {
  const stepParams = params.step;
  const tenantId = stepParams.tenantId?.trim();
  const employeeId = stepParams.employeeId?.trim();
  if (!stepParams.idempotencyKey?.trim()) {
    throw new Error("Obligation-bound steps require step.idempotencyKey.");
  }
  if (!tenantId || !employeeId) {
    throw new Error("Obligation-bound steps require step.tenantId and step.employeeId (identity is mandatory).");
  }
  const identity: MemoryIdentity = {
    tenantId,
    userId: params.userId?.trim() || obligationEmployeeUserId(employeeId),
  };
  const obligations = deps.obligations;

  // —— 契约解析：绑定既有，或按 carrier 幂等键去重后自动创建（§10 幂等）。 ——
  const obligationId = await resolveObligationId(obligations, identity, employeeId, stepParams.idempotencyKey, params.obligation);

  const maxRetries = clampRetries(params.maxInProcessRetries);
  const baseUsage = deps.usageResolver !== undefined
    ? await deps.usageResolver(identity, (await requireStatus(obligations, identity, obligationId)).record.obligation)
    : undefined;
  const callUsage = { tokens: 0, costUsd: 0, count: 0 };

  // —— 首次执行（重放时命中幂等缓存，不产生副作用）。 ——
  let key = stepParams.idempotencyKey;
  let result = await executeGatewayStep(deps.step, stepParams);
  accumulateUsage(callUsage, result);
  let retriesUsed = 0;

  for (;;) {
    const status = await requireStatus(obligations, identity, obligationId);
    const obligationStatus = status.record.obligation.status;

    // 终态短路：重放/并发完成路径 —— 不重挂、不重验、不重复沉淀。
    if (isObligationTerminalStatus(obligationStatus)) {
      const outcome: GatewayObligationBoundStepOutcome = obligationStatus === "fulfilled" ? "completed_verified" : "blocked";
      return composeOutcome(result, status, {
        outcome,
        attempts: callUsage.count,
        retriesUsed,
        callUsage,
        ...(baseUsage !== undefined ? { baseUsage } : {}),
      });
    }

    // 可恢复阻断（含上次调用触顶返回 retryable 后的再进入）：§6.2 重新派发。
    if (obligationStatus === "blocked_recoverable") {
      if (retriesUsed >= maxRetries) {
        return composeOutcome(result, status, {
          outcome: "retryable",
          reason: `in-process retry cap reached (${maxRetries}); redispatch later via obligation.retry`,
          attempts: callUsage.count,
          retriesUsed,
          callUsage,
          ...(baseUsage !== undefined ? { baseUsage } : {}),
        });
      }
      const retried = await obligations.retryObligation(identity, obligationId, FLOW_WRITE_META);
      retriesUsed += 1;
      if (retried.obligation.status !== "dispatched") {
        continue; // 预算耗尽 → retryObligation 已升级 blocked_hard；回到终态分支。
      }
      key = `${stepParams.idempotencyKey}#obligation-retry-${retriesUsed}`;
      result = await executeGatewayStep(deps.step, { ...stepParams, idempotencyKey: key });
      accumulateUsage(callUsage, result);
      continue;
    }

    // 在途（pending / dispatched / evidence_collecting / validating）：
    // 挂接回执 → 关闭收集窗 → 以本次 step result 为验证主体逐项裁定。
    // attachStepResult 走 carrier 幂等键路径（回填 runId）；重试派生键或绑定
    // 模式键不匹配时 attached:false，随后按 obligationId 显式挂接兜底——
    // 两条路径均幂等（同 ref 去重、同状态 no-op）。
    await obligations.attachStepResult(
      identity,
      key,
      result.runId !== undefined ? { runId: result.runId } : {},
      FLOW_WRITE_META,
    );
    await obligations.attachEvidence(identity, obligationId, {
      ref: { kind: "step_result", idempotencyKey: key },
    }, FLOW_WRITE_META);
    await obligations.closeEvidenceCollection(identity, obligationId, FLOW_WRITE_META);
    const report = await obligations.validateObligation(identity, obligationId, FLOW_WRITE_META, {
      subject: result,
    });
    if (report.outcome === "awaiting") {
      // 人工确认未决（§6.1）：留在 validating，消费方经 obligation.verdict.human
      // / awaitObligationVerdict 继续驱动。
      const awaitingStatus = await requireStatus(obligations, identity, obligationId);
      return composeOutcome(result, awaitingStatus, {
        outcome: "awaiting",
        reason: report.reason,
        attempts: callUsage.count,
        retriesUsed,
        callUsage,
        ...(baseUsage !== undefined ? { baseUsage } : {}),
      });
    }
    // fulfilled / blocked_recoverable / blocked_hard：回到循环顶部的状态分支收敛。
  }
}

/** 绑定既有契约或按 carrier 幂等键去重创建；返回契约 id。 */
async function resolveObligationId(
  obligations: ObligationService,
  identity: MemoryIdentity,
  employeeId: string,
  idempotencyKey: string,
  binding: GatewayObligationBoundStepBinding,
): Promise<string> {
  const bindId = binding.obligationId?.trim();
  const createSpec = binding.create;
  if ((bindId === undefined || bindId === "") === (createSpec === undefined)) {
    throw new Error("Obligation-bound steps require exactly one of obligation.obligationId or obligation.create.");
  }
  if (bindId) {
    const status = await obligations.getObligationStatus(identity, bindId);
    if (status === undefined) {
      throw new Error(`Obligation not found for the given identity: ${bindId}`);
    }
    return bindId;
  }
  const spec = createSpec!;
  const existing = await obligations.findObligationByIdempotencyKey(identity, idempotencyKey);
  if (existing !== undefined) {
    return existing.id; // 同键重放：复用既有契约，不建第二条（§10 幂等）。
  }
  const created = await obligations.createObligation(identity, {
    employeeId,
    statement: spec.statement,
    items: spec.items,
    source: spec.source ?? "orchestration",
    carrier: { idempotencyKey },
    ...(spec.requesterUserId !== undefined ? { requesterUserId: spec.requesterUserId } : {}),
    ...(spec.budget !== undefined ? { budget: spec.budget } : {}),
    ...(spec.deadlineAt !== undefined ? { deadlineAt: spec.deadlineAt } : {}),
    ...(spec.retryBudget !== undefined ? { retryBudget: spec.retryBudget } : {}),
  }, FLOW_WRITE_META);
  return created.obligation.id;
}

async function requireStatus(
  obligations: ObligationService,
  identity: MemoryIdentity,
  obligationId: string,
) {
  const status = await obligations.getObligationStatus(identity, obligationId);
  if (status === undefined) {
    throw new Error(`Obligation not found for the given identity: ${obligationId}`);
  }
  return status;
}

interface OutcomeContext {
  outcome: GatewayObligationBoundStepOutcome;
  reason?: string;
  attempts: number;
  retriesUsed: number;
  callUsage: { tokens: number; costUsd: number; count: number };
  baseUsage?: ObligationUsageAggregate;
}

/** 组装闭环响应：step result + 裁定摘要 + 停止规则（含本次调用聚合用量）。 */
async function composeOutcome(
  result: GatewayStepResult,
  status: ObligationStatusReport,
  context: OutcomeContext,
): Promise<GatewayObligationBoundStepResult> {
  const usage = mergeUsage(context.baseUsage, context.callUsage);
  const stoppingRule = evaluateObligationStoppingRule(status.record, usage);
  const verdict: GatewayStepObligationVerdict = {
    obligationId: status.record.obligation.id,
    status: status.record.obligation.status,
    verdictState: obligationVerdictStateOf(status.record.obligation.status),
    outcome: context.outcome,
    reason: context.reason ?? stoppingRule.reason,
    attempts: context.attempts,
    retries: context.retriesUsed,
    remainingRetryBudget: status.record.obligation.retryBudget,
    verdictSummary: status.verdictSummary,
    stoppingRule,
    usage,
    explainRef: { rpc: "obligation.explain", obligationId: status.record.obligation.id },
  };
  return { ...result, obligation: verdict };
}

function accumulateUsage(acc: { tokens: number; costUsd: number; count: number }, result: GatewayStepResult): void {
  acc.tokens += result.usage.tokens;
  acc.costUsd += result.usage.costUsd;
  acc.count += 1;
}

/** 本次调用用量 + 可选基数；始终返回本次调用口径的聚合（attempts ≥ 1）。 */
function mergeUsage(
  base: ObligationUsageAggregate | undefined,
  call: { tokens: number; costUsd: number; count: number },
): ObligationUsageAggregate {
  return {
    totalTokens: (base?.totalTokens ?? 0) + call.tokens,
    totalCostUsd: (base?.totalCostUsd ?? 0) + call.costUsd,
    stepCount: (base?.stepCount ?? 0) + call.count,
  };
}

function clampRetries(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_IN_PROCESS_RETRIES;
  }
  return Math.min(Math.max(0, Math.floor(value)), ABSOLUTE_MAX_IN_PROCESS_RETRIES);
}
