import type { MemoryIdentity } from "@loong/core";
import { assertMemoryIdentity } from "../memory-store-v2.js";
import { MemoryToolError } from "../memory-tool-error.js";
import type { OntologyStore, OntologyWriteMeta } from "./ontology-store.js";
import type { OntologyAssertion, OntologyEntity, UserProfileSnapshot } from "./ontology-types.js";
import { ONTOLOGY_PREDICATES } from "./ontology-vocabulary.js";

/**
 * Phase 3 (FR-08, §6.4): Profile Snapshot generation and reversible rebuild
 * verification.
 *
 * A snapshot is a compressed, rebuildable projection of the user's currently
 * valid, stable, high-confidence, non-sensitive assertions (§4.6 可逆语义压缩).
 * It is a cache for context injection — NEVER a fact source: every content
 * line is a pure function of the assertions listed in `assertionIds` plus
 * their entity names, so `assertionIds` itself serves as the machine-readable
 * manifest (no hidden state). `verify` regenerates the projection from the
 * current assertion set and proves the stored snapshot matches it (§11.3
 * 重建一致率 100%).
 *
 * Selection rules (defaults configurable):
 * - status === "active";
 * - currently valid: validFrom <= now and (validTo unset or > now);
 * - confidence >= 0.6 for explicit/observed/imported; inferred facts need
 *   >= 0.8 (低置信推断不进画像, §7.4 FR-11);
 * - sensitivity: any participating entity (subject or object) with
 *   "sensitive" sensitivity excludes the fact; "personal" is excluded unless
 *   `includePersonal` is set (§10 默认不注入敏感属性);
 * - content capped at `maxLines` highest-ranked lines.
 */

export const DEFAULT_SNAPSHOT_MIN_CONFIDENCE = 0.6;
export const DEFAULT_SNAPSHOT_MIN_INFERRED_CONFIDENCE = 0.8;
export const DEFAULT_SNAPSHOT_MAX_LINES = 30;
export const ONTOLOGY_SNAPSHOT_FORMAT_VERSION = "ontology-snapshot/v1";

export interface OntologySnapshotSelection {
  minConfidence?: number;
  minInferredConfidence?: number;
  includePersonal?: boolean;
  maxLines?: number;
}

/** Pure projection of a snapshot — no timestamps, no persistence. */
export interface OntologySnapshotProjection {
  content: string;
  /** Sorted assertion ids included in `content` (the manifest). */
  assertionIds: string[];
  estimatedTokens: number;
}

export interface OntologySnapshotRebuildVerification {
  ok: boolean;
  stored?: UserProfileSnapshot;
  projectedAssertionIds: string[];
  projectedContent: string;
  mismatches: string[];
}

export interface OntologySnapshotterOptions extends OntologySnapshotSelection {
  store: OntologyStore;
  /** Clock injection for deterministic tests. */
  now?: () => string;
}

export interface OntologySnapshotter {
  /** Compute the pure projection for the current assertion set. */
  project(identity: MemoryIdentity): Promise<OntologySnapshotProjection>;
  /** Project, bump the version and persist via `store.putSnapshot`. */
  generate(identity: MemoryIdentity, meta?: OntologyWriteMeta): Promise<UserProfileSnapshot>;
  /** §11.3: prove the stored snapshot equals a fresh projection of the current assertions. */
  verify(identity: MemoryIdentity): Promise<OntologySnapshotRebuildVerification>;
}

export function createOntologySnapshotter(options: OntologySnapshotterOptions): OntologySnapshotter {
  const selection = normalizeSelection(options);
  const now = options.now ?? (() => new Date().toISOString());
  const store = options.store;

  async function project(identityValue: MemoryIdentity): Promise<OntologySnapshotProjection> {
    const identity = assertMemoryIdentity(identityValue);
    const asOf = now();
    const assertions = await store.findAssertions(identity, {
      status: "active",
      asOf,
      limit: 1000,
    });
    const entities = await store.listEntities(identity, { limit: 1000 });
    const entitiesById = new Map(entities.map(entity => [entity.id, entity]));

    const eligible: { assertion: OntologyAssertion; line: string }[] = [];
    for (const assertion of assertions) {
      const subject = entitiesById.get(assertion.subjectId);
      if (subject === undefined || subject.status !== "active") {
        continue;
      }
      const objectEntity = assertion.objectEntityId !== undefined
        ? entitiesById.get(assertion.objectEntityId)
        : undefined;
      if (assertion.objectEntityId !== undefined && objectEntity === undefined) {
        continue;
      }
      if (!isConfidenceEligible(assertion, selection)) {
        continue;
      }
      if (!isSensitivityEligible(subject, selection) || (objectEntity !== undefined && !isSensitivityEligible(objectEntity, selection))) {
        continue;
      }
      eligible.push({
        assertion,
        line: `- ${renderAssertionLine(assertion, subject, objectEntity)}`,
      });
    }

    // Deterministic order: controlled predicate order → confidence desc → id asc.
    eligible.sort((left, right) => {
      const predicateOrder = (PREDICATE_ORDER.get(left.assertion.predicate as never) ?? Number.MAX_SAFE_INTEGER)
        - (PREDICATE_ORDER.get(right.assertion.predicate as never) ?? Number.MAX_SAFE_INTEGER);
      if (predicateOrder !== 0) {
        return predicateOrder;
      }
      if (left.assertion.confidence !== right.assertion.confidence) {
        return right.assertion.confidence - left.assertion.confidence;
      }
      return left.assertion.id.localeCompare(right.assertion.id);
    });
    const selected = eligible.slice(0, selection.maxLines);
    const content = selected.map(entry => entry.line).join("\n");
    return {
      content,
      assertionIds: selected.map(entry => entry.assertion.id).sort(),
      estimatedTokens: estimateSnapshotTokens(content),
    };
  }

  async function generate(identityValue: MemoryIdentity, meta: OntologyWriteMeta = {}): Promise<UserProfileSnapshot> {
    const identity = assertMemoryIdentity(identityValue);
    const projection = await project(identity);
    const latest = await store.getLatestSnapshot(identity);
    const snapshot: UserProfileSnapshot = {
      identity: { ...identity },
      version: (latest?.version ?? 0) + 1,
      content: projection.content,
      assertionIds: projection.assertionIds,
      estimatedTokens: projection.estimatedTokens,
      generatedAt: now(),
    };
    return await store.putSnapshot(identity, snapshot, {
      operator: meta.operator?.trim() ? meta.operator.trim() : "ontology_snapshot",
      ...(meta.source !== undefined ? { source: meta.source } : {}),
      detail: { format: ONTOLOGY_SNAPSHOT_FORMAT_VERSION, ...(meta.detail ?? {}) },
    });
  }

  async function verify(identityValue: MemoryIdentity): Promise<OntologySnapshotRebuildVerification> {
    const identity = assertMemoryIdentity(identityValue);
    const stored = await store.getLatestSnapshot(identity);
    const projection = await project(identity);
    const mismatches: string[] = [];
    if (stored === undefined) {
      mismatches.push("No stored snapshot exists for this identity.");
    } else {
      if (stored.content !== projection.content) {
        mismatches.push("Snapshot content differs from a fresh projection of the current assertions.");
      }
      if (stored.assertionIds.join(",") !== projection.assertionIds.join(",")) {
        mismatches.push("Snapshot assertionIds differ from a fresh projection of the current assertions.");
      }
    }
    const verification: OntologySnapshotRebuildVerification = {
      ok: mismatches.length === 0,
      projectedAssertionIds: projection.assertionIds,
      projectedContent: projection.content,
      mismatches,
    };
    if (stored !== undefined) {
      verification.stored = stored;
    }
    return verification;
  }

  return { project, generate, verify };
}

/** Convenience one-shot wrapper around `createOntologySnapshotter`. */
export async function generateProfileSnapshot(
  store: OntologyStore,
  identity: MemoryIdentity,
  options: OntologySnapshotSelection & { now?: () => string; meta?: OntologyWriteMeta } = {},
): Promise<UserProfileSnapshot> {
  const { meta, ...rest } = options;
  return await createOntologySnapshotter({ store, ...rest }).generate(identity, meta);
}

/** Convenience one-shot wrapper around `createOntologySnapshotter`. */
export async function verifySnapshotRebuild(
  store: OntologyStore,
  identity: MemoryIdentity,
  options: OntologySnapshotSelection & { now?: () => string } = {},
): Promise<OntologySnapshotRebuildVerification> {
  return await createOntologySnapshotter({ store, ...options }).verify(identity);
}

interface NormalizedSelection {
  minConfidence: number;
  minInferredConfidence: number;
  includePersonal: boolean;
  maxLines: number;
}

function normalizeSelection(options: OntologySnapshotSelection): NormalizedSelection {
  const minConfidence = options.minConfidence ?? DEFAULT_SNAPSHOT_MIN_CONFIDENCE;
  const minInferredConfidence = options.minInferredConfidence ?? DEFAULT_SNAPSHOT_MIN_INFERRED_CONFIDENCE;
  const maxLines = options.maxLines ?? DEFAULT_SNAPSHOT_MAX_LINES;
  for (const [name, value] of [["minConfidence", minConfidence], ["minInferredConfidence", minInferredConfidence]] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new MemoryToolError(`Ontology snapshot ${name} must be a finite number between 0 and 1.`);
    }
  }
  if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 200) {
    throw new MemoryToolError("Ontology snapshot maxLines must be an integer between 1 and 200.");
  }
  return {
    minConfidence,
    minInferredConfidence,
    includePersonal: options.includePersonal === true,
    maxLines,
  };
}

function isConfidenceEligible(assertion: OntologyAssertion, selection: NormalizedSelection): boolean {
  const threshold = assertion.sourceType === "inferred"
    ? selection.minInferredConfidence
    : selection.minConfidence;
  return assertion.confidence >= threshold;
}

function isSensitivityEligible(entity: OntologyEntity, selection: NormalizedSelection): boolean {
  if (entity.sensitivity === "sensitive") {
    return false;
  }
  if (entity.sensitivity === "personal" && !selection.includePersonal) {
    return false;
  }
  return true;
}

const SELF_DISPLAY_NAME = "用户";

const PREDICATE_ORDER = new Map(ONTOLOGY_PREDICATES.map((predicate, index) => [predicate, index]));

function renderAssertionLine(
  assertion: OntologyAssertion,
  subject: OntologyEntity,
  objectEntity: OntologyEntity | undefined,
): string {
  const subjectName = subject.canonicalName === "self" ? SELF_DISPLAY_NAME : subject.canonicalName;
  const objectName = objectEntity !== undefined ? objectEntity.canonicalName : String(assertion.objectValue ?? "");
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

/**
 * Rough token estimator for snapshot content. CJK characters (and CJK
 * punctuation/fullwidth forms) count ~1 token each; other characters count
 * ~1/4 token (the common Latin heuristic). Documented as an estimate only —
 * it budgets context injection, it does not bill anyone.
 */
export function estimateSnapshotTokens(content: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of content) {
    if (/[㐀-䶿一-鿿豈-﫿　-〿＀-￯]/u.test(char)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.ceil(cjk + other / 4);
}
