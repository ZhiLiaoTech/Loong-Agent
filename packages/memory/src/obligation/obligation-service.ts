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
  ObligationWriteMeta,
} from "./obligation-store.js";
import type {
  Obligation,
  ObligationBudget,
  ObligationEvidenceRef,
  ObligationStatus,
  ObligationValidatorKind,
} from "./obligation-types.js";

/**
 * Phase 3.0 契约记录服务（docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md §11
 * Phase 3.0：「先记录，不裁定」）。
 *
 * 职责：
 * - 显式登记契约（createObligation）：携带验收项；带执行载体创建时直接推进
 *   到 dispatched（含审计）。
 * - 执行过程中归集证据（attachEvidence / attachStepResult）：校验证据指针
 *   完整性后写入证据链，并按状态机推进 pending → dispatched →
 *   evidence_collecting → validating（3.0 终态；不裁定）。
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
    return { attached: true, obligationId: obligation.id, record: attach.record };
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

  async function requireRecord(identity: MemoryIdentity, id: string): Promise<ObligationRecord> {
    const record = await options.store.getObligation(identity, id);
    if (record === undefined) {
      throw new MemoryToolError("Obligation not found for the given identity.");
    }
    return record;
  }

  /** 3.0 只允许在执行进行中的状态上挂证据。 */
  function assertAttachAllowed(status: ObligationStatus): void {
    if (
      status !== "pending"
      && status !== "dispatched"
      && status !== "evidence_collecting"
      && status !== "validating"
    ) {
      throw new MemoryToolError(`Cannot attach evidence to an obligation in status ${status}.`);
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
  };
}

/** 全部 required 验收项均有 ≥1 条项级证据（契约级证据不计入项覆盖）。 */
export function requiredCoverageComplete(record: ObligationRecord): boolean {
  const requiredItems = record.items.filter(item => item.required);
  if (requiredItems.length === 0) {
    return false;
  }
  return requiredItems.every(item => record.evidenceLinks.some(link => link.itemId === item.id));
}
