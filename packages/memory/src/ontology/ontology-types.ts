import type { LoongLifecycleHookRequest, MemoryIdentity } from "@loong/core";

/**
 * Phase 2 of the ontology memory upgrade (docs/ONTOLOGY_MEMORY_REQUIREMENTS.md
 * §4.2, §5, §6): core ontology data models.
 *
 * The `OntologyEntity` / `OntologyAssertion` / `OntologyEvidence` /
 * `UserProfileSnapshot` interfaces follow doc §6 exactly. `OntologyEpisode`
 * follows doc §4.2 (raw interaction record). The `supersedes` relation from
 * FR-07 is stored by the backend (SQLite: `supersedes_assertion_id` column)
 * and surfaced as `OntologySupersession` records so the §6 interfaces stay
 * exact.
 */

/** §4.3 事实来源类型. */
export type AssertionSourceType = "explicit" | "observed" | "inferred" | "imported";

export type OntologyEntityStatus = "active" | "merged" | "deleted";

export type OntologyAssertionStatus =
  | "candidate"
  | "active"
  | "disputed"
  | "superseded"
  | "retracted";

export type OntologySensitivity = "normal" | "personal" | "sensitive";

/** §6.1 Entity. */
export interface OntologyEntity {
  id: string;
  identity: MemoryIdentity;
  type: string;
  canonicalName: string;
  aliases: string[];
  status: OntologyEntityStatus;
  sensitivity: OntologySensitivity;
  createdAt: string;
  updatedAt: string;
}

/** §6.2 Assertion. */
export interface OntologyAssertion {
  id: string;
  identity: MemoryIdentity;

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

  createdAt: string;
  updatedAt: string;
}

/** §6.3 Evidence. */
export interface OntologyEvidence {
  id: string;
  identity: MemoryIdentity;
  sessionId?: string;
  runId?: string;
  messageId?: string;
  source: string;
  excerpt: string;
  capturedAt: string;
}

/**
 * §6.4 Profile Snapshot. A rebuildable projection for context injection —
 * never the source of truth. Phase 2 only defines the model and storage;
 * generation logic lands in Phase 3 (FR-08).
 */
export interface UserProfileSnapshot {
  identity: MemoryIdentity;
  version: number;
  content: string;
  assertionIds: string[];
  estimatedTokens: number;
  generatedAt: string;
}

/** §4.2 Episode: raw interaction record. */
export interface OntologyEpisode {
  id: string;
  identity: MemoryIdentity;
  sessionId: string;
  runId: string;
  messageIds: string[];
  summary?: string;
  excerpt?: string;
  capturedAt: string;
}

/**
 * FR-07 supersession link (`new assertion supersedes old assertion`). Kept
 * outside `OntologyAssertion` so the §6.2 interface stays exact; the store
 * persists it as assertion metadata.
 */
export interface OntologySupersession {
  supersededAssertionId: string;
  supersedingAssertionId: string;
  createdAt: string;
}

/**
 * Structured extraction output produced by an ontology candidate extractor
 * (FR-04). Entity references use names (canonical or alias); the resolver is
 * responsible for alias resolution and entity creation. `predicate` and the
 * entity `type` values MUST come from the controlled vocabulary
 * (ontology-vocabulary.ts); unknown values are rejected at write time.
 */
export interface OntologyEntityRef {
  type: string;
  name: string;
  aliases?: string[];
}

export interface OntologyCandidateDraft {
  subject: OntologyEntityRef;
  predicate: string;
  objectEntity?: OntologyEntityRef;
  objectValue?: string | number | boolean;
  sourceType: AssertionSourceType;
  confidence?: number;
  sensitivity?: OntologySensitivity;
  /** Raw excerpt backing this candidate (FR-04 保留原始 Evidence). Required. */
  excerpt: string;
  reason?: string;
}

/**
 * Pluggable extraction contract (FR-04). Implementations must be deterministic
 * for a given turn; the default heuristic extractor is
 * `createHeuristicOntologyExtractor`.
 */
export type OntologyCandidateExtractor = (
  turn: Readonly<LoongLifecycleHookRequest>,
) => OntologyCandidateDraft[];

export function isAssertionSourceType(value: unknown): value is AssertionSourceType {
  return value === "explicit" || value === "observed" || value === "inferred" || value === "imported";
}

export function isOntologyEntityStatus(value: unknown): value is OntologyEntityStatus {
  return value === "active" || value === "merged" || value === "deleted";
}

export function isOntologyAssertionStatus(value: unknown): value is OntologyAssertionStatus {
  return value === "candidate"
    || value === "active"
    || value === "disputed"
    || value === "superseded"
    || value === "retracted";
}

export function isOntologySensitivity(value: unknown): value is OntologySensitivity {
  return value === "normal" || value === "personal" || value === "sensitive";
}
