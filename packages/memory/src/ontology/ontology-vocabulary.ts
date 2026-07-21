import { MemoryToolError } from "../memory-tool-error.js";

/**
 * Phase 2 (doc §5): controlled ontology vocabulary.
 *
 * The first-phase ontology deliberately uses a closed vocabulary. Models and
 * extractors MUST NOT mint new entity types or predicates
 * ("首期关系应采用受控词表，禁止模型随意生成无限的新谓词"); unknown values are
 * rejected at write time by the validator.
 */

/** §5.1 首期实体类型. */
export const ONTOLOGY_ENTITY_TYPES = [
  "Person",
  "Organization",
  "Project",
  "Role",
  "Skill",
  "Tool",
  "Model",
  "Preference",
  "Constraint",
  "Goal",
  "Decision",
  "CommunicationStyle",
  "Episode",
] as const;

export type OntologyEntityType = (typeof ONTOLOGY_ENTITY_TYPES)[number];

/** §5.2 首期关系类型. */
export const ONTOLOGY_PREDICATES = [
  "worksOn",
  "belongsTo",
  "hasRole",
  "hasSkill",
  "usesTool",
  "prefers",
  "avoids",
  "hasGoal",
  "madeDecision",
  "constrainedBy",
  "relatedToProject",
  "supportedByEpisode",
  "derivedFrom",
  "supersedes",
] as const;

export type OntologyPredicate = (typeof ONTOLOGY_PREDICATES)[number];

const entityTypeSet: ReadonlySet<string> = new Set(ONTOLOGY_ENTITY_TYPES);
const predicateSet: ReadonlySet<string> = new Set(ONTOLOGY_PREDICATES);

export function isOntologyEntityType(value: unknown): value is OntologyEntityType {
  return typeof value === "string" && entityTypeSet.has(value);
}

export function isOntologyPredicate(value: unknown): value is OntologyPredicate {
  return typeof value === "string" && predicateSet.has(value);
}

export function assertOntologyEntityType(value: unknown, field = "entity type"): OntologyEntityType {
  if (!isOntologyEntityType(value)) {
    throw new MemoryToolError(
      `Unknown ontology ${field}: ${String(value)}. Controlled vocabulary only (${ONTOLOGY_ENTITY_TYPES.join(", ")}).`,
    );
  }
  return value;
}

export function assertOntologyPredicate(value: unknown, field = "predicate"): OntologyPredicate {
  if (!isOntologyPredicate(value)) {
    throw new MemoryToolError(
      `Unknown ontology ${field}: ${String(value)}. Controlled vocabulary only (${ONTOLOGY_PREDICATES.join(", ")}).`,
    );
  }
  return value;
}
