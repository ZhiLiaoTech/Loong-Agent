import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLoongRuntime, type MemoryIdentity } from "@loong/core";
import {
  createFileMemoryStore,
  createFileMemoryStoreV2,
  createLegacyMemoryStoreV2,
  createSqliteMemoryStoreV2,
  LOCAL_COMPAT_MEMORY_IDENTITY,
  type MemorySearchContext,
  type MemoryStoreV2,
} from "@loong/memory";
import { assert } from "../lib/test-helpers.js";
import type { TestCase } from "../runner.js";

/**
 * Phase 1 (身份与隔离) acceptance tests for the ontology memory upgrade.
 * See docs/ONTOLOGY_MEMORY_REQUIREMENTS.md §11.1: cross-user/cross-tenant
 * leakage must be zero.
 */

function identity(tenantId: string, userId: string): MemoryIdentity {
  return { tenantId, userId };
}

function context(identityValue: MemoryIdentity): MemorySearchContext {
  return { identity: identityValue };
}

async function assertRejects(fn: () => Promise<unknown>, pattern: RegExp, message: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    assert(pattern.test(text), `${message} (unexpected error: ${text})`);
    return;
  }
  throw new Error(message);
}

/**
 * §11.1 target: 1000 cross-user isolation checks with zero leakage.
 * Each iteration writes overlapping-content records for two identities
 * (cross-user same-tenant or same-user cross-tenant) and verifies search and
 * get stay inside the caller's identity.
 */
async function testSqliteMemoryV2CrossUserIsolation(): Promise<void> {
  const store = createSqliteMemoryStoreV2({ databasePath: ":memory:" });
  const ITERATIONS = 1000;
  let checks = 0;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const crossTenant = i % 3 === 0;
    const identityA = identity(`tenant-${i % 5}`, `user-${i}`);
    const identityB = crossTenant
      ? identity(`tenant-other-${i % 2}`, identityA.userId) // same user id, different tenant
      : identity(identityA.tenantId, `user-other-${i}`); // same tenant, different user
    const markerA = `mk${i}a`;
    const markerB = `mk${i}b`;
    const recordA = await store.remember(context(identityA), {
      scope: "user",
      content: `zephyr preference ${markerA}`,
      source: "isolation-test",
    });
    await store.remember(context(identityB), {
      scope: "user",
      content: `zephyr preference ${markerB}`,
      source: "isolation-test",
    });

    const resultsA = await store.search(context(identityA), "zephyr preference");
    assert(
      resultsA.length === 1 && resultsA[0]?.record.id === recordA.id,
      `iteration ${i}: identity A should see exactly its own record, got ${resultsA.length}`,
    );
    assert(
      resultsA.every(result => result.record.content.includes(markerA) && !result.record.content.includes(markerB)),
      `iteration ${i}: identity A results must only contain A markers`,
    );
    checks += 1;

    const stolen = await store.search(context(identityB), markerA);
    assert(stolen.length === 0, `iteration ${i}: identity B must not find A's record by unique token`);
    checks += 1;

    const crossGet = await store.get(context(identityB), recordA.id);
    assert(crossGet === undefined, `iteration ${i}: identity B must not read A's record by id`);
    checks += 1;
  }
  assert(checks === ITERATIONS * 3, `expected ${ITERATIONS * 3} isolation checks, ran ${checks}`);
}

/** File backend: same isolation battery, plus on-disk layout verification. */
async function testFileMemoryV2CrossUserIsolation(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-memory-v2-file-"));
  try {
    const store = createFileMemoryStoreV2({ rootDir: root });
    const ITERATIONS = 150;
    let checks = 0;
    for (let i = 0; i < ITERATIONS; i += 1) {
      const crossTenant = i % 3 === 0;
      const identityA = identity(`tenant-${i % 5}`, `user-${i}`);
      const identityB = crossTenant
        ? identity(`tenant-other-${i % 2}`, identityA.userId)
        : identity(identityA.tenantId, `user-other-${i}`);
      const markerA = `mk${i}a`;
      const markerB = `mk${i}b`;
      const recordA = await store.remember(context(identityA), {
        scope: "user",
        content: `zephyr preference ${markerA}`,
        source: "isolation-test",
      });
      await store.remember(context(identityB), {
        scope: "user",
        content: `zephyr preference ${markerB}`,
        source: "isolation-test",
      });

      const resultsA = await store.search(context(identityA), "zephyr preference");
      assert(
        resultsA.length === 1 && resultsA[0]?.record.id === recordA.id,
        `iteration ${i}: identity A should see exactly its own record, got ${resultsA.length}`,
      );
      checks += 1;

      const stolen = await store.search(context(identityB), markerA);
      assert(stolen.length === 0, `iteration ${i}: identity B must not find A's record by unique token`);
      checks += 1;

      const crossGet = await store.get(context(identityB), recordA.id);
      assert(crossGet === undefined, `iteration ${i}: identity B must not read A's record by id`);
      checks += 1;
    }
    assert(checks === ITERATIONS * 3, `expected ${ITERATIONS * 3} isolation checks, ran ${checks}`);

    // On-disk layout: <rootDir>/<tenantId>/<userId>/records.jsonl, nothing else.
    const tenantDirs = await readdir(root);
    assert(tenantDirs.length > 0, "expected per-tenant directories under rootDir");
    for (const tenantDir of tenantDirs) {
      assert(!tenantDir.includes(".."), `tenant directory must be sanitized, got ${tenantDir}`);
      const userDirs = await readdir(path.join(root, tenantDir));
      for (const userDir of userDirs) {
        const recordFile = path.join(root, tenantDir, userDir, "records.jsonl");
        await stat(recordFile); // throws if the per-identity JSONL file is missing
        const resolved = path.resolve(recordFile);
        assert(
          !path.relative(path.resolve(root), resolved).startsWith(".."),
          "identity directories must stay inside rootDir",
        );
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * §4.1: without a trustworthy identity, user-scope writes are refused.
 * Design choice (documented in the V2 contract): identity is mandatory for
 * ALL V2 operations — search/get without identity throw instead of returning
 * empty results, so a missing identity can never silently degrade into a
 * shared bucket.
 */
async function testMemoryV2MissingIdentityRules(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-memory-v2-rules-"));
  const stores: Array<[name: string, store: MemoryStoreV2]> = [];
  try {
    stores.push(
      ["file", createFileMemoryStoreV2({ rootDir: path.join(root, "file") })],
      ["sqlite", createSqliteMemoryStoreV2({ databasePath: path.join(root, "memory.sqlite") })],
    );
    for (const [name, store] of stores) {
      const noIdentity = { identity: undefined } as unknown as MemorySearchContext;
      const emptyTenant = context(identity("", "user-1"));
      const blankUser = context(identity("tenant-1", "   "));

      await assertRejects(
        () => store.remember(noIdentity, { scope: "user", content: "user fact" }),
        /trustworthy identity/,
        `${name}: user-scope write without identity must be refused`,
      );
      await assertRejects(
        () => store.remember(noIdentity, { scope: "session", content: "session note" }),
        /trustworthy identity/,
        `${name}: write without identity must be refused`,
      );
      await assertRejects(
        () => store.remember(emptyTenant, { scope: "user", content: "user fact" }),
        /trustworthy identity/,
        `${name}: empty tenantId must be refused`,
      );
      await assertRejects(
        () => store.remember(blankUser, { scope: "user", content: "user fact" }),
        /trustworthy identity/,
        `${name}: blank userId must be refused`,
      );
      await assertRejects(
        () => store.search(noIdentity, "user fact"),
        /trustworthy identity/,
        `${name}: search without identity must throw`,
      );
      await assertRejects(
        () => store.get(noIdentity, "some-id"),
        /trustworthy identity/,
        `${name}: get without identity must throw`,
      );

      // With a trustworthy identity, user-scope writes work and are searchable.
      const alice = context(identity("tenant-1", "alice"));
      const record = await store.remember(alice, { scope: "user", content: "alice prefers teal interfaces" });
      const found = await store.search(alice, "teal interfaces");
      assert(found.some(result => result.record.id === record.id), `${name}: own user-scope record should be searchable`);
      const loaded = await store.get(alice, record.id);
      assert(loaded?.id === record.id, `${name}: own record should be readable by id`);
    }
  } finally {
    for (const [, store] of stores) {
      (store as { close?: () => void }).close?.();
    }
    await rm(root, { recursive: true, force: true });
  }
}

/** FR-03: legacy adapter serves old data to the compat identity only. */
async function testLegacyMemoryStoreV2Adapter(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-memory-v2-legacy-"));
  try {
    const legacy = createFileMemoryStore({ rootDir: root });
    const userRecord = await legacy.remember({ scope: "user", content: "legacy user prefers dark mode" });
    await legacy.remember({ scope: "session", content: "legacy session scratch note" });

    const adapter = createLegacyMemoryStoreV2(legacy);
    const compat = context(LOCAL_COMPAT_MEMORY_IDENTITY);
    const online = context(identity("default", "alice"));

    const compatResults = await adapter.search(compat, "legacy");
    assert(compatResults.length === 2, `compat identity should see both legacy records, got ${compatResults.length}`);
    const loaded = await adapter.get(compat, userRecord.id);
    assert(loaded?.id === userRecord.id, "compat identity should read legacy records by id");

    await assertRejects(
      () => adapter.search(online, "legacy"),
      /compatibility data/,
      "legacy data must not be attributed to an online user",
    );
    await assertRejects(
      () => adapter.remember(online, { scope: "user", content: "alice fact" }),
      /compatibility data/,
      "online user must not write into the legacy bucket",
    );
    await assertRejects(
      () => adapter.get(online, userRecord.id),
      /compatibility data/,
      "online user must not read the legacy bucket by id",
    );

    // Writes through the adapter land in the same underlying bucket.
    await adapter.remember(compat, { scope: "project", content: "compat adapter write visible to legacy store" });
    const legacyResults = await legacy.search("compat adapter write");
    assert(legacyResults.length === 1, "adapter writes should stay in the legacy single-user bucket");

    // Explicit operator attribution: a configured compat identity opts a real
    // user into the legacy bucket (never automatic).
    const attributed = createLegacyMemoryStoreV2(legacy, {
      compatIdentity: { tenantId: "default", userId: "alice" },
    });
    const aliceResults = await attributed.search(online, "legacy");
    assert(
      aliceResults.some(result => result.record.id === userRecord.id)
        && aliceResults.length >= compatResults.length,
      "explicitly attributed identity should see the legacy records",
    );
    await assertRejects(
      () => attributed.search(compat, "legacy"),
      /compatibility data/,
      "default compat identity should not match a custom compat identity",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** FR-02: identity segments can never be used as arbitrary storage paths. */
async function testFileMemoryV2SanitizesIdentitySegments(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-memory-v2-sanitize-"));
  try {
    const store = createFileMemoryStoreV2({ rootDir: root });
    const badSegments = ["../evil", "a/b", "a\\b", "", "   ", ".", "..", "sub/dir/records"];
    for (const bad of badSegments) {
      await assertRejects(
        () => store.remember(context(identity(bad, "user-1")), { scope: "user", content: "escape attempt" }),
        /Invalid memory identity|trustworthy identity/,
        `tenantId ${JSON.stringify(bad)} must be rejected on write`,
      );
      await assertRejects(
        () => store.search(context(identity(bad, "user-1")), "escape attempt"),
        /Invalid memory identity|trustworthy identity/,
        `tenantId ${JSON.stringify(bad)} must be rejected on search`,
      );
      await assertRejects(
        () => store.remember(context(identity("tenant-1", bad)), { scope: "user", content: "escape attempt" }),
        /Invalid memory identity|trustworthy identity/,
        `userId ${JSON.stringify(bad)} must be rejected on write`,
      );
    }

    // A valid identity still works and stays inside rootDir.
    const valid = context(identity("tenant-1", "user-1"));
    await store.remember(valid, { scope: "user", content: "legit record" });
    await stat(path.join(root, "tenant-1", "user-1", "records.jsonl"));

    // No rejected identity created directories anywhere (especially outside root).
    const rootEntries = await readdir(root);
    assert(
      rootEntries.length === 1 && rootEntries[0] === "tenant-1",
      `only the valid tenant directory should exist, got ${JSON.stringify(rootEntries)}`,
    );
    const tenantEntries = await readdir(path.join(root, "tenant-1"));
    assert(
      tenantEntries.length === 1 && tenantEntries[0] === "user-1",
      `only the valid user directory should exist, got ${JSON.stringify(tenantEntries)}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Scope filter on the search context applies on top of identity isolation. */
async function testMemoryV2ScopeFiltering(): Promise<void> {
  const store = createSqliteMemoryStoreV2({ databasePath: ":memory:" });
  const alice = context(identity("tenant-1", "alice"));
  await store.remember(alice, { scope: "user", content: "shared scopecheck user fact" });
  await store.remember(alice, { scope: "project", content: "shared scopecheck project note" });

  const userOnly = await store.search({ identity: alice.identity, scope: "user" }, "scopecheck");
  assert(
    userOnly.length > 0 && userOnly.every(result => result.record.scope === "user"),
    "scope filter should return only user records",
  );
  const all = await store.search(alice, "scopecheck");
  assert(all.length === 2, `unscoped search should return both records, got ${all.length}`);
}

/** FR-01: runtime threads turn identity to context providers and lifecycle hooks. */
async function testRuntimeThreadsIdentityToProvidersAndHooks(): Promise<void> {
  const provider = {
    id: "mock",
    displayName: "Mock",
    defaultModel: "mock-model",
    supportsToolCalling: false,
    async complete() {
      return { id: "mock-response", text: "ack" };
    },
  };
  let providerIdentity: MemoryIdentity | undefined;
  let hookStartIdentity: MemoryIdentity | undefined;
  let hookEndIdentity: MemoryIdentity | undefined;
  const runtime = createLoongRuntime({
    providers: [provider],
    defaultModel: "mock-model",
    contextProviders: [{
      name: "identity-capture",
      async buildContext(request) {
        providerIdentity = request.identity;
        return [];
      },
    }],
    lifecycleHooks: [{
      name: "identity-capture-hook",
      onLifecycle(request) {
        if (request.phase === "start") {
          hookStartIdentity = request.identity;
        }
        if (request.phase === "end") {
          hookEndIdentity = request.identity;
        }
      },
    }],
  });

  await runtime.runTurn({
    sessionId: "identity-session",
    source: "cli",
    message: "hello with identity",
    identity: { tenantId: "default", userId: "runtime-user" },
  });
  assert(providerIdentity?.userId === "runtime-user", "context provider should receive the turn identity");
  assert(providerIdentity?.tenantId === "default", "context provider should receive the turn tenant");
  assert(hookStartIdentity?.userId === "runtime-user", "lifecycle hook start should receive the turn identity");
  assert(hookEndIdentity?.userId === "runtime-user", "lifecycle hook end should receive the turn identity");

  // Backward compatibility: turns without identity behave exactly as before.
  providerIdentity = undefined;
  hookStartIdentity = undefined;
  hookEndIdentity = undefined;
  const result = await runtime.runTurn({ sessionId: "plain-session", source: "cli", message: "hello without identity" });
  assert(result.status === "ok", "turn without identity should still succeed");
  assert(providerIdentity === undefined, "context provider should see no identity for anonymous turns");
  assert(hookStartIdentity === undefined, "lifecycle hook should see no identity for anonymous turns");
  assert(hookEndIdentity === undefined, "lifecycle end hook should see no identity for anonymous turns");
}

export const memoryV2TestCases: TestCase[] = [
  ["memory v2 sqlite cross-user isolation (1000 checks)", testSqliteMemoryV2CrossUserIsolation],
  ["memory v2 file cross-user isolation", testFileMemoryV2CrossUserIsolation],
  ["memory v2 missing identity rules", testMemoryV2MissingIdentityRules],
  ["memory v2 legacy adapter compat identity", testLegacyMemoryStoreV2Adapter],
  ["memory v2 file backend sanitizes identity segments", testFileMemoryV2SanitizesIdentitySegments],
  ["memory v2 scope filtering", testMemoryV2ScopeFiltering],
  ["runtime threads identity to providers and hooks", testRuntimeThreadsIdentityToProvidersAndHooks],
];
