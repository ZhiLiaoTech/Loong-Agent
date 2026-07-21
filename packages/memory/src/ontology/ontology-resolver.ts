import type { MemoryIdentity } from "@loong/core";
import { assertMemoryIdentity } from "../memory-store-v2.js";
import { MemoryToolError } from "../memory-tool-error.js";
import type { OntologyStore, OntologyWriteMeta } from "./ontology-store.js";
import type {
  AssertionSourceType,
  OntologyAssertion,
  OntologyCandidateDraft,
  OntologyEntity,
  OntologyEntityRef,
} from "./ontology-types.js";
import { isAssertionSourceType, isOntologySensitivity } from "./ontology-types.js";
import { validateAssertionSensitivity, validateOntologyAssertionWrite } from "./ontology-validator.js";
import { assertOntologyEntityType, assertOntologyPredicate } from "./ontology-vocabulary.js";

/**
 * Phase 2 FR-06/FR-07: dedup, merge, conflict detection and temporal handling
 * on the ontology write path.
 *
 * `ingestCandidate` runs the FR-06 pipeline for candidate writes: alias
 * resolution → same-assertion lookup → evidence merge + confidence bump on
 * repeats. Candidates with conflicting objects coexist as candidates; the
 * conflict is resolved when a human promotes one (FR-05/FR-07).
 *
 * `promoteAssertion` runs the FR-06 pipeline for activation: an identical
 * active assertion absorbs the candidate (single active per fact, §11.2);
 * a conflicting active assertion is either superseded (FR-07 temporal update)
 * or both sides become `disputed` when replacement vs. context difference is
 * undecidable (§4.3/FR-07 不得自行选择).
 */

/** §4.3 source priority: 用户明确陈述 > 多次一致观察 > 单次观察 > 模型推断. */
const SOURCE_TYPE_RANK: Record<AssertionSourceType, number> = {
  explicit: 3,
  observed: 2,
  imported: 1,
  inferred: 1,
};

const DEFAULT_CONFIDENCE: Record<AssertionSourceType, number> = {
  explicit: 0.9,
  observed: 0.7,
  imported: 0.5,
  inferred: 0.4,
};

/** Repeat-evidence confidence bump per source type (FR-06 step 4). */
const CONFIDENCE_BUMP: Record<AssertionSourceType, number> = {
  explicit: 0.1,
  observed: 0.05,
  imported: 0.02,
  inferred: 0.02,
};

export interface OntologyIngestContext {
  sessionId?: string;
  runId?: string;
  messageId?: string;
  /** Audit operator, e.g. the hook or tool name. */
  operator?: string;
  /** Evidence/audit source label. */
  source?: string;
}

export type OntologyIngestResult =
  | { kind: "skipped"; reason: string }
  | {
    kind: "stored";
    assertion: OntologyAssertion;
    subject: OntologyEntity;
    objectEntity?: OntologyEntity;
    /** True when the fact already existed and only evidence/confidence changed. */
    merged: boolean;
  };

export interface OntologyPromoteResult {
  /** The resulting active (or disputed) assertion. */
  assertion: OntologyAssertion;
  /** Assertions transitioned to `superseded` by this promote (FR-07). */
  superseded: OntologyAssertion[];
  /** Assertions transitioned to `disputed` by this promote (ambiguous conflicts). */
  disputed: OntologyAssertion[];
  /**
   * Set when an identical active assertion already existed and absorbed the
   * candidate (the candidate itself was marked superseded).
   */
  mergedInto?: OntologyAssertion;
}

export interface OntologyResolver {
  ingestCandidate(
    identity: MemoryIdentity,
    draft: OntologyCandidateDraft,
    context?: OntologyIngestContext,
  ): Promise<OntologyIngestResult>;
  promoteAssertion(
    identity: MemoryIdentity,
    assertionId: string,
    meta?: OntologyWriteMeta,
  ): Promise<OntologyPromoteResult>;
}

export interface OntologyResolverOptions {
  store: OntologyStore;
}

export function createOntologyResolver(options: OntologyResolverOptions): OntologyResolver {
  return new Resolver(options.store);
}

class Resolver implements OntologyResolver {
  readonly #store: OntologyStore;

  constructor(store: OntologyStore) {
    this.#store = store;
  }

  async ingestCandidate(
    identityValue: MemoryIdentity,
    draft: OntologyCandidateDraft,
    context: OntologyIngestContext = {},
  ): Promise<OntologyIngestResult> {
    const identity = assertMemoryIdentity(identityValue);
    const normalized = normalizeCandidateDraft(draft);

    // FR-05 "don't ask again": identical fact signatures are suppressed.
    const review = await this.#store.getCandidateReview(identity, ontologyCandidateFactKey(normalized));
    if (review !== undefined) {
      return { kind: "skipped", reason: `Suppressed by a "don't ask again" review marker (${review.key}).` };
    }

    const meta: OntologyWriteMeta = writeMeta(context);
    const subject = await this.#resolveEntity(identity, normalized.subject, meta);
    const objectEntity = normalized.objectEntity !== undefined
      ? await this.#resolveEntity(identity, normalized.objectEntity, meta)
      : undefined;

    // FR-06 step 2: same-assertion lookup (same subject + predicate + object
    // per identity) over candidate and active assertions.
    const sameFact = await this.#findSameFactAssertions(identity, subject.id, normalized, objectEntity);
    const existing = sameFact.find(assertion => assertion.status === "active") ?? sameFact[0];
    if (existing !== undefined) {
      // FR-06 step 3/4: evidence merge + confidence bump on repeats. An
      // active assertion absorbs repeats directly (重复表达同一事实只保留一个
      // active Assertion); no new assertion row is created.
      const evidence = await this.#store.insertEvidence(identity, {
        ...(context.sessionId !== undefined ? { sessionId: context.sessionId } : {}),
        ...(context.runId !== undefined ? { runId: context.runId } : {}),
        ...(context.messageId !== undefined ? { messageId: context.messageId } : {}),
        source: context.source ?? "ontology_resolver",
        excerpt: normalized.excerpt,
      }, meta);
      const updated = await this.#store.updateAssertion(identity, existing.id, {
        addEvidenceIds: [evidence.id],
        confidence: bumpConfidence(existing.confidence, normalized.sourceType),
      }, meta);
      const result: OntologyIngestResult = {
        kind: "stored",
        assertion: updated,
        subject,
        merged: true,
      };
      if (objectEntity !== undefined) {
        result.objectEntity = objectEntity;
      }
      return result;
    }

    // New candidate assertion (FR-04: 普通推断不得静默进入 active 状态 —
    // everything the extractor produces starts as a candidate).
    const evidence = await this.#store.insertEvidence(identity, {
      ...(context.sessionId !== undefined ? { sessionId: context.sessionId } : {}),
      ...(context.runId !== undefined ? { runId: context.runId } : {}),
      ...(context.messageId !== undefined ? { messageId: context.messageId } : {}),
      source: context.source ?? "ontology_resolver",
      excerpt: normalized.excerpt,
    }, meta);
    const assertion = await this.#store.insertAssertion(identity, {
      subjectId: subject.id,
      predicate: normalized.predicate,
      ...(objectEntity !== undefined ? { objectEntityId: objectEntity.id } : {}),
      ...(normalized.objectValue !== undefined ? { objectValue: normalized.objectValue } : {}),
      confidence: normalized.confidence ?? DEFAULT_CONFIDENCE[normalized.sourceType],
      sourceType: normalized.sourceType,
      status: "candidate",
      evidenceIds: [evidence.id],
    }, meta);
    const result: OntologyIngestResult = {
      kind: "stored",
      assertion,
      subject,
      merged: false,
    };
    if (objectEntity !== undefined) {
      result.objectEntity = objectEntity;
    }
    return result;
  }

  async promoteAssertion(
    identityValue: MemoryIdentity,
    assertionId: string,
    meta: OntologyWriteMeta = {},
  ): Promise<OntologyPromoteResult> {
    const identity = assertMemoryIdentity(identityValue);
    const operator = meta.operator?.trim() ? meta.operator.trim() : "ontology_review";
    const writeMeta: OntologyWriteMeta = { ...meta, operator };

    const candidate = await this.#store.getAssertion(identity, assertionId);
    if (candidate === undefined) {
      throw new MemoryToolError(`Ontology assertion not found: ${assertionId.trim()}`);
    }
    if (candidate.status !== "candidate" && candidate.status !== "disputed") {
      throw new MemoryToolError(`Ontology assertion is already ${candidate.status}; only candidate or disputed assertions can be promoted.`);
    }
    const subject = await this.#store.getEntity(identity, candidate.subjectId);
    const objectEntity = candidate.objectEntityId !== undefined
      ? await this.#store.getEntity(identity, candidate.objectEntityId)
      : undefined;
    // FR-06 step 7: structural validation of the would-be active assertion.
    validateOntologyAssertionWrite({ ...candidate, status: "active" }, { subject, ...(objectEntity !== undefined ? { objectEntity } : {}) });

    const now = new Date().toISOString();

    // FR-06 step 2/3/4: an identical active assertion absorbs the candidate.
    const sameFactActive = (await this.#store.findAssertions(identity, {
      subjectId: candidate.subjectId,
      predicate: candidate.predicate,
      status: "active",
    })).filter(assertion => sameObject(assertion, candidate));
    const canonical = sameFactActive[0];
    if (canonical !== undefined) {
      const merged = await this.#store.updateAssertion(identity, canonical.id, {
        addEvidenceIds: candidate.evidenceIds,
        confidence: bumpConfidence(canonical.confidence, candidate.sourceType),
      }, writeMeta);
      await this.#store.supersedeAssertion(identity, candidate.id, canonical.id, writeMeta);
      const absorbed = await this.#requireAssertion(identity, candidate.id);
      return {
        assertion: merged,
        superseded: [absorbed],
        disputed: [],
        mergedInto: merged,
      };
    }

    // FR-06 step 5/6 + FR-07: conflict detection and temporal handling over
    // active assertions with the same subject + predicate but a different
    // object.
    const conflicting = (await this.#store.findAssertions(identity, {
      subjectId: candidate.subjectId,
      predicate: candidate.predicate,
      status: "active",
    })).filter(assertion => !sameObject(assertion, candidate));

    const incomingRank = SOURCE_TYPE_RANK[candidate.sourceType];
    const superseded: OntologyAssertion[] = [];
    const disputed: OntologyAssertion[] = [];
    let ambiguous = false;
    for (const existing of conflicting) {
      const existingRank = SOURCE_TYPE_RANK[existing.sourceType];
      if (candidate.sourceType === "explicit" || incomingRank > existingRank) {
        // FR-07 temporal update: the user's latest explicit statement (or a
        // strictly stronger source) supersedes the old fact; history is kept.
        await this.#store.supersedeAssertion(identity, existing.id, candidate.id, writeMeta);
        superseded.push(await this.#requireAssertion(identity, existing.id));
      } else if (incomingRank === existingRank) {
        // Ambiguous (replacement vs. context difference undecidable): both
        // sides are marked disputed — never silently pick one (§4.3, FR-07).
        await this.#store.updateAssertion(identity, existing.id, { status: "disputed" }, writeMeta);
        disputed.push(await this.#requireAssertion(identity, existing.id));
        ambiguous = true;
      } else {
        // 模型推断不能自动覆盖用户明确事实 (§4.3): only the incoming weaker
        // candidate is flagged disputed; the stronger active fact stands.
        ambiguous = true;
      }
    }

    const nextStatus = ambiguous ? "disputed" : "active";
    const updated = await this.#store.updateAssertion(identity, candidate.id, {
      status: nextStatus,
      ...(nextStatus === "active" ? { validFrom: candidate.validFrom ?? now } : {}),
    }, writeMeta);
    if (ambiguous) {
      disputed.push(updated);
    }
    return { assertion: updated, superseded, disputed };
  }

  /** FR-06 step 1: alias resolution; create the entity on first sight. */
  async #resolveEntity(
    identity: MemoryIdentity,
    ref: OntologyEntityRef,
    meta: OntologyWriteMeta,
  ): Promise<OntologyEntity> {
    const matches = await this.#store.findEntitiesByName(identity, ref.name);
    const active = matches.find(entity => entity.status === "active" && entity.type === ref.type)
      ?? matches.find(entity => entity.status === "active");
    if (active !== undefined) {
      return active;
    }
    return await this.#store.insertEntity(identity, {
      type: ref.type,
      canonicalName: ref.name.trim(),
      ...(ref.aliases !== undefined ? { aliases: ref.aliases } : {}),
    }, meta);
  }

  async #findSameFactAssertions(
    identity: MemoryIdentity,
    subjectId: string,
    draft: NormalizedCandidateDraft,
    objectEntity: OntologyEntity | undefined,
  ): Promise<OntologyAssertion[]> {
    const candidates = await this.#store.findAssertions(identity, {
      subjectId,
      predicate: draft.predicate,
      status: ["candidate", "active"],
    });
    return candidates.filter(assertion => {
      if (objectEntity !== undefined) {
        return assertion.objectEntityId === objectEntity.id;
      }
      return assertion.objectValue === draft.objectValue;
    });
  }

  async #requireAssertion(identity: MemoryIdentity, id: string): Promise<OntologyAssertion> {
    const assertion = await this.#store.getAssertion(identity, id);
    if (assertion === undefined) {
      throw new MemoryToolError(`Ontology assertion not found: ${id}`);
    }
    return assertion;
  }
}

interface NormalizedCandidateDraft extends OntologyCandidateDraft {
  sourceType: AssertionSourceType;
}

function normalizeCandidateDraft(draft: OntologyCandidateDraft): NormalizedCandidateDraft {
  assertOntologyPredicate(draft.predicate);
  assertOntologyEntityType(draft.subject.type, "subject entity type");
  if (draft.objectEntity !== undefined) {
    assertOntologyEntityType(draft.objectEntity.type, "object entity type");
  }
  if (typeof draft.subject.name !== "string" || !draft.subject.name.trim()) {
    throw new MemoryToolError("Ontology candidate subject name cannot be empty.");
  }
  if (draft.objectEntity !== undefined && !draft.objectEntity.name.trim()) {
    throw new MemoryToolError("Ontology candidate object entity name cannot be empty.");
  }
  const hasObjectEntity = draft.objectEntity !== undefined;
  const hasObjectValue = draft.objectValue !== undefined;
  if (hasObjectEntity === hasObjectValue) {
    throw new MemoryToolError("Ontology candidate requires exactly one object form: objectEntity or objectValue.");
  }
  if (!isAssertionSourceType(draft.sourceType)) {
    throw new MemoryToolError("Invalid ontology candidate sourceType.");
  }
  if (draft.confidence !== undefined
    && (!Number.isFinite(draft.confidence) || draft.confidence < 0 || draft.confidence > 1)) {
    throw new MemoryToolError("Ontology candidate confidence must be a finite number between 0 and 1.");
  }
  if (typeof draft.excerpt !== "string" || !draft.excerpt.trim()) {
    throw new MemoryToolError("Ontology candidate excerpt cannot be empty (FR-04 保留原始 Evidence).");
  }
  const sensitivity = draft.sensitivity ?? "normal";
  if (!isOntologySensitivity(sensitivity)) {
    throw new MemoryToolError("Invalid ontology candidate sensitivity.");
  }
  validateAssertionSensitivity(draft.sourceType, sensitivity);
  return {
    ...draft,
    subject: { ...draft.subject, name: draft.subject.name.trim() },
    ...(draft.objectEntity !== undefined
      ? { objectEntity: { ...draft.objectEntity, name: draft.objectEntity.name.trim() } }
      : {}),
    sensitivity,
  };
}

function sameObject(left: OntologyAssertion, right: OntologyAssertion): boolean {
  if (left.objectEntityId !== undefined || right.objectEntityId !== undefined) {
    return left.objectEntityId !== undefined && left.objectEntityId === right.objectEntityId;
  }
  return left.objectValue === right.objectValue;
}

function bumpConfidence(confidence: number, sourceType: AssertionSourceType): number {
  return Math.min(1, Math.round((confidence + CONFIDENCE_BUMP[sourceType]) * 10_000) / 10_000);
}

function writeMeta(context: OntologyIngestContext): OntologyWriteMeta {
  return {
    operator: context.operator?.trim() ? context.operator.trim() : "ontology_resolver",
    source: context.source?.trim() ? context.source.trim() : "ontology_resolver",
  };
}

/** FR-05 "don't ask again" fact signature for a candidate draft. */
export function ontologyCandidateFactKey(draft: OntologyCandidateDraft): string {
  const subjectKey = `${draft.subject.type}:${draft.subject.name.trim().toLowerCase()}`;
  const objectKey = draft.objectEntity !== undefined
    ? `entity:${draft.objectEntity.type}:${draft.objectEntity.name.trim().toLowerCase()}`
    : `value:${String(draft.objectValue ?? "").trim().toLowerCase()}`;
  return `${subjectKey}|${draft.predicate}|${objectKey}`;
}

/** Fact signature for an already-stored assertion (used by review tools). */
export async function ontologyAssertionFactKey(
  store: OntologyStore,
  identity: MemoryIdentity,
  assertion: OntologyAssertion,
): Promise<string> {
  const subject = await store.getEntity(identity, assertion.subjectId);
  const subjectKey = `${subject?.type ?? "?"}:${(subject?.canonicalName ?? assertion.subjectId).toLowerCase()}`;
  if (assertion.objectEntityId !== undefined) {
    const objectEntity = await store.getEntity(identity, assertion.objectEntityId);
    return `${subjectKey}|${assertion.predicate}|entity:${objectEntity?.type ?? "?"}:${(objectEntity?.canonicalName ?? assertion.objectEntityId).toLowerCase()}`;
  }
  return `${subjectKey}|${assertion.predicate}|value:${String(assertion.objectValue ?? "").trim().toLowerCase()}`;
}
