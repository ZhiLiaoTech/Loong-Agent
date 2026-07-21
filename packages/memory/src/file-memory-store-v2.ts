import path from "node:path";
import type { MemoryIdentity } from "@loong/core";
import { FileMemoryStore } from "./file-memory-store.js";
import { MemoryToolError } from "./memory-tool-error.js";
import type {
  FileMemoryStoreOptions,
  MemoryRecord,
  MemorySearchResult,
} from "./memory-record-types.js";
import {
  assertMemoryIdentity,
  assertMemoryWriteIdentity,
  sanitizeMemoryIdentitySegment,
  type MemoryDraft,
  type MemorySearchContext,
  type MemoryStoreV2,
} from "./memory-store-v2.js";

export type FileMemoryStoreV2Options = FileMemoryStoreOptions;

export function createFileMemoryStoreV2(options: FileMemoryStoreV2Options = {}): MemoryStoreV2 {
  return new FileMemoryStoreV2(options);
}

/**
 * Identity-partitioned JSONL file backend (FR-02).
 *
 * Records are stored under `<rootDir>/<tenantId>/<userId>/records.jsonl`.
 * `rootDir` is configured once at construction; the identity only selects
 * sanitized subdirectories below it. Identity segments are validated
 * (`sanitizeMemoryIdentitySegment`) and the resolved directory is verified to
 * stay inside `rootDir`, so a caller-provided identity can never be used as
 * an arbitrary storage path
 * ("禁止以调用方传入的任意路径作为用户存储目录").
 */
export class FileMemoryStoreV2 implements MemoryStoreV2 {
  readonly #rootDir: string;
  readonly #options: FileMemoryStoreV2Options;

  constructor(options: FileMemoryStoreV2Options = {}) {
    this.#rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".loong", "memory"));
    this.#options = { ...options, rootDir: this.#rootDir };
  }

  async remember(context: MemorySearchContext, record: MemoryDraft): Promise<MemoryRecord> {
    const identity = assertMemoryWriteIdentity(context.identity, record.scope);
    return await this.#storeFor(identity).remember(record);
  }

  async get(context: MemorySearchContext, id: string): Promise<MemoryRecord | undefined> {
    const identity = assertMemoryIdentity(context.identity);
    return await this.#storeFor(identity).get(id);
  }

  async search(context: MemorySearchContext, query: string, limit?: number): Promise<MemorySearchResult[]> {
    const identity = assertMemoryIdentity(context.identity);
    const results = await this.#storeFor(identity).search(query, limit);
    return context.scope === undefined
      ? results
      : results.filter(result => result.record.scope === context.scope);
  }

  /** Resolve (and validate) the per-identity store below the configured rootDir. */
  #storeFor(identity: MemoryIdentity): FileMemoryStore {
    const tenantSegment = sanitizeMemoryIdentitySegment(identity.tenantId, "tenantId");
    const userSegment = sanitizeMemoryIdentitySegment(identity.userId, "userId");
    const identityDir = path.resolve(this.#rootDir, tenantSegment, userSegment);
    const relative = path.relative(this.#rootDir, identityDir);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      // Defense in depth: sanitized segments should make this unreachable.
      throw new MemoryToolError("Memory identity resolves outside the configured memory rootDir.");
    }
    return new FileMemoryStore({ ...this.#options, rootDir: identityDir });
  }
}
