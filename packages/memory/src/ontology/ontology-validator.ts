import { MemoryToolError } from "../memory-tool-error.js";
import { isIsoTimestamp } from "../memory-util.js";
import type {
  OntologyAssertionWrite,
  OntologyEntityWrite,
} from "./ontology-store.js";
import type { OntologyEntity } from "./ontology-types.js";
import {
  isAssertionSourceType,
  isOntologyAssertionStatus,
  isOntologyEntityStatus,
  isOntologySensitivity,
} from "./ontology-types.js";
import { assertOntologyEntityType, assertOntologyPredicate } from "./ontology-vocabulary.js";

/**
 * Phase 2 FR-06 step 7 (结构约束验证): structural validation for ontology
 * writes. The validator is pure — entity existence is supplied by the caller
 * (store/resolver) so the rules stay backend-agnostic.
 */

export interface AssertionWriteValidationContext {
  /** Resolved subject entity; undefined when the id does not exist. */
  subject: OntologyEntity | undefined;
  /** Resolved object entity when `objectEntityId` is set. */
  objectEntity?: OntologyEntity | undefined;
}

export function validateOntologyEntityWrite(write: OntologyEntityWrite): void {
  assertOntologyEntityType(write.type);
  if (typeof write.canonicalName !== "string" || !write.canonicalName.trim()) {
    throw new MemoryToolError("Ontology entity canonicalName cannot be empty.");
  }
  if (write.canonicalName.trim().length > 200) {
    throw new MemoryToolError("Ontology entity canonicalName must be 200 characters or fewer.");
  }
  if (write.status !== undefined && !isOntologyEntityStatus(write.status)) {
    throw new MemoryToolError("Invalid ontology entity status.");
  }
  if (write.sensitivity !== undefined && !isOntologySensitivity(write.sensitivity)) {
    throw new MemoryToolError("Invalid ontology entity sensitivity.");
  }
  if (write.aliases !== undefined) {
    for (const alias of write.aliases) {
      if (typeof alias !== "string" || !alias.trim() || alias.trim().length > 200) {
        throw new MemoryToolError("Ontology entity aliases must be non-empty strings of 200 characters or fewer.");
      }
    }
  }
}

/**
 * Structural rules for assertion writes:
 *
 * - subject must reference an existing, non-merged, non-deleted entity; the
 *   object entity (when `objectEntityId` is set) must also exist and be active.
 * - predicate must come from the controlled vocabulary (§5.2).
 * - exactly one object form (entity or literal value) must be present.
 * - confidence must be a finite number in [0, 1].
 * - every active assertion must carry evidence (§11.2); candidates also
 *   require evidence because FR-04 demands raw evidence retention.
 * - `inferred` + `sensitive` is rejected (§10 敏感属性默认禁止模型推断).
 * - validFrom/validTo must be ISO timestamps with validFrom <= validTo.
 */
export function validateOntologyAssertionWrite(
  write: OntologyAssertionWrite,
  context: AssertionWriteValidationContext,
): void {
  assertOntologyPredicate(write.predicate);

  if (typeof write.subjectId !== "string" || !write.subjectId.trim()) {
    throw new MemoryToolError("Ontology assertion subjectId cannot be empty.");
  }
  if (context.subject === undefined) {
    throw new MemoryToolError("Ontology assertion subject must reference an existing entity.");
  }
  if (context.subject.status !== "active") {
    throw new MemoryToolError(
      `Ontology assertion subject entity is ${context.subject.status}; new assertions require an active subject entity.`,
    );
  }

  const hasObjectEntity = write.objectEntityId !== undefined && write.objectEntityId.trim() !== "";
  const hasObjectValue = write.objectValue !== undefined;
  if (hasObjectEntity === hasObjectValue) {
    throw new MemoryToolError(
      "Ontology assertion requires exactly one object form: objectEntityId or objectValue.",
    );
  }
  if (hasObjectEntity) {
    if (context.objectEntity === undefined) {
      throw new MemoryToolError("Ontology assertion objectEntityId must reference an existing entity.");
    }
    if (context.objectEntity.status !== "active") {
      throw new MemoryToolError(
        `Ontology assertion object entity is ${context.objectEntity.status}; assertions require an active object entity.`,
      );
    }
  }
  if (hasObjectValue) {
    const valueType = typeof write.objectValue;
    if (valueType !== "string" && valueType !== "number" && valueType !== "boolean") {
      throw new MemoryToolError("Ontology assertion objectValue must be a string, number, or boolean.");
    }
    if (valueType === "number" && !Number.isFinite(write.objectValue as number)) {
      throw new MemoryToolError("Ontology assertion objectValue number must be finite.");
    }
    if (valueType === "string" && (write.objectValue as string).trim().length === 0) {
      throw new MemoryToolError("Ontology assertion objectValue string cannot be empty.");
    }
  }

  if (!Number.isFinite(write.confidence) || write.confidence < 0 || write.confidence > 1) {
    throw new MemoryToolError("Ontology assertion confidence must be a finite number between 0 and 1.");
  }
  if (!isAssertionSourceType(write.sourceType)) {
    throw new MemoryToolError("Invalid ontology assertion sourceType.");
  }
  if (!isOntologyAssertionStatus(write.status)) {
    throw new MemoryToolError("Invalid ontology assertion status.");
  }

  if (!Array.isArray(write.evidenceIds) || write.evidenceIds.some(id => typeof id !== "string" || !id.trim())) {
    throw new MemoryToolError("Ontology assertion evidenceIds must be an array of non-empty strings.");
  }
  // §11.2: every active Assertion has Evidence. Candidates also always carry
  // evidence (FR-04 保留原始 Evidence); superseded/retracted rows keep the
  // evidence they already had.
  if ((write.status === "active" || write.status === "candidate" || write.status === "disputed")
    && write.evidenceIds.length === 0) {
    throw new MemoryToolError(`Ontology assertion with status "${write.status}" must reference at least one evidence record.`);
  }

  if (write.validFrom !== undefined && !isIsoTimestamp(write.validFrom)) {
    throw new MemoryToolError("Ontology assertion validFrom must be an ISO timestamp.");
  }
  if (write.validTo !== undefined && !isIsoTimestamp(write.validTo)) {
    throw new MemoryToolError("Ontology assertion validTo must be an ISO timestamp.");
  }
  if (write.validFrom !== undefined && write.validTo !== undefined && write.validFrom > write.validTo) {
    throw new MemoryToolError("Ontology assertion validFrom must be before or equal to validTo.");
  }
}

/**
 * §10 sensitivity rule: inferred facts may never target sensitive attributes
 * (敏感属性默认禁止模型推断). Checked separately because sensitivity lives on
 * the entity, while sourceType lives on the assertion.
 */
export function validateAssertionSensitivity(
  sourceType: string,
  sensitivity: string | undefined,
): void {
  if (sourceType === "inferred" && sensitivity === "sensitive") {
    throw new MemoryToolError(
      "Inferred ontology assertions must not target sensitive attributes (doc §10).",
    );
  }
}
