import type { MemoryIdentity } from "@loong/core";
import type {
  Obligation,
  ObligationBudget,
  ObligationEvidenceRef,
  ObligationEvidenceRefKind,
  ObligationItem,
  ObligationStatus,
  ObligationValidatorKind,
} from "./obligation-types.js";

/**
 * Phase 3.0 (docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md §5): backend-agnostic
 * obligation store contract.
 *
 * Same isolation posture as `OntologyStore`: every method takes a mandatory
 * `MemoryIdentity` first parameter and every query is forced through
 * `tenant_id + user_id`. Implementations must throw when the identity is
 * missing or invalid rather than touching another tenant's or user's data.
 *
 * Every mutating method accepts an optional `ObligationWriteMeta`; the store
 * appends an audit row (operator/source, pointer-only detail — never raw
 * evidence excerpts, §9) inside the same write transaction.
 *
 * Phase 3.0 is recording-only: `transitionStatus` rejects any target outside
 * OBLIGATION_PHASE30_ALLOWED_TRANSITIONS (no fulfilled / blocked_* / expired),
 * and `obligation_item.verdict*` columns exist but have no write path in 3.0.
 */

export interface ObligationWriteMeta {
  /** Who/what performed the write, e.g. "gateway-rpc" or "step-execution". */
  operator?: string;
  /** Origin of the write, e.g. "obligation.create" or "step.execute". */
  source?: string;
  /** Pointer/metadata-only audit detail. MUST NOT contain raw evidence excerpts. */
  detail?: Record<string, unknown>;
}

export interface ObligationItemWrite {
  id?: string;
  seq: number;
  acceptance: string;
  validator: ObligationValidatorKind;
  validatorConfig?: Record<string, unknown>;
  required?: boolean;
  deadlineAt?: string;
}

/** 执行载体（身份三）。创建时可空，派发时回填。 */
export interface ObligationCarrier {
  instanceId?: string;
  runId?: string;
  idempotencyKey?: string;
}

export type ObligationCarrierPatch = ObligationCarrier;

export interface ObligationWrite {
  id?: string;
  employeeId: string;
  requesterUserId?: string;
  source?: string;
  statement: string;
  items: ObligationItemWrite[];
  budget?: ObligationBudget;
  deadlineAt?: string;
  retryBudget?: number;
  carrier?: ObligationCarrier;
}

/** 证据链一行：契约/验收项 ↔ 跨 store 证据指针。 */
export interface ObligationEvidenceLink {
  identity: MemoryIdentity;
  obligationId: string;
  itemId?: string;                       // undefined = 契约级证据
  kind: ObligationEvidenceRefKind;
  refHash: string;                       // sha256(canonical ref)，归集去重
  ref: ObligationEvidenceRef;
  collectedAt: string;
}

export interface ObligationEvidenceLinkWrite {
  itemId?: string;
  ref: ObligationEvidenceRef;
  collectedAt?: string;
}

export interface ObligationEvidenceAttachResult {
  link: ObligationEvidenceLink;
  /** false when the same ref was already attached (idempotent re-attach). */
  inserted: boolean;
}

/** getObligation 的聚合返回：契约 + 验收项 + 证据链。 */
export interface ObligationRecord {
  obligation: Obligation;
  items: ObligationItem[];
  evidenceLinks: ObligationEvidenceLink[];
}

export interface ObligationFilter {
  status?: ObligationStatus;
  limit?: number;
}

/**
 * 三类断裂点（设计 §2 / 报告 PAGE 54）的悬挂检测查询。
 * - "untouched"   路由完成，但无人接手：dispatched 且零证据，且超 cutoff。
 * - "silent"      任务派发，但长期无响应：dispatched/evidence_collecting 且 deadline 已过。
 * - "unvalidated" 结果返回，但没有验收：evidence_collecting 且有证据，且超 cutoff。
 */
export type ObligationDanglingKind = "untouched" | "silent" | "unvalidated";

export interface ObligationDanglingQuery {
  kind: ObligationDanglingKind;
  /** Evaluation instant (ISO). Required; the service fills it from its clock. */
  now: string;
  /**
   * Optional updated_at cutoff (ISO) for "untouched" / "unvalidated": rows
   * qualify when deadline_at <= now OR (olderThan provided AND updated_at <=
   * olderThan). Without olderThan only deadline-based rows qualify.
   */
  olderThan?: string;
  limit?: number;
}

export interface ObligationDanglingRecord {
  obligation: Obligation;
  evidenceCount: number;
}

export type ObligationAuditAction =
  | "create"
  | "dispatch"
  | "update_carrier"
  | "attach_evidence"
  | "transition";

export type ObligationAuditRecordKind = "obligation" | "obligation_item";

export interface ObligationAuditRecord {
  seq: number;
  identity: MemoryIdentity;
  action: ObligationAuditAction;
  recordKind: ObligationAuditRecordKind;
  recordId: string;
  operator: string;
  source?: string;
  detail?: Record<string, unknown>;
  createdAt: string;
}

export interface ObligationAuditFilter {
  recordId?: string;
  limit?: number;
}

export interface ObligationStore {
  /**
   * Insert an obligation (status `pending`) with its items atomically, plus a
   * `create` audit row. Carrier fields (if any) are persisted as provided;
   * advancing to `dispatched` is a separate audited transition.
   */
  createObligation(identity: MemoryIdentity, write: ObligationWrite, meta?: ObligationWriteMeta): Promise<ObligationRecord>;

  /** Aggregate read: obligation + items (seq order) + evidence links (collect order). */
  getObligation(identity: MemoryIdentity, id: string): Promise<ObligationRecord | undefined>;

  listObligations(identity: MemoryIdentity, filter?: ObligationFilter): Promise<Obligation[]>;

  /** 幂等键归集：同 key 重放必须找到同一条契约（§10 幂等验收）。 */
  findObligationByIdempotencyKey(identity: MemoryIdentity, idempotencyKey: string): Promise<Obligation | undefined>;

  /**
   * Phase 3.0 guarded transition. Same-status is an idempotent no-op (no new
   * audit row); anything outside OBLIGATION_PHASE30_ALLOWED_TRANSITIONS throws
   * — fulfilled / blocked_recoverable / blocked_hard / expired cannot be
   * persisted in 3.0.
   */
  transitionStatus(identity: MemoryIdentity, id: string, to: ObligationStatus, meta?: ObligationWriteMeta): Promise<Obligation>;

  /** Patch execution-carrier fields (only provided fields change). */
  updateCarrier(identity: MemoryIdentity, id: string, patch: ObligationCarrierPatch, meta?: ObligationWriteMeta): Promise<Obligation>;

  /**
   * Idempotent attach keyed by (tenant_id, user_id, obligation_id, ref_hash):
   * re-attaching the same ref returns the existing row with `inserted: false`.
   * The obligation must exist under the caller's identity.
   */
  attachEvidence(
    identity: MemoryIdentity,
    obligationId: string,
    write: ObligationEvidenceLinkWrite,
    meta?: ObligationWriteMeta,
  ): Promise<ObligationEvidenceAttachResult>;

  listEvidenceLinks(identity: MemoryIdentity, obligationId: string): Promise<ObligationEvidenceLink[]>;

  /** 三类断裂点悬挂检测（§11 Phase 3.0：查询支持在 3.0，定时点火在 3.1）。 */
  listDangling(identity: MemoryIdentity, query: ObligationDanglingQuery): Promise<ObligationDanglingRecord[]>;

  listAudit(identity: MemoryIdentity, filter?: ObligationAuditFilter): Promise<ObligationAuditRecord[]>;
}
