import type { MemoryIdentity } from "@loong/core";
import { assertMemoryIdentity } from "../memory-store-v2.js";
import { MemoryToolError } from "../memory-tool-error.js";
import type { OntologyStore } from "../ontology/ontology-store.js";
import type {
  ObligationAuditFilter,
  ObligationAuditRecord,
  ObligationCarrier,
  ObligationDanglingQuery,
  ObligationDanglingRecord,
  ObligationEvidenceLink,
  ObligationFilter,
  ObligationRecord,
  ObligationStore,
  ObligationSweptRecord,
  ObligationWriteMeta,
} from "./obligation-store.js";
import type {
  Obligation,
  ObligationBudget,
  ObligationEvidenceRef,
  ObligationItem,
  ObligationStatus,
  ObligationValidatorKind,
  ObligationVerdict,
} from "./obligation-types.js";
import {
  aggregateObligationVerdict,
  executeValidator,
  type ObligationCommandRunner,
  type ObligationModelReviewer,
} from "./obligation-verdict.js";
import {
  ABSOLUTE_OBLIGATION_LIST_LIMIT,
} from "./sqlite-obligation-store.js";
import {
  obligationSedimentEpisodeId,
  obligationSedimentEvidenceId,
  type ObligationSedimenter,
} from "./obligation-sediment.js";
import {
  evaluateObligationStoppingRule,
  isObligationTerminalStatus,
  type ObligationStoppingRule,
  type ObligationUsageAggregate,
} from "./obligation-loop.js";
import {
  extractObligationFinalVerdict,
  extractObligationRetryHistory,
  foldObligationAuditTimeline,
  type ObligationExplainedEvidence,
  type ObligationExplanation,
} from "./obligation-explain.js";

/**
 * Phase 3.0/3.1/3.2 契约记录与裁定服务（docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md
 * §11：3.0「先记录，不裁定」→ 3.1 三态裁定生效 → 3.2 记忆沉淀 + 解释链 +
 * Loop 对接）。
 *
 * 职责：
 * - 显式登记契约（createObligation）：携带验收项；带执行载体创建时直接推进
 *   到 dispatched（含审计）。
 * - 执行过程中归集证据（attachEvidence / attachStepResult）：校验证据指针
 *   完整性后写入证据链，并按状态机推进 pending → dispatched →
 *   evidence_collecting → validating。
 * - Phase 3.1 裁定（validateObligation / submitHumanVerdict / retryObligation /
 *   sweepExpired）：逐项执行机器验证器（human_confirm 留给人工），聚合三态
 *   裁定并按 §3.2 状态机迁移 fulfilled / blocked_recoverable / blocked_hard /
 *   expired；retry_budget 在重新派发时扣减（§6.2）。
 * - Phase 3.2 沉淀与解释（§7/§8）：终态（fulfilled / blocked_hard / expired）
 *   经可插拔 sedimenter 幂等沉淀进 ontology 记忆层；explainObligation 输出
 *   FR-12 同构全链路解释；getObligationStatus / awaitObligationVerdict 暴露
 *   「契约即退出条件」的 Loop 停止原语。
 * - 三类断裂点悬挂查询（listDangling）与审计查询（listAudit）。
 *
 * 证据完整性规则（§5.2 / §9）：
 * - ontology_evidence / ontology_episode 指针必须解析到**同一 identity** 下
 *   真实存在的本体记录（跨租户/跨用户引用直接拒绝；服务未配置 ontology
 *   store 时此类指针 fail-closed）。
 * - wf_event / step_result 是外部真相源（ClawWorks-Server）的逻辑外键，
 *   只校验形态、不做存在性检查（读方容忍悬空并留痕）。
 * - 本服务只写指针与状态，从不复制证据原文，也从不写 ontology_assertions。
 */

export interface ObligationServiceOptions {
  store: ObligationStore;
  /**
   * Used to verify ontology_evidence / ontology_episode refs resolve to real
   * records under the SAME identity. When absent, such refs are rejected
   * (fail-closed); external refs (wf_event / step_result) remain attachable.
   */
  ontologyStore?: OntologyStore;
  /**
   * Phase 3.1: resolves the validation subject (e.g. a step result payload)
   * for schema / tool_assertion / model_review validators. The gateway does
   * NOT wire this by default — step results live gateway-side and there is no
   * in-repo subject store; orchestration embedders inject their own resolver.
   * When the subject resolves to undefined, subject-based validators
   * recoverable-block (证据缺失, §6.2) rather than fail hard.
   */
  subjectResolver?: (identity: MemoryIdentity, obligation: Obligation) => unknown | Promise<unknown>;
  /**
   * Phase 3.1: sandbox-aware command execution for test_command validators
   * (验证器不扩权, §9). Validation of a contract containing test_command
   * items throws (fail-closed) when no runner is configured.
   */
  commandRunner?: ObligationCommandRunner;
  /**
   * Phase 3.1: rubric scorer for model_review validators (只作佐证). Same
   * fail-closed posture as commandRunner when unconfigured.
   */
  modelReviewer?: ObligationModelReviewer;
  /**
   * Phase 3.2 (§7): terminal-state sedimentation listener. Invoked
   * best-effort after every transition that lands in a terminal status
   * (fulfilled / blocked_hard / expired — NOT blocked_recoverable, which is
   * retryable). Must be idempotent: duplicate terminal notifications must not
   * duplicate sedimented artifacts. Use createOntologyObligationSedimenter to
   * write OntologyEpisode + OntologyEvidence into an ontology store.
   */
  sedimenter?: ObligationSedimenter;
  /**
   * Phase 3.2 (§8): resolves cross-step aggregated usage (tokens/cost) for
   * the contract-level budget hard limit. Not wired by default — step usages
   * live gateway/orchestration-side; embedders inject their own resolver
   * (same posture as subjectResolver). Budget evaluation stays inactive
   * while unresolved.
   */
  usageResolver?: (
    identity: MemoryIdentity,
    obligation: Obligation,
  ) => ObligationUsageAggregate | undefined | Promise<ObligationUsageAggregate | undefined>;
  clock?: () => Date;
}

export interface ObligationCreateItemInput {
  seq?: number;
  acceptance: string;
  validator: ObligationValidatorKind;
  validatorConfig?: Record<string, unknown>;
  required?: boolean;
  deadlineAt?: string;
}

export interface ObligationCreateInput {
  employeeId: string;
  requesterUserId?: string;
  source?: string;
  statement: string;
  items: ObligationCreateItemInput[];
  budget?: ObligationBudget;
  deadlineAt?: string;
  retryBudget?: number;
  /** 执行载体（身份三）：提供任意字段即视为已派发，创建后直接进 dispatched。 */
  carrier?: ObligationCarrier;
}

export interface ObligationAttachEvidenceInput {
  itemId?: string;
  ref: ObligationEvidenceRef;
}

export interface ObligationAttachEvidenceResult {
  link: ObligationEvidenceLink;
  inserted: boolean;
  record: ObligationRecord;
}

export interface ObligationStepResultAttach {
  attached: boolean;
  obligationId?: string;
  record?: ObligationRecord;
  /**
   * Phase 3.1（「ok 即终态」下线，§3.3/§11）：契约绑定执行的回执携带裁定态——
   * `GatewayStepResult.status: "ok"` 只证明这次执行没出错，它只是证据，
   * 不是裁定；消费方必须据此继续驱动验收（或显式声明该任务无需契约）。
   * obligation-free 流程不受影响（attached:false 时无此字段）。
   */
  verdictState?: ObligationVerdictState;
}

/**
 * 「ok 即终态」下线后的回执裁定态：
 * - collecting        证据归集中（pending / dispatched / evidence_collecting）
 * - awaiting_verdict  覆盖齐套，等待验证器/人工裁定（validating）
 * - fulfilled / blocked_recoverable / blocked_hard / expired  与契约状态同名
 */
export type ObligationVerdictState =
  | "collecting"
  | "awaiting_verdict"
  | "fulfilled"
  | "blocked_recoverable"
  | "blocked_hard"
  | "expired";

export function obligationVerdictStateOf(status: ObligationStatus): ObligationVerdictState {
  switch (status) {
    case "pending":
    case "dispatched":
    case "evidence_collecting":
      return "collecting";
    case "validating":
      return "awaiting_verdict";
    default:
      return status;
  }
}

export interface ObligationValidationItemResult {
  itemId: string;
  validator: ObligationValidatorKind;
  /** false = 本轮未执行（已 pass / human_confirm 留给人工）。 */
  executed: boolean;
  skipped?: "already_passed" | "human_confirm";
  verdict?: ObligationVerdict;
  reason?: string;
}

/** validateObligation / submitHumanVerdict 的聚合报告。 */
export interface ObligationValidationReport {
  outcome: "fulfilled" | "blocked_recoverable" | "blocked_hard" | "awaiting";
  reason: string;
  record: ObligationRecord;
  itemResults: ObligationValidationItemResult[];
}

export interface ObligationHumanVerdictInput {
  itemId: string;
  verdict: ObligationVerdict;
  reason?: string;
}

/** validateObligation 的按次调用选项（闭环流：手持执行产物直接作为验证主体）。 */
export interface ObligationValidateCallOptions {
  /** 优先于构造期 subjectResolver；undefined 时回落到注入的 resolver。 */
  subject?: unknown;
}

/** obligation.get 挂的裁定摘要（指针/计数级，无证据原文）。 */
export interface ObligationVerdictSummary {
  status: ObligationStatus;
  verdictState: ObligationVerdictState;
  retryBudget: number;
  fulfilledAt?: string;
  itemCounts: {
    total: number;
    required: number;
    passed: number;
    recoverableBlock: number;
    hardBlock: number;
    unverified: number;
  };
  /** 仍待人工确认的 required 项（human_confirm 且无 verdict）。 */
  pendingHumanItemIds: string[];
  /** ≥1 个 required 项以非 model_review 验证器通过（§10 自证完成率指标）。 */
  hasNonModelRequiredPass: boolean;
}

export function summarizeObligationRecord(record: ObligationRecord): ObligationVerdictSummary {
  const requiredItems = record.items.filter(item => item.required);
  return {
    status: record.obligation.status,
    verdictState: obligationVerdictStateOf(record.obligation.status),
    retryBudget: record.obligation.retryBudget,
    ...(record.obligation.fulfilledAt !== undefined ? { fulfilledAt: record.obligation.fulfilledAt } : {}),
    itemCounts: {
      total: record.items.length,
      required: requiredItems.length,
      passed: record.items.filter(item => item.verdict === "pass").length,
      recoverableBlock: record.items.filter(item => item.verdict === "recoverable_block").length,
      hardBlock: record.items.filter(item => item.verdict === "hard_block").length,
      unverified: record.items.filter(item => item.verdict === undefined).length,
    },
    pendingHumanItemIds: requiredItems
      .filter(item => item.validator === "human_confirm" && item.verdict === undefined)
      .map(item => item.id),
    hasNonModelRequiredPass: requiredItems.some(item => item.verdict === "pass" && item.validator !== "model_review"),
  };
}

/** Phase 3.2：obligation.get 的状态视图（记录 + 裁定摘要 + Loop 停止信号 + 聚合用量）。 */
export interface ObligationStatusReport {
  record: ObligationRecord;
  verdictSummary: ObligationVerdictSummary;
  stoppingRule: ObligationStoppingRule;
  usage?: ObligationUsageAggregate;
}

/** Phase 3.2：awaitObligationVerdict 的等待参数（均为进程内轮询，非 durable timer）。 */
export interface ObligationAwaitVerdictOptions {
  /** 0 = 单次轮询立即返回；上限 60_000ms。 */
  timeoutMs?: number;
  /** 默认 250ms，范围 [10, 5_000]。 */
  pollIntervalMs?: number;
}

export interface ObligationAwaitVerdictResult {
  record: ObligationRecord;
  stoppingRule: ObligationStoppingRule;
  /** true = 等到超时仍未到停止条件。 */
  timedOut: boolean;
  polls: number;
}

export type ObligationDanglingQueryInput = Omit<ObligationDanglingQuery, "now"> & { now?: string };

export interface ObligationService {
  createObligation(identity: MemoryIdentity, input: ObligationCreateInput, meta?: ObligationWriteMeta): Promise<ObligationRecord>;
  attachEvidence(
    identity: MemoryIdentity,
    obligationId: string,
    input: ObligationAttachEvidenceInput,
    meta?: ObligationWriteMeta,
  ): Promise<ObligationAttachEvidenceResult>;
  /**
   * step.execute 回执归集：按幂等键找到契约（同 identity），回填 runId、挂
   * step_result 证据并推进状态。找不到契约时返回 { attached: false }（契约
   * 登记是显式的，3.0 不在执行路径上自动创建契约）。
   */
  attachStepResult(
    identity: MemoryIdentity,
    idempotencyKey: string,
    options?: { runId?: string },
    meta?: ObligationWriteMeta,
  ): Promise<ObligationStepResultAttach>;
  getObligation(identity: MemoryIdentity, id: string): Promise<ObligationRecord | undefined>;
  listObligations(identity: MemoryIdentity, filter?: ObligationFilter): Promise<Obligation[]>;
  listDangling(identity: MemoryIdentity, query: ObligationDanglingQueryInput): Promise<ObligationDanglingRecord[]>;
  listAudit(identity: MemoryIdentity, filter?: ObligationAuditFilter): Promise<ObligationAuditRecord[]>;
  /**
   * Phase 3.1（§6）：对 validating 契约逐项执行机器验证器（已 pass 项跳过；
   * human_confirm 项不执行，等待 submitHumanVerdict），逐项写 verdict 审计后
   * 聚合三态裁定并迁移状态。test_command / model_review 项缺少对应执行器时
   * 直接抛错（fail-closed，不写任何 verdict）。
   *
   * `callOptions.subject`（闭环流）：调用方手持执行产物（如 step result）时
   * 按次传入验证主体，优先于构造期注入的 subjectResolver——与 3.1 的注入
   * 姿态一致，只是粒度细化到单次裁定。
   */
  validateObligation(
    identity: MemoryIdentity,
    obligationId: string,
    meta?: ObligationWriteMeta,
    callOptions?: ObligationValidateCallOptions,
  ): Promise<ObligationValidationReport>;
  /**
   * 证据收集窗关闭（§3.2「证据齐套（或收集窗关闭）」的后者）：调用方声明本契约
   * 的证据收集已完成，evidence_collecting → validating（审计 via =
   * "collection_window_closed"）。已在 validating 时为幂等 no-op；其他状态
   * 抛错。单步闭环流（executeObligationBoundStep）在挂接 step_result 回执后
   * 显式关窗；多步契约仍走覆盖齐套自动推进，不受影响。
   */
  closeEvidenceCollection(
    identity: MemoryIdentity,
    obligationId: string,
    meta?: ObligationWriteMeta,
  ): Promise<ObligationRecord>;
  /** 按执行载体幂等键查找契约（同 identity，只读）；闭环流自动建契约的重放去重锚点（§10 幂等）。 */
  findObligationByIdempotencyKey(identity: MemoryIdentity, idempotencyKey: string): Promise<Obligation | undefined>;
  /**
   * Phase 3.1（§6.1 human_confirm）：人工对 human_confirm 项给出裁定。
   * 契约须在 validating；meta.operator 必须显式给出（确认人）；写完后自动
   * 重新聚合并迁移。
   */
  submitHumanVerdict(
    identity: MemoryIdentity,
    obligationId: string,
    input: ObligationHumanVerdictInput,
    meta?: ObligationWriteMeta,
  ): Promise<ObligationValidationReport>;
  /**
   * Phase 3.1（§6.2）：blocked_recoverable → dispatched 重新派发，重新派发时
   * 扣减 retry_budget；预算已耗尽则直接升级 blocked_hard。
   */
  retryObligation(identity: MemoryIdentity, obligationId: string, meta?: ObligationWriteMeta): Promise<ObligationRecord>;
  /**
   * Phase 3.1 超时兜底（§6.3）：把该 identity 下 deadline 已过的在途契约
   * （dispatched / evidence_collecting / validating / blocked_recoverable）
   * 迁移为 expired（审计 detail.via = "deadline_sweep"）。
   */
  sweepExpired(identity: MemoryIdentity, now?: string): Promise<Obligation[]>;
  /** 系统内部全量兜底扫描：跨 identity 定位后逐行按行 identity 迁移。 */
  sweepExpiredSystem(now?: string): Promise<ObligationSweptRecord[]>;
  /**
   * Phase 3.2（§8 Loop 对接）：契约状态视图 —— 记录 + 裁定摘要 + 停止信号
   * （契约即退出条件）+ 聚合用量（usageResolver 已接线时）。
   */
  getObligationStatus(identity: MemoryIdentity, id: string): Promise<ObligationStatusReport | undefined>;
  /**
   * Phase 3.2（§7 解释链，FR-12 explainAssertion 同构）：一次调用返回契约
   * 全链路 —— 四身份、审计折叠时间线、逐项 verdict 与理由、证据指针解引用
   * （ontology 原文按调用方 identity 解引用；外部指针标 external；悬空标
   * dangling）、retry 历史、终态裁定与 operator、终态沉淀。不存在时返回
   * undefined（跨 identity 不可见）。
   */
  explainObligation(identity: MemoryIdentity, id: string): Promise<ObligationExplanation | undefined>;
  /**
   * Phase 3.2（§8）：Loop 轮询/等待原语 —— 进程内轮询直到停止条件满足
   * （终态或预算超支）或超时。单租户外层编排使用；durable 等待仍属
   * wf_timer 领域，本方法不做持久化定时。
   */
  awaitObligationVerdict(
    identity: MemoryIdentity,
    id: string,
    options?: ObligationAwaitVerdictOptions,
  ): Promise<ObligationAwaitVerdictResult>;
}

export function createObligationService(options: ObligationServiceOptions): ObligationService {
  const clock = options.clock ?? (() => new Date());

  async function createObligation(
    identityValue: MemoryIdentity,
    input: ObligationCreateInput,
    meta: ObligationWriteMeta = {},
  ): Promise<ObligationRecord> {
    const identity = assertMemoryIdentity(identityValue);
    const record = await options.store.createObligation(identity, {
      ...(input.requesterUserId !== undefined ? { requesterUserId: input.requesterUserId } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      employeeId: input.employeeId,
      statement: input.statement,
      items: input.items.map((item, index) => ({
        ...(item.seq !== undefined ? { seq: item.seq } : { seq: index + 1 }),
        acceptance: item.acceptance,
        validator: item.validator,
        ...(item.validatorConfig !== undefined ? { validatorConfig: item.validatorConfig } : {}),
        ...(item.required !== undefined ? { required: item.required } : {}),
        ...(item.deadlineAt !== undefined ? { deadlineAt: item.deadlineAt } : {}),
      })),
      ...(input.budget !== undefined ? { budget: input.budget } : {}),
      ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
      ...(input.retryBudget !== undefined ? { retryBudget: input.retryBudget } : {}),
      ...(input.carrier !== undefined ? { carrier: input.carrier } : {}),
    }, meta);
    const hasCarrier = input.carrier !== undefined
      && (input.carrier.instanceId?.trim() || input.carrier.runId?.trim() || input.carrier.idempotencyKey?.trim());
    if (!hasCarrier) {
      return record;
    }
    // 带执行载体创建 = 已派发：pending → dispatched（审计留痕）。
    const dispatched = await options.store.transitionStatus(identity, record.obligation.id, "dispatched", {
      ...meta,
      detail: { ...(meta.detail ?? {}), via: "create_with_carrier" },
    });
    return { ...record, obligation: dispatched };
  }

  async function attachEvidence(
    identityValue: MemoryIdentity,
    obligationId: string,
    input: ObligationAttachEvidenceInput,
    meta: ObligationWriteMeta = {},
  ): Promise<ObligationAttachEvidenceResult> {
    const identity = assertMemoryIdentity(identityValue);
    const existing = await options.store.getObligation(identity, obligationId);
    if (existing === undefined) {
      throw new MemoryToolError("Obligation not found for the given identity.");
    }
    assertAttachAllowed(existing.obligation.status);
    await assertEvidenceRefIntegrity(identity, input.ref);

    const attach = await options.store.attachEvidence(identity, obligationId, {
      ...(input.itemId !== undefined ? { itemId: input.itemId } : {}),
      ref: input.ref,
    }, meta);

    // 状态推进（3.0 允许路径）：pending → dispatched → evidence_collecting。
    let status: ObligationStatus = existing.obligation.status;
    if (status === "pending") {
      await options.store.transitionStatus(identity, obligationId, "dispatched", {
        ...meta,
        detail: { ...(meta.detail ?? {}), via: "first_evidence" },
      });
      status = "dispatched";
    }
    if (status === "dispatched") {
      await options.store.transitionStatus(identity, obligationId, "evidence_collecting", meta);
      status = "evidence_collecting";
    }

    // 覆盖检查：全部 required 验收项均有项级证据 → validating（3.0 记录终态）。
    let record = await requireRecord(identity, obligationId);
    if (status === "evidence_collecting" && requiredCoverageComplete(record)) {
      await options.store.transitionStatus(identity, obligationId, "validating", {
        ...meta,
        detail: {
          ...(meta.detail ?? {}),
          reason: "required item coverage complete; verdict pending (Phase 3.1)",
        },
      });
      record = await requireRecord(identity, obligationId);
    }
    return { link: attach.link, inserted: attach.inserted, record };
  }

  async function attachStepResult(
    identityValue: MemoryIdentity,
    idempotencyKey: string,
    options2: { runId?: string } = {},
    meta: ObligationWriteMeta = {},
  ): Promise<ObligationStepResultAttach> {
    const identity = assertMemoryIdentity(identityValue);
    const stepMeta: ObligationWriteMeta = {
      operator: meta.operator ?? "step-execution",
      source: meta.source ?? "step.execute",
      ...(meta.detail !== undefined ? { detail: meta.detail } : {}),
    };
    const obligation = await options.store.findObligationByIdempotencyKey(identity, idempotencyKey);
    if (obligation === undefined) {
      return { attached: false };
    }
    if (options2.runId?.trim() && obligation.runId === undefined) {
      await options.store.updateCarrier(identity, obligation.id, { runId: options2.runId.trim() }, stepMeta);
    }
    const attach = await attachEvidence(identity, obligation.id, {
      ref: { kind: "step_result", idempotencyKey },
    }, stepMeta);
    // 「ok 即终态」下线（§3.3）：回执只携带裁定态，step ok 不等于契约完成。
    return {
      attached: true,
      obligationId: obligation.id,
      record: attach.record,
      verdictState: obligationVerdictStateOf(attach.record.obligation.status),
    };
  }

  async function getObligation(identity: MemoryIdentity, id: string): Promise<ObligationRecord | undefined> {
    assertMemoryIdentity(identity);
    return await options.store.getObligation(identity, id);
  }

  async function listObligations(identity: MemoryIdentity, filter?: ObligationFilter): Promise<Obligation[]> {
    assertMemoryIdentity(identity);
    return await options.store.listObligations(identity, filter);
  }

  async function listDangling(
    identity: MemoryIdentity,
    query: ObligationDanglingQueryInput,
  ): Promise<ObligationDanglingRecord[]> {
    assertMemoryIdentity(identity);
    return await options.store.listDangling(identity, {
      kind: query.kind,
      now: query.now ?? clock().toISOString(),
      ...(query.olderThan !== undefined ? { olderThan: query.olderThan } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    });
  }

  async function listAudit(identity: MemoryIdentity, filter?: ObligationAuditFilter): Promise<ObligationAuditRecord[]> {
    assertMemoryIdentity(identity);
    return await options.store.listAudit(identity, filter);
  }

  async function validateObligation(
    identityValue: MemoryIdentity,
    obligationId: string,
    meta: ObligationWriteMeta = {},
    callOptions: ObligationValidateCallOptions = {},
  ): Promise<ObligationValidationReport> {
    const identity = assertMemoryIdentity(identityValue);
    const record = await requireRecord(identity, obligationId);
    if (record.obligation.status !== "validating") {
      throw new MemoryToolError(`Obligation must be validating to run validation, got ${record.obligation.status}.`);
    }
    // fail-closed 预检：存在无法执行的验证器时整体抛错，不写任何 verdict。
    assertExecutorsConfigured(record.items);
    // 按次传入的验证主体优先；未传入时回落到构造期注入的 subjectResolver。
    const subject = callOptions.subject !== undefined
      ? callOptions.subject
      : options.subjectResolver !== undefined
        ? await options.subjectResolver(identity, record.obligation)
        : undefined;
    const itemResults: ObligationValidationItemResult[] = [];
    for (const item of record.items) {
      if (item.verdict === "pass") {
        itemResults.push({ itemId: item.id, validator: item.validator, executed: false, skipped: "already_passed", verdict: "pass" });
        continue;
      }
      if (item.validator === "human_confirm") {
        itemResults.push({ itemId: item.id, validator: item.validator, executed: false, skipped: "human_confirm" });
        continue;
      }
      const result = await executeValidator(item, {
        ...(subject !== undefined ? { subject } : {}),
        ...(options.commandRunner !== undefined ? { commandRunner: options.commandRunner } : {}),
        ...(options.modelReviewer !== undefined ? { modelReviewer: options.modelReviewer } : {}),
      });
      const written = await options.store.recordItemVerdict(identity, obligationId, item.id, {
        verdict: result.verdict ?? "hard_block",
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
        validatedAt: clock().toISOString(),
      }, {
        ...meta,
        detail: { ...(meta.detail ?? {}), via: "obligation.validate", validator: item.validator },
      });
      itemResults.push({
        itemId: item.id,
        validator: item.validator,
        executed: true,
        ...(written.verdict !== undefined ? { verdict: written.verdict } : {}),
        ...(written.verdictReason !== undefined ? { reason: written.verdictReason } : {}),
      });
    }
    const aggregated = await aggregateAndTransition(identity, obligationId, meta, "obligation.validate");
    return { ...aggregated, itemResults };
  }

  async function submitHumanVerdict(
    identityValue: MemoryIdentity,
    obligationId: string,
    input: ObligationHumanVerdictInput,
    meta: ObligationWriteMeta = {},
  ): Promise<ObligationValidationReport> {
    const identity = assertMemoryIdentity(identityValue);
    if (!meta.operator?.trim()) {
      throw new MemoryToolError("Human verdicts require an explicit operator (the confirming user).");
    }
    if (input.verdict !== "pass" && input.verdict !== "recoverable_block" && input.verdict !== "hard_block") {
      throw new MemoryToolError("Obligation human verdict is invalid.");
    }
    const record = await requireRecord(identity, obligationId);
    if (record.obligation.status !== "validating") {
      throw new MemoryToolError(`Human verdicts require a validating obligation, got ${record.obligation.status}.`);
    }
    const item = record.items.find(entry => entry.id === input.itemId);
    if (item === undefined) {
      throw new MemoryToolError("Obligation item not found on this obligation.");
    }
    if (item.validator !== "human_confirm") {
      throw new MemoryToolError(`Human verdicts only apply to human_confirm items, got ${item.validator}.`);
    }
    await options.store.recordItemVerdict(identity, obligationId, item.id, {
      verdict: input.verdict,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      validatedAt: clock().toISOString(),
    }, {
      ...meta,
      detail: { ...(meta.detail ?? {}), via: "obligation.verdict.human", validator: "human_confirm" },
    });
    const itemResults: ObligationValidationItemResult[] = [{
      itemId: item.id,
      validator: item.validator,
      executed: true,
      verdict: input.verdict,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    }];
    const aggregated = await aggregateAndTransition(identity, obligationId, meta, "obligation.verdict.human");
    return { ...aggregated, itemResults };
  }

  async function retryObligation(
    identityValue: MemoryIdentity,
    obligationId: string,
    meta: ObligationWriteMeta = {},
  ): Promise<ObligationRecord> {
    const identity = assertMemoryIdentity(identityValue);
    const record = await requireRecord(identity, obligationId);
    if (record.obligation.status !== "blocked_recoverable") {
      throw new MemoryToolError(`Only blocked_recoverable obligations can be retried, got ${record.obligation.status}.`);
    }
    const budget = record.obligation.retryBudget;
    if (budget <= 0) {
      // 预算已耗尽的可恢复阻断：直接升级 hard_block（§6.2 错误放大防护）。
      await options.store.transitionStatus(identity, obligationId, "blocked_hard", {
        ...meta,
        detail: { ...(meta.detail ?? {}), via: "retry_budget_exhausted" },
      });
      await notifyTerminal(identity, obligationId, {
        via: "retry_budget_exhausted",
        ...(meta.operator !== undefined ? { operator: meta.operator } : {}),
      });
      return await requireRecord(identity, obligationId);
    }
    // §6.2：扣减发生在重新派发时，而不是进入 blocked_recoverable 时。
    await options.store.setRetryBudget(identity, obligationId, budget - 1, {
      ...meta,
      detail: { ...(meta.detail ?? {}), via: "obligation.retry" },
    });
    await options.store.transitionStatus(identity, obligationId, "dispatched", {
      ...meta,
      detail: { ...(meta.detail ?? {}), via: "obligation.retry", remainingRetryBudget: budget - 1 },
    });
    return await requireRecord(identity, obligationId);
  }

  /** 证据收集窗关闭（§3.2）：evidence_collecting → validating；validating 幂等 no-op。 */
  async function closeEvidenceCollection(
    identityValue: MemoryIdentity,
    obligationId: string,
    meta: ObligationWriteMeta = {},
  ): Promise<ObligationRecord> {
    const identity = assertMemoryIdentity(identityValue);
    const record = await requireRecord(identity, obligationId);
    const status = record.obligation.status;
    if (status === "validating") {
      return record; // 幂等：收集窗已关闭，不重复写审计。
    }
    if (status !== "evidence_collecting") {
      throw new MemoryToolError(
        `Cannot close evidence collection for an obligation in status ${status};`
        + " expected evidence_collecting (attach the execution receipt first).",
      );
    }
    await options.store.transitionStatus(identity, obligationId, "validating", {
      ...meta,
      detail: { ...(meta.detail ?? {}), via: "collection_window_closed" },
    });
    return await requireRecord(identity, obligationId);
  }

  async function findObligationByIdempotencyKey(
    identityValue: MemoryIdentity,
    idempotencyKey: string,
  ): Promise<Obligation | undefined> {
    const identity = assertMemoryIdentity(identityValue);
    return await options.store.findObligationByIdempotencyKey(identity, idempotencyKey);
  }

  async function sweepExpired(identityValue: MemoryIdentity, now?: string): Promise<Obligation[]> {
    const identity = assertMemoryIdentity(identityValue);
    const swept = await options.store.sweepExpired(identity, now ?? clock().toISOString(), {
      operator: "system",
      source: "obligation.sweep",
    });
    for (const obligation of swept) {
      // expired = 异常归档（§3.2），同样沉淀（§7 终态语义 + §8 停止信号）。
      await notifyTerminal(identity, obligation.id, { via: "deadline_sweep", operator: "system" });
    }
    return swept;
  }

  async function sweepExpiredSystem(now?: string): Promise<ObligationSweptRecord[]> {
    const swept = await options.store.sweepExpiredGlobal(now ?? clock().toISOString(), {
      operator: "system",
      source: "obligation.sweep",
    });
    for (const record of swept) {
      await notifyTerminal(record.identity, record.obligation.id, { via: "deadline_sweep", operator: "system" });
    }
    return swept;
  }

  async function getObligationStatus(identityValue: MemoryIdentity, id: string): Promise<ObligationStatusReport | undefined> {
    const identity = assertMemoryIdentity(identityValue);
    const record = await options.store.getObligation(identity, id);
    if (record === undefined) {
      return undefined;
    }
    const usage = await resolveUsage(identity, record.obligation);
    return {
      record,
      verdictSummary: summarizeObligationRecord(record),
      stoppingRule: evaluateObligationStoppingRule(record, usage),
      ...(usage !== undefined ? { usage } : {}),
    };
  }

  async function explainObligation(identityValue: MemoryIdentity, id: string): Promise<ObligationExplanation | undefined> {
    const identity = assertMemoryIdentity(identityValue);
    const record = await options.store.getObligation(identity, id);
    if (record === undefined) {
      return undefined;
    }
    const itemIds = new Set(record.items.map(item => item.id));
    // 契约行 + 全部验收项行的审计（FR-12 同构：折叠成一条 provenance 链）。
    const audits = (await options.store.listAudit(identity, { limit: ABSOLUTE_OBLIGATION_LIST_LIMIT }))
      .filter(entry => entry.recordId === id || itemIds.has(entry.recordId));
    const explainedEvidence = await resolveEvidenceLinks(identity, record.evidenceLinks);
    const usage = await resolveUsage(identity, record.obligation);
    const sedimentEpisodeId = obligationSedimentEpisodeId(id);
    const sedimentEvidenceId = obligationSedimentEvidenceId(id);
    const sedimentEpisode = options.ontologyStore !== undefined
      ? await options.ontologyStore.getEpisode(identity, sedimentEpisodeId)
      : undefined;
    const finalVerdict = extractObligationFinalVerdict(audits);
    const obligation = record.obligation;
    return {
      identity: { ...identity },
      record,
      fourIdentities: {
        request: {
          tenantId: identity.tenantId,
          userId: identity.userId,
          employeeId: obligation.employeeId,
          ...(obligation.requesterUserId !== undefined ? { requesterUserId: obligation.requesterUserId } : {}),
          source: obligation.source,
        },
        contract: {
          statement: obligation.statement,
          itemCount: record.items.length,
          requiredItemCount: record.items.filter(item => item.required).length,
          ...(obligation.budget !== undefined ? { budget: obligation.budget } : {}),
          ...(obligation.deadlineAt !== undefined ? { deadlineAt: obligation.deadlineAt } : {}),
          retryBudget: obligation.retryBudget,
        },
        carrier: {
          ...(obligation.instanceId !== undefined ? { instanceId: obligation.instanceId } : {}),
          ...(obligation.runId !== undefined ? { runId: obligation.runId } : {}),
          ...(obligation.idempotencyKey !== undefined ? { idempotencyKey: obligation.idempotencyKey } : {}),
        },
        record: {
          evidenceLinkCount: record.evidenceLinks.length,
          auditCount: audits.length,
          sedimented: sedimentEpisode !== undefined,
          sedimentEpisodeId,
          sedimentEvidenceId,
        },
      },
      verdictSummary: summarizeObligationRecord(record),
      stoppingRule: evaluateObligationStoppingRule(record, usage),
      ...(usage !== undefined ? { usage } : {}),
      timeline: foldObligationAuditTimeline(audits),
      items: record.items.map(item => ({
        item,
        evidence: explainedEvidence.filter(entry => entry.link.itemId === item.id),
      })),
      contractEvidence: explainedEvidence.filter(entry => entry.link.itemId === undefined),
      retryHistory: extractObligationRetryHistory(audits),
      ...(finalVerdict !== undefined ? { finalVerdict } : {}),
      sedimentation: {
        sedimented: sedimentEpisode !== undefined,
        episodeId: sedimentEpisodeId,
        evidenceId: sedimentEvidenceId,
        ...(sedimentEpisode !== undefined ? { episode: sedimentEpisode } : {}),
      },
      audit: audits,
    };
  }

  /** §5.2/§9：ontology 指针按调用方 identity 解引用；悬空/缺 store 标 dangling；外部指针只标 external。 */
  async function resolveEvidenceLinks(
    identity: MemoryIdentity,
    links: readonly ObligationEvidenceLink[],
  ): Promise<ObligationExplainedEvidence[]> {
    const resolved: ObligationExplainedEvidence[] = [];
    for (const link of links) {
      const ref = link.ref;
      if (ref.kind === "ontology_evidence") {
        // 跨 identity 指针在挂接时已被拒绝（3.0 fail-closed）；此处仍以调用方
        // identity 解引用，命中不了就标 dangling（读方容忍，不泄露、不报错）。
        const evidence = ref.tenantId === identity.tenantId && ref.userId === identity.userId && options.ontologyStore !== undefined
          ? await options.ontologyStore.getEvidence(identity, ref.evidenceId)
          : undefined;
        resolved.push({
          link,
          resolution: evidence !== undefined
            ? { kind: "ontology_evidence", status: "resolved", evidence }
            : { kind: "ontology_evidence", status: "dangling" },
        });
        continue;
      }
      if (ref.kind === "ontology_episode") {
        const episode = ref.tenantId === identity.tenantId && ref.userId === identity.userId && options.ontologyStore !== undefined
          ? await options.ontologyStore.getEpisode(identity, ref.episodeId)
          : undefined;
        resolved.push({
          link,
          resolution: episode !== undefined
            ? { kind: "ontology_episode", status: "resolved", episode }
            : { kind: "ontology_episode", status: "dangling" },
        });
        continue;
      }
      resolved.push({ link, resolution: { kind: ref.kind, status: "external" } });
    }
    return resolved;
  }

  async function awaitObligationVerdict(
    identityValue: MemoryIdentity,
    id: string,
    awaitOptions: ObligationAwaitVerdictOptions = {},
  ): Promise<ObligationAwaitVerdictResult> {
    const identity = assertMemoryIdentity(identityValue);
    const timeoutMs = clampAwaitMs(awaitOptions.timeoutMs ?? 0, 0, MAX_AWAIT_TIMEOUT_MS);
    const pollIntervalMs = clampAwaitMs(awaitOptions.pollIntervalMs ?? DEFAULT_AWAIT_POLL_INTERVAL_MS, 10, MAX_AWAIT_POLL_INTERVAL_MS);
    const deadline = Date.now() + timeoutMs;
    let polls = 0;
    for (;;) {
      polls += 1;
      const record = await options.store.getObligation(identity, id);
      if (record === undefined) {
        throw new MemoryToolError("Obligation not found for the given identity.");
      }
      const usage = await resolveUsage(identity, record.obligation);
      const stoppingRule = evaluateObligationStoppingRule(record, usage);
      if (stoppingRule.shouldStop || Date.now() >= deadline) {
        return { record, stoppingRule, timedOut: !stoppingRule.shouldStop, polls };
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }

  /** 聚合当前 verdicts 并按 §3.2 迁移（awaiting 时保持 validating）。 */
  async function aggregateAndTransition(
    identity: MemoryIdentity,
    obligationId: string,
    meta: ObligationWriteMeta,
    via: string,
  ): Promise<{ record: ObligationRecord; outcome: ObligationValidationReport["outcome"]; reason: string }> {
    const record = await requireRecord(identity, obligationId);
    const outcome = aggregateObligationVerdict({
      items: record.items,
      evidenceLinks: record.evidenceLinks,
      retryBudget: record.obligation.retryBudget,
    });
    if (outcome.kind === "awaiting") {
      return { record, outcome: "awaiting", reason: outcome.reason };
    }
    const transitioned = await options.store.transitionStatus(identity, obligationId, outcome.kind, {
      ...meta,
      detail: { ...(meta.detail ?? {}), via, reason: outcome.reason },
    });
    if (isObligationTerminalStatus(outcome.kind)) {
      await notifyTerminal(identity, obligationId, {
        via,
        reason: outcome.reason,
        ...(meta.operator !== undefined ? { operator: meta.operator } : {}),
      });
    }
    return { record: { ...record, obligation: transitioned }, outcome: outcome.kind, reason: outcome.reason };
  }

  /**
   * Phase 3.2（§7）：终态沉淀通知。best-effort —— 沉淀是记忆投影，投影失败
   * 绝不回滚裁定（与 3.0 step 记录钩子同姿态）；幂等由 sedimenter 的确定性
   * id 锚点保证。
   */
  async function notifyTerminal(
    identity: MemoryIdentity,
    obligationId: string,
    notice: { via: string; reason?: string; operator?: string },
  ): Promise<void> {
    const sedimenter = options.sedimenter;
    if (sedimenter === undefined) {
      return;
    }
    const record = await options.store.getObligation(identity, obligationId);
    if (record === undefined || !isObligationTerminalStatus(record.obligation.status)) {
      return;
    }
    try {
      await sedimenter.onObligationTerminal(identity, { record, ...notice });
    } catch {
      // 投影失败不影响契约状态；悬挂由 ontology 审计与 explain 视图兜底。
    }
  }

  /** §8 聚合用量解析（未接线时返回 undefined，预算评估不激活）。 */
  async function resolveUsage(identity: MemoryIdentity, obligation: Obligation): Promise<ObligationUsageAggregate | undefined> {
    if (options.usageResolver === undefined) {
      return undefined;
    }
    return await options.usageResolver(identity, obligation);
  }

  /** fail-closed：test_command / model_review 项缺少执行器时验证整体不可进行。 */
  function assertExecutorsConfigured(items: readonly ObligationItem[]): void {
    const needsRunner = items.some(item => item.validator === "test_command" && item.verdict !== "pass");
    if (needsRunner && options.commandRunner === undefined) {
      throw new MemoryToolError("Obligation validation requires a commandRunner for test_command items (fail-closed).");
    }
    const needsReviewer = items.some(item => item.validator === "model_review" && item.verdict !== "pass");
    if (needsReviewer && options.modelReviewer === undefined) {
      throw new MemoryToolError("Obligation validation requires a modelReviewer for model_review items (fail-closed).");
    }
  }

  async function requireRecord(identity: MemoryIdentity, id: string): Promise<ObligationRecord> {
    const record = await options.store.getObligation(identity, id);
    if (record === undefined) {
      throw new MemoryToolError("Obligation not found for the given identity.");
    }
    return record;
  }

  /** 执行进行中的状态才允许挂证据；blocked_recoverable 须先 retry 回 dispatched。 */
  function assertAttachAllowed(status: ObligationStatus): void {
    if (
      status !== "pending"
      && status !== "dispatched"
      && status !== "evidence_collecting"
      && status !== "validating"
    ) {
      throw new MemoryToolError(
        `Cannot attach evidence to an obligation in status ${status}`
        + (status === "blocked_recoverable" ? " (retry the obligation first)" : "."),
      );
    }
  }

  /** 证据指针完整性（§5.2 / §9）：ontology 指针必须同 identity 且解析存在。 */
  async function assertEvidenceRefIntegrity(identity: MemoryIdentity, ref: ObligationEvidenceRef): Promise<void> {
    if (ref.kind === "wf_event" || ref.kind === "step_result") {
      return; // 外部真相源逻辑外键：形态校验已由 store 兜底，读方容忍悬空。
    }
    if (ref.tenantId !== identity.tenantId || ref.userId !== identity.userId) {
      throw new MemoryToolError("Ontology evidence refs must belong to the caller's identity (cross-user refs are rejected).");
    }
    if (options.ontologyStore === undefined) {
      throw new MemoryToolError("Ontology evidence refs require an ontology store for existence verification.");
    }
    if (ref.kind === "ontology_evidence") {
      const evidence = await options.ontologyStore.getEvidence(identity, ref.evidenceId);
      if (evidence === undefined) {
        throw new MemoryToolError("Ontology evidence ref does not resolve to an existing evidence record.");
      }
      return;
    }
    const episode = await options.ontologyStore.getEpisode(identity, ref.episodeId);
    if (episode === undefined) {
      throw new MemoryToolError("Ontology episode ref does not resolve to an existing episode record.");
    }
  }

  return {
    createObligation,
    attachEvidence,
    attachStepResult,
    getObligation,
    listObligations,
    listDangling,
    listAudit,
    validateObligation,
    submitHumanVerdict,
    retryObligation,
    closeEvidenceCollection,
    findObligationByIdempotencyKey,
    sweepExpired,
    sweepExpiredSystem,
    getObligationStatus,
    explainObligation,
    awaitObligationVerdict,
  };
}

const DEFAULT_AWAIT_POLL_INTERVAL_MS = 250;
const MAX_AWAIT_TIMEOUT_MS = 60_000;
const MAX_AWAIT_POLL_INTERVAL_MS = 5_000;

function clampAwaitMs(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(min, Math.floor(value)), max);
}

/** 全部 required 验收项均有 ≥1 条项级证据（契约级证据不计入项覆盖）。 */
export function requiredCoverageComplete(record: ObligationRecord): boolean {
  const requiredItems = record.items.filter(item => item.required);
  if (requiredItems.length === 0) {
    return false;
  }
  return requiredItems.every(item => record.evidenceLinks.some(link => link.itemId === item.id));
}
