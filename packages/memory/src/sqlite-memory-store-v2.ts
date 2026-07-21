import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { MemoryIdentity } from "@loong/core";
import { ABSOLUTE_MAX_MEMORY_FILE_BYTES, DEFAULT_MAX_MEMORY_FILE_BYTES } from "./file-memory-store.js";
import { MemoryToolError } from "./memory-tool-error.js";
import {
  createMemoryId,
  DEFAULT_MAX_MEMORY_RECORD_BYTES,
  DEFAULT_MAX_MEMORY_RECORDS,
  DEFAULT_MEMORY_SEARCH_LIMIT,
  escapeSqlLike,
  readSqlitePragmaNumber,
  sqliteRankToScore,
  sqliteRowToMemoryRecord,
  stringifyMemoryRecord,
  toSafeFtsQuery,
  validateMemoryDraft,
  ABSOLUTE_MAX_MEMORY_RECORDS,
  ABSOLUTE_MEMORY_SEARCH_LIMIT,
} from "./memory-record-helpers.js";
import {
  ABSOLUTE_MAX_MEMORY_RECORD_BYTES,
  type MemoryRecord,
  type MemorySearchResult,
  type SqliteMemoryStoreOptions,
} from "./memory-record-types.js";
import {
  assertMemoryIdentity,
  assertMemoryWriteIdentity,
  type MemoryDraft,
  type MemorySearchContext,
  type MemoryStoreV2,
} from "./memory-store-v2.js";
import { tokenize } from "./memory-text.js";
import { clampPositiveInteger, isNodeError, stringifyJson } from "./memory-util.js";

export type SqliteMemoryStoreV2Options = SqliteMemoryStoreOptions;

export function createSqliteMemoryStoreV2(options: SqliteMemoryStoreV2Options = {}): MemoryStoreV2 {
  return new SqliteMemoryStoreV2(options);
}

/**
 * Identity-isolated SQLite backend (FR-02).
 *
 * Every record is stored with `tenant_id` and `user_id` columns and EVERY
 * query (remember/get/search, including the FTS join and the LIKE fallback)
 * is forced through identity filters. Identity is mandatory: operations
 * without a trustworthy identity throw instead of touching any data. Records
 * from legacy identity-less tables are never read here; they stay behind the
 * legacy compatibility adapter until migrated.
 */
export class SqliteMemoryStoreV2 implements MemoryStoreV2 {
  readonly #rootDir: string;
  readonly #databasePath: string;
  readonly #memoryOnly: boolean;
  readonly #maxRecords: number;
  readonly #maxRecordBytes: number;
  readonly #maxDatabaseBytes: number;
  #database: DatabaseSync | undefined;
  #databasePromise: Promise<DatabaseSync> | undefined;

  constructor(options: SqliteMemoryStoreV2Options = {}) {
    const defaultRootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".loong", "memory"));
    this.#memoryOnly = options.databasePath === ":memory:";
    this.#databasePath = this.#memoryOnly
      ? ":memory:"
      : path.resolve(options.databasePath ?? path.join(defaultRootDir, "memory-v2.sqlite"));
    this.#rootDir = this.#memoryOnly ? defaultRootDir : path.dirname(this.#databasePath);
    this.#maxRecords = clampPositiveInteger(
      options.maxRecords,
      DEFAULT_MAX_MEMORY_RECORDS,
      ABSOLUTE_MAX_MEMORY_RECORDS,
    );
    this.#maxRecordBytes = clampPositiveInteger(
      options.maxRecordBytes,
      DEFAULT_MAX_MEMORY_RECORD_BYTES,
      ABSOLUTE_MAX_MEMORY_RECORD_BYTES,
    );
    this.#maxDatabaseBytes = clampPositiveInteger(
      options.maxDatabaseBytes,
      DEFAULT_MAX_MEMORY_FILE_BYTES,
      ABSOLUTE_MAX_MEMORY_FILE_BYTES,
    );
  }

  async remember(context: MemorySearchContext, record: MemoryDraft): Promise<MemoryRecord> {
    const identity = assertMemoryWriteIdentity(context.identity, record.scope);
    validateMemoryDraft(record, this.#maxRecordBytes);
    const now = new Date().toISOString();
    const memoryRecord: MemoryRecord = {
      id: createMemoryId(record, now),
      scope: record.scope,
      content: record.content,
      createdAt: now,
    };
    if (record.source !== undefined) {
      memoryRecord.source = record.source;
    }
    if (record.updatedAt !== undefined) {
      memoryRecord.updatedAt = record.updatedAt;
    }
    if (record.metadata !== undefined) {
      memoryRecord.metadata = record.metadata;
    }
    stringifyMemoryRecord(memoryRecord, this.#maxRecordBytes);
    await this.#assertDatabaseCanGrowBy(Buffer.byteLength(memoryRecord.content, "utf8"));

    const database = await this.#getDatabase();
    const metadataJson = memoryRecord.metadata === undefined ? null : stringifyJson(memoryRecord.metadata);
    try {
      database.exec("BEGIN IMMEDIATE");
      database.prepare(`
        INSERT INTO memory_records_v2 (
          tenant_id, user_id, agent_instance_id, id, scope, content, source, created_at, updated_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        identity.tenantId,
        identity.userId,
        identity.agentInstanceId ?? null,
        memoryRecord.id,
        memoryRecord.scope,
        memoryRecord.content,
        memoryRecord.source ?? null,
        memoryRecord.createdAt,
        memoryRecord.updatedAt ?? null,
        metadataJson,
      );
      database.prepare(`
        INSERT INTO memory_records_v2_fts (tenant_id, user_id, id, scope, source, content)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        identity.tenantId,
        identity.userId,
        memoryRecord.id,
        memoryRecord.scope,
        memoryRecord.source ?? "",
        memoryRecord.content,
      );
      this.#pruneOldRecords(database, identity);
      this.#assertOpenDatabaseWithinLimit(database);
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the original SQLite failure.
      }
      throw error;
    }
    return memoryRecord;
  }

  async get(context: MemorySearchContext, id: string): Promise<MemoryRecord | undefined> {
    const identity = assertMemoryIdentity(context.identity);
    const normalizedId = id.trim();
    if (!normalizedId) {
      throw new MemoryToolError("Memory id cannot be empty.");
    }
    const database = await this.#getDatabase();
    const row = database.prepare(`
      SELECT id, scope, content, source, created_at, updated_at, metadata_json
      FROM memory_records_v2
      WHERE tenant_id = ? AND user_id = ? AND id = ?
    `).get(identity.tenantId, identity.userId, normalizedId);
    return row === undefined ? undefined : sqliteRowToMemoryRecord(row, "memory_records_v2");
  }

  async search(context: MemorySearchContext, query: string, limit?: number): Promise<MemorySearchResult[]> {
    const identity = assertMemoryIdentity(context.identity);
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new MemoryToolError("Memory search query cannot be empty.");
    }
    const maxResults = clampPositiveInteger(limit, DEFAULT_MEMORY_SEARCH_LIMIT, ABSOLUTE_MEMORY_SEARCH_LIMIT);
    const database = await this.#getDatabase();
    const queryTokens = tokenize(normalizedQuery);
    const ftsQuery = toSafeFtsQuery(queryTokens);
    if (!ftsQuery) {
      return this.#searchLike(database, identity, normalizedQuery, maxResults, context.scope);
    }

    const scopeClause = context.scope === undefined ? "" : " AND r.scope = ?";
    const params: (string | number)[] = [ftsQuery, identity.tenantId, identity.userId];
    if (context.scope !== undefined) {
      params.push(context.scope);
    }
    params.push(maxResults);
    const rows = database.prepare(`
      SELECT
        r.id,
        r.scope,
        r.content,
        r.source,
        r.created_at,
        r.updated_at,
        r.metadata_json,
        bm25(memory_records_v2_fts) AS rank
      FROM memory_records_v2_fts
      JOIN memory_records_v2 r
        ON r.tenant_id = memory_records_v2_fts.tenant_id
        AND r.user_id = memory_records_v2_fts.user_id
        AND r.id = memory_records_v2_fts.id
      WHERE memory_records_v2_fts MATCH ?
        AND r.tenant_id = ?
        AND r.user_id = ?${scopeClause}
      ORDER BY rank, r.created_at DESC
      LIMIT ?
    `).all(...params);

    return rows.map(row => {
      const rank = typeof row.rank === "number" ? row.rank : 0;
      return {
        record: sqliteRowToMemoryRecord(row, "memory_records_v2_fts"),
        score: sqliteRankToScore(rank),
        reason: `Matched SQLite FTS tokens: ${queryTokens.slice(0, 8).join(", ")}.`,
      };
    });
  }

  close(): void {
    this.#database?.close();
    this.#database = undefined;
    this.#databasePromise = undefined;
  }

  async #assertDatabaseCanGrowBy(bytesToAppend: number): Promise<void> {
    if (this.#memoryOnly) {
      return;
    }
    try {
      const databaseStat = await stat(this.#databasePath);
      if (databaseStat.size + bytesToAppend > this.#maxDatabaseBytes) {
        throw new MemoryToolError(`SQLite memory database would exceed ${this.#maxDatabaseBytes} bytes.`);
      }
    } catch (error) {
      if (error instanceof MemoryToolError) {
        throw error;
      }
      if (isNodeError(error) && error.code === "ENOENT") {
        if (bytesToAppend > this.#maxDatabaseBytes) {
          throw new MemoryToolError(`SQLite memory database would exceed ${this.#maxDatabaseBytes} bytes.`);
        }
        return;
      }
      throw new MemoryToolError("SQLite memory database is unavailable.");
    }
  }

  /** Prune only within the writing identity, so one user can never evict another user's records. */
  #pruneOldRecords(database: DatabaseSync, identity: MemoryIdentity): void {
    const countRow = database.prepare(`
      SELECT COUNT(*) AS count FROM memory_records_v2
      WHERE tenant_id = ? AND user_id = ?
    `).get(identity.tenantId, identity.userId);
    const count = typeof countRow?.count === "number" ? countRow.count : 0;
    const deleteCount = count - this.#maxRecords;
    if (deleteCount <= 0) {
      return;
    }
    database.prepare(`
      DELETE FROM memory_records_v2_fts
      WHERE rowid IN (
        SELECT f.rowid FROM memory_records_v2_fts f
        JOIN memory_records_v2 r
          ON r.tenant_id = f.tenant_id AND r.user_id = f.user_id AND r.id = f.id
        WHERE f.tenant_id = ? AND f.user_id = ?
        ORDER BY r.created_at ASC, r.id ASC
        LIMIT ?
      )
    `).run(identity.tenantId, identity.userId, deleteCount);
    database.prepare(`
      DELETE FROM memory_records_v2
      WHERE tenant_id = ? AND user_id = ? AND id IN (
        SELECT id FROM memory_records_v2
        WHERE tenant_id = ? AND user_id = ?
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      )
    `).run(identity.tenantId, identity.userId, identity.tenantId, identity.userId, deleteCount);
  }

  #assertOpenDatabaseWithinLimit(database: DatabaseSync): void {
    if (this.#memoryOnly) {
      return;
    }
    const pageCount = readSqlitePragmaNumber(database, "PRAGMA page_count", "page_count");
    const pageSize = readSqlitePragmaNumber(database, "PRAGMA page_size", "page_size");
    if (pageCount * pageSize > this.#maxDatabaseBytes) {
      throw new MemoryToolError(`SQLite memory database would exceed ${this.#maxDatabaseBytes} bytes.`);
    }
  }

  async #searchLike(
    database: DatabaseSync,
    identity: MemoryIdentity,
    query: string,
    maxResults: number,
    scope?: MemoryRecord["scope"],
  ): Promise<MemorySearchResult[]> {
    const pattern = `%${escapeSqlLike(query)}%`;
    const scopeClause = scope === undefined ? "" : " AND scope = ?";
    const params: (string | number)[] = [identity.tenantId, identity.userId, pattern, pattern, pattern];
    if (scope !== undefined) {
      params.push(scope);
    }
    params.push(maxResults);
    const rows = database.prepare(`
      SELECT id, scope, content, source, created_at, updated_at, metadata_json
      FROM memory_records_v2
      WHERE tenant_id = ? AND user_id = ?
        AND (content LIKE ? ESCAPE '\\'
          OR scope LIKE ? ESCAPE '\\'
          OR COALESCE(source, '') LIKE ? ESCAPE '\\')${scopeClause}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params);

    return rows.map(row => ({
      record: sqliteRowToMemoryRecord(row, "memory_records_v2_like"),
      score: 1,
      reason: "Matched SQLite fallback LIKE query.",
    }));
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
        `SQLite memory backend requires Node.js node:sqlite support: ${error instanceof Error ? error.message : String(error)}`,
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
        CREATE TABLE IF NOT EXISTS memory_records_v2 (
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          agent_instance_id TEXT,
          id TEXT NOT NULL,
          scope TEXT NOT NULL,
          content TEXT NOT NULL,
          source TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          metadata_json TEXT,
          PRIMARY KEY (tenant_id, user_id, id)
        );
        CREATE INDEX IF NOT EXISTS memory_records_v2_identity_idx
          ON memory_records_v2 (tenant_id, user_id);
        CREATE INDEX IF NOT EXISTS memory_records_v2_identity_scope_idx
          ON memory_records_v2 (tenant_id, user_id, scope);
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_records_v2_fts
        USING fts5(tenant_id UNINDEXED, user_id UNINDEXED, id UNINDEXED, scope, source, content);
      `);
    } catch (error) {
      database?.close();
      throw new Error(
        `SQLite memory backend could not initialize schema: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (database === undefined) {
      throw new Error("SQLite memory backend could not initialize database.");
    }
    return database;
  }
}
