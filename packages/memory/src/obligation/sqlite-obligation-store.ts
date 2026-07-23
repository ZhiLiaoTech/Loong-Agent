import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { MemoryIdentity } from "@loong/core";
import { assertMemoryIdentity } from "../memory-store-v2.js";
import { MemoryToolError } from "../memory-tool-error.js";
import { clampPositiveInteger, isIsoTimestamp, stringifyJson } from "../memory-util.js";
import type {
  ObligationAuditAction,
  ObligationAuditFilter,
  ObligationAuditRecord,
  ObligationCarrierPatch,
  ObligationDanglingQuery,
  ObligationDanglingRecord,
  ObligationEvidenceAttachResult,
  ObligationEvidenceLink,
  ObligationEvidenceLinkWrite,
  ObligationFilter,
  ObligationRecord,
  ObligationStore,
  ObligationWrite,
  ObligationWriteMeta,
} from "./obligation-store.js";
import type {
  Obligation,
  ObligationBudget,
  ObligationEvidenceRef,
  ObligationEvidenceRefKind,
  ObligationItem,
  ObligationStatus,
} from "./obligation-types.js";
import {
  isObligationEvidenceRefKind,
  isObligationStatus,
  isObligationTransitionAllowedInPhase30,
  isObligationValidatorKind,
} from "./obligation-types.js";

export interface SqliteObligationStoreOptions {
  rootDir?: string;
  databasePath?: string;
}

export const DEFAULT_OBLIGATION_LIST_LIMIT = 100;
export const ABSOLUTE_OBLIGATION_LIST_LIMIT = 1000;

export function createSqliteObligationStore(options: SqliteObligationStoreOptions = {}): ObligationStore {
  return new SqliteObligationStore(options);
}

/** sha256 over the canonical (key-ordered, kind-normalized) ref JSON. */
export function hashObligationEvidenceRef(ref: ObligationEvidenceRef): string {
  return createHash("sha256").update(canonicalizeObligationEvidenceRef(ref)).digest("hex");
}

export function canonicalizeObligationEvidenceRef(ref: ObligationEvidenceRef): string {
  switch (ref.kind) {
    case "wf_event":
      return JSON.stringify({ instanceId: ref.instanceId, kind: ref.kind, seq: ref.seq });
    case "ontology_evidence":
      return JSON.stringify({ evidenceId: ref.evidenceId, kind: ref.kind, tenantId: ref.tenantId, userId: ref.userId });
    case "ontology_episode":
      return JSON.stringify({ episodeId: ref.episodeId, kind: ref.kind, tenantId: ref.tenantId, userId: ref.userId });
    case "step_result":
      return JSON.stringify({ idempotencyKey: ref.idempotencyKey, kind: ref.kind });
  }
}

/**
 * Identity-isolated SQLite obligation backend (Phase 3.0, 设计 §5/§9).
 *
 * Four tables (obligation, obligation_item, obligation_evidence_link,
 * obligation_audit_log). EVERY statement is forced through
 * `tenant_id + user_id`; identity is asserted before any storage access, the
 * same posture as `SqliteOntologyStore`. Every mutation appends an audit row
 * (operator/source per §9) inside the same transaction.
 *
 * Recording-only (先记录不裁定): status transitions are guarded by
 * OBLIGATION_PHASE30_ALLOWED_TRANSITIONS; verdict columns exist on
 * obligation_item but have no write path in 3.0.
 */
export class SqliteObligationStore implements ObligationStore {
  readonly #rootDir: string;
  readonly #databasePath: string;
  readonly #memoryOnly: boolean;
  #database: DatabaseSync | undefined;
  #databasePromise: Promise<DatabaseSync> | undefined;

  constructor(options: SqliteObligationStoreOptions = {}) {
    const defaultRootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".loong", "memory"));
    this.#memoryOnly = options.databasePath === ":memory:";
    this.#databasePath = this.#memoryOnly
      ? ":memory:"
      : path.resolve(options.databasePath ?? path.join(defaultRootDir, "obligation-v1.sqlite"));
    this.#rootDir = this.#memoryOnly ? defaultRootDir : path.dirname(this.#databasePath);
  }

  async createObligation(
    identityValue: MemoryIdentity,
    write: ObligationWrite,
    meta: ObligationWriteMeta = {},
  ): Promise<ObligationRecord> {
    const identity = assertMemoryIdentity(identityValue);
    validateObligationWrite(write);
    const now = new Date().toISOString();
    const obligation = buildObligation(identity, write, now);
    const items = write.items.map((itemWrite, index) => buildItem(identity, obligation.id, itemWrite, index, now));
    const database = await this.#getDatabase();
    this.#transaction(database, () => {
      database.prepare(`
        INSERT INTO obligation (
          tenant_id, user_id, agent_instance_id, id, employee_id, requester_user_id, source,
          statement, status, instance_id, run_id, idempotency_key, budget_json, deadline_at,
          retry_budget, fulfilled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        identity.tenantId,
        identity.userId,
        identity.agentInstanceId ?? null,
        obligation.id,
        obligation.employeeId,
        obligation.requesterUserId ?? null,
        obligation.source,
        obligation.statement,
        obligation.status,
        obligation.instanceId ?? null,
        obligation.runId ?? null,
        obligation.idempotencyKey ?? null,
        obligation.budget === undefined ? null : stringifyJson(obligation.budget),
        obligation.deadlineAt ?? null,
        obligation.retryBudget,
        null,
        now,
        now,
      );
      for (const item of items) {
        this.#insertItem(database, identity, item);
      }
      this.#appendAudit(database, identity, "create", "obligation", obligation.id, meta, now);
    });
    return { obligation, items, evidenceLinks: [] };
  }

  async getObligation(identityValue: MemoryIdentity, id: string): Promise<ObligationRecord | undefined> {
    const identity = assertMemoryIdentity(identityValue);
    const database = await this.#getDatabase();
    const row = database.prepare(`
      SELECT * FROM obligation WHERE tenant_id = ? AND user_id = ? AND id = ?
    `).get(identity.tenantId, identity.userId, id);
    if (row === undefined) {
      return undefined;
    }
    const obligation = this.#rowToObligation(identity, row as Record<string, unknown>);
    return {
      obligation,
      items: this.#selectItems(database, identity, obligation.id),
      evidenceLinks: this.#selectLinks(database, identity, obligation.id),
    };
  }

  async listObligations(identityValue: MemoryIdentity, filter: ObligationFilter = {}): Promise<Obligation[]> {
    const identity = assertMemoryIdentity(identityValue);
    if (filter.status !== undefined && !isObligationStatus(filter.status)) {
      throw new MemoryToolError("Invalid obligation status filter.");
    }
    const limit = clampPositiveInteger(filter.limit, DEFAULT_OBLIGATION_LIST_LIMIT, ABSOLUTE_OBLIGATION_LIST_LIMIT);
    const conditions = ["tenant_id = ?", "user_id = ?"];
    const params: (string | number)[] = [identity.tenantId, identity.userId];
    if (filter.status !== undefined) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    const database = await this.#getDatabase();
    const rows = database.prepare(`
      SELECT * FROM obligation
      WHERE ${conditions.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...params, limit);
    return rows.map(row => this.#rowToObligation(identity, row as Record<string, unknown>));
  }

  async findObligationByIdempotencyKey(
    identityValue: MemoryIdentity,
    idempotencyKey: string,
  ): Promise<Obligation | undefined> {
    const identity = assertMemoryIdentity(identityValue);
    const key = normalizeBoundedText(idempotencyKey, "idempotencyKey", 200);
    const database = await this.#getDatabase();
    const row = database.prepare(`
      SELECT * FROM obligation
      WHERE tenant_id = ? AND user_id = ? AND idempotency_key = ?
      ORDER BY created_at ASC
      LIMIT 1
    `).get(identity.tenantId, identity.userId, key);
    return row === undefined ? undefined : this.#rowToObligation(identity, row as Record<string, unknown>);
  }

  async transitionStatus(
    identityValue: MemoryIdentity,
    id: string,
    to: ObligationStatus,
    meta: ObligationWriteMeta = {},
  ): Promise<Obligation> {
    const identity = assertMemoryIdentity(identityValue);
    if (!isObligationStatus(to)) {
      throw new MemoryToolError("Invalid obligation status transition target.");
    }
    const database = await this.#getDatabase();
    let updated: Obligation | undefined;
    this.#transaction(database, () => {
      const row = database.prepare(`
        SELECT * FROM obligation WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).get(identity.tenantId, identity.userId, id) as Record<string, unknown> | undefined;
      if (row === undefined) {
        throw new MemoryToolError("Obligation not found for the given identity.");
      }
      const current = this.#rowToObligation(identity, row);
      if (current.status === to) {
        updated = current;
        return;
      }
      if (!isObligationTransitionAllowedInPhase30(current.status, to)) {
        throw new MemoryToolError(
          `Obligation status transition ${current.status} → ${to} is not allowed in Phase 3.0`
          + " (recording only; verdicts and terminal states land in Phase 3.1).",
        );
      }
      const now = new Date().toISOString();
      database.prepare(`
        UPDATE obligation SET status = ?, updated_at = ?
        WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).run(to, now, identity.tenantId, identity.userId, id);
      this.#appendAudit(database, identity, "transition", "obligation", id, {
        ...meta,
        detail: { ...(meta.detail ?? {}), from: current.status, to },
      }, now);
      updated = { ...current, status: to, updatedAt: now };
    });
    if (updated === undefined) {
      throw new MemoryToolError("Obligation transition failed.");
    }
    return updated;
  }

  async updateCarrier(
    identityValue: MemoryIdentity,
    id: string,
    patch: ObligationCarrierPatch,
    meta: ObligationWriteMeta = {},
  ): Promise<Obligation> {
    const identity = assertMemoryIdentity(identityValue);
    const database = await this.#getDatabase();
    let updated: Obligation | undefined;
    this.#transaction(database, () => {
      const row = database.prepare(`
        SELECT * FROM obligation WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).get(identity.tenantId, identity.userId, id) as Record<string, unknown> | undefined;
      if (row === undefined) {
        throw new MemoryToolError("Obligation not found for the given identity.");
      }
      const current = this.#rowToObligation(identity, row);
      const next: Obligation = { ...current };
      const changedFields: string[] = [];
      if (patch.instanceId !== undefined && patch.instanceId !== current.instanceId) {
        next.instanceId = normalizeBoundedText(patch.instanceId, "instanceId", 200);
        changedFields.push("instanceId");
      }
      if (patch.runId !== undefined && patch.runId !== current.runId) {
        next.runId = normalizeBoundedText(patch.runId, "runId", 200);
        changedFields.push("runId");
      }
      if (patch.idempotencyKey !== undefined && patch.idempotencyKey !== current.idempotencyKey) {
        next.idempotencyKey = normalizeBoundedText(patch.idempotencyKey, "idempotencyKey", 200);
        changedFields.push("idempotencyKey");
      }
      if (changedFields.length === 0) {
        updated = current;
        return;
      }
      const now = new Date().toISOString();
      database.prepare(`
        UPDATE obligation SET instance_id = ?, run_id = ?, idempotency_key = ?, updated_at = ?
        WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).run(
        next.instanceId ?? null,
        next.runId ?? null,
        next.idempotencyKey ?? null,
        now,
        identity.tenantId,
        identity.userId,
        id,
      );
      this.#appendAudit(database, identity, "update_carrier", "obligation", id, {
        ...meta,
        detail: { ...(meta.detail ?? {}), fields: changedFields },
      }, now);
      updated = { ...next, updatedAt: now };
    });
    if (updated === undefined) {
      throw new MemoryToolError("Obligation carrier update failed.");
    }
    return updated;
  }

  async attachEvidence(
    identityValue: MemoryIdentity,
    obligationId: string,
    write: ObligationEvidenceLinkWrite,
    meta: ObligationWriteMeta = {},
  ): Promise<ObligationEvidenceAttachResult> {
    const identity = assertMemoryIdentity(identityValue);
    validateEvidenceLinkWrite(write);
    const now = write.collectedAt ?? new Date().toISOString();
    if (!isIsoTimestamp(now)) {
      throw new MemoryToolError("Obligation evidence collectedAt must be an ISO timestamp.");
    }
    const refHash = hashObligationEvidenceRef(write.ref);
    const database = await this.#getDatabase();
    let result: ObligationEvidenceAttachResult | undefined;
    this.#transaction(database, () => {
      const obligationRow = database.prepare(`
        SELECT id FROM obligation WHERE tenant_id = ? AND user_id = ? AND id = ?
      `).get(identity.tenantId, identity.userId, obligationId);
      if (obligationRow === undefined) {
        throw new MemoryToolError("Obligation not found for the given identity.");
      }
      if (write.itemId !== undefined) {
        const itemRow = database.prepare(`
          SELECT id FROM obligation_item WHERE tenant_id = ? AND user_id = ? AND id = ? AND obligation_id = ?
        `).get(identity.tenantId, identity.userId, write.itemId, obligationId);
        if (itemRow === undefined) {
          throw new MemoryToolError("Obligation item not found on this obligation.");
        }
      }
      const insertOutcome = database.prepare(`
        INSERT OR IGNORE INTO obligation_evidence_link (
          tenant_id, user_id, obligation_id, item_id, kind, ref_hash, ref_json, collected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        identity.tenantId,
        identity.userId,
        obligationId,
        write.itemId ?? null,
        write.ref.kind,
        refHash,
        canonicalizeObligationEvidenceRef(write.ref),
        now,
      );
      const inserted = Number(insertOutcome.changes) > 0;
      if (inserted) {
        this.#appendAudit(database, identity, "attach_evidence", "obligation", obligationId, {
          ...meta,
          detail: {
            ...(meta.detail ?? {}),
            kind: write.ref.kind,
            refHash,
            ...(write.itemId !== undefined ? { itemId: write.itemId } : {}),
          },
        }, now);
      }
      result = {
        link: {
          identity: { ...identity },
          obligationId,
          ...(write.itemId !== undefined ? { itemId: write.itemId } : {}),
          kind: write.ref.kind,
          refHash,
          ref: write.ref,
          collectedAt: now,
        },
        inserted,
      };
    });
    if (result === undefined) {
      throw new MemoryToolError("Obligation evidence attach failed.");
    }
    return result;
  }

  async listEvidenceLinks(identityValue: MemoryIdentity, obligationId: string): Promise<ObligationEvidenceLink[]> {
    const identity = assertMemoryIdentity(identityValue);
    const database = await this.#getDatabase();
    return this.#selectLinks(database, identity, obligationId);
  }

  async listDangling(
    identityValue: MemoryIdentity,
    query: ObligationDanglingQuery,
  ): Promise<ObligationDanglingRecord[]> {
    const identity = assertMemoryIdentity(identityValue);
    validateDanglingQuery(query);
    const limit = clampPositiveInteger(query.limit, DEFAULT_OBLIGATION_LIST_LIMIT, ABSOLUTE_OBLIGATION_LIST_LIMIT);
    const params: (string | number | null)[] = [identity.tenantId, identity.userId];
    let statusCondition: string;
    let having: string | undefined;
    if (query.kind === "silent") {
      // 断裂点二：派发后长期无响应 —— 只看 durable deadline。
      statusCondition = "o.status IN ('dispatched', 'evidence_collecting')";
      params.push(query.now);
      statusCondition += " AND o.deadline_at IS NOT NULL AND o.deadline_at <= ?";
    } else {
      // untouched / unvalidated：deadline 已过，或提供了 updated_at cutoff。
      statusCondition = query.kind === "untouched"
        ? "o.status = 'dispatched'"
        : "o.status = 'evidence_collecting'";
      statusCondition += " AND ((o.deadline_at IS NOT NULL AND o.deadline_at <= ?) OR (? IS NOT NULL AND o.updated_at <= ?))";
      params.push(query.now, query.olderThan ?? null, query.olderThan ?? null);
      having = query.kind === "untouched" ? "evidence_count = 0" : "evidence_count > 0";
    }
    const database = await this.#getDatabase();
    const rows = database.prepare(`
      SELECT o.*, COUNT(l.ref_hash) AS evidence_count
      FROM obligation o
      LEFT JOIN obligation_evidence_link l
        ON l.tenant_id = o.tenant_id AND l.user_id = o.user_id AND l.obligation_id = o.id
      WHERE o.tenant_id = ? AND o.user_id = ?
        AND ${statusCondition}
      GROUP BY o.tenant_id, o.user_id, o.id
      ${having !== undefined ? `HAVING ${having}` : ""}
      ORDER BY o.updated_at ASC
      LIMIT ?
    `).all(...params, limit);
    return rows.map(row => {
      const record = row as Record<string, unknown>;
      return {
        obligation: this.#rowToObligation(identity, record),
        evidenceCount: readRequiredNumber(record, "evidence_count", "obligation dangling query"),
      };
    });
  }

  async listAudit(identityValue: MemoryIdentity, filter: ObligationAuditFilter = {}): Promise<ObligationAuditRecord[]> {
    const identity = assertMemoryIdentity(identityValue);
    const limit = clampPositiveInteger(filter.limit, DEFAULT_OBLIGATION_LIST_LIMIT, ABSOLUTE_OBLIGATION_LIST_LIMIT);
    const conditions = ["tenant_id = ?", "user_id = ?"];
    const params: (string | number)[] = [identity.tenantId, identity.userId];
    if (filter.recordId !== undefined) {
      conditions.push("record_id = ?");
      params.push(filter.recordId);
    }
    const database = await this.#getDatabase();
    const rows = database.prepare(`
      SELECT * FROM obligation_audit_log
      WHERE ${conditions.join(" AND ")}
      ORDER BY seq ASC
      LIMIT ?
    `).all(...params, limit);
    return rows.map(row => this.#rowToAudit(identity, row as Record<string, unknown>));
  }

  // ------------------------------------------------------------------ internals

  #insertItem(database: DatabaseSync, identity: MemoryIdentity, item: ObligationItem): void {
    database.prepare(`
      INSERT INTO obligation_item (
        tenant_id, user_id, id, obligation_id, seq, acceptance, validator, validator_config_json,
        required, deadline_at, verdict, verdict_reason, validated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      identity.tenantId,
      identity.userId,
      item.id,
      item.obligationId,
      item.seq,
      item.acceptance,
      item.validator,
      stringifyJson(item.validatorConfig),
      item.required ? 1 : 0,
      item.deadlineAt ?? null,
      null,
      null,
      null,
      item.createdAt,
      item.updatedAt,
    );
  }

  #selectItems(database: DatabaseSync, identity: MemoryIdentity, obligationId: string): ObligationItem[] {
    const rows = database.prepare(`
      SELECT * FROM obligation_item
      WHERE tenant_id = ? AND user_id = ? AND obligation_id = ?
      ORDER BY seq ASC
    `).all(identity.tenantId, identity.userId, obligationId);
    return rows.map(row => this.#rowToItem(identity, row as Record<string, unknown>));
  }

  #selectLinks(database: DatabaseSync, identity: MemoryIdentity, obligationId: string): ObligationEvidenceLink[] {
    const rows = database.prepare(`
      SELECT * FROM obligation_evidence_link
      WHERE tenant_id = ? AND user_id = ? AND obligation_id = ?
      ORDER BY collected_at ASC, ref_hash ASC
    `).all(identity.tenantId, identity.userId, obligationId);
    return rows.map(row => this.#rowToLink(identity, row as Record<string, unknown>));
  }

  #appendAudit(
    database: DatabaseSync,
    identity: MemoryIdentity,
    action: ObligationAuditAction,
    recordKind: "obligation" | "obligation_item",
    recordId: string,
    meta: ObligationWriteMeta,
    now: string,
  ): void {
    database.prepare(`
      INSERT INTO obligation_audit_log (
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

  #rowToObligation(identity: MemoryIdentity, row: Record<string, unknown>): Obligation {
    const status = readRequiredText(row, "status", "obligation");
    if (!isObligationStatus(status)) {
      throw new MemoryToolError("Invalid obligation status in storage.");
    }
    const obligation: Obligation = {
      id: readRequiredText(row, "id", "obligation"),
      identity: { ...identity },
      employeeId: readRequiredText(row, "employee_id", "obligation"),
      source: readRequiredText(row, "source", "obligation"),
      statement: readRequiredText(row, "statement", "obligation"),
      status,
      retryBudget: readRequiredNumber(row, "retry_budget", "obligation"),
      createdAt: readRequiredText(row, "created_at", "obligation"),
      updatedAt: readRequiredText(row, "updated_at", "obligation"),
    };
    const requesterUserId = readOptionalText(row, "requester_user_id", "obligation");
    if (requesterUserId !== undefined) {
      obligation.requesterUserId = requesterUserId;
    }
    const instanceId = readOptionalText(row, "instance_id", "obligation");
    if (instanceId !== undefined) {
      obligation.instanceId = instanceId;
    }
    const runId = readOptionalText(row, "run_id", "obligation");
    if (runId !== undefined) {
      obligation.runId = runId;
    }
    const idempotencyKey = readOptionalText(row, "idempotency_key", "obligation");
    if (idempotencyKey !== undefined) {
      obligation.idempotencyKey = idempotencyKey;
    }
    const budgetJson = readOptionalText(row, "budget_json", "obligation");
    if (budgetJson !== undefined) {
      obligation.budget = parseBudgetJson(budgetJson);
    }
    const deadlineAt = readOptionalText(row, "deadline_at", "obligation");
    if (deadlineAt !== undefined) {
      obligation.deadlineAt = deadlineAt;
    }
    const fulfilledAt = readOptionalText(row, "fulfilled_at", "obligation");
    if (fulfilledAt !== undefined) {
      obligation.fulfilledAt = fulfilledAt;
    }
    return obligation;
  }

  #rowToItem(identity: MemoryIdentity, row: Record<string, unknown>): ObligationItem {
    void identity;
    const validator = readRequiredText(row, "validator", "obligation_item");
    if (!isObligationValidatorKind(validator)) {
      throw new MemoryToolError("Invalid obligation item validator in storage.");
    }
    const item: ObligationItem = {
      id: readRequiredText(row, "id", "obligation_item"),
      obligationId: readRequiredText(row, "obligation_id", "obligation_item"),
      seq: readRequiredNumber(row, "seq", "obligation_item"),
      acceptance: readRequiredText(row, "acceptance", "obligation_item"),
      validator,
      validatorConfig: parseValidatorConfigJson(readRequiredText(row, "validator_config_json", "obligation_item")),
      required: readRequiredNumber(row, "required", "obligation_item") === 1,
      createdAt: readRequiredText(row, "created_at", "obligation_item"),
      updatedAt: readRequiredText(row, "updated_at", "obligation_item"),
    };
    const deadlineAt = readOptionalText(row, "deadline_at", "obligation_item");
    if (deadlineAt !== undefined) {
      item.deadlineAt = deadlineAt;
    }
    const verdict = readOptionalText(row, "verdict", "obligation_item");
    if (verdict !== undefined) {
      if (verdict !== "pass" && verdict !== "recoverable_block" && verdict !== "hard_block") {
        throw new MemoryToolError("Invalid obligation item verdict in storage.");
      }
      item.verdict = verdict;
    }
    const verdictReason = readOptionalText(row, "verdict_reason", "obligation_item");
    if (verdictReason !== undefined) {
      item.verdictReason = verdictReason;
    }
    const validatedAt = readOptionalText(row, "validated_at", "obligation_item");
    if (validatedAt !== undefined) {
      item.validatedAt = validatedAt;
    }
    return item;
  }

  #rowToLink(identity: MemoryIdentity, row: Record<string, unknown>): ObligationEvidenceLink {
    const kind = readRequiredText(row, "kind", "obligation_evidence_link");
    if (!isObligationEvidenceRefKind(kind)) {
      throw new MemoryToolError("Invalid obligation evidence link kind in storage.");
    }
    const link: ObligationEvidenceLink = {
      identity: { ...identity },
      obligationId: readRequiredText(row, "obligation_id", "obligation_evidence_link"),
      kind,
      refHash: readRequiredText(row, "ref_hash", "obligation_evidence_link"),
      ref: parseEvidenceRefJson(kind, readRequiredText(row, "ref_json", "obligation_evidence_link")),
      collectedAt: readRequiredText(row, "collected_at", "obligation_evidence_link"),
    };
    const itemId = readOptionalText(row, "item_id", "obligation_evidence_link");
    if (itemId !== undefined) {
      link.itemId = itemId;
    }
    return link;
  }

  #rowToAudit(identity: MemoryIdentity, row: Record<string, unknown>): ObligationAuditRecord {
    const record: ObligationAuditRecord = {
      seq: readRequiredNumber(row, "seq", "obligation_audit_log"),
      identity: { ...identity },
      action: readAuditAction(row),
      recordKind: readRequiredText(row, "record_kind", "obligation_audit_log") === "obligation_item"
        ? "obligation_item"
        : "obligation",
      recordId: readRequiredText(row, "record_id", "obligation_audit_log"),
      operator: readRequiredText(row, "operator", "obligation_audit_log"),
      createdAt: readRequiredText(row, "created_at", "obligation_audit_log"),
    };
    const source = readOptionalText(row, "source", "obligation_audit_log");
    if (source !== undefined) {
      record.source = source;
    }
    const detailJson = readOptionalText(row, "detail_json", "obligation_audit_log");
    if (detailJson !== undefined) {
      record.detail = parseAuditDetailJson(detailJson);
    }
    return record;
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
        `SQLite obligation backend requires Node.js node:sqlite support: ${error instanceof Error ? error.message : String(error)}`,
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

        -- 任务契约（当前态投影；3.0 事件留痕在 obligation_audit_log）
        CREATE TABLE IF NOT EXISTS obligation (
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          agent_instance_id TEXT,
          id TEXT NOT NULL,
          employee_id TEXT NOT NULL,
          requester_user_id TEXT,
          source TEXT NOT NULL,
          statement TEXT NOT NULL,
          status TEXT NOT NULL,
          instance_id TEXT,
          run_id TEXT,
          idempotency_key TEXT,
          budget_json TEXT,
          deadline_at TEXT,
          retry_budget INTEGER NOT NULL DEFAULT 2,
          fulfilled_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, user_id, id)
        );
        CREATE INDEX IF NOT EXISTS obligation_status_idx
          ON obligation (tenant_id, user_id, status);
        CREATE INDEX IF NOT EXISTS obligation_deadline_idx
          ON obligation (tenant_id, user_id, deadline_at);
        CREATE INDEX IF NOT EXISTS obligation_idempotency_idx
          ON obligation (tenant_id, user_id, idempotency_key);

        -- 验收项（完成标准的最小单元；verdict* 为 3.1 预留，3.0 无写入路径）
        CREATE TABLE IF NOT EXISTS obligation_item (
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          id TEXT NOT NULL,
          obligation_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          acceptance TEXT NOT NULL,
          validator TEXT NOT NULL,
          validator_config_json TEXT NOT NULL,
          required INTEGER NOT NULL DEFAULT 1,
          deadline_at TEXT,
          verdict TEXT,
          verdict_reason TEXT,
          validated_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, user_id, id),
          UNIQUE (tenant_id, user_id, obligation_id, seq)
        );
        CREATE INDEX IF NOT EXISTS obligation_item_obligation_idx
          ON obligation_item (tenant_id, user_id, obligation_id);

        -- 证据链：契约/验收项 ↔ 跨 store 证据指针（逻辑外键，不存原文）
        CREATE TABLE IF NOT EXISTS obligation_evidence_link (
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          obligation_id TEXT NOT NULL,
          item_id TEXT,
          kind TEXT NOT NULL,
          ref_hash TEXT NOT NULL,
          ref_json TEXT NOT NULL,
          collected_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, user_id, obligation_id, ref_hash)
        );
        CREATE INDEX IF NOT EXISTS obligation_evidence_link_item_idx
          ON obligation_evidence_link (tenant_id, user_id, item_id);

        -- 审计（append-only；detail_json 只存指针与元数据，不复制 excerpt）
        CREATE TABLE IF NOT EXISTS obligation_audit_log (
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
        CREATE INDEX IF NOT EXISTS obligation_audit_log_identity_idx
          ON obligation_audit_log (tenant_id, user_id);
        CREATE INDEX IF NOT EXISTS obligation_audit_log_record_idx
          ON obligation_audit_log (tenant_id, user_id, record_kind, record_id);
      `);
    } catch (error) {
      database?.close();
      throw new Error(
        `SQLite obligation backend could not initialize schema: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (database === undefined) {
      throw new Error("SQLite obligation backend could not initialize database.");
    }
    return database;
  }
}

// ---------------------------------------------------------------------------
// Row/record helpers
// ---------------------------------------------------------------------------

function buildObligation(identity: MemoryIdentity, write: ObligationWrite, now: string): Obligation {
  const obligation: Obligation = {
    id: write.id ?? `obl_${randomUUID()}`,
    identity: { ...identity },
    employeeId: write.employeeId.trim(),
    source: write.source?.trim() ? write.source.trim() : "rpc",
    statement: write.statement.trim(),
    status: "pending",
    retryBudget: write.retryBudget ?? 2,
    createdAt: now,
    updatedAt: now,
  };
  if (write.requesterUserId?.trim()) {
    obligation.requesterUserId = write.requesterUserId.trim();
  }
  if (write.budget !== undefined) {
    obligation.budget = { ...write.budget };
  }
  if (write.deadlineAt !== undefined) {
    obligation.deadlineAt = write.deadlineAt;
  }
  if (write.carrier?.instanceId?.trim()) {
    obligation.instanceId = write.carrier.instanceId.trim();
  }
  if (write.carrier?.runId?.trim()) {
    obligation.runId = write.carrier.runId.trim();
  }
  if (write.carrier?.idempotencyKey?.trim()) {
    obligation.idempotencyKey = write.carrier.idempotencyKey.trim();
  }
  return obligation;
}

function buildItem(
  identity: MemoryIdentity,
  obligationId: string,
  write: ObligationWrite["items"][number],
  index: number,
  now: string,
): ObligationItem {
  void identity;
  const item: ObligationItem = {
    id: write.id ?? `obi_${randomUUID()}`,
    obligationId,
    seq: write.seq,
    acceptance: write.acceptance.trim(),
    validator: write.validator,
    validatorConfig: { ...(write.validatorConfig ?? {}) },
    required: write.required ?? true,
    createdAt: now,
    updatedAt: now,
  };
  if (write.deadlineAt !== undefined) {
    item.deadlineAt = write.deadlineAt;
  }
  void index;
  return item;
}

function validateObligationWrite(write: ObligationWrite): void {
  if (!write.employeeId?.trim()) {
    throw new MemoryToolError("Obligation employeeId cannot be empty.");
  }
  normalizeBoundedText(write.employeeId, "employeeId", 128);
  if (!write.statement?.trim()) {
    throw new MemoryToolError("Obligation statement cannot be empty.");
  }
  normalizeBoundedText(write.statement, "statement", 4000);
  if (write.source !== undefined) {
    normalizeBoundedText(write.source, "source", 64);
  }
  if (write.requesterUserId !== undefined) {
    normalizeBoundedText(write.requesterUserId, "requesterUserId", 200);
  }
  if (write.deadlineAt !== undefined && !isIsoTimestamp(write.deadlineAt)) {
    throw new MemoryToolError("Obligation deadlineAt must be an ISO timestamp.");
  }
  if (write.retryBudget !== undefined && (!Number.isInteger(write.retryBudget) || write.retryBudget < 0)) {
    throw new MemoryToolError("Obligation retryBudget must be a non-negative integer.");
  }
  if (write.budget !== undefined) {
    validateBudget(write.budget);
  }
  if (write.carrier?.instanceId !== undefined) {
    normalizeBoundedText(write.carrier.instanceId, "instanceId", 200);
  }
  if (write.carrier?.runId !== undefined) {
    normalizeBoundedText(write.carrier.runId, "runId", 200);
  }
  if (write.carrier?.idempotencyKey !== undefined) {
    normalizeBoundedText(write.carrier.idempotencyKey, "idempotencyKey", 200);
  }
  if (!Array.isArray(write.items) || write.items.length === 0) {
    throw new MemoryToolError("Obligation requires at least one acceptance item.");
  }
  const seenSeq = new Set<number>();
  for (const item of write.items) {
    if (!Number.isInteger(item.seq) || item.seq < 1) {
      throw new MemoryToolError("Obligation item seq must be a positive integer.");
    }
    if (seenSeq.has(item.seq)) {
      throw new MemoryToolError("Obligation item seq values must be unique.");
    }
    seenSeq.add(item.seq);
    if (!item.acceptance?.trim()) {
      throw new MemoryToolError("Obligation item acceptance cannot be empty.");
    }
    normalizeBoundedText(item.acceptance, "item acceptance", 2000);
    if (!isObligationValidatorKind(item.validator)) {
      throw new MemoryToolError("Obligation item validator is invalid.");
    }
    if (item.validatorConfig !== undefined && (typeof item.validatorConfig !== "object" || item.validatorConfig === null || Array.isArray(item.validatorConfig))) {
      throw new MemoryToolError("Obligation item validatorConfig must be an object.");
    }
    if (item.deadlineAt !== undefined && !isIsoTimestamp(item.deadlineAt)) {
      throw new MemoryToolError("Obligation item deadlineAt must be an ISO timestamp.");
    }
  }
}

function validateBudget(budget: ObligationBudget): void {
  if (budget.maxTokens !== undefined && (!Number.isFinite(budget.maxTokens) || budget.maxTokens <= 0)) {
    throw new MemoryToolError("Obligation budget.maxTokens must be a positive number.");
  }
  if (budget.maxCostUsd !== undefined && (!Number.isFinite(budget.maxCostUsd) || budget.maxCostUsd < 0)) {
    throw new MemoryToolError("Obligation budget.maxCostUsd must be a non-negative number.");
  }
}

function validateEvidenceLinkWrite(write: ObligationEvidenceLinkWrite): void {
  const ref = write.ref;
  if (ref === null || typeof ref !== "object" || !isObligationEvidenceRefKind((ref as ObligationEvidenceRef).kind)) {
    throw new MemoryToolError("Obligation evidence ref kind is invalid.");
  }
  switch (ref.kind) {
    case "wf_event":
      normalizeBoundedText(ref.instanceId, "wf_event.instanceId", 200);
      if (!Number.isInteger(ref.seq) || ref.seq < 0) {
        throw new MemoryToolError("wf_event evidence ref seq must be a non-negative integer.");
      }
      break;
    case "ontology_evidence":
      normalizeBoundedText(ref.tenantId, "ontology_evidence.tenantId", 200);
      normalizeBoundedText(ref.userId, "ontology_evidence.userId", 200);
      normalizeBoundedText(ref.evidenceId, "ontology_evidence.evidenceId", 200);
      break;
    case "ontology_episode":
      normalizeBoundedText(ref.tenantId, "ontology_episode.tenantId", 200);
      normalizeBoundedText(ref.userId, "ontology_episode.userId", 200);
      normalizeBoundedText(ref.episodeId, "ontology_episode.episodeId", 200);
      break;
    case "step_result":
      normalizeBoundedText(ref.idempotencyKey, "step_result.idempotencyKey", 200);
      break;
  }
}

function validateDanglingQuery(query: ObligationDanglingQuery): void {
  if (query.kind !== "untouched" && query.kind !== "silent" && query.kind !== "unvalidated") {
    throw new MemoryToolError("Invalid obligation dangling query kind.");
  }
  if (!isIsoTimestamp(query.now)) {
    throw new MemoryToolError("Obligation dangling query now must be an ISO timestamp.");
  }
  if (query.olderThan !== undefined && !isIsoTimestamp(query.olderThan)) {
    throw new MemoryToolError("Obligation dangling query olderThan must be an ISO timestamp.");
  }
}

function normalizeBoundedText(value: string, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new MemoryToolError(`Obligation ${field} cannot be empty.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new MemoryToolError(`Obligation ${field} is too long.`);
  }
  return trimmed;
}

function readRequiredText(row: Record<string, unknown>, key: string, source: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new MemoryToolError(`Invalid SQLite obligation record from ${source}: ${key} must be a non-empty string.`);
  }
  return value;
}

function readOptionalText(row: Record<string, unknown>, key: string, source: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new MemoryToolError(`Invalid SQLite obligation record from ${source}: ${key} must be a string.`);
  }
  return value.trim() ? value : undefined;
}

function readRequiredNumber(row: Record<string, unknown>, key: string, source: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MemoryToolError(`Invalid SQLite obligation record from ${source}: ${key} must be a finite number.`);
  }
  return value;
}

function parseBudgetJson(json: string): ObligationBudget {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new MemoryToolError("Invalid SQLite obligation record: budget_json must be valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MemoryToolError("Invalid SQLite obligation record: budget_json must be an object.");
  }
  const budget = parsed as Record<string, unknown>;
  const result: ObligationBudget = {};
  if (typeof budget.maxTokens === "number") {
    result.maxTokens = budget.maxTokens;
  }
  if (typeof budget.maxCostUsd === "number") {
    result.maxCostUsd = budget.maxCostUsd;
  }
  return result;
}

function parseValidatorConfigJson(json: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new MemoryToolError("Invalid SQLite obligation record: validator_config_json must be valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MemoryToolError("Invalid SQLite obligation record: validator_config_json must be an object.");
  }
  return parsed as Record<string, unknown>;
}

function parseEvidenceRefJson(kind: ObligationEvidenceRefKind, json: string): ObligationEvidenceRef {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new MemoryToolError("Invalid SQLite obligation record: ref_json must be valid JSON.");
  }
  const ref = parsed as ObligationEvidenceRef;
  if (ref === null || typeof ref !== "object" || ref.kind !== kind) {
    throw new MemoryToolError("Invalid SQLite obligation record: ref_json kind mismatch.");
  }
  validateEvidenceLinkWrite({ ref });
  return ref;
}

function readAuditAction(row: Record<string, unknown>): ObligationAuditAction {
  const action = readRequiredText(row, "action", "obligation_audit_log");
  if (
    action !== "create"
    && action !== "dispatch"
    && action !== "update_carrier"
    && action !== "attach_evidence"
    && action !== "transition"
  ) {
    throw new MemoryToolError("Invalid obligation audit action in storage.");
  }
  return action;
}

function parseAuditDetailJson(json: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new MemoryToolError("Invalid SQLite obligation record: detail_json must be valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MemoryToolError("Invalid SQLite obligation record: detail_json must be an object.");
  }
  return parsed as Record<string, unknown>;
}
