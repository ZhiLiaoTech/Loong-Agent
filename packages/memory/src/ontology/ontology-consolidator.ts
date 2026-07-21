import type { MemoryIdentity } from "@loong/core";
import { assertMemoryIdentity } from "../memory-store-v2.js";
import { MemoryToolError } from "../memory-tool-error.js";
import { createOntologySnapshotter, type OntologySnapshotSelection } from "./ontology-snapshot.js";
import type { OntologyStore, OntologyWriteMeta } from "./ontology-store.js";
import type { OntologyAssertion, OntologyEntity, UserProfileSnapshot } from "./ontology-types.js";

/**
 * Phase 3 FR-08 (语义压缩): the ontology consolidator.
 *
 * `shouldConsolidate` evaluates the FR-08 triggers; `consolidate` produces:
 * deduplicated entities (high-confidence exact rules only, §10), the current
 * active assertion set (with re-pointed references and post-merge fact
 * dedup), preserved history/conflict relations, an updated Profile Snapshot,
 * and a full audit trail.
 *
 * HARD RULES (§4.6, FR-08): the consolidator NEVER physically deletes
 * Sessions, Episodes, Evidence, Assertions or Entities. Merged-away entities
 * get status "merged"; superseded assertions stay in the database; the only
 * operations are status changes, reference re-points and snapshot writes.
 *
 * Auto-merge rules are deliberately conservative (§10 自动实体合并必须使用高置信规则):
 * two active entities merge only when they share a type AND sensitivity AND
 * have an exact (case-insensitive, trimmed) canonical-name or alias overlap.
 * Anything fuzzier stays separate.
 *
 * Idempotency: a second consecutive run merges nothing and regenerates the
 * identical projection, so it writes NOTHING (no new snapshot version, no
 * audit spam) and reports `changed: false`.
 */

export const DEFAULT_CONSOLIDATOR_ASSERTION_THRESHOLD = 200;
export const DEFAULT_CONSOLIDATOR_EPISODE_THRESHOLD = 50;
export const DEFAULT_CONSOLIDATOR_CANDIDATES_PER_PREDICATE = 3;
export const DEFAULT_CONSOLIDATOR_OPERATOR = "ontology_consolidator";

export interface OntologyConsolidatorOptions {
  store: OntologyStore;
  /** FR-08 trigger: total assertions above this threshold. Default 200. */
  assertionThreshold?: number;
  /** FR-08 trigger: this many pending candidates on one predicate. Default 3. */
  candidatePerPredicateThreshold?: number;
  /** FR-08 trigger: accumulated episodes above this threshold. Default 50. */
  episodeThreshold?: number;
  /** Snapshot selection overrides passed to the snapshotter. */
  snapshot?: OntologySnapshotSelection;
  /** Clock injection for deterministic tests. */
  now?: () => string;
  /** Audit operator for consolidator writes. */
  operator?: string;
}

export interface OntologyConsolidationStats {
  assertionCount: number;
  candidateCount: number;
  maxCandidatesPerPredicate: number;
  disputedCount: number;
  episodeCount: number;
}

export interface OntologyConsolidationTriggers {
  assertionCountExceeded: boolean;
  multipleCandidatesPerPredicate: boolean;
  conflictDetected: boolean;
  episodesAccumulated: boolean;
  /** Explicit user/agent request (用户主动要求整理记忆). */
  requested: boolean;
}

export interface OntologyEntityMergeRecord {
  survivingEntity: OntologyEntity;
  mergedEntityIds: string[];
  repointedAssertions: number;
  dedupedAssertions: number;
}

export interface OntologyConsolidationReport {
  identity: MemoryIdentity;
  stats: OntologyConsolidationStats;
  triggers: OntologyConsolidationTriggers;
  entityMerges: OntologyEntityMergeRecord[];
  snapshotWritten: boolean;
  snapshot?: UserProfileSnapshot;
  /** False when the run changed nothing (idempotent no-op). */
  changed: boolean;
}

export interface OntologyConsolidateOptions {
  /** Marks the run as an explicit user/agent request (FR-08 trigger). */
  requested?: boolean;
  /** Free-form reason recorded in the audit summary. */
  reason?: string;
}

export interface OntologyConsolidator {
  computeStats(identity: MemoryIdentity): Promise<OntologyConsolidationStats>;
  /** Evaluate the FR-08 triggers; `requested` marks an explicit user request. */
  shouldConsolidate(
    identity: MemoryIdentity,
    options?: { requested?: boolean; stats?: OntologyConsolidationStats },
  ): Promise<OntologyConsolidationTriggers>;
  consolidate(identity: MemoryIdentity, options?: OntologyConsolidateOptions): Promise<OntologyConsolidationReport>;
}

export function createOntologyConsolidator(options: OntologyConsolidatorOptions): OntologyConsolidator {
  const store = options.store;
  const assertionThreshold = positiveInt(options.assertionThreshold, DEFAULT_CONSOLIDATOR_ASSERTION_THRESHOLD, "assertionThreshold");
  const candidatePerPredicateThreshold = positiveInt(options.candidatePerPredicateThreshold, DEFAULT_CONSOLIDATOR_CANDIDATES_PER_PREDICATE, "candidatePerPredicateThreshold");
  const episodeThreshold = positiveInt(options.episodeThreshold, DEFAULT_CONSOLIDATOR_EPISODE_THRESHOLD, "episodeThreshold");
  const operator = options.operator?.trim() ? options.operator.trim() : DEFAULT_CONSOLIDATOR_OPERATOR;
  const now = options.now ?? (() => new Date().toISOString());
  const snapshotter = createOntologySnapshotter({
    store,
    ...(options.snapshot ?? {}),
    now,
  });

  async function computeStats(identityValue: MemoryIdentity): Promise<OntologyConsolidationStats> {
    const identity = assertMemoryIdentity(identityValue);
    const assertionCount = await store.countAssertions(identity);
    const disputedCount = await store.countAssertions(identity, { status: "disputed" });
    const episodeCount = await store.countEpisodes(identity);
    const candidates = await store.findAssertions(identity, { status: "candidate", limit: 1000 });
    const perPredicate = new Map<string, number>();
    for (const candidate of candidates) {
      perPredicate.set(candidate.predicate, (perPredicate.get(candidate.predicate) ?? 0) + 1);
    }
    return {
      assertionCount,
      candidateCount: candidates.length,
      maxCandidatesPerPredicate: Math.max(0, ...perPredicate.values()),
      disputedCount,
      episodeCount,
    };
  }

  async function shouldConsolidate(
    identityValue: MemoryIdentity,
    options_: { requested?: boolean; stats?: OntologyConsolidationStats } = {},
  ): Promise<OntologyConsolidationTriggers> {
    const identity = assertMemoryIdentity(identityValue);
    const stats = options_.stats ?? await computeStats(identity);
    return evaluateTriggers(stats, {
      requested: options_.requested === true,
      assertionThreshold,
      candidatePerPredicateThreshold,
      episodeThreshold,
    });
  }

  async function consolidate(
    identityValue: MemoryIdentity,
    consolidateOptions: OntologyConsolidateOptions = {},
  ): Promise<OntologyConsolidationReport> {
    const identity = assertMemoryIdentity(identityValue);
    const meta: OntologyWriteMeta = { operator, source: DEFAULT_CONSOLIDATOR_OPERATOR };
    const stats = await computeStats(identity);
    const triggers = evaluateTriggers(stats, {
      requested: consolidateOptions.requested === true,
      assertionThreshold,
      candidatePerPredicateThreshold,
      episodeThreshold,
    });

    // ---- 1. Entity dedup (high-confidence exact rules only) ----
    const entityMerges = await mergeDuplicateEntities(identity, meta);

    // ---- 2. Snapshot: write only when the projection changed ----
    const projection = await snapshotter.project(identity);
    const latest = await store.getLatestSnapshot(identity);
    const snapshotChanged = latest === undefined
      || latest.content !== projection.content
      || latest.assertionIds.join(",") !== projection.assertionIds.join(",");
    let snapshot: UserProfileSnapshot | undefined;
    if (snapshotChanged) {
      snapshot = await snapshotter.generate(identity, { operator, source: DEFAULT_CONSOLIDATOR_OPERATOR });
    }

    const changed = entityMerges.length > 0 || snapshot !== undefined;

    // ---- 3. Audit summary (only when the run changed anything) ----
    if (changed) {
      await store.recordAuditEntry(identity, {
        action: "consolidate",
        recordKind: "consolidation",
        recordId: snapshot !== undefined ? `snapshot-v${snapshot.version}` : "no-snapshot-change",
        operator,
        source: DEFAULT_CONSOLIDATOR_OPERATOR,
        detail: {
          triggers,
          mergedEntityIds: entityMerges.flatMap(merge => merge.mergedEntityIds),
          repointedAssertions: entityMerges.reduce((sum, merge) => sum + merge.repointedAssertions, 0),
          dedupedAssertions: entityMerges.reduce((sum, merge) => sum + merge.dedupedAssertions, 0),
          snapshotVersion: snapshot?.version ?? latest?.version ?? null,
          ...(consolidateOptions.reason !== undefined ? { reason: consolidateOptions.reason } : {}),
        },
      });
    }

    const report: OntologyConsolidationReport = {
      identity: { ...identity },
      stats,
      triggers,
      entityMerges,
      snapshotWritten: snapshot !== undefined,
      changed,
    };
    if (snapshot !== undefined) {
      report.snapshot = snapshot;
    }
    return report;
  }

  /**
   * High-confidence entity dedup: group active entities by (type,
   * sensitivity); within a group, merge entities whose normalized canonical
   * names or aliases overlap exactly. Re-point assertions to the survivor,
   * union the aliases, mark the rest "merged" (never deleted, §4.6).
   */
  async function mergeDuplicateEntities(identity: MemoryIdentity, meta: OntologyWriteMeta): Promise<OntologyEntityMergeRecord[]> {
    const entities = await store.listEntities(identity, { status: "active", limit: 1000 });
    const components = groupDuplicateEntities(entities);
    const merges: OntologyEntityMergeRecord[] = [];
    for (const component of components) {
      const survivor = pickSurvivor(component);
      const mergedEntities = component.filter(entity => entity.id !== survivor.id);
      const aliasUnion = new Set(survivor.aliases);
      for (const merged of mergedEntities) {
        aliasUnion.add(merged.canonicalName);
        for (const alias of merged.aliases) {
          aliasUnion.add(alias);
        }
      }
      let repointed = 0;
      let deduped = 0;
      for (const merged of mergedEntities) {
        repointed += await store.repointEntityAssertions(identity, merged.id, survivor.id, {
          ...meta,
          detail: { survivingEntityId: survivor.id, mergedEntityId: merged.id },
        });
        deduped += await dedupAssertionsAfterRepoint(identity, survivor.id, meta);
        await store.updateEntity(identity, { ...merged, status: "merged" }, {
          ...meta,
          detail: { survivingEntityId: survivor.id, mergeRule: "exact-name-or-alias" },
        });
      }
      const updatedSurvivor = await store.updateEntity(identity, {
        ...survivor,
        aliases: [...aliasUnion],
      }, {
        ...meta,
        detail: { mergedEntityIds: mergedEntities.map(entity => entity.id) },
      });
      merges.push({
        survivingEntity: updatedSurvivor,
        mergedEntityIds: mergedEntities.map(entity => entity.id),
        repointedAssertions: repointed,
        dedupedAssertions: deduped,
      });
    }
    return merges;
  }

  /**
   * Post-repoint fact dedup: two assertions about the survivor can become
   * identical (same subject + predicate + object). Keep the stronger one,
   * merge its evidence in, supersede the duplicate — never leave parallel
   * active/candidate duplicates (FR-06).
   */
  async function dedupAssertionsAfterRepoint(
    identity: MemoryIdentity,
    survivorId: string,
    meta: OntologyWriteMeta,
  ): Promise<number> {
    const related = await store.findAssertions(identity, {
      status: ["candidate", "active"],
      limit: 1000,
    });
    const touched = related.filter(assertion => assertion.subjectId === survivorId || assertion.objectEntityId === survivorId);
    const byFact = new Map<string, OntologyAssertion[]>();
    for (const assertion of touched) {
      const key = [
        assertion.subjectId,
        assertion.predicate,
        assertion.objectEntityId !== undefined ? `entity:${assertion.objectEntityId}` : `value:${String(assertion.objectValue ?? "")}`,
      ].join("|");
      const bucket = byFact.get(key) ?? [];
      bucket.push(assertion);
      byFact.set(key, bucket);
    }
    let deduped = 0;
    for (const bucket of byFact.values()) {
      if (bucket.length < 2) {
        continue;
      }
      const sorted = [...bucket].sort(compareAssertionStrength);
      const keep = sorted[0];
      if (keep === undefined) {
        continue;
      }
      for (const duplicate of sorted.slice(1)) {
        await store.updateAssertion(identity, keep.id, {
          addEvidenceIds: duplicate.evidenceIds,
          confidence: Math.max(keep.confidence, duplicate.confidence),
        }, meta);
        await store.supersedeAssertion(identity, duplicate.id, keep.id, meta);
        deduped += 1;
      }
    }
    return deduped;
  }

  return { computeStats, shouldConsolidate, consolidate };
}

function evaluateTriggers(
  stats: OntologyConsolidationStats,
  thresholds: {
    requested: boolean;
    assertionThreshold: number;
    candidatePerPredicateThreshold: number;
    episodeThreshold: number;
  },
): OntologyConsolidationTriggers {
  return {
    assertionCountExceeded: stats.assertionCount > thresholds.assertionThreshold,
    multipleCandidatesPerPredicate: stats.maxCandidatesPerPredicate >= thresholds.candidatePerPredicateThreshold,
    conflictDetected: stats.disputedCount > 0,
    episodesAccumulated: stats.episodeCount >= thresholds.episodeThreshold,
    requested: thresholds.requested,
  };
}

/** True when any FR-08 trigger fired. */
export function anyConsolidationTriggerFired(triggers: OntologyConsolidationTriggers): boolean {
  return triggers.assertionCountExceeded
    || triggers.multipleCandidatesPerPredicate
    || triggers.conflictDetected
    || triggers.episodesAccumulated
    || triggers.requested;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Group active entities into duplicate components. Two entities are
 * duplicates when they share a type AND sensitivity AND have an exact
 * normalized canonical-name or alias overlap (union-find over exact rules;
 * fuzzy similarity is deliberately not used, §10).
 */
function groupDuplicateEntities(entities: OntologyEntity[]): OntologyEntity[][] {
  const parent = new Map<string, string>(entities.map(entity => [entity.id, entity.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) {
      root = parent.get(root) ?? root;
    }
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    parent.set(find(a), find(b));
  };

  const byGroup = new Map<string, OntologyEntity[]>();
  for (const entity of entities) {
    const groupKey = `${entity.type}|${entity.sensitivity}`;
    const bucket = byGroup.get(groupKey) ?? [];
    bucket.push(entity);
    byGroup.set(groupKey, bucket);
  }
  for (const bucket of byGroup.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const left = bucket[i];
        const right = bucket[j];
        if (left === undefined || right === undefined) {
          continue;
        }
        if (entitiesOverlapExactly(left, right)) {
          union(left.id, right.id);
        }
      }
    }
  }
  const components = new Map<string, OntologyEntity[]>();
  for (const entity of entities) {
    const root = find(entity.id);
    const bucket = components.get(root) ?? [];
    bucket.push(entity);
    components.set(root, bucket);
  }
  return [...components.values()].filter(component => component.length > 1);
}

function entitiesOverlapExactly(left: OntologyEntity, right: OntologyEntity): boolean {
  const leftNames = new Set([normalizeName(left.canonicalName), ...left.aliases.map(normalizeName)]);
  const rightNames = new Set([normalizeName(right.canonicalName), ...right.aliases.map(normalizeName)]);
  for (const name of leftNames) {
    if (rightNames.has(name)) {
      return true;
    }
  }
  return false;
}

/** Survivor: earliest created → smallest id (deterministic; first-seen entity wins). */
function pickSurvivor(component: OntologyEntity[]): OntologyEntity {
  return [...component].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt.localeCompare(right.createdAt);
    }
    return left.id.localeCompare(right.id);
  })[0] as OntologyEntity;
}

/** Active beats candidate; then higher confidence; then earliest created. */
function compareAssertionStrength(left: OntologyAssertion, right: OntologyAssertion): number {
  const leftRank = left.status === "active" ? 1 : 0;
  const rightRank = right.status === "active" ? 1 : 0;
  if (leftRank !== rightRank) {
    return rightRank - leftRank;
  }
  if (left.confidence !== right.confidence) {
    return right.confidence - left.confidence;
  }
  if (left.createdAt !== right.createdAt) {
    return left.createdAt.localeCompare(right.createdAt);
  }
  return left.id.localeCompare(right.id);
}

function positiveInt(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new MemoryToolError(`Ontology consolidator ${field} must be a positive integer.`);
  }
  return value;
}
