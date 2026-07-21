import type { MemoryIdentity } from "@loong/core";
import { assertMemoryIdentity, type MemoryStoreV2 } from "../memory-store-v2.js";
import { ONTOLOGY_SELF_ENTITY_NAME } from "./ontology-candidate-hook.js";
import {
  createOntologySnapshotter,
  estimateSnapshotTokens,
  type OntologySnapshotter,
} from "./ontology-snapshot.js";
import type { OntologyStore } from "./ontology-store.js";
import type {
  OntologyAssertion,
  OntologyEntity,
  OntologyEpisode,
  OntologyEvidence,
} from "./ontology-types.js";

/**
 * Phase 4 (FR-09, FR-10, §4.5 有界召回): bounded ontology recall.
 *
 * The retriever implements the FR-09 three-tier funnel:
 * 1. 用户核心认知 (tier 1) — the latest Profile Snapshot (stored, or projected
 *    on the fly without persistence when none exists), trimmed to a small
 *    token budget (doc range 100～500, default 300).
 * 2. 任务相关语义 (tier 2) — assertions about entities mentioned in the
 *    current message plus one-hop relations (两跳需显式开启, FR-10), ranked by
 *    the hybrid scoring below and trimmed to a token budget (doc range
 *    500～1500, default 1000).
 * 3. 情景证据下钻 (tier 3) — NOT injected by default. `drillDown` returns
 *    Evidence excerpts and Episode references on demand (§4.6 查询可逆下钻);
 *    recall results carry `drillDownHints` so callers know drilling is
 *    possible (FR-11 必须返回可供下钻的 Evidence 引用).
 *
 * §4.5 filters applied to everything returned: identity (mandatory first
 * parameter, store-enforced), sensitivity (sensitive facts never recalled;
 * personal excluded unless `includePersonal`), status (only active facts are
 * injected; disputed facts are excluded from the text but surfaced in
 * metadata, superseded facts surface only as transition context), temporal
 * validity (`asOf = now`), relevance + confidence ranking, and token budget
 * trimming.
 *
 * The "self" entity is excluded from mention matching and hop expansion: it is
 * the hub of the whole profile, so matching/expanding it would drag the full
 * profile into every tier-2 result. User-centric stable facts are exactly what
 * tier 1 carries.
 */

export const DEFAULT_ONTOLOGY_RECALL_TIER1_TOKEN_BUDGET = 300;
export const MIN_ONTOLOGY_RECALL_TIER1_TOKEN_BUDGET = 100;
export const MAX_ONTOLOGY_RECALL_TIER1_TOKEN_BUDGET = 500;
export const DEFAULT_ONTOLOGY_RECALL_TIER2_TOKEN_BUDGET = 1000;
export const MIN_ONTOLOGY_RECALL_TIER2_TOKEN_BUDGET = 100;
export const MAX_ONTOLOGY_RECALL_TIER2_TOKEN_BUDGET = 1500;
export const DEFAULT_ONTOLOGY_RECALL_MAX_HOPS = 1;
export const ABSOLUTE_ONTOLOGY_RECALL_MAX_HOPS = 2;
export const DEFAULT_ONTOLOGY_RECALL_MIN_CONFIDENCE = 0.6;
export const DEFAULT_ONTOLOGY_RECALL_MIN_INFERRED_CONFIDENCE = 0.8;
export const DEFAULT_ONTOLOGY_RECALL_FTS_LIMIT = 3;
export const DEFAULT_ONTOLOGY_DRILL_DOWN_LIMIT = 10;
export const ABSOLUTE_ONTOLOGY_DRILL_DOWN_LIMIT = 50;
export const DEFAULT_ONTOLOGY_DRILL_DOWN_EXCERPT_CHARS = 240;

/** FR-10 混合召回排序 weights. All factors are documented and configurable. */
export interface OntologyRecallRankingWeights {
  /** Base score for an assertion directly about a mentioned entity. */
  directMention: number;
  /** Base score for a one-hop relation of a mentioned entity. */
  oneHop: number;
  /** Base score for a two-hop relation (only when maxHops: 2). */
  twoHop: number;
  /** 是否为用户明确事实: bonus for explicit statements. */
  explicitSource: number;
  /** Bonus for observed facts (weaker than explicit). */
  observedSource: number;
  /** Assertion 置信度 multiplier (confidence * confidenceScale). */
  confidenceScale: number;
  /** 最近确认时间: max recency bonus, decaying with a half-life. */
  recencyBoost: number;
  /** Half-life in days for the recency bonus (from assertion.updatedAt). */
  recencyHalfLifeDays: number;
  /** Evidence 数量 bonus per linked evidence item... */
  evidenceBoost: number;
  /** ...capped at this many evidence items. */
  maxEvidenceCount: number;
}

export const DEFAULT_ONTOLOGY_RECALL_RANKING_WEIGHTS: OntologyRecallRankingWeights = {
  directMention: 1.0,
  oneHop: 0.5,
  twoHop: 0.25,
  explicitSource: 0.2,
  observedSource: 0.1,
  confidenceScale: 0.3,
  recencyBoost: 0.1,
  recencyHalfLifeDays: 30,
  evidenceBoost: 0.1,
  maxEvidenceCount: 3,
};

export type OntologyRecallHop = 0 | 1 | 2;

/** A tier-2 fact: an eligible assertion with its ranking context. */
export interface OntologyRecalledAssertion {
  assertion: OntologyAssertion;
  subject: OntologyEntity;
  objectEntity?: OntologyEntity;
  /** Hybrid ranking score (FR-10); higher is more relevant. */
  score: number;
  /** Relation distance from a mentioned entity (0 = direct mention). */
  hop: OntologyRecallHop;
  /**
   * FR-07/FR-11 transition context: when this active fact superseded an older
   * one, the old assertion id plus a rendered transition line
   * ("用户过去使用 X，目前已改用 Y。"). The superseded fact itself is never
   * injected as a current fact.
   */
  transition?: { supersededAssertionId: string; line: string };
}

export interface OntologyRecallTier1 {
  /** Snapshot lines (each prefixed "- "), trimmed to the tier-1 budget. */
  content: string;
  /**
   * Machine-readable manifest of the snapshot (sorted assertion ids). For a
   * stored snapshot this is the stored manifest — when the content had to be
   * line-trimmed for budget, the manifest still describes the full snapshot.
   */
  assertionIds: string[];
  estimatedTokens: number;
  /** "stored" = latest persisted snapshot; "projected" = on-the-fly projection (not persisted). */
  source: "stored" | "projected";
  trimmed: boolean;
}

/** §4.5 transparency: what the funnel filtered out (never injected). */
export interface OntologyRecallExclusions {
  disputedCount: number;
  /** Ids of disputed facts touching the mentioned entities (capped at 20). */
  disputedAssertionIds: string[];
  supersededCount: number;
  sensitiveExcludedCount: number;
  lowConfidenceCount: number;
}

export interface OntologyRecallResult {
  identity: MemoryIdentity;
  message: string;
  /** Active entities whose canonical name or alias appears in the message. */
  matchedEntities: OntologyEntity[];
  tier1: OntologyRecallTier1;
  /** Tier-2 facts, sorted by score desc (ties by assertion id asc). */
  tier2: OntologyRecalledAssertion[];
  tier2EstimatedTokens: number;
  /** Number of eligible tier-2 facts dropped by budget trimming. */
  tier2DroppedCount: number;
  exclusions: OntologyRecallExclusions;
  /** FR-11 drill-down references: recalled assertion id → evidence count. */
  drillDownHints: Record<string, number>;
  /** FTS supplement lines from the optional MemoryStoreV2 (each prefixed "- "). */
  ftsSupplement: string[];
  totalEstimatedTokens: number;
  trimmed: boolean;
}

export interface OntologyRecallOptions {
  /** Tier-1 token budget (doc range 100～500). Default 300. */
  tier1TokenBudget?: number;
  /** Tier-2 token budget (doc range 500～1500). Default 1000. */
  tier2TokenBudget?: number;
  /** Overall cap across tiers + FTS. Defaults to tier1 + tier2 budgets. */
  totalTokenBudget?: number;
  /** Relation distance: 1 hop by default; 2 only for special scenarios (FR-10). */
  maxHops?: number;
  /** Optional FTS supplement store (FR-09 FTS 补充). */
  ftsStore?: MemoryStoreV2;
  ftsLimit?: number;
}

export interface OntologyRetrieverOptions {
  store: OntologyStore;
  /**
   * Snapshotter used for the on-the-fly tier-1 projection when no stored
   * snapshot exists. Defaults to `createOntologySnapshotter({ store })`.
   */
  snapshotter?: OntologySnapshotter;
  weights?: Partial<OntologyRecallRankingWeights>;
  /** 低置信推断不进上下文: inferred facts need at least this confidence. */
  minInferredConfidence?: number;
  /** Non-inferred facts need at least this confidence. */
  minConfidence?: number;
  /** Include "personal" sensitivity facts (sensitive is never included). */
  includePersonal?: boolean;
  /** Clock injection for deterministic tests. */
  now?: () => string;
}

export interface OntologyDrillDownQuery {
  /** Drill specific assertions (any status — needed to explain transitions). */
  assertionIds?: string[];
  /** Drill every non-candidate, non-retracted assertion touching these entities. */
  entityIds?: string[];
  /** Drill active facts about entities mentioned in this text. */
  query?: string;
  /** Max assertions drilled (default 10, cap 50). */
  limit?: number;
  /** Evidence excerpts are trimmed to this many characters (default 240). */
  maxExcerptChars?: number;
}

export interface OntologyDrillDownAssertion {
  assertion: OntologyAssertion;
  subject?: OntologyEntity;
  objectEntity?: OntologyEntity;
  evidence: OntologyEvidence[];
  /** Episodes linked through the evidence session/run ids. */
  episodes: OntologyEpisode[];
}

export interface OntologyDrillDownResult {
  assertions: OntologyDrillDownAssertion[];
}

export interface OntologyRetriever {
  recall(identity: MemoryIdentity, message: string, options?: OntologyRecallOptions): Promise<OntologyRecallResult>;
  drillDown(identity: MemoryIdentity, query: OntologyDrillDownQuery): Promise<OntologyDrillDownResult>;
}

export function createOntologyRetriever(options: OntologyRetrieverOptions): OntologyRetriever {
  const store = options.store;
  const snapshotter = options.snapshotter ?? createOntologySnapshotter({ store });
  const weights: OntologyRecallRankingWeights = {
    ...DEFAULT_ONTOLOGY_RECALL_RANKING_WEIGHTS,
    ...(options.weights ?? {}),
  };
  const minConfidence = options.minConfidence ?? DEFAULT_ONTOLOGY_RECALL_MIN_CONFIDENCE;
  const minInferredConfidence = options.minInferredConfidence ?? DEFAULT_ONTOLOGY_RECALL_MIN_INFERRED_CONFIDENCE;
  const includePersonal = options.includePersonal === true;
  const now = options.now ?? (() => new Date().toISOString());

  async function recall(
    identityValue: MemoryIdentity,
    message: string,
    recallOptions: OntologyRecallOptions = {},
  ): Promise<OntologyRecallResult> {
    const identity = assertMemoryIdentity(identityValue);
    const text = typeof message === "string" ? message : "";
    const asOf = now();
    const tier1Budget = clampInt(
      recallOptions.tier1TokenBudget,
      DEFAULT_ONTOLOGY_RECALL_TIER1_TOKEN_BUDGET,
      MIN_ONTOLOGY_RECALL_TIER1_TOKEN_BUDGET,
      MAX_ONTOLOGY_RECALL_TIER1_TOKEN_BUDGET,
    );
    const tier2Budget = clampInt(
      recallOptions.tier2TokenBudget,
      DEFAULT_ONTOLOGY_RECALL_TIER2_TOKEN_BUDGET,
      MIN_ONTOLOGY_RECALL_TIER2_TOKEN_BUDGET,
      MAX_ONTOLOGY_RECALL_TIER2_TOKEN_BUDGET,
    );
    const totalBudget = recallOptions.totalTokenBudget !== undefined && Number.isFinite(recallOptions.totalTokenBudget)
      ? Math.max(1, Math.floor(recallOptions.totalTokenBudget))
      : tier1Budget + tier2Budget;
    const maxHops = clampInt(
      recallOptions.maxHops,
      DEFAULT_ONTOLOGY_RECALL_MAX_HOPS,
      1,
      ABSOLUTE_ONTOLOGY_RECALL_MAX_HOPS,
    ) as 1 | 2;

    // ---- Load the working set (identity filter is store-enforced). ----
    const entities = await store.listEntities(identity, { status: "active", limit: 1000 });
    const entitiesById = new Map(entities.map(entity => [entity.id, entity]));
    const activeAssertions = await store.findAssertions(identity, {
      status: "active",
      asOf,
      limit: 1000,
    });
    const supersessions = await store.listSupersessions(identity);
    const supersededByNewId = new Map(
      supersessions.map(link => [link.supersedingAssertionId, link.supersededAssertionId]),
    );

    // ---- Tier 1: profile snapshot (stored, else projected on the fly). ----
    const stored = await store.getLatestSnapshot(identity);
    let tier1Content: string;
    let tier1AssertionIds: string[];
    let tier1Source: "stored" | "projected";
    if (stored !== undefined) {
      tier1Content = stored.content;
      tier1AssertionIds = stored.assertionIds;
      tier1Source = "stored";
    } else {
      const projection = await snapshotter.project(identity);
      tier1Content = projection.content;
      tier1AssertionIds = projection.assertionIds;
      tier1Source = "projected";
    }
    const tier1Lines = tier1Content.split("\n").filter(line => line.trim().length > 0);
    const keptTier1Lines: string[] = [];
    let tier1Tokens = 0;
    for (const line of tier1Lines) {
      const lineTokens = estimateSnapshotTokens(line) + 1;
      if (keptTier1Lines.length > 0 && tier1Tokens + lineTokens > tier1Budget) {
        break;
      }
      keptTier1Lines.push(line);
      tier1Tokens += lineTokens;
    }
    const tier1: OntologyRecallTier1 = {
      content: keptTier1Lines.join("\n"),
      assertionIds: tier1AssertionIds,
      estimatedTokens: estimateSnapshotTokens(keptTier1Lines.join("\n")),
      source: tier1Source,
      trimmed: keptTier1Lines.length < tier1Lines.length,
    };

    // ---- Tier 2: mention matching → direct + hop expansion. ----
    const matchedEntities = matchEntities(entities, text);
    const matchedIds = new Set(matchedEntities.map(entity => entity.id));

    interface Candidate {
      assertion: OntologyAssertion;
      subject: OntologyEntity;
      objectEntity?: OntologyEntity;
      hop: OntologyRecallHop;
    }
    const excluded = { sensitivity: 0, lowConfidence: 0 };
    const isEligible = (assertion: OntologyAssertion): boolean => {
      const subject = entitiesById.get(assertion.subjectId);
      if (subject === undefined) {
        return false;
      }
      const objectEntity = assertion.objectEntityId !== undefined
        ? entitiesById.get(assertion.objectEntityId)
        : undefined;
      if (assertion.objectEntityId !== undefined && objectEntity === undefined) {
        return false;
      }
      if (!isSensitivityEligible(subject, includePersonal)
        || (objectEntity !== undefined && !isSensitivityEligible(objectEntity, includePersonal))) {
        excluded.sensitivity += 1;
        return false;
      }
      if (!isConfidenceEligible(assertion, minConfidence, minInferredConfidence)) {
        excluded.lowConfidence += 1;
        return false;
      }
      return true;
    };
    const eligibleAssertions = activeAssertions.filter(isEligible);
    const touchesAny = (assertion: OntologyAssertion, ids: ReadonlySet<string>): boolean =>
      ids.has(assertion.subjectId)
      || (assertion.objectEntityId !== undefined && ids.has(assertion.objectEntityId));
    const endpointIds = (assertion: OntologyAssertion): string[] =>
      assertion.objectEntityId !== undefined
        ? [assertion.subjectId, assertion.objectEntityId]
        : [assertion.subjectId];

    const selected = new Map<string, Candidate>();
    const directAssertions = eligibleAssertions.filter(assertion => touchesAny(assertion, matchedIds));
    for (const assertion of directAssertions) {
      selected.set(assertion.id, toCandidate(assertion, 0));
    }
    // Hop expansion. The self entity is never used as an expansion endpoint:
    // it is the profile hub and would flood tier 2 with the whole profile.
    let frontier = new Set<string>();
    for (const assertion of directAssertions) {
      for (const id of endpointIds(assertion)) {
        if (!matchedIds.has(id) && entitiesById.get(id)?.canonicalName !== ONTOLOGY_SELF_ENTITY_NAME) {
          frontier.add(id);
        }
      }
    }
    for (let hop = 1; hop <= maxHops && frontier.size > 0; hop += 1) {
      const hopAssertions = eligibleAssertions.filter(
        assertion => !selected.has(assertion.id) && touchesAny(assertion, frontier),
      );
      for (const assertion of hopAssertions) {
        selected.set(assertion.id, toCandidate(assertion, hop as OntologyRecallHop));
      }
      if (hop === maxHops) {
        break;
      }
      const next = new Set<string>();
      for (const assertion of hopAssertions) {
        for (const id of endpointIds(assertion)) {
          if (!matchedIds.has(id) && !frontier.has(id)
            && entitiesById.get(id)?.canonicalName !== ONTOLOGY_SELF_ENTITY_NAME) {
            next.add(id);
          }
        }
      }
      frontier = next;
    }

    function toCandidate(assertion: OntologyAssertion, hop: OntologyRecallHop): Candidate {
      const subject = entitiesById.get(assertion.subjectId)!;
      const objectEntity = assertion.objectEntityId !== undefined
        ? entitiesById.get(assertion.objectEntityId)
        : undefined;
      return {
        assertion,
        subject,
        ...(objectEntity !== undefined ? { objectEntity } : {}),
        hop,
      };
    }

    // ---- FR-10 hybrid ranking. ----
    const ranked = [...selected.values()].map(candidate => ({
      ...candidate,
      score: scoreAssertion(candidate.assertion, candidate.hop, weights, asOf),
    }));
    ranked.sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.assertion.id.localeCompare(right.assertion.id);
    });

    // ---- Transition lines for facts that superseded an older one. ----
    const supersededIds = [...new Set(
      ranked
        .map(candidate => supersededByNewId.get(candidate.assertion.id))
        .filter((id): id is string => id !== undefined),
    )];
    const supersededAssertions = new Map<string, OntologyAssertion>();
    for (const id of supersededIds) {
      const old = await store.getAssertion(identity, id);
      if (old !== undefined) {
        supersededAssertions.set(id, old);
      }
    }
    const oldObjectEntityIds = [...new Set(
      [...supersededAssertions.values()]
        .map(assertion => assertion.objectEntityId)
        .filter((id): id is string => id !== undefined && !entitiesById.has(id)),
    )];
    const oldObjectEntities = new Map<string, OntologyEntity>();
    for (const id of oldObjectEntityIds) {
      const entity = await store.getEntity(identity, id);
      if (entity !== undefined) {
        oldObjectEntities.set(id, entity);
      }
    }
    const recalled: OntologyRecalledAssertion[] = ranked.map(candidate => {
      const supersededId = supersededByNewId.get(candidate.assertion.id);
      const old = supersededId !== undefined ? supersededAssertions.get(supersededId) : undefined;
      const base: OntologyRecalledAssertion = {
        assertion: candidate.assertion,
        subject: candidate.subject,
        ...(candidate.objectEntity !== undefined ? { objectEntity: candidate.objectEntity } : {}),
        score: candidate.score,
        hop: candidate.hop,
      };
      if (supersededId !== undefined && old !== undefined) {
        const oldObjectEntity = old.objectEntityId !== undefined
          ? entitiesById.get(old.objectEntityId) ?? oldObjectEntities.get(old.objectEntityId)
          : undefined;
        base.transition = {
          supersededAssertionId: supersededId,
          line: renderOntologyTransitionLine(candidate.assertion, candidate.subject, candidate.objectEntity, old, oldObjectEntity),
        };
      }
      return base;
    });

    // ---- Tier-2 token budget (drops lowest-scored facts first). ----
    const kept: OntologyRecalledAssertion[] = [];
    let tier2Tokens = 0;
    for (const candidate of recalled) {
      const lineTokens = estimateSnapshotTokens(renderOntologyAssertionLine(candidate.assertion, candidate.subject, candidate.objectEntity)) + 1
        + (candidate.transition !== undefined ? estimateSnapshotTokens(candidate.transition.line) + 1 : 0);
      if (kept.length > 0 && tier2Tokens + lineTokens > tier2Budget) {
        break;
      }
      kept.push(candidate);
      tier2Tokens += lineTokens;
    }

    // ---- FTS supplement (FR-09 FTS 补充). ----
    const ftsSupplement: string[] = [];
    let ftsTokens = 0;
    if (recallOptions.ftsStore !== undefined) {
      const ftsLimit = clampInt(recallOptions.ftsLimit, DEFAULT_ONTOLOGY_RECALL_FTS_LIMIT, 1, 10);
      const results = await recallOptions.ftsStore.search({ identity }, text, ftsLimit);
      for (const result of results) {
        const line = `- ${result.record.content.trim()}`;
        if (line.length > 2) {
          ftsSupplement.push(line);
          ftsTokens += estimateSnapshotTokens(line) + 1;
        }
      }
    }

    // ---- Overall cap: trim tier 2 further (never silently drop tier 1). ----
    let total = tier1.estimatedTokens + tier2Tokens + ftsTokens;
    let trimmed = tier1.trimmed;
    while (kept.length > 0 && total > totalBudget) {
      const dropped = kept.pop()!;
      const droppedTokens = estimateSnapshotTokens(renderOntologyAssertionLine(dropped.assertion, dropped.subject, dropped.objectEntity)) + 1
        + (dropped.transition !== undefined ? estimateSnapshotTokens(dropped.transition.line) + 1 : 0);
      tier2Tokens -= droppedTokens;
      total -= droppedTokens;
      trimmed = true;
    }
    const tier2DroppedCount = recalled.length - kept.length;
    if (tier2DroppedCount > 0) {
      trimmed = true;
    }

    // ---- §4.5 transparency: status-filtered facts touching the mentions. ----
    const [disputed, superseded] = await Promise.all([
      store.findAssertions(identity, { status: "disputed", limit: 1000 }),
      store.findAssertions(identity, { status: "superseded", limit: 1000 }),
    ]);
    const disputedLinked = disputed.filter(assertion => touchesAny(assertion, matchedIds));
    const supersededLinked = superseded.filter(assertion => touchesAny(assertion, matchedIds));

    // ---- FR-11 drill-down references for everything recalled. ----
    const drillDownHints: Record<string, number> = {};
    for (const id of tier1.assertionIds) {
      drillDownHints[id] = activeAssertions.find(assertion => assertion.id === id)?.evidenceIds.length ?? 0;
    }
    for (const candidate of kept) {
      drillDownHints[candidate.assertion.id] = candidate.assertion.evidenceIds.length;
    }

    return {
      identity: { ...identity },
      message: text,
      matchedEntities,
      tier1,
      tier2: kept,
      tier2EstimatedTokens: tier2Tokens,
      tier2DroppedCount,
      exclusions: {
        disputedCount: disputedLinked.length,
        disputedAssertionIds: disputedLinked.slice(0, 20).map(assertion => assertion.id),
        supersededCount: supersededLinked.length,
        sensitiveExcludedCount: excluded.sensitivity,
        lowConfidenceCount: excluded.lowConfidence,
      },
      drillDownHints,
      ftsSupplement,
      totalEstimatedTokens: tier1.estimatedTokens + tier2Tokens + ftsTokens,
      trimmed,
    };
  }

  async function drillDown(
    identityValue: MemoryIdentity,
    query: OntologyDrillDownQuery,
  ): Promise<OntologyDrillDownResult> {
    const identity = assertMemoryIdentity(identityValue);
    const limit = clampInt(query.limit, DEFAULT_ONTOLOGY_DRILL_DOWN_LIMIT, 1, ABSOLUTE_ONTOLOGY_DRILL_DOWN_LIMIT);
    const maxExcerptChars = clampInt(query.maxExcerptChars, DEFAULT_ONTOLOGY_DRILL_DOWN_EXCERPT_CHARS, 40, 4000);

    let assertions: OntologyAssertion[] = [];
    if (query.assertionIds !== undefined && query.assertionIds.length > 0) {
      for (const id of query.assertionIds) {
        const assertion = await store.getAssertion(identity, id);
        if (assertion !== undefined) {
          assertions.push(assertion);
        }
      }
    } else if (query.entityIds !== undefined && query.entityIds.length > 0) {
      const ids = new Set(query.entityIds);
      const found = await store.findAssertions(identity, {
        status: ["active", "disputed", "superseded"],
        limit: 1000,
      });
      assertions = found.filter(assertion =>
        ids.has(assertion.subjectId)
        || (assertion.objectEntityId !== undefined && ids.has(assertion.objectEntityId)));
    } else if (query.query !== undefined) {
      const entities = await store.listEntities(identity, { status: "active", limit: 1000 });
      const matched = matchEntities(entities, query.query);
      const ids = new Set(matched.map(entity => entity.id));
      const found = await store.findAssertions(identity, {
        status: "active",
        asOf: now(),
        limit: 1000,
      });
      assertions = found.filter(assertion =>
        ids.has(assertion.subjectId)
        || (assertion.objectEntityId !== undefined && ids.has(assertion.objectEntityId)));
    }
    assertions = assertions.slice(0, limit);

    const entitiesById = new Map<string, OntologyEntity>();
    const result: OntologyDrillDownAssertion[] = [];
    for (const assertion of assertions) {
      const evidence = await store.getAssertionEvidence(identity, assertion.id);
      const trimmedEvidence = evidence.map(item => ({
        ...item,
        excerpt: trimExcerpt(item.excerpt, maxExcerptChars),
      }));
      const episodes = new Map<string, OntologyEpisode>();
      for (const item of evidence) {
        if (item.sessionId === undefined) {
          continue;
        }
        const sessionEpisodes = await store.listEpisodes(identity, { sessionId: item.sessionId, limit: 20 });
        for (const episode of sessionEpisodes) {
          if (item.runId !== undefined && episode.runId !== item.runId) {
            continue;
          }
          episodes.set(episode.id, episode);
        }
      }
      const subject = await lookupEntity(identity, assertion.subjectId, entitiesById);
      const objectEntity = assertion.objectEntityId !== undefined
        ? await lookupEntity(identity, assertion.objectEntityId, entitiesById)
        : undefined;
      result.push({
        assertion,
        ...(subject !== undefined ? { subject } : {}),
        ...(objectEntity !== undefined ? { objectEntity } : {}),
        evidence: trimmedEvidence,
        episodes: [...episodes.values()],
      });
    }
    return { assertions: result };
  }

  async function lookupEntity(
    identity: MemoryIdentity,
    id: string,
    cache: Map<string, OntologyEntity>,
  ): Promise<OntologyEntity | undefined> {
    const cached = cache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const entity = await store.getEntity(identity, id);
    if (entity !== undefined) {
      cache.set(id, entity);
    }
    return entity;
  }

  return { recall, drillDown };
}

/** Case-insensitive substring match over canonical names and aliases. The self entity never matches. */
function matchEntities(entities: readonly OntologyEntity[], message: string): OntologyEntity[] {
  const text = message.toLowerCase();
  if (text.trim().length === 0) {
    return [];
  }
  const matched: OntologyEntity[] = [];
  for (const entity of entities) {
    if (entity.canonicalName === ONTOLOGY_SELF_ENTITY_NAME) {
      continue;
    }
    const names = [entity.canonicalName, ...entity.aliases];
    if (names.some(name => name.trim().length > 0 && text.includes(name.toLowerCase()))) {
      matched.push(entity);
    }
  }
  return matched;
}

function isSensitivityEligible(entity: OntologyEntity, includePersonal: boolean): boolean {
  if (entity.sensitivity === "sensitive") {
    return false;
  }
  if (entity.sensitivity === "personal" && !includePersonal) {
    return false;
  }
  return true;
}

function isConfidenceEligible(
  assertion: OntologyAssertion,
  minConfidence: number,
  minInferredConfidence: number,
): boolean {
  const threshold = assertion.sourceType === "inferred" ? minInferredConfidence : minConfidence;
  return assertion.confidence >= threshold;
}

/** FR-10 hybrid score: distance base + source bonus + confidence + recency + evidence. */
export function scoreOntologyAssertion(
  assertion: OntologyAssertion,
  hop: OntologyRecallHop,
  weights: OntologyRecallRankingWeights = DEFAULT_ONTOLOGY_RECALL_RANKING_WEIGHTS,
  asOf?: string,
): number {
  return scoreAssertion(assertion, hop, weights, asOf ?? new Date().toISOString());
}

function scoreAssertion(
  assertion: OntologyAssertion,
  hop: OntologyRecallHop,
  weights: OntologyRecallRankingWeights,
  asOf: string,
): number {
  let score = hop === 0 ? weights.directMention : hop === 1 ? weights.oneHop : weights.twoHop;
  if (assertion.sourceType === "explicit") {
    score += weights.explicitSource;
  } else if (assertion.sourceType === "observed") {
    score += weights.observedSource;
  }
  score += assertion.confidence * weights.confidenceScale;
  const updatedAt = Date.parse(assertion.updatedAt);
  const asOfMs = Date.parse(asOf);
  if (Number.isFinite(updatedAt) && Number.isFinite(asOfMs) && asOfMs >= updatedAt) {
    const ageDays = (asOfMs - updatedAt) / 86_400_000;
    score += weights.recencyBoost * Math.pow(0.5, ageDays / weights.recencyHalfLifeDays);
  }
  score += Math.min(assertion.evidenceIds.length, weights.maxEvidenceCount) * weights.evidenceBoost;
  return score;
}

const SELF_DISPLAY_NAME = "用户";

function subjectDisplayName(subject: OntologyEntity): string {
  return subject.canonicalName === ONTOLOGY_SELF_ENTITY_NAME ? SELF_DISPLAY_NAME : subject.canonicalName;
}

function objectDisplayName(
  assertion: OntologyAssertion,
  objectEntity: OntologyEntity | undefined,
): string {
  return objectEntity !== undefined ? objectEntity.canonicalName : String(assertion.objectValue ?? "");
}

/**
 * Natural-language projection of a fact (FR-11 输出格式). Mirrors the
 * snapshotter's line rendering; the snapshotter keeps its own frozen copy
 * because snapshot rebuild verification depends on byte-stable content.
 */
export function renderOntologyAssertionLine(
  assertion: OntologyAssertion,
  subject: OntologyEntity,
  objectEntity: OntologyEntity | undefined,
): string {
  const subjectName = subjectDisplayName(subject);
  const objectName = objectDisplayName(assertion, objectEntity);
  switch (assertion.predicate) {
    case "prefers": return `${subjectName}偏好${objectName}。`;
    case "avoids": return `${subjectName}不喜欢${objectName}。`;
    case "usesTool": return `${subjectName}通常使用${objectName}。`;
    case "worksOn": return `${subjectName}正在参与${objectName}。`;
    case "hasRole": return `${subjectName}的角色是${objectName}。`;
    case "hasSkill": return `${subjectName}掌握${objectName}。`;
    case "hasGoal": return `${subjectName}的目标是${objectName}。`;
    case "madeDecision": return `${subjectName}决定${objectName}。`;
    case "belongsTo": return `${subjectName}隶属于${objectName}。`;
    case "constrainedBy": return `${subjectName}受限于${objectName}。`;
    case "relatedToProject": return `${subjectName}与项目${objectName}相关。`;
    case "supportedByEpisode": return `${subjectName}有相关交互记录：${objectName}。`;
    case "derivedFrom": return `${subjectName}源自${objectName}。`;
    case "supersedes": return `${subjectName}替代了${objectName}。`;
    default: return `${subjectName}${assertion.predicate}${objectName}。`;
  }
}

const TRANSITION_PAST_VERBS: Record<string, string> = {
  prefers: "偏好",
  avoids: "回避",
  usesTool: "使用",
  worksOn: "参与",
  hasRole: "担任",
  hasSkill: "掌握",
  hasGoal: "追求",
  madeDecision: "决定",
  belongsTo: "隶属于",
  constrainedBy: "受限于",
  relatedToProject: "参与项目",
};

/**
 * FR-11 transition line: the current fact is injected, and the superseded
 * fact appears only as historical context ("用户过去使用 X，目前已改用 Y。").
 */
export function renderOntologyTransitionLine(
  newAssertion: OntologyAssertion,
  newSubject: OntologyEntity,
  newObjectEntity: OntologyEntity | undefined,
  oldAssertion: OntologyAssertion,
  oldObjectEntity: OntologyEntity | undefined,
): string {
  const subjectName = subjectDisplayName(newSubject);
  const oldName = objectDisplayName(oldAssertion, oldObjectEntity);
  const newName = objectDisplayName(newAssertion, newObjectEntity);
  const verb = TRANSITION_PAST_VERBS[newAssertion.predicate] ?? "使用";
  const replacement = newAssertion.predicate === "usesTool" ? "已改用" : "已改为";
  return `${subjectName}过去${verb}${oldName}，目前${replacement}${newName}。`;
}

function trimExcerpt(excerpt: string, maxChars: number): string {
  return excerpt.length <= maxChars ? excerpt : `${excerpt.slice(0, maxChars)}…`;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(min, Math.floor(value)), max);
}
