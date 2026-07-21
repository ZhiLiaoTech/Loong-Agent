import type { MemoryIdentity } from "@loong/core";
import { MemoryToolError } from "./memory-tool-error.js";
import type { MemoryRecord, MemorySearchResult } from "./memory-record-types.js";

/**
 * Phase 1 of the ontology memory upgrade (docs/ONTOLOGY_MEMORY_REQUIREMENTS.md
 * §4.1, §7.1 FR-02/FR-03): identity-scoped memory store contract.
 *
 * Every read and write is forced through a `MemoryIdentity`. Without a
 * trustworthy identity, user-scope writes are refused; no implementation may
 * silently fall back to another tenant's or user's data.
 */

export type MemoryDraft = Omit<MemoryRecord, "id" | "createdAt">;

export interface MemorySearchContext {
  identity: MemoryIdentity;
  scope?: MemoryRecord["scope"];
  workspace?: string;
  now?: string;
}

export interface MemoryStoreV2 {
  remember(context: MemorySearchContext, record: MemoryDraft): Promise<MemoryRecord>;
  get(context: MemorySearchContext, id: string): Promise<MemoryRecord | undefined>;
  search(context: MemorySearchContext, query: string, limit?: number): Promise<MemorySearchResult[]>;
}

/**
 * Local single-user compatibility identity (FR-03).
 *
 * Data written through legacy `MemoryStore` backends has no trustworthy
 * tenant/user attribution. Until it is migrated it may only be served as
 * local single-user compatibility data under this identity and must never be
 * automatically attributed to an online user
 * ("旧数据迁移前只能作为本地单用户兼容数据，不得自动归属到某个线上用户").
 */
export const LOCAL_COMPAT_TENANT_ID = "local-compat";
export const LOCAL_COMPAT_USER_ID = "local-user";
export const LOCAL_COMPAT_MEMORY_IDENTITY: MemoryIdentity = {
  tenantId: LOCAL_COMPAT_TENANT_ID,
  userId: LOCAL_COMPAT_USER_ID,
};

/** Pattern for identity segments used as file-system directory names. */
const IDENTITY_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isMemoryIdentity(value: unknown): value is MemoryIdentity {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.tenantId === "string"
    && candidate.tenantId.trim().length > 0
    && typeof candidate.userId === "string"
    && candidate.userId.trim().length > 0
    && (candidate.agentInstanceId === undefined
      || (typeof candidate.agentInstanceId === "string" && candidate.agentInstanceId.trim().length > 0))
  );
}

/**
 * Require a trustworthy identity for any V2 store operation. Implementations
 * must call this before touching storage; identity is mandatory, never
 * defaulted from ambient state.
 */
export function assertMemoryIdentity(identity: MemoryIdentity | undefined): MemoryIdentity {
  if (!isMemoryIdentity(identity)) {
    throw new MemoryToolError(
      "Memory operations require a trustworthy identity (tenantId and userId).",
    );
  }
  return identity;
}

/**
 * Enforce the §4.1 write rule: without a trustworthy identity, session memory
 * may still work elsewhere, but user-scope writes must be refused.
 */
export function assertMemoryWriteIdentity(
  identity: MemoryIdentity | undefined,
  scope: MemoryRecord["scope"],
): MemoryIdentity {
  if (!isMemoryIdentity(identity)) {
    if (scope === "user") {
      throw new MemoryToolError(
        "User-scope memory writes require a trustworthy identity; refusing to write without one.",
      );
    }
    throw new MemoryToolError(
      "Memory operations require a trustworthy identity (tenantId and userId).",
    );
  }
  return identity;
}

/**
 * Validate an identity segment for use as a single directory name.
 * Rejects empty values, path separators, and `.`/`..` traversal segments so a
 * caller-provided identity can never escape the configured store rootDir
 * ("禁止以调用方传入的任意路径作为用户存储目录").
 */
export function sanitizeMemoryIdentitySegment(segment: string, field: string): string {
  const trimmed = segment.trim();
  if (!IDENTITY_SEGMENT_PATTERN.test(trimmed) || trimmed === "." || trimmed === "..") {
    throw new MemoryToolError(
      `Invalid memory identity ${field}: must be 1-128 chars of [A-Za-z0-9._-], start with an alphanumeric, and contain no path separators.`,
    );
  }
  return trimmed;
}
