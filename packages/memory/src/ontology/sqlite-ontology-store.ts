import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { MemoryIdentity } from "@loong/core";
import { assertMemoryIdentity } from "../memory-store-v2.js";
import { MemoryToolError } from "../memory-tool-error.js";
import { clampPositiveInteger, isObject, stringifyJson } from "../memory-util.js";
import type {
  OntologyAssertionFilter,
  OntologyAssertionPatch,
  OntologyAssertionWrite,
  OntologyAuditAction,
  OntologyAuditEntryWrite,
  OntologyAuditFilter,
  OntologyAuditRecord,
  OntologyAuditRecordKind,
  OntologyCandidateReview,
  OntologyEntityFilter,
  OntologyEntityWrite,
  OntologyEpisodeWrite,
  OntologyEvidenceWrite,
  OntologyStore,
  OntologyWriteMeta,
} from "./ontology-store.js";
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
import {
  isAssertionSourceType,
  isOntologyAssertionStatus,
  isOntologyEntityStatus,
  isOntologySensitivity,
} from "./ontology-types.js";
import { validateAssertionSensitivity, validateOntologyAssertionWrite, validateOntologyEntityWrite } from "./ontology-validator.js";

export interface SqliteOntologyStoreOptions {
  rootDir?: string;
  databasePath?: string;
}

export const DEFAULT_ONTOLOGY_LIST_LIMIT = 100;
export const ABSOLUTE_ONTOLOGY_LIST_LIMIT = 1000;

export function createSqliteOntologyStore(options: SqliteOntologyStoreOptions = {}): OntologyStore {
  return new SqliteOntologyStore(options);
}

/**
 * Identity-isolated SQLite ontology backend (FR-02, §9).
 *
 * Nine tables (ontology_entities, ontology_entity_aliases,
 * ontology_assertions, ontology_evidence, ontology_assertion_evidence,
 * ontology_episodes, ontology_snapshots, ontology_candidate_reviews,
 * ontology_audit_log). EVERY statement is forced through
 * `tenant_id + user_id`; identity is asserted before any storage access, the
 * same posture as `SqliteMemoryStoreV2`. Every mutation appends an audit row
 * (operator/source per §10) inside the same transaction.
 */
export class SqliteOntologyStore implements OntologyStore {
  readonly #rootDir: string;
  readonly #databasePath: string;
  readonly #memoryOnly: boolean;
  #database: DatabaseSync | undefined;
  #databasePromise: Promise<DatabaseSync> | undefined;

  constructor(options: SqliteOntologyStoreOptions = {}) {
    const defaultRootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".loong", "memory"));
    this.#memoryOnly = options.databasePath === ":memory:";
    this.#databasePath = this.#memoryOnly
      ? ":memory:"
      : path.resolve(options.databasePath ?? path.join(defaultRootDir, "ontology-v2.sqlite"));
    this.#rootDir = this.#memoryOnly ? defaultRootDir : path.dirname(this.#databasePath);
  }

  // ---------------------------------------------------------------- entities

  async insertEntity(
    identityValue: MemoryIdentity,
    write: OntologyEntityWrite,
    meta: OntologyWriteMeta = {},
  ): Promise<OntologyEntity> {
    const identity = assertMemoryIdentity(identityValue);
    validateOntologyEntityWrite(write);
    const now = new Date().toISOString();
    const entity = buildEntity(identity, write, now);
    const database = await this.#getDatabase();
    this.#transaction(database, () => {
      database.prepare(`
        INSERT INTO ontology_entities (
          tenant_id, user_id, agent_instance_id, id, type, canonical_name, status, sensitivity, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        identity.tenantId,
        identity.userId,
        identity.agentInstanceId ?? null,
        entity.id,
        entity.type,
        entity.canonicalName,
        entity.status,
        entity.sensitivity,
        entity.createdAt,
        entity.updatedAt,
      );
      this.#replaceAliasRows(database, identity, entity);
      this.#appendAudit(database, identity, "insert_entity", "entity", entity.id, meta, now);
    });
    return entity;
  }

  async updateEntity(
    identityValue: MemoryIdentity,
    entity: OntologyEntity,
    meta: OntologyWriteMeta = {},
  ): Promise<OntologyEntity> {
    const identity = assertMemoryIdentity(identityValue);
    validateOntologyEntityWrite(entity);
    const existing = await this.getEntity(identity, entity.id);
    if (existing === undefined) {
      throw new MemoryToolError(`Ontology entity not found: ${entity.id}`);
    }
    const now = new Date().toISOString();
    const updated: OntologyEntity = {
      ...existing,
      canonicalName: entity.canonicalName.trim(),
      aliases: normalizeAliases(entity.aliases),
      status: entity.status,
      sensitivity: entity.sensitivity,
      updatedAt: now,
    };
    const database = await this.#getDatabase();
    this.#transaction(database, () => {
      database.prepare(`
        UPDATE ontology_entities
        SET canonical_name = ?, status = ?, sensitivity = ?, updated_at = ?
        WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).run(
        updated.canonicalName,
        updated.status,
        updated.sensitivity,
        updated.updatedAt,
        identity.tenantId,
        identity.userId,
        updated.id,
      );
      database.prepare(`
        DELETE FROM ontology_entity_aliases
        WHERE tenant_id = ? AND user_id = ? AND entity_id = ?
      `).run(identity.tenantId, identity.userId, updated.id);
      this.#replaceAliasRows(database, identity, updated);
      this.#appendAudit(database, identity, "update_entity", "entity", updated.id, meta, now);
    });
    return updated;
  }

  async getEntity(identityValue: MemoryIdentity, id: string): Promise<OntologyEntity | undefined> {
    const identity = assertMemoryIdentity(identityValue);
    const normalizedId = normalizeId(id, "entity id");
    const database = await this.#getDatabase();
    const row = database.prepare(`
      SELECT id, type, canonical_name, status, sensitivity, created_at, updated_at
      FROM ontology_entities
      WHERE tenant_id = ? AND user_id = ? AND id = ?
    `).get(identity.tenantId, identity.userId, normalizedId);
    if (row === undefined) {
      return undefined;
    }
    return this.#rowToEntity(database, identity, row);
  }

  async findEntitiesByName(identityValue: MemoryIdentity, name: string): Promise<OntologyEntity[]> {
    const identity = assertMemoryIdentity(identityValue);
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new MemoryToolError("Ontology entity name cannot be empty.");
    }
    const database = await this.#getDatabase();
    const rows = database.prepare(`
      SELECT id, type, canonical_name, status, sensitivity, created_at, updated_at
      FROM ontology_entities
      WHERE tenant_id = ? AND user_id = ? AND canonical_name = ? COLLATE NOCASE
      UNION
      SELECT e.id, e.type, e.canonical_name, e.status, e.sensitivity, e.created_at, e.updated_at
      FROM ontology_entity_aliases a
      JOIN ontology_entities e
        ON e.tenant_id = a.tenant_id AND e.user_id = a.user_id AND e.id = a.entity_id
      WHERE a.tenant_id = ? AND a.user_id = ? AND a.alias = ? COLLATE NOCASE
    `).all(identity.tenantId, identity.userId, normalizedName, identity.tenantId, identity.userId, normalizedName);
    return rows.map(row => this.#rowToEntity(database, identity, row));
  }

  async listEntities(identityValue: MemoryIdentity, filter: OntologyEntityFilter = {}): Promise<OntologyEntity[]> {
    const identity = assertMemoryIdentity(identityValue);
    const limit = clampPositiveInteger(filter.limit, DEFAULT_ONTOLOGY_LIST_LIMIT, ABSOLUTE_ONTOLOGY_LIST_LIMIT);
    const database = await this.#getDatabase();
    const conditions = ["tenant_id = ?", "user_id = ?"];
    const params: (string | number)[] = [identity.tenantId, identity.userId];
    if (filter.type !== undefined) {
      conditions.push("type = ?");
      params.push(filter.type);
    }
    if (filter.status !== undefined) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    params.push(limit);
    const rows = database.prepare(`
      SELECT id, type, canonical_name, status, sensitivity, created_at, updated_at
      FROM ontology_entities
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...params);
    return rows.map(row => this.#rowToEntity(database, identity, row));
  }

  // -------------------------------------------------------------- assertions

  async insertAssertion(
    identityValue: MemoryIdentity,
    write: OntologyAssertionWrite,
    meta: OntologyWriteMeta = {},
  ): Promise<OntologyAssertion> {
    const identity = assertMemoryIdentity(identityValue);
    const subject = await this.getEntity(identity, write.subjectId);
    const objectEntity = write.objectEntityId !== undefined
      ? await this.getEntity(identity, write.objectEntityId)
      : undefined;
    validateOntologyAssertionWrite(write, { subject, ...(objectEntity !== undefined ? { objectEntity } : {}) });
    validateAssertionSensitivity(write.sourceType, subject?.sensitivity);
    const now = new Date().toISOString();
    const database = await this.#getDatabase();
    const assertion = buildAssertion(identity, write, now);
    this.#assertEvidenceExists(database, identity, write.evidenceIds);
    this.#transaction(database, () => {
      this.#insertAssertionRow(database, identity, assertion);
      this.#replaceAssertionEvidenceRows(database, identity, assertion.id, assertion.evidenceIds, now);
      this.#appendAudit(database, identity, "insert_assertion", "assertion", assertion.id, meta, now);
    });
    return assertion;
  }

  async getAssertion(identityValue: MemoryIdentity, id: string): Promise<OntologyAssertion | undefined> {
    const identity = assertMemoryIdentity(identityValue);
    const normalizedId = normalizeId(id, "assertion id");
    const database = await this.#getDatabase();
    const row = database.prepare(`
      SELECT id, subject_id, predicate, object_entity_id, object_value, confidence, source_type, status,
             valid_from, valid_to, created_at, updated_at
      FROM ontology_assertions
      WHERE tenant_id = ? AND user_id = ? AND id = ?
    `).get(identity.tenantId, identity.userId, normalizedId);
    if (row === undefined) {
      return undefined;
    }
    return this.#rowToAssertion(database, identity, row);
  }

  async findAssertions(
    identityValue: MemoryIdentity,
    filter: OntologyAssertionFilter = {},
  ): Promise<OntologyAssertion[]> {
    const identity = assertMemoryIdentity(identityValue);
    const limit = clampPositiveInteger(filter.limit, DEFAULT_ONTOLOGY_LIST_LIMIT, ABSOLUTE_ONTOLOGY_LIST_LIMIT);
    const database = await this.#getDatabase();
    const { conditions, params } = assertionFilterConditions(identity, filter);
    params.push(limit);
    const rows = database.prepare(`
      SELECT id, subject_id, predicate, object_entity_id, object_value, confidence, source_type, status,
             valid_from, valid_to, created_at, updated_at
      FROM ontology_assertions
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...params);
    return rows.map(row => this.#rowToAssertion(database, identity, row));
  }

  async countAssertions(
    identityValue: MemoryIdentity,
    filter: OntologyAssertionFilter = {},
  ): Promise<number> {
    const identity = assertMemoryIdentity(identityValue);
    const database = await this.#getDatabase();
    const { conditions, params } = assertionFilterConditions(identity, filter);
    const row = database.prepare(`
      SELECT COUNT(*) AS count
      FROM ontology_assertions
      WHERE ${conditions.join(" AND ")}
    `).get(...params);
    return typeof row?.count === "number" ? row.count : 0;
  }

  async repointEntityAssertions(
    identityValue: MemoryIdentity,
    fromEntityId: string,
    toEntityId: string,
    meta: OntologyWriteMeta = {},
    onlyAssertionIds?: readonly string[],
  ): Promise<number> {
    const identity = assertMemoryIdentity(identityValue);
    const fromId = normalizeId(fromEntityId, "from entity id");
    const toId = normalizeId(toEntityId, "to entity id");
    if (fromId === toId) {
      throw new MemoryToolError("Cannot re-point assertions from an entity to itself.");
    }
    const database = await this.#getDatabase();
    const now = new Date().toISOString();
    let repointed = 0;
    this.#transaction(database, () => {
      for (const id of [fromId, toId]) {
        const row = database.prepare(`
          SELECT id FROM ontology_entities
          WHERE tenant_id = ? AND user_id = ? AND id = ?
        `).get(identity.tenantId, identity.userId, id);
        if (row === undefined) {
          throw new MemoryToolError(`Ontology entity not found: ${id}`);
        }
      }
      const changedIds = new Set<string>();
      if (onlyAssertionIds !== undefined) {
        // Phase 5 unmerge: re-point exactly the recorded assertion set.
        for (const assertionId of onlyAssertionIds) {
          const subjectResult = database.prepare(`
            UPDATE ontology_assertions
            SET subject_id = ?, updated_at = ?
            WHERE tenant_id = ? AND user_id = ? AND id = ? AND subject_id = ?
          `).run(toId, now, identity.tenantId, identity.userId, assertionId, fromId);
          const objectResult = database.prepare(`
            UPDATE ontology_assertions
            SET object_entity_id = ?, updated_at = ?
            WHERE tenant_id = ? AND user_id = ? AND id = ? AND object_entity_id = ?
          `).run(toId, now, identity.tenantId, identity.userId, assertionId, fromId);
          if (Number(subjectResult.changes) + Number(objectResult.changes) > 0) {
            changedIds.add(assertionId);
          }
          repointed += Number(subjectResult.changes) + Number(objectResult.changes);
        }
      } else {
        const affected = database.prepare(`
          SELECT id FROM ontology_assertions
          WHERE tenant_id = ? AND user_id = ? AND (subject_id = ? OR object_entity_id = ?)
        `).all(identity.tenantId, identity.userId, fromId, fromId);
        for (const row of affected) {
          const id = readRequiredText(row, "id", "ontology_assertions");
          changedIds.add(id);
        }
        const subjectResult = database.prepare(`
          UPDATE ontology_assertions
          SET subject_id = ?, updated_at = ?
          WHERE tenant_id = ? AND user_id = ? AND subject_id = ?
        `).run(toId, now, identity.tenantId, identity.userId, fromId);
        const objectResult = database.prepare(`
          UPDATE ontology_assertions
          SET object_entity_id = ?, updated_at = ?
          WHERE tenant_id = ? AND user_id = ? AND object_entity_id = ?
        `).run(toId, now, identity.tenantId, identity.userId, fromId);
        repointed = Number(subjectResult.changes) + Number(objectResult.changes);
      }
      const assertionIds = [...changedIds].sort();
      this.#appendAudit(database, identity, "repoint_assertions", "entity", fromId, {
        ...meta,
        detail: {
          ...(meta.detail ?? {}),
          toEntityId: toId,
          assertionIds: assertionIds.slice(0, 200),
          assertionIdsTruncated: assertionIds.length > 200,
        },
      }, now);
    });
    return repointed;
  }

  async updateAssertion(
    identityValue: MemoryIdentity,
    id: string,
    patch: OntologyAssertionPatch,
    meta: OntologyWriteMeta = {},
  ): Promise<OntologyAssertion> {
    const identity = assertMemoryIdentity(identityValue);
    const normalizedId = normalizeId(id, "assertion id");
    const database = await this.#getDatabase();
    const now = new Date().toISOString();
    let updated: OntologyAssertion | undefined;
    this.#transaction(database, () => {
      const row = database.prepare(`
        SELECT id, subject_id, predicate, object_entity_id, object_value, confidence, source_type, status,
               valid_from, valid_to, created_at, updated_at
        FROM ontology_assertions
        WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).get(identity.tenantId, identity.userId, normalizedId);
      if (row === undefined) {
        throw new MemoryToolError(`Ontology assertion not found: ${normalizedId}`);
      }
      const current = this.#rowToAssertion(database, identity, row);
      if (patch.status !== undefined && !isOntologyAssertionStatus(patch.status)) {
        throw new MemoryToolError("Invalid ontology assertion status.");
      }
      if (patch.confidence !== undefined
        && (!Number.isFinite(patch.confidence) || patch.confidence < 0 || patch.confidence > 1)) {
        throw new MemoryToolError("Ontology assertion confidence must be a finite number between 0 and 1.");
      }
      if (patch.validFrom !== undefined) {
        const parsed = Date.parse(patch.validFrom);
        if (Number.isNaN(parsed)) {
          throw new MemoryToolError("Ontology assertion validFrom must be an ISO timestamp.");
        }
      }
      if (patch.validTo !== undefined) {
        const parsed = Date.parse(patch.validTo);
        if (Number.isNaN(parsed)) {
          throw new MemoryToolError("Ontology assertion validTo must be an ISO timestamp.");
        }
      }
      const nextEvidenceIds = [...current.evidenceIds];
      for (const evidenceId of patch.addEvidenceIds ?? []) {
        if (!nextEvidenceIds.includes(evidenceId)) {
          nextEvidenceIds.push(evidenceId);
        }
      }
      // §11.2: an active assertion must always carry evidence.
      const nextStatus = patch.status ?? current.status;
      if ((nextStatus === "active" || nextStatus === "candidate" || nextStatus === "disputed")
        && nextEvidenceIds.length === 0) {
        throw new MemoryToolError(`Ontology assertion with status "${nextStatus}" must reference at least one evidence record.`);
      }
      this.#assertEvidenceExists(database, identity, patch.addEvidenceIds ?? []);
      updated = {
        ...current,
        status: nextStatus,
        confidence: patch.confidence ?? current.confidence,
        evidenceIds: nextEvidenceIds,
        updatedAt: now,
      };
      if (patch.validFrom !== undefined) {
        updated.validFrom = patch.validFrom;
      }
      if (patch.validTo !== undefined) {
        updated.validTo = patch.validTo;
      }
      database.prepare(`
        UPDATE ontology_assertions
        SET status = ?, confidence = ?, valid_from = ?, valid_to = ?, updated_at = ?
        WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).run(
        updated.status,
        updated.confidence,
        updated.validFrom ?? null,
        updated.validTo ?? null,
        updated.updatedAt,
        identity.tenantId,
        identity.userId,
        updated.id,
      );
      if ((patch.addEvidenceIds ?? []).length > 0) {
        this.#replaceAssertionEvidenceRows(database, identity, updated.id, updated.evidenceIds, now);
      }
      this.#appendAudit(database, identity, "update_assertion", "assertion", updated.id, meta, now);
    });
    if (updated === undefined) {
      throw new MemoryToolError(`Ontology assertion not found: ${normalizedId}`);
    }
    return updated;
  }

  async supersedeAssertion(
    identityValue: MemoryIdentity,
    supersededId: string,
    supersedingId: string,
    meta: OntologyWriteMeta = {},
  ): Promise<void> {
    const identity = assertMemoryIdentity(identityValue);
    const oldId = normalizeId(supersededId, "superseded assertion id");
    const newId = normalizeId(supersedingId, "superseding assertion id");
    if (oldId === newId) {
      throw new MemoryToolError("An ontology assertion cannot supersede itself.");
    }
    const database = await this.#getDatabase();
    const now = new Date().toISOString();
    this.#transaction(database, () => {
      const oldRow = database.prepare(`
        SELECT status, valid_to FROM ontology_assertions
        WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).get(identity.tenantId, identity.userId, oldId);
      if (oldRow === undefined) {
        throw new MemoryToolError(`Ontology assertion not found: ${oldId}`);
      }
      const newRow = database.prepare(`
        SELECT id FROM ontology_assertions
        WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).get(identity.tenantId, identity.userId, newId);
      if (newRow === undefined) {
        throw new MemoryToolError(`Ontology assertion not found: ${newId}`);
      }
      // §4.4: keep history — the old assertion is marked superseded and keeps
      // its evidence; its validity window closes at the supersession time.
      database.prepare(`
        UPDATE ontology_assertions
        SET status = 'superseded', valid_to = COALESCE(valid_to, ?), updated_at = ?
        WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).run(now, now, identity.tenantId, identity.userId, oldId);
      database.prepare(`
        UPDATE ontology_assertions
        SET supersedes_assertion_id = ?, updated_at = ?
        WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).run(oldId, now, identity.tenantId, identity.userId, newId);
      this.#appendAudit(database, identity, "supersede_assertion", "assertion", oldId, {
        ...meta,
        detail: { ...(meta.detail ?? {}), supersededBy: newId },
      }, now);
    });
  }

  async listSupersessions(identityValue: MemoryIdentity): Promise<OntologySupersession[]> {
    const identity = assertMemoryIdentity(identityValue);
    const database = await this.#getDatabase();
    const rows = database.prepare(`
      SELECT id, supersedes_assertion_id, updated_at
      FROM ontology_assertions
      WHERE tenant_id = ? AND user_id = ? AND supersedes_assertion_id IS NOT NULL
      ORDER BY updated_at ASC, id ASC
    `).all(identity.tenantId, identity.userId);
    return rows.map(row => ({
      supersededAssertionId: readRequiredText(row, "supersedes_assertion_id", "ontology_assertions"),
      supersedingAssertionId: readRequiredText(row, "id", "ontology_assertions"),
      createdAt: readRequiredText(row, "updated_at", "ontology_assertions"),
    }));
  }

  // ---------------------------------------------------------------- evidence

  async insertEvidence(
    identityValue: MemoryIdentity,
    write: OntologyEvidenceWrite,
    meta: OntologyWriteMeta = {},
  ): Promise<OntologyEvidence> {
    const identity = assertMemoryIdentity(identityValue);
    if (typeof write.source !== "string" || !write.source.trim()) {
      throw new MemoryToolError("Ontology evidence source cannot be empty.");
    }
    if (typeof write.excerpt !== "string" || !write.excerpt.trim()) {
      throw new MemoryToolError("Ontology evidence excerpt cannot be empty.");
    }
    const now = new Date().toISOString();
    const evidence: OntologyEvidence = {
      id: write.id ?? `evd_${randomUUID()}`,
      identity: { ...identity },
      source: write.source.trim(),
      excerpt: write.excerpt,
      capturedAt: write.capturedAt ?? now,
    };
    if (write.sessionId !== undefined) {
      evidence.sessionId = write.sessionId;
    }
    if (write.runId !== undefined) {
      evidence.runId = write.runId;
    }
    if (write.messageId !== undefined) {
      evidence.messageId = write.messageId;
    }
    const database = await this.#getDatabase();
    this.#transaction(database, () => {
      database.prepare(`
        INSERT INTO ontology_evidence (
          tenant_id, user_id, agent_instance_id, id, session_id, run_id, message_id, source, excerpt, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        identity.tenantId,
        identity.userId,
        identity.agentInstanceId ?? null,
        evidence.id,
        evidence.sessionId ?? null,
        evidence.runId ?? null,
        evidence.messageId ?? null,
        evidence.source,
        evidence.excerpt,
        evidence.capturedAt,
      );
      this.#appendAudit(database, identity, "insert_evidence", "evidence", evidence.id, {
        // §10: the audit log must not record full sensitive evidence; only ids.
        ...(meta.operator !== undefined ? { operator: meta.operator } : {}),
        ...(meta.source !== undefined ? { source: meta.source } : {}),
      }, now);
    });
    return evidence;
  }

  async getEvidence(identityValue: MemoryIdentity, id: string): Promise<OntologyEvidence | undefined> {
    const identity = assertMemoryIdentity(identityValue);
    const normalizedId = normalizeId(id, "evidence id");
    const database = await this.#getDatabase();
    const row = database.prepare(`
      SELECT id, session_id, run_id, message_id, source, excerpt, captured_at
      FROM ontology_evidence
      WHERE tenant_id = ? AND user_id = ? AND id = ?
    `).get(identity.tenantId, identity.userId, normalizedId);
    return row === undefined ? undefined : this.#rowToEvidence(identity, row);
  }

  async getAssertionEvidence(identityValue: MemoryIdentity, assertionId: string): Promise<OntologyEvidence[]> {
    const identity = assertMemoryIdentity(identityValue);
    const normalizedId = normalizeId(assertionId, "assertion id");
    const database = await this.#getDatabase();
    const rows = database.prepare(`
      SELECT e.id, e.session_id, e.run_id, e.message_id, e.source, e.excerpt, e.captured_at
      FROM ontology_assertion_evidence ae
      JOIN ontology_evidence e
        ON e.tenant_id = ae.tenant_id AND e.user_id = ae.user_id AND e.id = ae.evidence_id
      WHERE ae.tenant_id = ? AND ae.user_id = ? AND ae.assertion_id = ?
      ORDER BY ae.created_at ASC, ae.evidence_id ASC
    `).all(identity.tenantId, identity.userId, normalizedId);
    return rows.map(row => this.#rowToEvidence(identity, row));
  }

  // ---------------------------------------------------------------- episodes

  async insertEpisode(
    identityValue: MemoryIdentity,
    write: OntologyEpisodeWrite,
    meta: OntologyWriteMeta = {},
  ): Promise<OntologyEpisode> {
    const identity = assertMemoryIdentity(identityValue);
    if (typeof write.sessionId !== "string" || !write.sessionId.trim()) {
      throw new MemoryToolError("Ontology episode sessionId cannot be empty.");
    }
    if (typeof write.runId !== "string" || !write.runId.trim()) {
      throw new MemoryToolError("Ontology episode runId cannot be empty.");
    }
    const now = new Date().toISOString();
    const episode: OntologyEpisode = {
      id: write.id ?? `epi_${randomUUID()}`,
      identity: { ...identity },
      sessionId: write.sessionId.trim(),
      runId: write.runId.trim(),
      messageIds: (write.messageIds ?? []).map(id => id.trim()).filter(id => id.length > 0),
      capturedAt: write.capturedAt ?? now,
    };
    if (write.summary !== undefined) {
      episode.summary = write.summary;
    }
    if (write.excerpt !== undefined) {
      episode.excerpt = write.excerpt;
    }
    const database = await this.#getDatabase();
    this.#transaction(database, () => {
      database.prepare(`
        INSERT INTO ontology_episodes (
          tenant_id, user_id, agent_instance_id, id, session_id, run_id, message_ids_json, summary, excerpt, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        identity.tenantId,
        identity.userId,
        identity.agentInstanceId ?? null,
        episode.id,
        episode.sessionId,
        episode.runId,
        stringifyJson(episode.messageIds),
        episode.summary ?? null,
        episode.excerpt ?? null,
        episode.capturedAt,
      );
      this.#appendAudit(database, identity, "insert_episode", "episode", episode.id, {
        ...(meta.operator !== undefined ? { operator: meta.operator } : {}),
        ...(meta.source !== undefined ? { source: meta.source } : {}),
      }, now);
    });
    return episode;
  }

  async getEpisode(identityValue: MemoryIdentity, id: string): Promise<OntologyEpisode | undefined> {
    const identity = assertMemoryIdentity(identityValue);
    const normalizedId = normalizeId(id, "episode id");
    const database = await this.#getDatabase();
    const row = database.prepare(`
      SELECT id, session_id, run_id, message_ids_json, summary, excerpt, captured_at
      FROM ontology_episodes
      WHERE tenant_id = ? AND user_id = ? AND id = ?
    `).get(identity.tenantId, identity.userId, normalizedId);
    return row === undefined ? undefined : this.#rowToEpisode(identity, row);
  }

  async listEpisodes(
    identityValue: MemoryIdentity,
    filter: { sessionId?: string; limit?: number } = {},
  ): Promise<OntologyEpisode[]> {
    const identity = assertMemoryIdentity(identityValue);
    const limit = clampPositiveInteger(filter.limit, DEFAULT_ONTOLOGY_LIST_LIMIT, ABSOLUTE_ONTOLOGY_LIST_LIMIT);
    const database = await this.#getDatabase();
    const conditions = ["tenant_id = ?", "user_id = ?"];
    const params: (string | number)[] = [identity.tenantId, identity.userId];
    if (filter.sessionId !== undefined) {
      conditions.push("session_id = ?");
      params.push(filter.sessionId);
    }
    params.push(limit);
    const rows = database.prepare(`
      SELECT id, session_id, run_id, message_ids_json, summary, excerpt, captured_at
      FROM ontology_episodes
      WHERE ${conditions.join(" AND ")}
      ORDER BY captured_at ASC, id ASC
      LIMIT ?
    `).all(...params);
    return rows.map(row => this.#rowToEpisode(identity, row));
  }

  async countEpisodes(identityValue: MemoryIdentity): Promise<number> {
    const identity = assertMemoryIdentity(identityValue);
    const database = await this.#getDatabase();
    const row = database.prepare(`
      SELECT COUNT(*) AS count
      FROM ontology_episodes
      WHERE tenant_id = ? AND user_id = ?
    `).get(identity.tenantId, identity.userId);
    return typeof row?.count === "number" ? row.count : 0;
  }

  // --------------------------------------------------------------- snapshots

  async putSnapshot(
    identityValue: MemoryIdentity,
    snapshot: UserProfileSnapshot,
    meta: OntologyWriteMeta = {},
  ): Promise<UserProfileSnapshot> {
    const identity = assertMemoryIdentity(identityValue);
    if (!Number.isInteger(snapshot.version) || snapshot.version < 1) {
      throw new MemoryToolError("Ontology snapshot version must be a positive integer.");
    }
    if (typeof snapshot.content !== "string" || !snapshot.content.trim()) {
      throw new MemoryToolError("Ontology snapshot content cannot be empty.");
    }
    const database = await this.#getDatabase();
    const now = new Date().toISOString();
    this.#transaction(database, () => {
      database.prepare(`
        INSERT INTO ontology_snapshots (
          tenant_id, user_id, version, content, assertion_ids_json, estimated_tokens, generated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (tenant_id, user_id, version) DO UPDATE SET
          content = excluded.content,
          assertion_ids_json = excluded.assertion_ids_json,
          estimated_tokens = excluded.estimated_tokens,
          generated_at = excluded.generated_at
      `).run(
        identity.tenantId,
        identity.userId,
        snapshot.version,
        snapshot.content,
        stringifyJson(snapshot.assertionIds),
        Math.max(0, Math.floor(snapshot.estimatedTokens)),
        snapshot.generatedAt,
      );
      this.#appendAudit(database, identity, "put_snapshot", "snapshot", `v${snapshot.version}`, meta, now);
    });
    return { ...snapshot, identity: { ...identity } };
  }

  async getLatestSnapshot(identityValue: MemoryIdentity): Promise<UserProfileSnapshot | undefined> {
    const identity = assertMemoryIdentity(identityValue);
    const database = await this.#getDatabase();
    const row = database.prepare(`
      SELECT version, content, assertion_ids_json, estimated_tokens, generated_at
      FROM ontology_snapshots
      WHERE tenant_id = ? AND user_id = ?
      ORDER BY version DESC
      LIMIT 1
    `).get(identity.tenantId, identity.userId);
    if (row === undefined) {
      return undefined;
    }
    return {
      identity: { ...identity },
      version: readRequiredNumber(row, "version", "ontology_snapshots"),
      content: readRequiredText(row, "content", "ontology_snapshots"),
      assertionIds: readStringArray(row, "assertion_ids_json", "ontology_snapshots"),
      estimatedTokens: readRequiredNumber(row, "estimated_tokens", "ontology_snapshots"),
      generatedAt: readRequiredText(row, "generated_at", "ontology_snapshots"),
    };
  }

  // ----------------------------------------------------------------- reviews

  async putCandidateReview(
    identityValue: MemoryIdentity,
    review: { key: string; decision: "dont_ask"; reason?: string },
    meta: OntologyWriteMeta = {},
  ): Promise<OntologyCandidateReview> {
    const identity = assertMemoryIdentity(identityValue);
    const key = review.key.trim();
    if (!key) {
      throw new MemoryToolError("Ontology candidate review key cannot be empty.");
    }
    if (review.decision !== "dont_ask") {
      throw new MemoryToolError("Invalid ontology candidate review decision.");
    }
    const database = await this.#getDatabase();
    const now = new Date().toISOString();
    this.#transaction(database, () => {
      database.prepare(`
        INSERT INTO ontology_candidate_reviews (
          tenant_id, user_id, key, decision, reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (tenant_id, user_id, key) DO UPDATE SET
          decision = excluded.decision,
          reason = excluded.reason,
          updated_at = excluded.updated_at
      `).run(
        identity.tenantId,
        identity.userId,
        key,
        review.decision,
        review.reason ?? null,
        now,
        now,
      );
      this.#appendAudit(database, identity, "put_review", "review", key, meta, now);
    });
    const stored = await this.getCandidateReview(identity, key);
    if (stored === undefined) {
      throw new MemoryToolError("Ontology candidate review could not be stored.");
    }
    return stored;
  }

  async getCandidateReview(
    identityValue: MemoryIdentity,
    key: string,
  ): Promise<OntologyCandidateReview | undefined> {
    const identity = assertMemoryIdentity(identityValue);
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new MemoryToolError("Ontology candidate review key cannot be empty.");
    }
    const database = await this.#getDatabase();
    const row = database.prepare(`
      SELECT key, decision, reason, created_at, updated_at
      FROM ontology_candidate_reviews
      WHERE tenant_id = ? AND user_id = ? AND key = ?
    `).get(identity.tenantId, identity.userId, normalizedKey);
    if (row === undefined) {
      return undefined;
    }
    const record: OntologyCandidateReview = {
      key: readRequiredText(row, "key", "ontology_candidate_reviews"),
      decision: "dont_ask",
      createdAt: readRequiredText(row, "created_at", "ontology_candidate_reviews"),
      updatedAt: readRequiredText(row, "updated_at", "ontology_candidate_reviews"),
    };
    const reason = readOptionalText(row, "reason", "ontology_candidate_reviews");
    if (reason !== undefined) {
      record.reason = reason;
    }
    return record;
  }

  // -------------------------------------------------------------------- audit

  async listAuditEntries(
    identityValue: MemoryIdentity,
    filter: OntologyAuditFilter = {},
  ): Promise<OntologyAuditRecord[]> {
    const identity = assertMemoryIdentity(identityValue);
    const limit = clampPositiveInteger(filter.limit, DEFAULT_ONTOLOGY_LIST_LIMIT, ABSOLUTE_ONTOLOGY_LIST_LIMIT);
    const database = await this.#getDatabase();
    const conditions = ["tenant_id = ?", "user_id = ?"];
    const params: (string | number)[] = [identity.tenantId, identity.userId];
    if (filter.recordKind !== undefined) {
      conditions.push("record_kind = ?");
      params.push(filter.recordKind);
    }
    if (filter.recordId !== undefined) {
      conditions.push("record_id = ?");
      params.push(filter.recordId);
    }
    params.push(limit);
    const rows = database.prepare(`
      SELECT seq, agent_instance_id, action, record_kind, record_id, operator, source, detail_json, created_at
      FROM ontology_audit_log
      WHERE ${conditions.join(" AND ")}
      ORDER BY seq ASC
      LIMIT ?
    `).all(...params);
    return rows.map(row => {
      const record: OntologyAuditRecord = {
        seq: readRequiredNumber(row, "seq", "ontology_audit_log"),
        identity: { ...identity },
        action: readRequiredText(row, "action", "ontology_audit_log") as OntologyAuditAction,
        recordKind: readRequiredText(row, "record_kind", "ontology_audit_log") as OntologyAuditRecordKind,
        recordId: readRequiredText(row, "record_id", "ontology_audit_log"),
        operator: readRequiredText(row, "operator", "ontology_audit_log"),
        createdAt: readRequiredText(row, "created_at", "ontology_audit_log"),
      };
      const source = readOptionalText(row, "source", "ontology_audit_log");
      if (source !== undefined) {
        record.source = source;
      }
      const detailJson = readOptionalText(row, "detail_json", "ontology_audit_log");
      if (detailJson !== undefined) {
        try {
          const parsed: unknown = JSON.parse(detailJson);
          if (isObject(parsed)) {
            record.detail = parsed;
          }
        } catch {
          // Ignore malformed audit detail; the row itself is still valid.
        }
      }
      return record;
    });
  }

  async recordAuditEntry(identityValue: MemoryIdentity, entry: OntologyAuditEntryWrite): Promise<void> {
    const identity = assertMemoryIdentity(identityValue);
    if (typeof entry.recordId !== "string" || !entry.recordId.trim()) {
      throw new MemoryToolError("Ontology audit entry recordId cannot be empty.");
    }
    const database = await this.#getDatabase();
    const now = new Date().toISOString();
    this.#transaction(database, () => {
      this.#appendAudit(database, identity, entry.action, entry.recordKind, entry.recordId.trim(), {
        ...(entry.operator !== undefined ? { operator: entry.operator } : {}),
        ...(entry.source !== undefined ? { source: entry.source } : {}),
        ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
      }, now);
    });
  }

  close(): void {
    this.#database?.close();
    this.#database = undefined;
    this.#databasePromise = undefined;
  }

  // ------------------------------------------------------ Phase 5 queries

  async findAssertionsByEvidence(identityValue: MemoryIdentity, evidenceId: string): Promise<OntologyAssertion[]> {
    const identity = assertMemoryIdentity(identityValue);
    const normalizedId = normalizeId(evidenceId, "evidence id");
    const database = await this.#getDatabase();
    const rows = database.prepare(`
      SELECT a.id, a.subject_id, a.predicate, a.object_entity_id, a.object_value, a.confidence, a.source_type, a.status,
             a.valid_from, a.valid_to, a.created_at, a.updated_at
      FROM ontology_assertion_evidence ae
      JOIN ontology_assertions a
        ON a.tenant_id = ae.tenant_id AND a.user_id = ae.user_id AND a.id = ae.assertion_id
      WHERE ae.tenant_id = ? AND ae.user_id = ? AND ae.evidence_id = ?
      ORDER BY a.created_at ASC, a.id ASC
    `).all(identity.tenantId, identity.userId, normalizedId);
    return rows.map(row => this.#rowToAssertion(database, identity, row));
  }

  async listEvidence(identityValue: MemoryIdentity, filter: { limit?: number } = {}): Promise<OntologyEvidence[]> {
    const identity = assertMemoryIdentity(identityValue);
    const limit = clampPositiveInteger(filter.limit, ABSOLUTE_ONTOLOGY_LIST_LIMIT, ABSOLUTE_ONTOLOGY_LIST_LIMIT);
    const database = await this.#getDatabase();
    const rows = database.prepare(`
      SELECT id, session_id, run_id, message_id, source, excerpt, captured_at
      FROM ontology_evidence
      WHERE tenant_id = ? AND user_id = ?
      ORDER BY captured_at ASC, id ASC
      LIMIT ?
    `).all(identity.tenantId, identity.userId, limit);
    return rows.map(row => this.#rowToEvidence(identity, row));
  }

  // ---------------------------------------------------- Phase 5 deletions

  async deleteEvidence(identityValue: MemoryIdentity, evidenceId: string, meta: OntologyWriteMeta = {}): Promise<void> {
    const identity = assertMemoryIdentity(identityValue);
    const normalizedId = normalizeId(evidenceId, "evidence id");
    const database = await this.#getDatabase();
    const now = new Date().toISOString();
    this.#transaction(database, () => {
      const existing = database.prepare(`
        SELECT id FROM ontology_evidence
        WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).get(identity.tenantId, identity.userId, normalizedId);
      if (existing === undefined) {
        throw new MemoryToolError(`Ontology evidence not found: ${normalizedId}`);
      }
      database.prepare(`
        DELETE FROM ontology_assertion_evidence
        WHERE tenant_id = ? AND user_id = ? AND evidence_id = ?
      `).run(identity.tenantId, identity.userId, normalizedId);
      database.prepare(`
        DELETE FROM ontology_evidence
        WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).run(identity.tenantId, identity.userId, normalizedId);
      // §10: audit carries ids/reasons only — never the deleted excerpt.
      this.#appendAudit(database, identity, "delete_evidence", "evidence", normalizedId, meta, now);
    });
  }

  async deleteAssertions(
    identityValue: MemoryIdentity,
    assertionIds: readonly string[],
    meta: OntologyWriteMeta = {},
  ): Promise<number> {
    const identity = assertMemoryIdentity(identityValue);
    const database = await this.#getDatabase();
    const now = new Date().toISOString();
    let deleted = 0;
    this.#transaction(database, () => {
      for (const assertionId of assertionIds) {
        const normalizedId = normalizeId(assertionId, "assertion id");
        const existing = database.prepare(`
          SELECT id FROM ontology_assertions
          WHERE tenant_id = ? AND user_id = ? AND id = ?
        `).get(identity.tenantId, identity.userId, normalizedId);
        if (existing === undefined) {
          continue;
        }
        database.prepare(`
          DELETE FROM ontology_assertion_evidence
          WHERE tenant_id = ? AND user_id = ? AND assertion_id = ?
        `).run(identity.tenantId, identity.userId, normalizedId);
        database.prepare(`
          DELETE FROM ontology_assertions
          WHERE tenant_id = ? AND user_id = ? AND id = ?
        `).run(identity.tenantId, identity.userId, normalizedId);
        deleted += 1;
        this.#appendAudit(database, identity, "delete_assertions", "assertion", normalizedId, meta, now);
      }
    });
    return deleted;
  }

  async deleteEntity(identityValue: MemoryIdentity, entityId: string, meta: OntologyWriteMeta = {}): Promise<void> {
    const identity = assertMemoryIdentity(identityValue);
    const normalizedId = normalizeId(entityId, "entity id");
    const database = await this.#getDatabase();
    const now = new Date().toISOString();
    this.#transaction(database, () => {
      const existing = database.prepare(`
        SELECT id FROM ontology_entities
        WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).get(identity.tenantId, identity.userId, normalizedId);
      if (existing === undefined) {
        throw new MemoryToolError(`Ontology entity not found: ${normalizedId}`);
      }
      database.prepare(`
        DELETE FROM ontology_entity_aliases
        WHERE tenant_id = ? AND user_id = ? AND entity_id = ?
      `).run(identity.tenantId, identity.userId, normalizedId);
      database.prepare(`
        DELETE FROM ontology_entities
        WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).run(identity.tenantId, identity.userId, normalizedId);
      this.#appendAudit(database, identity, "delete_entity", "entity", normalizedId, meta, now);
    });
  }

  async deleteEpisodes(
    identityValue: MemoryIdentity,
    filter: { sessionId?: string } = {},
    meta: OntologyWriteMeta = {},
  ): Promise<number> {
    const identity = assertMemoryIdentity(identityValue);
    const database = await this.#getDatabase();
    const now = new Date().toISOString();
    let deleted = 0;
    this.#transaction(database, () => {
      const result = filter.sessionId !== undefined
        ? database.prepare(`
            DELETE FROM ontology_episodes
            WHERE tenant_id = ? AND user_id = ? AND session_id = ?
          `).run(identity.tenantId, identity.userId, filter.sessionId)
        : database.prepare(`
            DELETE FROM ontology_episodes
            WHERE tenant_id = ? AND user_id = ?
          `).run(identity.tenantId, identity.userId);
      deleted = Number(result.changes);
      this.#appendAudit(database, identity, "delete_episodes", "episode", filter.sessionId ?? "*", {
        ...meta,
        detail: { ...(meta.detail ?? {}), deleted },
      }, now);
    });
    return deleted;
  }

  async deleteSnapshots(identityValue: MemoryIdentity, meta: OntologyWriteMeta = {}): Promise<number> {
    const identity = assertMemoryIdentity(identityValue);
    const database = await this.#getDatabase();
    const now = new Date().toISOString();
    let deleted = 0;
    this.#transaction(database, () => {
      const result = database.prepare(`
        DELETE FROM ontology_snapshots
        WHERE tenant_id = ? AND user_id = ?
      `).run(identity.tenantId, identity.userId);
      deleted = Number(result.changes);
      this.#appendAudit(database, identity, "delete_snapshots", "snapshot", "*", {
        ...meta,
        detail: { ...(meta.detail ?? {}), deleted },
      }, now);
    });
    return deleted;
  }

  async deleteCandidateReviews(identityValue: MemoryIdentity, meta: OntologyWriteMeta = {}): Promise<number> {
    const identity = assertMemoryIdentity(identityValue);
    const database = await this.#getDatabase();
    const now = new Date().toISOString();
    let deleted = 0;
    this.#transaction(database, () => {
      const result = database.prepare(`
        DELETE FROM ontology_candidate_reviews
        WHERE tenant_id = ? AND user_id = ?
      `).run(identity.tenantId, identity.userId);
      deleted = Number(result.changes);
      this.#appendAudit(database, identity, "delete_candidate_reviews", "review", "*", {
        ...meta,
        detail: { ...(meta.detail ?? {}), deleted },
      }, now);
    });
    return deleted;
  }

  // ------------------------------------------------------------------ helpers

  #replaceAliasRows(database: DatabaseSync, identity: MemoryIdentity, entity: OntologyEntity): void {
    const now = entity.updatedAt;
    for (const alias of entity.aliases) {
      database.prepare(`
        INSERT OR IGNORE INTO ontology_entity_aliases (tenant_id, user_id, entity_id, alias, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(identity.tenantId, identity.userId, entity.id, alias, now);
    }
  }

  #insertAssertionRow(database: DatabaseSync, identity: MemoryIdentity, assertion: OntologyAssertion): void {
    database.prepare(`
      INSERT INTO ontology_assertions (
        tenant_id, user_id, agent_instance_id, id, subject_id, predicate, object_entity_id, object_value,
        confidence, source_type, status, valid_from, valid_to, supersedes_assertion_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      identity.tenantId,
      identity.userId,
      identity.agentInstanceId ?? null,
      assertion.id,
      assertion.subjectId,
      assertion.predicate,
      assertion.objectEntityId ?? null,
      assertion.objectValue === undefined ? null : stringifyJson(assertion.objectValue),
      assertion.confidence,
      assertion.sourceType,
      assertion.status,
      assertion.validFrom ?? null,
      assertion.validTo ?? null,
      null,
      assertion.createdAt,
      assertion.updatedAt,
    );
  }

  #replaceAssertionEvidenceRows(
    database: DatabaseSync,
    identity: MemoryIdentity,
    assertionId: string,
    evidenceIds: string[],
    now: string,
  ): void {
    database.prepare(`
      DELETE FROM ontology_assertion_evidence
      WHERE tenant_id = ? AND user_id = ? AND assertion_id = ?
    `).run(identity.tenantId, identity.userId, assertionId);
    for (const evidenceId of evidenceIds) {
      database.prepare(`
        INSERT INTO ontology_assertion_evidence (tenant_id, user_id, assertion_id, evidence_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(identity.tenantId, identity.userId, assertionId, evidenceId, now);
    }
  }

  #assertEvidenceExists(database: DatabaseSync, identity: MemoryIdentity, evidenceIds: string[]): void {
    for (const evidenceId of evidenceIds) {
      const row = database.prepare(`
        SELECT id FROM ontology_evidence
        WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).get(identity.tenantId, identity.userId, evidenceId);
      if (row === undefined) {
        throw new MemoryToolError(`Ontology evidence not found: ${evidenceId}`);
      }
    }
  }

  #appendAudit(
    database: DatabaseSync,
    identity: MemoryIdentity,
    action: OntologyAuditAction,
    recordKind: OntologyAuditRecordKind,
    recordId: string,
    meta: OntologyWriteMeta,
    now: string,
  ): void {
    database.prepare(`
      INSERT INTO ontology_audit_log (
        tenant_id, user_id, agent_instance_id, action, record_kind, record_id, operator, source, detail_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      identity.tenantId,
      identity.userId,
      identity.agentInstanceId ?? null,
      action,
      recordKind,
      recordId,
      meta.operator?.trim() ? meta.operator.trim() : "system",
      meta.source?.trim() ? meta.source.trim() : null,
      meta.detail === undefined ? null : stringifyJson(meta.detail),
      now,
    );
  }

  #transaction(database: DatabaseSync, work: () => void): void {
    database.exec("BEGIN IMMEDIATE");
    try {
      work();
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the original SQLite failure.
      }
      throw error;
    }
  }

  #rowToEntity(database: DatabaseSync, identity: MemoryIdentity, row: Record<string, unknown>): OntologyEntity {
    const status = readRequiredText(row, "status", "ontology_entities");
    const sensitivity = readRequiredText(row, "sensitivity", "ontology_entities");
    if (!isOntologyEntityStatus(status)) {
      throw new MemoryToolError("Invalid ontology entity status in storage.");
    }
    if (!isOntologySensitivity(sensitivity)) {
      throw new MemoryToolError("Invalid ontology entity sensitivity in storage.");
    }
    const id = readRequiredText(row, "id", "ontology_entities");
    const aliasRows = database.prepare(`
      SELECT alias FROM ontology_entity_aliases
      WHERE tenant_id = ? AND user_id = ? AND entity_id = ?
      ORDER BY alias ASC
    `).all(identity.tenantId, identity.userId, id);
    return {
      id,
      identity: { ...identity },
      type: readRequiredText(row, "type", "ontology_entities"),
      canonicalName: readRequiredText(row, "canonical_name", "ontology_entities"),
      aliases: aliasRows.map(aliasRow => readRequiredText(aliasRow, "alias", "ontology_entity_aliases")),
      status,
      sensitivity,
      createdAt: readRequiredText(row, "created_at", "ontology_entities"),
      updatedAt: readRequiredText(row, "updated_at", "ontology_entities"),
    };
  }

  #rowToAssertion(database: DatabaseSync, identity: MemoryIdentity, row: Record<string, unknown>): OntologyAssertion {
    const sourceType = readRequiredText(row, "source_type", "ontology_assertions");
    const status = readRequiredText(row, "status", "ontology_assertions");
    if (!isAssertionSourceType(sourceType)) {
      throw new MemoryToolError("Invalid ontology assertion sourceType in storage.");
    }
    if (!isOntologyAssertionStatus(status)) {
      throw new MemoryToolError("Invalid ontology assertion status in storage.");
    }
    const id = readRequiredText(row, "id", "ontology_assertions");
    const evidenceRows = database.prepare(`
      SELECT evidence_id FROM ontology_assertion_evidence
      WHERE tenant_id = ? AND user_id = ? AND assertion_id = ?
      ORDER BY created_at ASC, evidence_id ASC
    `).all(identity.tenantId, identity.userId, id);
    const assertion: OntologyAssertion = {
      id,
      identity: { ...identity },
      subjectId: readRequiredText(row, "subject_id", "ontology_assertions"),
      predicate: readRequiredText(row, "predicate", "ontology_assertions"),
      confidence: readRequiredNumber(row, "confidence", "ontology_assertions"),
      sourceType: sourceType as AssertionSourceType,
      status: status as OntologyAssertionStatus,
      evidenceIds: evidenceRows.map(evidenceRow => readRequiredText(evidenceRow, "evidence_id", "ontology_assertion_evidence")),
      createdAt: readRequiredText(row, "created_at", "ontology_assertions"),
      updatedAt: readRequiredText(row, "updated_at", "ontology_assertions"),
    };
    const objectEntityId = readOptionalText(row, "object_entity_id", "ontology_assertions");
    if (objectEntityId !== undefined) {
      assertion.objectEntityId = objectEntityId;
    }
    const objectValueJson = row.object_value;
    if (objectValueJson !== null && objectValueJson !== undefined) {
      if (typeof objectValueJson !== "string") {
        throw new MemoryToolError("Invalid ontology assertion object value in storage.");
      }
      const parsed: unknown = JSON.parse(objectValueJson);
      if (typeof parsed !== "string" && typeof parsed !== "number" && typeof parsed !== "boolean") {
        throw new MemoryToolError("Invalid ontology assertion object value in storage.");
      }
      assertion.objectValue = parsed;
    }
    const validFrom = readOptionalText(row, "valid_from", "ontology_assertions");
    if (validFrom !== undefined) {
      assertion.validFrom = validFrom;
    }
    const validTo = readOptionalText(row, "valid_to", "ontology_assertions");
    if (validTo !== undefined) {
      assertion.validTo = validTo;
    }
    return assertion;
  }

  #rowToEvidence(identity: MemoryIdentity, row: Record<string, unknown>): OntologyEvidence {
    const evidence: OntologyEvidence = {
      id: readRequiredText(row, "id", "ontology_evidence"),
      identity: { ...identity },
      source: readRequiredText(row, "source", "ontology_evidence"),
      excerpt: readRequiredText(row, "excerpt", "ontology_evidence"),
      capturedAt: readRequiredText(row, "captured_at", "ontology_evidence"),
    };
    const sessionId = readOptionalText(row, "session_id", "ontology_evidence");
    if (sessionId !== undefined) {
      evidence.sessionId = sessionId;
    }
    const runId = readOptionalText(row, "run_id", "ontology_evidence");
    if (runId !== undefined) {
      evidence.runId = runId;
    }
    const messageId = readOptionalText(row, "message_id", "ontology_evidence");
    if (messageId !== undefined) {
      evidence.messageId = messageId;
    }
    return evidence;
  }

  #rowToEpisode(identity: MemoryIdentity, row: Record<string, unknown>): OntologyEpisode {
    const episode: OntologyEpisode = {
      id: readRequiredText(row, "id", "ontology_episodes"),
      identity: { ...identity },
      sessionId: readRequiredText(row, "session_id", "ontology_episodes"),
      runId: readRequiredText(row, "run_id", "ontology_episodes"),
      messageIds: readStringArray(row, "message_ids_json", "ontology_episodes"),
      capturedAt: readRequiredText(row, "captured_at", "ontology_episodes"),
    };
    const summary = readOptionalText(row, "summary", "ontology_episodes");
    if (summary !== undefined) {
      episode.summary = summary;
    }
    const excerpt = readOptionalText(row, "excerpt", "ontology_episodes");
    if (excerpt !== undefined) {
      episode.excerpt = excerpt;
    }
    return episode;
  }

  async #getDatabase(): Promise<DatabaseSync> {
    if (this.#database !== undefined) {
      return this.#database;
    }
    if (this.#databasePromise === undefined) {
      this.#databasePromise = this.#openDatabase().then(
        database => {
          this.#database = database;
          return database;
        },
        error => {
          this.#databasePromise = undefined;
          throw error;
        },
      );
    }
    return await this.#databasePromise;
  }

  async #openDatabase(): Promise<DatabaseSync> {
    if (!this.#memoryOnly) {
      await mkdir(this.#rootDir, { recursive: true });
    }
    let sqlite: typeof import("node:sqlite");
    try {
      sqlite = await import("node:sqlite");
    } catch (error) {
      throw new Error(
        `SQLite ontology backend requires Node.js node:sqlite support: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let database: DatabaseSync | undefined;
    try {
      database = new sqlite.DatabaseSync(this.#databasePath, {
        timeout: 2000,
      });
      database.exec(`
        PRAGMA journal_mode = DELETE;
        PRAGMA busy_timeout = 2000;
        CREATE TABLE IF NOT EXISTS ontology_entities (
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          agent_instance_id TEXT,
          id TEXT NOT NULL,
          type TEXT NOT NULL,
          canonical_name TEXT NOT NULL,
          status TEXT NOT NULL,
          sensitivity TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, user_id, id)
        );
        CREATE INDEX IF NOT EXISTS ontology_entities_identity_idx
          ON ontology_entities (tenant_id, user_id);
        CREATE INDEX IF NOT EXISTS ontology_entities_name_idx
          ON ontology_entities (tenant_id, user_id, canonical_name);

        CREATE TABLE IF NOT EXISTS ontology_entity_aliases (
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          alias TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, user_id, entity_id, alias)
        );
        CREATE INDEX IF NOT EXISTS ontology_entity_aliases_alias_idx
          ON ontology_entity_aliases (tenant_id, user_id, alias);

        CREATE TABLE IF NOT EXISTS ontology_assertions (
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          agent_instance_id TEXT,
          id TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          predicate TEXT NOT NULL,
          object_entity_id TEXT,
          object_value TEXT,
          confidence REAL NOT NULL,
          source_type TEXT NOT NULL,
          status TEXT NOT NULL,
          valid_from TEXT,
          valid_to TEXT,
          supersedes_assertion_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, user_id, id)
        );
        CREATE INDEX IF NOT EXISTS ontology_assertions_identity_idx
          ON ontology_assertions (tenant_id, user_id);
        CREATE INDEX IF NOT EXISTS ontology_assertions_subject_idx
          ON ontology_assertions (tenant_id, user_id, subject_id);
        CREATE INDEX IF NOT EXISTS ontology_assertions_predicate_idx
          ON ontology_assertions (tenant_id, user_id, predicate);
        CREATE INDEX IF NOT EXISTS ontology_assertions_status_idx
          ON ontology_assertions (tenant_id, user_id, status);
        CREATE INDEX IF NOT EXISTS ontology_assertions_valid_to_idx
          ON ontology_assertions (tenant_id, user_id, valid_to);

        CREATE TABLE IF NOT EXISTS ontology_evidence (
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          agent_instance_id TEXT,
          id TEXT NOT NULL,
          session_id TEXT,
          run_id TEXT,
          message_id TEXT,
          source TEXT NOT NULL,
          excerpt TEXT NOT NULL,
          captured_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, user_id, id)
        );
        CREATE INDEX IF NOT EXISTS ontology_evidence_identity_idx
          ON ontology_evidence (tenant_id, user_id);

        CREATE TABLE IF NOT EXISTS ontology_assertion_evidence (
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          assertion_id TEXT NOT NULL,
          evidence_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, user_id, assertion_id, evidence_id)
        );
        CREATE INDEX IF NOT EXISTS ontology_assertion_evidence_evidence_idx
          ON ontology_assertion_evidence (tenant_id, user_id, evidence_id);

        CREATE TABLE IF NOT EXISTS ontology_episodes (
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          agent_instance_id TEXT,
          id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          run_id TEXT NOT NULL,
          message_ids_json TEXT NOT NULL,
          summary TEXT,
          excerpt TEXT,
          captured_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, user_id, id)
        );
        CREATE INDEX IF NOT EXISTS ontology_episodes_identity_idx
          ON ontology_episodes (tenant_id, user_id);
        CREATE INDEX IF NOT EXISTS ontology_episodes_session_idx
          ON ontology_episodes (tenant_id, user_id, session_id);

        CREATE TABLE IF NOT EXISTS ontology_snapshots (
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          content TEXT NOT NULL,
          assertion_ids_json TEXT NOT NULL,
          estimated_tokens INTEGER NOT NULL,
          generated_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, user_id, version)
        );
        CREATE INDEX IF NOT EXISTS ontology_snapshots_identity_idx
          ON ontology_snapshots (tenant_id, user_id);

        CREATE TABLE IF NOT EXISTS ontology_candidate_reviews (
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          key TEXT NOT NULL,
          decision TEXT NOT NULL,
          reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, user_id, key)
        );

        CREATE TABLE IF NOT EXISTS ontology_audit_log (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          agent_instance_id TEXT,
          action TEXT NOT NULL,
          record_kind TEXT NOT NULL,
          record_id TEXT NOT NULL,
          operator TEXT NOT NULL,
          source TEXT,
          detail_json TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ontology_audit_log_identity_idx
          ON ontology_audit_log (tenant_id, user_id);
        CREATE INDEX IF NOT EXISTS ontology_audit_log_record_idx
          ON ontology_audit_log (tenant_id, user_id, record_kind, record_id);
      `);
    } catch (error) {
      database?.close();
      throw new Error(
        `SQLite ontology backend could not initialize schema: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (database === undefined) {
      throw new Error("SQLite ontology backend could not initialize database.");
    }
    return database;
  }
}

// ---------------------------------------------------------------------------
// Row/record helpers
// ---------------------------------------------------------------------------

/**
 * Shared WHERE-clause builder for assertion queries (find + count). Temporal
 * semantics (Phase 3): `asOf` returns the point-in-time view (validFrom <=
 * asOf < validTo); `excludeExpired` returns the "current facts" view
 * (validTo unset or in the future). Without either flag the raw store view is
 * returned — recall-time policies choose explicitly.
 */
function assertionFilterConditions(
  identity: MemoryIdentity,
  filter: OntologyAssertionFilter,
): { conditions: string[]; params: (string | number)[] } {
  const conditions = ["tenant_id = ?", "user_id = ?"];
  const params: (string | number)[] = [identity.tenantId, identity.userId];
  if (filter.subjectId !== undefined) {
    conditions.push("subject_id = ?");
    params.push(filter.subjectId);
  }
  if (filter.predicate !== undefined) {
    conditions.push("predicate = ?");
    params.push(filter.predicate);
  }
  if (filter.status !== undefined) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (statuses.length === 0) {
      conditions.push("1 = 0");
    } else {
      for (const status of statuses) {
        if (!isOntologyAssertionStatus(status)) {
          throw new MemoryToolError("Invalid ontology assertion status filter.");
        }
      }
      conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
  }
  if (filter.asOf !== undefined) {
    if (Number.isNaN(Date.parse(filter.asOf))) {
      throw new MemoryToolError("Ontology assertion filter asOf must be an ISO timestamp.");
    }
    conditions.push("(valid_from IS NULL OR valid_from <= ?)");
    params.push(filter.asOf);
    conditions.push("(valid_to IS NULL OR valid_to > ?)");
    params.push(filter.asOf);
  }
  if (filter.excludeExpired === true) {
    conditions.push("(valid_to IS NULL OR valid_to >= ?)");
    params.push(new Date().toISOString());
  }
  return { conditions, params };
}

function buildEntity(identity: MemoryIdentity, write: OntologyEntityWrite, now: string): OntologyEntity {  return {
    id: write.id ?? `ent_${randomUUID()}`,
    identity: { ...identity },
    type: write.type,
    canonicalName: write.canonicalName.trim(),
    aliases: normalizeAliases(write.aliases ?? []),
    status: write.status ?? "active",
    sensitivity: write.sensitivity ?? "normal",
    createdAt: now,
    updatedAt: now,
  };
}

function buildAssertion(identity: MemoryIdentity, write: OntologyAssertionWrite, now: string): OntologyAssertion {
  const assertion: OntologyAssertion = {
    id: write.id ?? `ast_${randomUUID()}`,
    identity: { ...identity },
    subjectId: write.subjectId,
    predicate: write.predicate,
    confidence: write.confidence,
    sourceType: write.sourceType,
    status: write.status,
    evidenceIds: [...write.evidenceIds],
    createdAt: now,
    updatedAt: now,
  };
  if (write.objectEntityId !== undefined) {
    assertion.objectEntityId = write.objectEntityId;
  }
  if (write.objectValue !== undefined) {
    assertion.objectValue = write.objectValue;
  }
  if (write.validFrom !== undefined) {
    assertion.validFrom = write.validFrom;
  }
  if (write.validTo !== undefined) {
    assertion.validTo = write.validTo;
  }
  return assertion;
}

function normalizeAliases(aliases: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const alias of aliases) {
    const trimmed = alias.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function normalizeId(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new MemoryToolError(`Ontology ${field} cannot be empty.`);
  }
  if (trimmed.length > 128) {
    throw new MemoryToolError(`Ontology ${field} is too long.`);
  }
  return trimmed;
}

function readRequiredText(row: Record<string, unknown>, key: string, source: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new MemoryToolError(`Invalid SQLite ontology record from ${source}: ${key} must be a non-empty string.`);
  }
  return value;
}

function readOptionalText(row: Record<string, unknown>, key: string, source: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new MemoryToolError(`Invalid SQLite ontology record from ${source}: ${key} must be a string.`);
  }
  return value.trim() ? value : undefined;
}

function readRequiredNumber(row: Record<string, unknown>, key: string, source: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MemoryToolError(`Invalid SQLite ontology record from ${source}: ${key} must be a finite number.`);
  }
  return value;
}

function readStringArray(row: Record<string, unknown>, key: string, source: string): string[] {
  const value = row[key];
  if (typeof value !== "string") {
    throw new MemoryToolError(`Invalid SQLite ontology record from ${source}: ${key} must be a JSON string array.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new MemoryToolError(`Invalid SQLite ontology record from ${source}: ${key} must be a JSON string array.`);
  }
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string")) {
    throw new MemoryToolError(`Invalid SQLite ontology record from ${source}: ${key} must be a JSON string array.`);
  }
  return parsed as string[];
}
