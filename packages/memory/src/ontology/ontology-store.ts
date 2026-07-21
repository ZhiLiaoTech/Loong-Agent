import type { MemoryIdentity } from "@loong/core";
import type {
  AssertionSourceType,
  OntologyAssertion,
  OntologyAssertionStatus,
  OntologyEntity,
  OntologyEntityStatus,
  OntologyEpisode,
  OntologyEvidence,
  OntologySensitivity,
  OntologySupersession,
  UserProfileSnapshot,
} from "./ontology-types.js";

/**
 * Phase 2 FR-02/§8: backend-agnostic ontology store contract.
 *
 * Every method takes a mandatory `MemoryIdentity` first parameter and every
 * query is forced through `tenant_id + user_id` — the same isolation posture
 * as `MemoryStoreV2`. Implementations must throw when the identity is missing
 * or invalid rather than touching another tenant's or user's data.
 *
 * Every mutating method accepts an optional `OntologyWriteMeta`; the store
 * appends an audit row (operator/source, redacted detail — never raw
 * sensitive excerpts, §10) inside the same write transaction.
 */

export interface OntologyWriteMeta {
  /** Who/what performed the write, e.g. a hook name, tool name, or user id. */
  operator?: string;
  /** Origin of the write, e.g. "ontology_candidate_capture". */
  source?: string;
  /** Redacted metadata for the audit log. MUST NOT contain raw sensitive excerpts. */
  detail?: Record<string, unknown>;
}

export interface OntologyEntityWrite {
  id?: string;
  type: string;
  canonicalName: string;
  aliases?: string[];
  status?: OntologyEntityStatus;
  sensitivity?: OntologySensitivity;
}

export interface OntologyAssertionWrite {
  id?: string;
  subjectId: string;
  predicate: string;
  objectEntityId?: string;
  objectValue?: string | number | boolean;
  confidence: number;
  sourceType: AssertionSourceType;
  status: OntologyAssertionStatus;
  validFrom?: string;
  validTo?: string;
  evidenceIds: string[];
}

export interface OntologyAssertionPatch {
  status?: OntologyAssertionStatus;
  confidence?: number;
  addEvidenceIds?: string[];
  validFrom?: string;
  validTo?: string;
}

export interface OntologyEvidenceWrite {
  id?: string;
  sessionId?: string;
  runId?: string;
  messageId?: string;
  source: string;
  excerpt: string;
  capturedAt?: string;
}

export interface OntologyEpisodeWrite {
  id?: string;
  sessionId: string;
  runId: string;
  messageIds?: string[];
  summary?: string;
  excerpt?: string;
  capturedAt?: string;
}

export interface OntologyAssertionFilter {
  subjectId?: string;
  predicate?: string;
  status?: OntologyAssertionStatus | readonly OntologyAssertionStatus[];
  /**
   * Phase 3 temporal point-in-time query: only assertions valid at `asOf`
   * (validFrom unset or <= asOf, and validTo unset or > asOf). Use it to
   * answer "what was true at time T" (§4.4 保留历史).
   */
  asOf?: string;
  /**
   * Phase 3 "current facts" view: exclude assertions whose validTo is in the
   * past at evaluation time (validTo unset or >= now). Recall paths default to
   * currently-valid facts (§4.4 默认只召回当前有效事实).
   */
  excludeExpired?: boolean;
  limit?: number;
}

export interface OntologyEntityFilter {
  type?: string;
  status?: OntologyEntityStatus;
  limit?: number;
}

/**
 * Actions the store writes to `ontology_audit_log`. Review transitions
 * (promote/reject) are audited as `update_assertion` rows whose `detail`
 * records the status transition and the reviewing operator. Phase 5 (FR-13)
 * deletion actions record ids/counts/reasons only — never raw sensitive
 * excerpts (§10 日志不得记录完整敏感 Evidence).
 */
export type OntologyAuditAction =
  | "insert_entity"
  | "update_entity"
  | "insert_assertion"
  | "update_assertion"
  | "supersede_assertion"
  | "repoint_assertions"
  | "insert_evidence"
  | "insert_episode"
  | "put_snapshot"
  | "put_review"
  | "consolidate"
  | "delete_evidence"
  | "delete_assertions"
  | "delete_entity"
  | "delete_episodes"
  | "delete_snapshots"
  | "delete_candidate_reviews"
  | "unmerge_entity"
  | "import_ontology";

export type OntologyAuditRecordKind = "entity" | "assertion" | "evidence" | "episode" | "snapshot" | "review" | "consolidation" | "import";

/** Manual audit entry (used by the Phase 3 consolidator summary). */
export interface OntologyAuditEntryWrite {
  action: OntologyAuditAction;
  recordKind: OntologyAuditRecordKind;
  recordId: string;
  operator?: string;
  source?: string;
  detail?: Record<string, unknown>;
}

export interface OntologyAuditRecord {
  seq: number;
  identity: MemoryIdentity;
  action: OntologyAuditAction;
  recordKind: OntologyAuditRecordKind;
  recordId: string;
  operator: string;
  source?: string;
  detail?: Record<string, unknown>;
  createdAt: string;
}

export interface OntologyAuditFilter {
  recordKind?: OntologyAuditRecordKind;
  recordId?: string;
  limit?: number;
}

/** "Don't ask again" review marker stored per identity (FR-05). */
export interface OntologyCandidateReview {
  key: string;
  decision: "dont_ask";
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OntologyStore {
  // Entities
  insertEntity(identity: MemoryIdentity, write: OntologyEntityWrite, meta?: OntologyWriteMeta): Promise<OntologyEntity>;
  updateEntity(identity: MemoryIdentity, entity: OntologyEntity, meta?: OntologyWriteMeta): Promise<OntologyEntity>;
  getEntity(identity: MemoryIdentity, id: string): Promise<OntologyEntity | undefined>;
  /** Alias resolution: match by canonical name OR alias, identity-scoped. */
  findEntitiesByName(identity: MemoryIdentity, name: string): Promise<OntologyEntity[]>;
  listEntities(identity: MemoryIdentity, filter?: OntologyEntityFilter): Promise<OntologyEntity[]>;

  // Assertions
  insertAssertion(identity: MemoryIdentity, write: OntologyAssertionWrite, meta?: OntologyWriteMeta): Promise<OntologyAssertion>;
  getAssertion(identity: MemoryIdentity, id: string): Promise<OntologyAssertion | undefined>;
  findAssertions(identity: MemoryIdentity, filter?: OntologyAssertionFilter): Promise<OntologyAssertion[]>;
  updateAssertion(
    identity: MemoryIdentity,
    id: string,
    patch: OntologyAssertionPatch,
    meta?: OntologyWriteMeta,
  ): Promise<OntologyAssertion>;
  /**
   * FR-07: mark `supersededId` as superseded by `supersedingId`. The link is
   * persisted as assertion metadata and exposed via `listSupersessions`.
   */
  supersedeAssertion(
    identity: MemoryIdentity,
    supersededId: string,
    supersedingId: string,
    meta?: OntologyWriteMeta,
  ): Promise<void>;
  listSupersessions(identity: MemoryIdentity): Promise<OntologySupersession[]>;
  /**
   * Phase 3 consolidator support: re-point every assertion whose subject (or
   * object entity) is `fromEntityId` to `toEntityId`. Raw rows only — the
   * entities themselves are updated separately. Returns the number of
   * re-pointed assertion references.
   *
   * Phase 5: when `onlyAssertionIds` is given, only those assertions are
   * re-pointed (used by unmerge to restore exactly the recorded set). The
   * audit detail always records the affected assertion ids (capped) so a
   * later unmerge can prove provenance.
   */
  repointEntityAssertions(
    identity: MemoryIdentity,
    fromEntityId: string,
    toEntityId: string,
    meta?: OntologyWriteMeta,
    onlyAssertionIds?: readonly string[],
  ): Promise<number>;
  /** Assertion count with the same filter semantics as `findAssertions` (no limit). */
  countAssertions(identity: MemoryIdentity, filter?: OntologyAssertionFilter): Promise<number>;

  // Evidence
  insertEvidence(identity: MemoryIdentity, write: OntologyEvidenceWrite, meta?: OntologyWriteMeta): Promise<OntologyEvidence>;
  getEvidence(identity: MemoryIdentity, id: string): Promise<OntologyEvidence | undefined>;
  /** Evidence lookup for an assertion (provenance drill-down). */
  getAssertionEvidence(identity: MemoryIdentity, assertionId: string): Promise<OntologyEvidence[]>;
  /** Phase 5: every assertion referencing this evidence (cascade analysis before deletion). */
  findAssertionsByEvidence(identity: MemoryIdentity, evidenceId: string): Promise<OntologyAssertion[]>;
  /** Phase 5/FR-14: identity-scoped evidence listing (export and full deletion). */
  listEvidence(identity: MemoryIdentity, filter?: { limit?: number }): Promise<OntologyEvidence[]>;

  // Episodes
  insertEpisode(identity: MemoryIdentity, write: OntologyEpisodeWrite, meta?: OntologyWriteMeta): Promise<OntologyEpisode>;
  getEpisode(identity: MemoryIdentity, id: string): Promise<OntologyEpisode | undefined>;
  listEpisodes(identity: MemoryIdentity, filter?: { sessionId?: string; limit?: number }): Promise<OntologyEpisode[]>;
  countEpisodes(identity: MemoryIdentity): Promise<number>;

  // Profile snapshots (storage only in Phase 2; generation is Phase 3 FR-08).
  putSnapshot(identity: MemoryIdentity, snapshot: UserProfileSnapshot, meta?: OntologyWriteMeta): Promise<UserProfileSnapshot>;
  getLatestSnapshot(identity: MemoryIdentity): Promise<UserProfileSnapshot | undefined>;

  // Candidate reviews ("don't ask again")
  putCandidateReview(
    identity: MemoryIdentity,
    review: { key: string; decision: "dont_ask"; reason?: string },
    meta?: OntologyWriteMeta,
  ): Promise<OntologyCandidateReview>;
  getCandidateReview(identity: MemoryIdentity, key: string): Promise<OntologyCandidateReview | undefined>;

  // Audit (§10 所有写入必须记录来源和操作者)
  listAuditEntries(identity: MemoryIdentity, filter?: OntologyAuditFilter): Promise<OntologyAuditRecord[]>;
  /** Append a standalone audit entry (e.g. a consolidator run summary). */
  recordAuditEntry(identity: MemoryIdentity, entry: OntologyAuditEntryWrite): Promise<void>;

  // -------------------------------------------------------------------- //
  // Phase 5 (FR-13 纠正与遗忘): physical deletion support.               //
  //                                                                      //
  // These methods physically remove rows (true forgetting). Higher-level //
  // policy — which assertions to retract first, which evidence becomes   //
  // unreferenced — lives in the user-control service. Every deletion is  //
  // audited with operator + reason; audit detail MUST NOT contain raw    //
  // sensitive excerpts (§10).                                            //
  // -------------------------------------------------------------------- //

  /** Physically delete one evidence row and its assertion links. */
  deleteEvidence(identity: MemoryIdentity, evidenceId: string, meta?: OntologyWriteMeta): Promise<void>;
  /** Physically delete assertions (and their evidence links). Returns the deleted count. */
  deleteAssertions(identity: MemoryIdentity, assertionIds: readonly string[], meta?: OntologyWriteMeta): Promise<number>;
  /** Physically delete one entity and its aliases. Referencing assertions are NOT touched (the service retracts/deletes them first). */
  deleteEntity(identity: MemoryIdentity, entityId: string, meta?: OntologyWriteMeta): Promise<void>;
  /** Physically delete episodes (optionally scoped to one session). Returns the deleted count. */
  deleteEpisodes(identity: MemoryIdentity, filter?: { sessionId?: string }, meta?: OntologyWriteMeta): Promise<number>;
  /** Physically delete every stored snapshot version. Returns the deleted count. */
  deleteSnapshots(identity: MemoryIdentity, meta?: OntologyWriteMeta): Promise<number>;
  /** Physically delete every "don't ask again" review marker. Returns the deleted count. */
  deleteCandidateReviews(identity: MemoryIdentity, meta?: OntologyWriteMeta): Promise<number>;

  close?(): void;
}
