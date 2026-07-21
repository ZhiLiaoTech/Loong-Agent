import type { MemoryIdentity } from "@loong/core";
import { MemoryToolError } from "./memory-tool-error.js";
import type { MemoryRecord, MemorySearchResult, MemoryStore } from "./memory-record-types.js";
import {
  assertMemoryWriteIdentity,
  isMemoryIdentity,
  LOCAL_COMPAT_MEMORY_IDENTITY,
  type MemoryDraft,
  type MemorySearchContext,
  type MemoryStoreV2,
} from "./memory-store-v2.js";

export interface LegacyMemoryStoreV2Options {
  /**
   * Identity under which the wrapped legacy data is served. Defaults to
   * `LOCAL_COMPAT_MEMORY_IDENTITY` ("local-compat"/"local-user").
   *
   * Operators may explicitly set this to a real identity to attribute legacy
   * local data to that user; this must be an explicit operator decision, never
   * an automatic mapping ("不得自动归属到某个线上用户").
   */
  compatIdentity?: MemoryIdentity;
}

/**
 * FR-03 compatibility adapter: wraps any legacy `MemoryStore` (file/sqlite)
 * as a `MemoryStoreV2`.
 *
 * Legacy records carry no trustworthy tenant/user attribution, so until they
 * are migrated they are served ONLY as local single-user compatibility data:
 *
 * - All operations require the context identity to exactly match the
 *   configured `compatIdentity`; any other identity is refused rather than
 *   silently reading or writing another user's data.
 * - The wrapped store remains a single shared bucket; do NOT expose this
 *   adapter in multi-user serving paths.
 */
export function createLegacyMemoryStoreV2(
  store: MemoryStore,
  options: LegacyMemoryStoreV2Options = {},
): MemoryStoreV2 {
  return new LegacyMemoryStoreV2(store, options);
}

export class LegacyMemoryStoreV2 implements MemoryStoreV2 {
  readonly #store: MemoryStore;
  readonly #compatIdentity: MemoryIdentity;

  constructor(store: MemoryStore, options: LegacyMemoryStoreV2Options = {}) {
    this.#store = store;
    this.#compatIdentity = options.compatIdentity ?? LOCAL_COMPAT_MEMORY_IDENTITY;
    if (!isMemoryIdentity(this.#compatIdentity)) {
      throw new MemoryToolError("Legacy memory compat identity must include tenantId and userId.");
    }
  }

  get compatIdentity(): MemoryIdentity {
    return this.#compatIdentity;
  }

  async remember(context: MemorySearchContext, record: MemoryDraft): Promise<MemoryRecord> {
    this.#assertCompatIdentity(context.identity, record.scope);
    return await this.#store.remember(record);
  }

  async get(context: MemorySearchContext, id: string): Promise<MemoryRecord | undefined> {
    this.#assertCompatIdentity(context.identity);
    return await this.#store.get(id);
  }

  async search(context: MemorySearchContext, query: string, limit?: number): Promise<MemorySearchResult[]> {
    this.#assertCompatIdentity(context.identity);
    const results = await this.#store.search(query, limit);
    return context.scope === undefined
      ? results
      : results.filter(result => result.record.scope === context.scope);
  }

  #assertCompatIdentity(identity: MemoryIdentity | undefined, scope?: MemoryRecord["scope"]): void {
    const resolved = assertMemoryWriteIdentity(identity, scope ?? "session");
    if (
      resolved.tenantId !== this.#compatIdentity.tenantId
      || resolved.userId !== this.#compatIdentity.userId
    ) {
      throw new MemoryToolError(
        "Legacy memory data is local single-user compatibility data and cannot be attributed to this identity.",
      );
    }
  }
}
