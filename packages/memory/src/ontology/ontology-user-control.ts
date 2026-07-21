import type { MemoryIdentity } from "@loong/core";
import { assertMemoryIdentity } from "../memory-store-v2.js";
import { MemoryToolError } from "../memory-tool-error.js";
import {
  renderOntologyAssertionLine,
  createOntologyRetriever,
  type OntologyRetriever,
} from "./ontology-retriever.js";
import {
  createOntologyResolver,
  type OntologyResolver,
} from "./ontology-resolver.js";
import {
  createOntologySnapshotter,
  type OntologySnapshotter,
} from "./ontology-snapshot.js";
import type {
  OntologyAuditRecord,
  OntologyStore,
  OntologyWriteMeta,
} from "./ontology-store.js";
import type {
  AssertionSourceType,
  OntologyAssertion,
  OntologyAssertionStatus,
  OntologyEntity,
  OntologyEntityRef,
  OntologyEpisode,
  OntologyEvidence,
  OntologySupersession,
  UserProfileSnapshot,
} from "./ontology-types.js";
import { isAssertionSourceType } from "./ontology-types.js";
import { isOntologyEntityType, isOntologyPredicate, ONTOLOGY_PREDICATES } from "./ontology-vocabulary.js";

/**
 * Phase 5 (§7.4): the ontology user-control plane — FR-12 查看与解释,
 * FR-13 纠正与遗忘, FR-14 导入导出.
 *
 * Design notes:
 * - Every method is identity-first; the store enforces tenant/user isolation
 *   (§10 跨用户泄漏零容忍).
 * - User corrections are explicit facts and bypass candidate suppression
 *   (§10 用户纠正优先于模型推断): the service inserts the correction as a
 *   candidate directly and lets the resolver's promote path apply FR-06
 *   dedup and FR-07 supersession, then closes the old fact's validTo.
 * - Deletion is complete (§10 删除必须覆盖搜索索引、缓存、Snapshot 和上下文召回结果):
 *   physical row deletion + snapshot invalidation/regeneration. Deleting the
 *   last evidence of an assertion RETRACTS the assertion first, so the §11.2
 *   invariant "every active assertion has evidence" always holds.
 * - Audit details carry ids/counts/reasons only — never raw sensitive
 *   excerpts (§10 日志不得记录完整敏感 Evidence).
 */

export const ONTOLOGY_EXPORT_FORMAT_VERSION = "ontology-export/v1";
const DEFAULT_OPERATOR = "ontology_user_control";

export interface OntologyUserControlServiceOptions {
  store: OntologyStore;
  resolver?: OntologyResolver;
  retriever?: OntologyRetriever;
  snapshotter?: OntologySnapshotter;
  /** Clock injection for deterministic tests. */
  now?: () => string;
}

// ------------------------------------------------------------------ FR-12

export interface OntologyKnowledgeFact {
  assertionId: string;
  /** Natural-language rendering of the fact (same projection as recall). */
  line: string;
  predicate: string;
  confidence: number;
  sourceType: AssertionSourceType;
  status: OntologyAssertionStatus;
  evidenceCount: number;
  validFrom?: string;
  validTo?: string;
}

export interface OntologyKnowledgeGroup {
  predicate: string;
  facts: OntologyKnowledgeFact[];
}

export interface OntologyKnowledgeExplanation {
  identity: MemoryIdentity;
  /** Active, currently-valid facts grouped by predicate (vocabulary order). */
  groups: OntologyKnowledgeGroup[];
  activeCount: number;
  candidateCount: number;
  disputedCount: number;
  inferredActiveCount: number;
}

export interface OntologyAssertionExplanation {
  assertion: OntologyAssertion;
  line: string;
  subject?: OntologyEntity;
  objectEntity?: OntologyEntity;
  /** Full evidence excerpts with session/run references (溯源). */
  evidence: OntologyEvidence[];
  episodes: OntologyEpisode[];
  /** The assertion this one supersedes, when any (FR-07 chain). */
  supersedes?: OntologyAssertion;
  /** The assertion that superseded this one, when any. */
  supersededBy?: OntologyAssertion;
  /** Audit history recorded for this assertion. */
  audit: OntologyAuditRecord[];
}

export interface OntologyConflictItem {
  assertionId: string;
  line: string;
  predicate: string;
  confidence: number;
  sourceType: AssertionSourceType;
  evidenceCount: number;
  updatedAt: string;
}

// ------------------------------------------------------------------ FR-13

export interface OntologyCorrectionInput {
  /** Exactly one object form, mirroring the candidate draft contract. */
  objectEntity?: OntologyEntityRef;
  objectValue?: string | number | boolean;
  /** Required: the user's own words backing the correction (traceable evidence). */
  excerpt: string;
  confidence?: number;
}

export interface OntologyCorrectionResult {
  previous: OntologyAssertion;
  corrected: OntologyAssertion;
  superseded: OntologyAssertion[];
  /** True when an identical active fact already existed and absorbed the correction. */
  mergedIntoExisting: boolean;
}

export interface OntologyDeleteEvidenceResult {
  deletedEvidenceId: string;
  /** Assertions that referenced the evidence (before deletion). */
  affectedAssertionIds: string[];
  /** Assertions retracted because the deleted evidence was their last one. */
  retractedAssertionIds: string[];
}

export interface OntologyDeleteEntityResult {
  deletedEntityId: string;
  retractedAssertionIds: string[];
}

export interface OntologyDeleteCategoryFilter {
  predicate?: string;
  sourceType?: AssertionSourceType;
  entityType?: string;
}

export interface OntologyDeleteCategoryResult {
  deletedAssertions: number;
  deletedEntities: number;
  /** Unreferenced evidence rows cleaned up as part of the deletion. */
  deletedEvidence: number;
  snapshotRegenerated: boolean;
}

export interface OntologyDeleteAllResult {
  deletedAssertions: number;
  deletedEntities: number;
  deletedEvidence: number;
  deletedEpisodes: number;
  deletedSnapshots: number;
  deletedCandidateReviews: number;
}

export interface OntologyUnmergeResult {
  restoredEntity: OntologyEntity;
  survivingEntityId: string;
  repointedReferences: number;
  assertionIds: string[];
}

export interface OntologySnapshotRegenerationResult {
  snapshot?: UserProfileSnapshot;
  /** True when the ontology is empty; stored snapshots were removed instead. */
  empty: boolean;
  deletedSnapshots: number;
}

// ------------------------------------------------------------------ FR-14

export interface OntologyExportOptions {
  /** 敏感 Evidence 原文导出需用户单独确认 (FR-14). Default false → redacted. */
  includeSensitiveEvidence?: boolean;
}

export interface OntologyExportEvidence {
  id: string;
  sessionId?: string;
  runId?: string;
  messageId?: string;
  source: string;
  capturedAt: string;
  /** Present unless redacted by the sensitive-evidence policy. */
  excerpt?: string;
  excerptRedacted?: true;
}

export interface OntologyExportEpisode {
  id: string;
  sessionId: string;
  runId: string;
  messageIds: string[];
  capturedAt: string;
}

export interface OntologyExportPayload {
  formatVersion: typeof ONTOLOGY_EXPORT_FORMAT_VERSION;
  exportedAt: string;
  identity: { tenantId: string; userId: string };
  entities: OntologyEntity[];
  assertions: OntologyAssertion[];
  evidence: OntologyExportEvidence[];
  episodes: OntologyExportEpisode[];
  supersessions: OntologySupersession[];
}

export interface OntologyImportReport {
  entitiesCreated: number;
  entitiesReused: number;
  assertionsImported: number;
  promoted: number;
  /** Re-imported facts absorbed by an identical existing assertion (dedup). */
  merged: number;
  disputed: number;
  /** Superseded/retracted history is deliberately not resurrected. */
  skippedHistorical: number;
  skippedInvalid: number;
  errors: string[];
  snapshotRegenerated: boolean;
}

export interface OntologyUserControlService {
  // FR-12 查看与解释
  explainUserKnowledge(identity: MemoryIdentity): Promise<OntologyKnowledgeExplanation>;
  explainAssertion(identity: MemoryIdentity, assertionId: string): Promise<OntologyAssertionExplanation>;
  listConflicts(identity: MemoryIdentity): Promise<OntologyConflictItem[]>;
  listInferred(identity: MemoryIdentity): Promise<OntologyConflictItem[]>;
  // FR-13 纠正与遗忘
  correctAssertion(
    identity: MemoryIdentity,
    assertionId: string,
    correction: OntologyCorrectionInput,
    meta?: OntologyWriteMeta,
  ): Promise<OntologyCorrectionResult>;
  retractAssertion(
    identity: MemoryIdentity,
    assertionId: string,
    reason?: string,
    meta?: OntologyWriteMeta,
  ): Promise<OntologyAssertion>;
  deleteEvidence(identity: MemoryIdentity, evidenceId: string, reason?: string, meta?: OntologyWriteMeta): Promise<OntologyDeleteEvidenceResult>;
  deleteEntity(identity: MemoryIdentity, entityId: string, reason?: string, meta?: OntologyWriteMeta): Promise<OntologyDeleteEntityResult>;
  deleteCategory(
    identity: MemoryIdentity,
    filter: OntologyDeleteCategoryFilter,
    reason?: string,
    meta?: OntologyWriteMeta,
  ): Promise<OntologyDeleteCategoryResult>;
  deleteAllUserOntology(identity: MemoryIdentity, reason?: string, meta?: OntologyWriteMeta): Promise<OntologyDeleteAllResult>;
  unmergeEntity(identity: MemoryIdentity, mergedEntityId: string, meta?: OntologyWriteMeta): Promise<OntologyUnmergeResult>;
  regenerateSnapshot(identity: MemoryIdentity, meta?: OntologyWriteMeta): Promise<OntologySnapshotRegenerationResult>;
  // FR-14 导入导出
  exportUserOntology(identity: MemoryIdentity, options?: OntologyExportOptions): Promise<OntologyExportPayload>;
  importUserOntology(identity: MemoryIdentity, payload: unknown, meta?: OntologyWriteMeta): Promise<OntologyImportReport>;
}

export function createOntologyUserControlService(options: OntologyUserControlServiceOptions): OntologyUserControlService {
  const store = options.store;
  const resolver = options.resolver ?? createOntologyResolver({ store });
  const retriever = options.retriever ?? createOntologyRetriever({ store });
  const snapshotter = options.snapshotter ?? createOntologySnapshotter({ store });
  const now = options.now ?? (() => new Date().toISOString());

  function writeMeta(meta: OntologyWriteMeta | undefined, reason?: string): OntologyWriteMeta & { operator: string; source: string } {
    return {
      operator: meta?.operator?.trim() ? meta.operator.trim() : DEFAULT_OPERATOR,
      source: meta?.source?.trim() ? meta.source.trim() : DEFAULT_OPERATOR,
      detail: {
        ...(meta?.detail ?? {}),
        ...(reason?.trim() ? { reason: reason.trim().slice(0, 500) } : {}),
      },
    };
  }

  async function entityMap(identity: MemoryIdentity): Promise<Map<string, OntologyEntity>> {
    const entities = await store.listEntities(identity, { limit: 1000 });
    return new Map(entities.map(entity => [entity.id, entity]));
  }

  function toFact(
    assertion: OntologyAssertion,
    entitiesById: Map<string, OntologyEntity>,
  ): OntologyKnowledgeFact | undefined {
    const subject = entitiesById.get(assertion.subjectId);
    if (subject === undefined) {
      return undefined;
    }
    const objectEntity = assertion.objectEntityId !== undefined
      ? entitiesById.get(assertion.objectEntityId)
      : undefined;
    const fact: OntologyKnowledgeFact = {
      assertionId: assertion.id,
      line: renderOntologyAssertionLine(assertion, subject, objectEntity),
      predicate: assertion.predicate,
      confidence: assertion.confidence,
      sourceType: assertion.sourceType,
      status: assertion.status,
      evidenceCount: assertion.evidenceIds.length,
    };
    if (assertion.validFrom !== undefined) {
      fact.validFrom = assertion.validFrom;
    }
    if (assertion.validTo !== undefined) {
      fact.validTo = assertion.validTo;
    }
    return fact;
  }

  // ------------------------------------------------------------------ FR-12

  async function explainUserKnowledge(identityValue: MemoryIdentity): Promise<OntologyKnowledgeExplanation> {
    const identity = assertMemoryIdentity(identityValue);
    const asOf = now();
    const [entitiesById, active, candidates, disputed] = await Promise.all([
      entityMap(identity),
      store.findAssertions(identity, { status: "active", asOf, limit: 1000 }),
      store.countAssertions(identity, { status: "candidate" }),
      store.countAssertions(identity, { status: "disputed" }),
    ]);
    const facts = active
      .map(assertion => toFact(assertion, entitiesById))
      .filter((fact): fact is OntologyKnowledgeFact => fact !== undefined);
    facts.sort((left, right) => {
      if (left.confidence !== right.confidence) {
        return right.confidence - left.confidence;
      }
      return left.assertionId.localeCompare(right.assertionId);
    });
    const groups: OntologyKnowledgeGroup[] = [];
    for (const predicate of ONTOLOGY_PREDICATES) {
      const groupFacts = facts.filter(fact => fact.predicate === predicate);
      if (groupFacts.length > 0) {
        groups.push({ predicate, facts: groupFacts });
      }
    }
    return {
      identity: { ...identity },
      groups,
      activeCount: facts.length,
      candidateCount: candidates,
      disputedCount: disputed,
      inferredActiveCount: facts.filter(fact => fact.sourceType === "inferred").length,
    };
  }

  async function explainAssertion(identityValue: MemoryIdentity, assertionId: string): Promise<OntologyAssertionExplanation> {
    const identity = assertMemoryIdentity(identityValue);
    const assertion = await requireAssertion(identity, assertionId);
    const subject = await store.getEntity(identity, assertion.subjectId);
    const objectEntity = assertion.objectEntityId !== undefined
      ? await store.getEntity(identity, assertion.objectEntityId)
      : undefined;
    const drilled = await retriever.drillDown(identity, { assertionIds: [assertion.id], limit: 1 });
    const drilledAssertion = drilled.assertions[0];
    const supersessions = await store.listSupersessions(identity);
    const supersedesId = supersessions.find(link => link.supersedingAssertionId === assertion.id)?.supersededAssertionId;
    const supersededById = supersessions.find(link => link.supersededAssertionId === assertion.id)?.supersedingAssertionId;
    const supersedes = supersedesId !== undefined ? await store.getAssertion(identity, supersedesId) : undefined;
    const supersededBy = supersededById !== undefined ? await store.getAssertion(identity, supersededById) : undefined;
    const audit = await store.listAuditEntries(identity, {
      recordKind: "assertion",
      recordId: assertion.id,
      limit: 200,
    });
    // Supersession transitions are audited against the OTHER side's record id;
    // fold those entries in so the provenance chain is complete from either end.
    for (const linkedId of [supersedesId, supersededById]) {
      if (linkedId === undefined) {
        continue;
      }
      const linkedAudit = await store.listAuditEntries(identity, {
        recordKind: "assertion",
        recordId: linkedId,
        limit: 200,
      });
      for (const entry of linkedAudit) {
        if (entry.action === "supersede_assertion" && !audit.some(existing => existing.seq === entry.seq)) {
          audit.push(entry);
        }
      }
    }
    audit.sort((left, right) => left.seq - right.seq);
    const explanation: OntologyAssertionExplanation = {
      assertion,
      line: subject !== undefined ? renderOntologyAssertionLine(assertion, subject, objectEntity) : assertion.id,
      ...(subject !== undefined ? { subject } : {}),
      ...(objectEntity !== undefined ? { objectEntity } : {}),
      evidence: drilledAssertion?.evidence ?? [],
      episodes: drilledAssertion?.episodes ?? [],
      ...(supersedes !== undefined ? { supersedes } : {}),
      ...(supersededBy !== undefined ? { supersededBy } : {}),
      audit,
    };
    return explanation;
  }

  async function listConflicts(identityValue: MemoryIdentity): Promise<OntologyConflictItem[]> {
    const identity = assertMemoryIdentity(identityValue);
    return await listRendered(identity, { status: "disputed" });
  }

  async function listInferred(identityValue: MemoryIdentity): Promise<OntologyConflictItem[]> {
    const identity = assertMemoryIdentity(identityValue);
    return await listRendered(identity, {
      status: ["active", "candidate", "disputed"],
      sourceType: "inferred",
    });
  }

  async function listRendered(
    identity: MemoryIdentity,
    filter: { status: OntologyAssertionStatus | readonly OntologyAssertionStatus[]; sourceType?: AssertionSourceType },
  ): Promise<OntologyConflictItem[]> {
    const entitiesById = await entityMap(identity);
    const assertions = (await store.findAssertions(identity, { status: filter.status, limit: 1000 }))
      .filter(assertion => filter.sourceType === undefined || assertion.sourceType === filter.sourceType);
    const items: OntologyConflictItem[] = [];
    for (const assertion of assertions) {
      const fact = toFact(assertion, entitiesById);
      if (fact === undefined) {
        continue;
      }
      items.push({
        assertionId: fact.assertionId,
        line: fact.line,
        predicate: fact.predicate,
        confidence: fact.confidence,
        sourceType: fact.sourceType,
        evidenceCount: fact.evidenceCount,
        updatedAt: assertion.updatedAt,
      });
    }
    items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.assertionId.localeCompare(right.assertionId));
    return items;
  }

  // ------------------------------------------------------------------ FR-13

  async function correctAssertion(
    identityValue: MemoryIdentity,
    assertionId: string,
    correction: OntologyCorrectionInput,
    meta?: OntologyWriteMeta,
  ): Promise<OntologyCorrectionResult> {
    const identity = assertMemoryIdentity(identityValue);
    const operator = writeMeta(meta);
    const previous = await requireAssertion(identity, assertionId);
    if (previous.status !== "active" && previous.status !== "disputed") {
      throw new MemoryToolError(`Only active or disputed assertions can be corrected; this one is ${previous.status}.`);
    }
    const hasObjectEntity = correction.objectEntity !== undefined;
    const hasObjectValue = correction.objectValue !== undefined;
    if (hasObjectEntity === hasObjectValue) {
      throw new MemoryToolError("Correction requires exactly one object form: objectEntity or objectValue.");
    }
    if (typeof correction.excerpt !== "string" || !correction.excerpt.trim()) {
      throw new MemoryToolError("Correction requires an excerpt (the user's own words as traceable evidence).");
    }
    if (correction.confidence !== undefined
      && (!Number.isFinite(correction.confidence) || correction.confidence < 0 || correction.confidence > 1)) {
      throw new MemoryToolError("Correction confidence must be a finite number between 0 and 1.");
    }
    const subject = await store.getEntity(identity, previous.subjectId);
    if (subject === undefined) {
      throw new MemoryToolError(`Ontology entity not found: ${previous.subjectId}`);
    }

    // 用户纠正优先 (§10): insert the correction directly as an explicit
    // candidate (bypassing candidate suppression / "don't ask again" markers)
    // and let the resolver's promote path apply FR-06 dedup + FR-07 conflict
    // handling. The user's explicit statement always supersedes conflicts.
    const objectEntity = correction.objectEntity !== undefined
      ? await resolveEntityRef(identity, correction.objectEntity, operator)
      : undefined;
    const evidence = await store.insertEvidence(identity, {
      source: "ontology_user_correction",
      excerpt: correction.excerpt.trim(),
    }, operator);
    const candidate = await store.insertAssertion(identity, {
      subjectId: subject.id,
      predicate: previous.predicate,
      ...(objectEntity !== undefined ? { objectEntityId: objectEntity.id } : {}),
      ...(correction.objectValue !== undefined ? { objectValue: correction.objectValue } : {}),
      confidence: correction.confidence ?? 0.95,
      sourceType: "explicit",
      status: "candidate",
      evidenceIds: [evidence.id],
    }, operator);
    const promoted = await resolver.promoteAssertion(identity, candidate.id, operator);
    const corrected = promoted.mergedInto ?? promoted.assertion;
    const superseded = [...promoted.superseded];
    if (!superseded.some(assertion => assertion.id === previous.id)) {
      // The old fact was disputed (or otherwise outside the resolver's active
      // conflict set): supersede it explicitly so it stops being current.
      await store.supersedeAssertion(identity, previous.id, corrected.id, operator);
      superseded.push(await requireAssertion(identity, previous.id));
    }
    // Close the old fact's valid time (FR-13: 纠正 closes the previous validity window).
    await store.updateAssertion(identity, previous.id, { validTo: now() }, operator);
    superseded[superseded.findIndex(assertion => assertion.id === previous.id)] = await requireAssertion(identity, previous.id);
    return {
      previous,
      corrected,
      superseded,
      mergedIntoExisting: promoted.mergedInto !== undefined,
    };
  }

  async function retractAssertion(
    identityValue: MemoryIdentity,
    assertionId: string,
    reason?: string,
    meta?: OntologyWriteMeta,
  ): Promise<OntologyAssertion> {
    const identity = assertMemoryIdentity(identityValue);
    const assertion = await requireAssertion(identity, assertionId);
    if (assertion.status === "retracted" || assertion.status === "superseded") {
      throw new MemoryToolError(`Ontology assertion is already ${assertion.status}.`);
    }
    return await store.updateAssertion(identity, assertion.id, { status: "retracted" }, writeMeta(meta, reason));
  }

  async function deleteEvidence(
    identityValue: MemoryIdentity,
    evidenceId: string,
    reason?: string,
    meta?: OntologyWriteMeta,
  ): Promise<OntologyDeleteEvidenceResult> {
    const identity = assertMemoryIdentity(identityValue);
    const operator = writeMeta(meta, reason);
    const affected = await store.findAssertionsByEvidence(identity, evidenceId);
    if (affected.length === 0) {
      const existing = await store.getEvidence(identity, evidenceId);
      if (existing === undefined) {
        throw new MemoryToolError(`Ontology evidence not found: ${evidenceId.trim()}`);
      }
    }
    // §11.2 invariant: an assertion may never end up evidence-less while
    // active/candidate/disputed — retract such assertions BEFORE deleting
    // their last evidence (the fact becomes unverifiable).
    const retracted: string[] = [];
    for (const assertion of affected) {
      const isLive = assertion.status === "active" || assertion.status === "candidate" || assertion.status === "disputed";
      if (isLive && assertion.evidenceIds.length <= 1) {
        await store.updateAssertion(identity, assertion.id, { status: "retracted" }, {
          ...operator,
          detail: { ...(operator.detail ?? {}), transition: `${assertion.status}->retracted`, cause: "last_evidence_deleted" },
        });
        retracted.push(assertion.id);
      }
    }
    await store.deleteEvidence(identity, evidenceId, operator);
    return {
      deletedEvidenceId: evidenceId.trim(),
      affectedAssertionIds: affected.map(assertion => assertion.id),
      retractedAssertionIds: retracted,
    };
  }

  async function deleteEntity(
    identityValue: MemoryIdentity,
    entityId: string,
    reason?: string,
    meta?: OntologyWriteMeta,
  ): Promise<OntologyDeleteEntityResult> {
    const identity = assertMemoryIdentity(identityValue);
    const operator = writeMeta(meta, reason);
    const entity = await store.getEntity(identity, entityId);
    if (entity === undefined) {
      throw new MemoryToolError(`Ontology entity not found: ${entityId.trim()}`);
    }
    const live = await store.findAssertions(identity, {
      status: ["candidate", "active", "disputed"],
      limit: 1000,
    });
    const retracted: string[] = [];
    for (const assertion of live) {
      if (assertion.subjectId === entity.id || assertion.objectEntityId === entity.id) {
        await store.updateAssertion(identity, assertion.id, { status: "retracted" }, {
          ...operator,
          detail: { ...(operator.detail ?? {}), transition: `${assertion.status}->retracted`, cause: "entity_deleted" },
        });
        retracted.push(assertion.id);
      }
    }
    await store.deleteEntity(identity, entity.id, operator);
    return { deletedEntityId: entity.id, retractedAssertionIds: retracted };
  }

  async function deleteCategory(
    identityValue: MemoryIdentity,
    filter: OntologyDeleteCategoryFilter,
    reason?: string,
    meta?: OntologyWriteMeta,
  ): Promise<OntologyDeleteCategoryResult> {
    const identity = assertMemoryIdentity(identityValue);
    const operator = writeMeta(meta, reason);
    const selected = [filter.predicate !== undefined, filter.sourceType !== undefined, filter.entityType !== undefined]
      .filter(Boolean).length;
    if (selected !== 1) {
      throw new MemoryToolError("deleteCategory requires exactly one of: predicate, sourceType, entityType.");
    }
    if (filter.predicate !== undefined && !isOntologyPredicate(filter.predicate)) {
      throw new MemoryToolError(`Unknown ontology predicate: ${String(filter.predicate)}.`);
    }
    if (filter.sourceType !== undefined && !isAssertionSourceType(filter.sourceType)) {
      throw new MemoryToolError(`Unknown assertion sourceType: ${String(filter.sourceType)}.`);
    }
    if (filter.entityType !== undefined && !isOntologyEntityType(filter.entityType)) {
      throw new MemoryToolError(`Unknown ontology entity type: ${String(filter.entityType)}.`);
    }

    let targetAssertions: OntologyAssertion[] = [];
    let targetEntities: OntologyEntity[] = [];
    if (filter.entityType !== undefined) {
      targetEntities = await store.listEntities(identity, { type: filter.entityType, limit: 1000 });
      const entityIds = new Set(targetEntities.map(entity => entity.id));
      targetAssertions = (await store.findAssertions(identity, { limit: 1000 }))
        .filter(assertion => entityIds.has(assertion.subjectId)
          || (assertion.objectEntityId !== undefined && entityIds.has(assertion.objectEntityId)));
    } else if (filter.predicate !== undefined) {
      targetAssertions = await store.findAssertions(identity, { predicate: filter.predicate, limit: 1000 });
    } else {
      targetAssertions = (await store.findAssertions(identity, { limit: 1000 }))
        .filter(assertion => assertion.sourceType === filter.sourceType);
    }

    const evidenceIds = [...new Set(targetAssertions.flatMap(assertion => assertion.evidenceIds))];
    const deletedAssertions = await store.deleteAssertions(identity, targetAssertions.map(assertion => assertion.id), {
      ...operator,
      detail: { ...(operator.detail ?? {}), category: categoryLabel(filter), count: targetAssertions.length },
    });
    let deletedEntities = 0;
    for (const entity of targetEntities) {
      await store.deleteEntity(identity, entity.id, operator);
      deletedEntities += 1;
    }
    // Clean up evidence left unreferenced by the deletion (forgetting must be complete, §10).
    let deletedEvidence = 0;
    for (const evidenceId of evidenceIds) {
      const referencing = await store.findAssertionsByEvidence(identity, evidenceId);
      if (referencing.length === 0) {
        await store.deleteEvidence(identity, evidenceId, {
          ...operator,
          detail: { ...(operator.detail ?? {}), cause: "unreferenced_after_category_delete" },
        });
        deletedEvidence += 1;
      }
    }
    const regeneration = await regenerateSnapshot(identity, operator);
    return {
      deletedAssertions,
      deletedEntities,
      deletedEvidence,
      snapshotRegenerated: regeneration.snapshot !== undefined || regeneration.empty,
    };
  }

  async function deleteAllUserOntology(
    identityValue: MemoryIdentity,
    reason?: string,
    meta?: OntologyWriteMeta,
  ): Promise<OntologyDeleteAllResult> {
    const identity = assertMemoryIdentity(identityValue);
    const operator = writeMeta(meta, reason);
    const assertions = await store.findAssertions(identity, { limit: 1000 });
    const entities = await store.listEntities(identity, { limit: 1000 });
    const evidence = await store.listEvidence(identity, { limit: 1000 });
    const deletedAssertions = await store.deleteAssertions(identity, assertions.map(assertion => assertion.id), {
      ...operator,
      detail: { ...(operator.detail ?? {}), scope: "deleteAllUserOntology" },
    });
    let deletedEntities = 0;
    for (const entity of entities) {
      await store.deleteEntity(identity, entity.id, operator);
      deletedEntities += 1;
    }
    let deletedEvidence = 0;
    for (const item of evidence) {
      await store.deleteEvidence(identity, item.id, operator);
      deletedEvidence += 1;
    }
    const deletedEpisodes = await store.deleteEpisodes(identity, {}, operator);
    const deletedSnapshots = await store.deleteSnapshots(identity, operator);
    const deletedCandidateReviews = await store.deleteCandidateReviews(identity, operator);
    await store.recordAuditEntry(identity, {
      action: "delete_assertions",
      recordKind: "assertion",
      recordId: "*",
      operator: operator.operator ?? DEFAULT_OPERATOR,
      source: operator.source,
      detail: {
        scope: "deleteAllUserOntology",
        ...(reason?.trim() ? { reason: reason.trim().slice(0, 500) } : {}),
        deletedAssertions,
        deletedEntities,
        deletedEvidence,
        deletedEpisodes,
        deletedSnapshots,
        deletedCandidateReviews,
      },
    });
    return {
      deletedAssertions,
      deletedEntities,
      deletedEvidence,
      deletedEpisodes,
      deletedSnapshots,
      deletedCandidateReviews,
    };
  }

  async function unmergeEntity(
    identityValue: MemoryIdentity,
    mergedEntityId: string,
    meta?: OntologyWriteMeta,
  ): Promise<OntologyUnmergeResult> {
    const identity = assertMemoryIdentity(identityValue);
    const operator = writeMeta(meta);
    const merged = await store.getEntity(identity, mergedEntityId);
    if (merged === undefined) {
      throw new MemoryToolError(`Ontology entity not found: ${mergedEntityId.trim()}`);
    }
    if (merged.status !== "merged") {
      throw new MemoryToolError(`Ontology entity is not merged (status: ${merged.status}); nothing to undo.`);
    }
    // Prove provenance from the repoint audit entry recorded at merge time.
    const auditEntries = await store.listAuditEntries(identity, {
      recordKind: "entity",
      recordId: merged.id,
      limit: 1000,
    });
    const repointEntry = auditEntries
      .filter(entry => entry.action === "repoint_assertions" && typeof entry.detail?.toEntityId === "string")
      .sort((left, right) => right.seq - left.seq)[0];
    if (repointEntry === undefined) {
      throw new MemoryToolError(`No merge provenance found for entity ${merged.id}; cannot unmerge safely.`);
    }
    if (repointEntry.detail?.assertionIdsTruncated === true) {
      throw new MemoryToolError("The merge re-pointed more assertions than the audit detail records; cannot unmerge safely.");
    }
    const survivingEntityId = String(repointEntry.detail?.toEntityId);
    const assertionIds = Array.isArray(repointEntry.detail?.assertionIds)
      ? (repointEntry.detail.assertionIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [];
    const survivor = await store.getEntity(identity, survivingEntityId);
    if (survivor === undefined) {
      throw new MemoryToolError(`Surviving entity not found: ${survivingEntityId}`);
    }
    const repointedReferences = await store.repointEntityAssertions(identity, survivor.id, merged.id, {
      ...operator,
      detail: { ...(operator.detail ?? {}), unmerge: true, mergedEntityId: merged.id },
    }, assertionIds);
    const restored = await store.updateEntity(identity, { ...merged, status: "active" }, {
      ...operator,
      detail: { ...(operator.detail ?? {}), transition: "merged->active", unmerge: true },
    });
    // Best-effort alias cleanup: the survivor absorbed the merged entity's
    // names at merge time; give them back.
    const mergedNames = new Set([merged.canonicalName, ...merged.aliases].map(name => name.trim().toLowerCase()));
    const survivorAliases = survivor.aliases.filter(alias => !mergedNames.has(alias.trim().toLowerCase()));
    if (survivorAliases.length !== survivor.aliases.length) {
      const current = await store.getEntity(identity, survivor.id);
      if (current !== undefined) {
        await store.updateEntity(identity, { ...current, aliases: survivorAliases }, operator);
      }
    }
    await store.recordAuditEntry(identity, {
      action: "unmerge_entity",
      recordKind: "entity",
      recordId: merged.id,
      operator: operator.operator ?? DEFAULT_OPERATOR,
      source: operator.source,
      detail: { survivingEntityId: survivor.id, repointedReferences, assertionIds },
    });
    return {
      restoredEntity: restored,
      survivingEntityId: survivor.id,
      repointedReferences,
      assertionIds,
    };
  }

  async function regenerateSnapshot(
    identityValue: MemoryIdentity,
    meta?: OntologyWriteMeta,
  ): Promise<OntologySnapshotRegenerationResult> {
    const identity = assertMemoryIdentity(identityValue);
    const operator = writeMeta(meta);
    // putSnapshot rejects empty content; an empty ontology means "no stored
    // snapshot" (the retriever then projects the empty set on the fly).
    const projection = await snapshotter.project(identity);
    if (projection.content.trim().length === 0) {
      const deletedSnapshots = await store.deleteSnapshots(identity, operator);
      return { empty: true, deletedSnapshots };
    }
    const snapshot = await snapshotter.generate(identity, operator);
    return { snapshot, empty: false, deletedSnapshots: 0 };
  }

  // ------------------------------------------------------------------ FR-14

  async function exportUserOntology(
    identityValue: MemoryIdentity,
    exportOptions: OntologyExportOptions = {},
  ): Promise<OntologyExportPayload> {
    const identity = assertMemoryIdentity(identityValue);
    const includeSensitive = exportOptions.includeSensitiveEvidence === true;
    const [entities, assertions, evidence, episodes, supersessions] = await Promise.all([
      store.listEntities(identity, { limit: 1000 }),
      store.findAssertions(identity, { limit: 1000 }),
      store.listEvidence(identity, { limit: 1000 }),
      store.listEpisodes(identity, { limit: 1000 }),
      store.listSupersessions(identity),
    ]);
    const entitiesById = new Map(entities.map(entity => [entity.id, entity]));
    // Evidence linked to a non-"normal" entity is treated as sensitive and
    // redacted unless the user explicitly confirmed export (FR-14).
    const sensitiveEvidenceIds = new Set<string>();
    for (const assertion of assertions) {
      const subject = entitiesById.get(assertion.subjectId);
      const objectEntity = assertion.objectEntityId !== undefined
        ? entitiesById.get(assertion.objectEntityId)
        : undefined;
      const sensitive = (entity: OntologyEntity | undefined): boolean =>
        entity !== undefined && entity.sensitivity !== "normal";
      if (sensitive(subject) || sensitive(objectEntity)) {
        for (const evidenceId of assertion.evidenceIds) {
          sensitiveEvidenceIds.add(evidenceId);
        }
      }
    }
    return {
      formatVersion: ONTOLOGY_EXPORT_FORMAT_VERSION,
      exportedAt: now(),
      identity: { tenantId: identity.tenantId, userId: identity.userId },
      entities,
      assertions,
      evidence: evidence.map(item => toExportEvidence(item, sensitiveEvidenceIds.has(item.id) && !includeSensitive)),
      episodes: episodes.map(episode => ({
        id: episode.id,
        sessionId: episode.sessionId,
        runId: episode.runId,
        messageIds: episode.messageIds,
        capturedAt: episode.capturedAt,
      })),
      supersessions,
    };
  }

  async function importUserOntology(
    identityValue: MemoryIdentity,
    payload: unknown,
    meta?: OntologyWriteMeta,
  ): Promise<OntologyImportReport> {
    const identity = assertMemoryIdentity(identityValue);
    const operator = writeMeta(meta);
    const parsed = parseExportPayload(payload);
    const report: OntologyImportReport = {
      entitiesCreated: 0,
      entitiesReused: 0,
      assertionsImported: 0,
      promoted: 0,
      merged: 0,
      disputed: 0,
      skippedHistorical: 0,
      skippedInvalid: 0,
      errors: [],
      snapshotRegenerated: false,
    };

    // 1. Entities: reuse by type + canonical name, create the rest.
    const entityIdMap = new Map<string, string>();
    for (const entity of parsed.entities) {
      try {
        const matches = await store.findEntitiesByName(identity, entity.canonicalName);
        const existing = matches.find(candidate => candidate.status === "active" && candidate.type === entity.type)
          ?? matches.find(candidate => candidate.status === "active");
        if (existing !== undefined) {
          entityIdMap.set(entity.id, existing.id);
          report.entitiesReused += 1;
        } else {
          const created = await store.insertEntity(identity, {
            type: entity.type,
            canonicalName: entity.canonicalName,
            aliases: entity.aliases,
            sensitivity: entity.sensitivity,
          }, { ...operator, detail: { imported: true } });
          entityIdMap.set(entity.id, created.id);
          report.entitiesCreated += 1;
        }
      } catch (error) {
        pushError(report, `entity ${entity.canonicalName}: ${errorMessage(error)}`);
      }
    }

    // 2. Assertions: current facts go through the resolver (dedup applies);
    //    historical (superseded/retracted) rows are deliberately not resurrected.
    const evidenceById = new Map(parsed.evidence.map(item => [item.id, item]));
    const entityNameByOldId = new Map(parsed.entities.map(entity => [entity.id, entity]));
    for (const assertion of parsed.assertions) {
      try {
        if (assertion.status === "superseded" || assertion.status === "retracted") {
          report.skippedHistorical += 1;
          continue;
        }
        const subjectEntity = entityNameByOldId.get(assertion.subjectId);
        if (subjectEntity === undefined) {
          report.skippedInvalid += 1;
          continue;
        }
        const objectEntity = assertion.objectEntityId !== undefined
          ? entityNameByOldId.get(assertion.objectEntityId)
          : undefined;
        if (assertion.objectEntityId !== undefined && objectEntity === undefined) {
          report.skippedInvalid += 1;
          continue;
        }
        const excerpt = assertion.evidenceIds
          .map(id => evidenceById.get(id)?.excerpt)
          .find((text): text is string => typeof text === "string" && text.trim().length > 0)
          ?? `Imported from ${ONTOLOGY_EXPORT_FORMAT_VERSION} (original evidence not included).`;
        const ingest = await resolver.ingestCandidate(identity, {
          subject: { type: subjectEntity.type, name: subjectEntity.canonicalName },
          predicate: assertion.predicate,
          ...(objectEntity !== undefined
            ? { objectEntity: { type: objectEntity.type, name: objectEntity.canonicalName } }
            : {}),
          ...(assertion.objectValue !== undefined ? { objectValue: assertion.objectValue } : {}),
          sourceType: "imported",
          confidence: assertion.confidence,
          excerpt,
        }, { operator: operator.operator ?? DEFAULT_OPERATOR, source: "ontology_import" });
        if (ingest.kind === "skipped") {
          report.skippedInvalid += 1;
          continue;
        }
        report.assertionsImported += 1;
        if (ingest.merged) {
          report.merged += 1;
          continue;
        }
        if (assertion.status === "active") {
          const promoted = await resolver.promoteAssertion(identity, ingest.assertion.id, operator);
          if (promoted.assertion.status === "disputed") {
            report.disputed += 1;
          } else {
            report.promoted += 1;
          }
          if (promoted.mergedInto !== undefined) {
            report.merged += 1;
          }
        } else if (assertion.status === "disputed") {
          await store.updateAssertion(identity, ingest.assertion.id, { status: "disputed" }, operator);
          report.disputed += 1;
        }
        // candidate stays a candidate (counts as imported only).
      } catch (error) {
        pushError(report, `assertion ${assertion.id}: ${errorMessage(error)}`);
      }
    }

    const regeneration = await regenerateSnapshot(identity, operator);
    report.snapshotRegenerated = regeneration.snapshot !== undefined || regeneration.empty;
    await store.recordAuditEntry(identity, {
      action: "import_ontology",
      recordKind: "import",
      recordId: ONTOLOGY_EXPORT_FORMAT_VERSION,
      operator: operator.operator ?? DEFAULT_OPERATOR,
      source: operator.source,
      detail: {
        sourceIdentity: payloadIdentity(parsed),
        entitiesCreated: report.entitiesCreated,
        entitiesReused: report.entitiesReused,
        assertionsImported: report.assertionsImported,
        promoted: report.promoted,
        merged: report.merged,
        disputed: report.disputed,
        skippedHistorical: report.skippedHistorical,
        skippedInvalid: report.skippedInvalid,
        errorCount: report.errors.length,
      },
    });
    return report;
  }

  async function resolveEntityRef(
    identity: MemoryIdentity,
    ref: OntologyEntityRef,
    meta: OntologyWriteMeta,
  ): Promise<OntologyEntity> {
    const matches = await store.findEntitiesByName(identity, ref.name);
    const active = matches.find(entity => entity.status === "active" && entity.type === ref.type)
      ?? matches.find(entity => entity.status === "active");
    if (active !== undefined) {
      return active;
    }
    return await store.insertEntity(identity, {
      type: ref.type,
      canonicalName: ref.name.trim(),
      ...(ref.aliases !== undefined ? { aliases: ref.aliases } : {}),
    }, meta);
  }

  async function requireAssertion(identity: MemoryIdentity, assertionId: string): Promise<OntologyAssertion> {
    const assertion = await store.getAssertion(identity, assertionId);
    if (assertion === undefined) {
      throw new MemoryToolError(`Ontology assertion not found: ${assertionId.trim()}`);
    }
    return assertion;
  }

  return {
    explainUserKnowledge,
    explainAssertion,
    listConflicts,
    listInferred,
    correctAssertion,
    retractAssertion,
    deleteEvidence,
    deleteEntity,
    deleteCategory,
    deleteAllUserOntology,
    unmergeEntity,
    regenerateSnapshot,
    exportUserOntology,
    importUserOntology,
  };
}

function toExportEvidence(item: OntologyEvidence, redact: boolean): OntologyExportEvidence {
  const exported: OntologyExportEvidence = {
    id: item.id,
    source: item.source,
    capturedAt: item.capturedAt,
  };
  if (item.sessionId !== undefined) {
    exported.sessionId = item.sessionId;
  }
  if (item.runId !== undefined) {
    exported.runId = item.runId;
  }
  if (item.messageId !== undefined) {
    exported.messageId = item.messageId;
  }
  if (redact) {
    exported.excerptRedacted = true;
  } else {
    exported.excerpt = item.excerpt;
  }
  return exported;
}

function categoryLabel(filter: OntologyDeleteCategoryFilter): string {
  if (filter.predicate !== undefined) {
    return `predicate:${filter.predicate}`;
  }
  if (filter.sourceType !== undefined) {
    return `sourceType:${filter.sourceType}`;
  }
  return `entityType:${String(filter.entityType)}`;
}

function payloadIdentity(parsed: OntologyExportPayload): string {
  return `${parsed.identity.tenantId}/${parsed.identity.userId}`;
}

function pushError(report: OntologyImportReport, message: string): void {
  if (report.errors.length < 20) {
    report.errors.push(message);
  }
  report.skippedInvalid += 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Validate an export payload structurally (version + required arrays). */
export function parseOntologyExportPayload(payload: unknown): OntologyExportPayload {
  return parseExportPayload(payload);
}

function parseExportPayload(payload: unknown): OntologyExportPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new MemoryToolError("Ontology import payload must be an object produced by exportUserOntology.");
  }
  const value = payload as Record<string, unknown>;
  if (value.formatVersion !== ONTOLOGY_EXPORT_FORMAT_VERSION) {
    throw new MemoryToolError(
      `Unsupported ontology export formatVersion: ${String(value.formatVersion)} (expected ${ONTOLOGY_EXPORT_FORMAT_VERSION}).`,
    );
  }
  for (const field of ["entities", "assertions", "evidence", "episodes", "supersessions"] as const) {
    if (!Array.isArray(value[field])) {
      throw new MemoryToolError(`Ontology import payload is missing the "${field}" array.`);
    }
  }
  const identityValue = value.identity;
  if (typeof identityValue !== "object" || identityValue === null
    || typeof (identityValue as Record<string, unknown>).tenantId !== "string"
    || typeof (identityValue as Record<string, unknown>).userId !== "string") {
    throw new MemoryToolError("Ontology import payload identity is invalid.");
  }
  return payload as OntologyExportPayload;
}
