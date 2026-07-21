import type { LoongLifecycleHookRequest, MemoryIdentity } from "@loong/core";
import {
  anyConsolidationTriggerFired,
  createOntologyCandidateLifecycleHook,
  createOntologyConsolidator,
  createOntologyResolver,
  createOntologySnapshotter,
  createSqliteOntologyStore,
  estimateSnapshotTokens,
  ONTOLOGY_SELF_ENTITY_NAME,
  verifySnapshotRebuild,
  type OntologyCandidateDraft,
  type OntologyStore,
} from "@loong/memory";
import { assert, delay } from "../lib/test-helpers.js";
import type { TestCase } from "../runner.js";

/**
 * Phase 3 (演化与压缩) acceptance tests: FR-08 consolidator, Profile Snapshot
 * generation + reversible rebuild (§11.3), valid-time management, raw
 * retention (§4.6).
 */

function identity(tenantId: string, userId: string): MemoryIdentity {
  return { tenantId, userId };
}

function hookRequest(overrides: Partial<LoongLifecycleHookRequest>): LoongLifecycleHookRequest {
  return {
    phase: "end",
    status: "ok",
    runId: "run-p3-1",
    sessionId: "session-p3-1",
    source: "cli",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

interface SeedAssertionOptions {
  objectValue?: string;
  confidence?: number;
  sourceType?: "explicit" | "observed" | "inferred" | "imported";
  status?: "candidate" | "active";
  validFrom?: string;
  validTo?: string;
}

/** Seed an entity + evidence + assertion directly through the store. */
async function seedAssertion(
  store: OntologyStore,
  alice: MemoryIdentity,
  subjectId: string,
  predicate: string,
  options: SeedAssertionOptions & { objectEntityId?: string } = {},
) {
  const evidence = await store.insertEvidence(alice, {
    source: "p3-test",
    excerpt: `seed excerpt for ${predicate} ${options.objectValue ?? options.objectEntityId ?? ""}`,
  });
  return await store.insertAssertion(alice, {
    subjectId,
    predicate,
    ...(options.objectEntityId !== undefined ? { objectEntityId: options.objectEntityId } : {}),
    ...(options.objectValue !== undefined ? { objectValue: options.objectValue } : {}),
    confidence: options.confidence ?? 0.9,
    sourceType: options.sourceType ?? "explicit",
    status: options.status ?? "active",
    ...(options.validFrom !== undefined ? { validFrom: options.validFrom } : {}),
    ...(options.validTo !== undefined ? { validTo: options.validTo } : {}),
    evidenceIds: [evidence.id],
  });
}

/** FR-08: exact canonical-name/alias duplicates merge; fuzzy ones must not. */
async function testConsolidateMergesExactDuplicateEntities(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p3", "alice");
  const resolver = createOntologyResolver({ store });
  const consolidator = createOntologyConsolidator({ store });

  const self = await store.insertEntity(alice, { type: "Person", canonicalName: ONTOLOGY_SELF_ENTITY_NAME });
  // Distinct createdAt timestamps make the survivor rule (earliest created) deterministic.
  const survivor = await store.insertEntity(alice, { type: "Tool", canonicalName: "VS Code", aliases: ["code"] });
  await delay(5);
  const dupByName = await store.insertEntity(alice, { type: "Tool", canonicalName: "vs code" });
  await delay(5);
  const dupByAlias = await store.insertEntity(alice, { type: "Tool", canonicalName: "Visual Studio Code", aliases: ["Code"] });

  // Assertions referencing the duplicates (subject AND object positions).
  const draft: OntologyCandidateDraft = {
    subject: { type: "Person", name: ONTOLOGY_SELF_ENTITY_NAME },
    predicate: "usesTool",
    objectEntity: { type: "Tool", name: "VS Code" },
    sourceType: "explicit",
    excerpt: "user said they use VS Code",
  };
  const first = await resolver.ingestCandidate(alice, draft);
  if (first.kind !== "stored") {
    throw new Error("unreachable");
  }
  await resolver.promoteAssertion(alice, first.assertion.id);

  const evidenceB = await store.insertEvidence(alice, { source: "p3-test", excerpt: "user mentioned vscode again" });
  const candidateOnDup = await store.insertAssertion(alice, {
    subjectId: self.id,
    predicate: "usesTool",
    objectEntityId: dupByName.id,
    confidence: 0.8,
    sourceType: "explicit",
    status: "candidate",
    evidenceIds: [evidenceB.id],
  });
  const assertionOnAliasDup = await seedAssertion(store, alice, dupByAlias.id, "relatedToProject", { objectValue: "Loong" });

  const report = await consolidator.consolidate(alice, { requested: true, reason: "user asked to tidy memory" });
  assert(report.entityMerges.length === 1, `expected one merge component, got ${report.entityMerges.length}`);
  const merge = report.entityMerges[0]!;
  assert(merge.survivingEntity.id === survivor.id, "the earliest-created entity should survive");
  assert(merge.mergedEntityIds.includes(dupByName.id) && merge.mergedEntityIds.includes(dupByAlias.id), "both duplicates should be merged");
  assert(merge.repointedAssertions >= 2, `assertions should be re-pointed, got ${merge.repointedAssertions}`);

  // Merged-away entities are "merged", NOT deleted (§4.6 raw retention).
  const mergedB = await store.getEntity(alice, dupByName.id);
  const mergedC = await store.getEntity(alice, dupByAlias.id);
  assert(mergedB?.status === "merged" && mergedC?.status === "merged", "merged entities keep their rows with status merged");

  // Survivor holds the union of aliases (incl. merged canonical names).
  const updatedSurvivor = await store.getEntity(alice, survivor.id);
  for (const alias of ["code", "Code", "vs code", "Visual Studio Code"]) {
    assert(updatedSurvivor!.aliases.includes(alias), `survivor aliases should include ${JSON.stringify(alias)}`);
  }

  // Alias resolution now lands on the survivor (merged rows stay queryable
  // with status "merged", so the ACTIVE match is the survivor).
  const resolved = await store.findEntitiesByName(alice, "vs code");
  const resolvedActive = resolved.filter(entity => entity.status === "active");
  assert(resolvedActive.length === 1 && resolvedActive[0]?.id === survivor.id, "alias of a merged entity resolves to the survivor");

  // Post-merge fact dedup: the two usesTool assertions became identical → one
  // kept (the active one), one superseded, evidence merged (FR-06).
  const usesToolAssertions = await store.findAssertions(alice, { predicate: "usesTool", status: ["active", "candidate"] });
  assert(usesToolAssertions.length === 1, `exactly one parallel usesTool assertion should remain, got ${usesToolAssertions.length}`);
  const kept = usesToolAssertions[0]!;
  assert(kept.status === "active" && kept.objectEntityId === survivor.id, "the active assertion on the survivor is kept");
  assert(kept.evidenceIds.length === 2, "evidence from the duplicate is merged");
  const absorbed = await store.getAssertion(alice, candidateOnDup.id);
  assert(absorbed?.status === "superseded", "the duplicate assertion is superseded, not deleted");

  // Assertions with a merged entity as SUBJECT were re-pointed too.
  const repointed = await store.getAssertion(alice, assertionOnAliasDup.id);
  assert(repointed?.subjectId === survivor.id, "assertion subject should be re-pointed to the survivor");

  // Audit trail: entity updates, re-points and the consolidation summary.
  const audit = await store.listAuditEntries(alice);
  const actions = audit.map(entry => entry.action);
  assert(actions.includes("repoint_assertions"), "re-point writes are audited");
  assert(actions.includes("update_entity"), "entity merges are audited");
  assert(actions.includes("consolidate"), "the consolidation run writes an audit summary");
  const summary = audit.find(entry => entry.action === "consolidate");
  assert(summary?.detail?.reason === "user asked to tidy memory", "audit summary keeps the run reason");

  // Fuzzy-near names are NOT auto-merged (§10 高置信规则).
  const fuzzy1 = await store.insertEntity(alice, { type: "Tool", canonicalName: "VS Code Insiders" });
  const fuzzy2 = await store.insertEntity(alice, { type: "Tool", canonicalName: "Cursor" });
  const fuzzy3 = await store.insertEntity(alice, { type: "Tool", canonicalName: "Cursor Pro" });
  const fuzzyReport = await consolidator.consolidate(alice, { requested: true });
  assert(fuzzyReport.entityMerges.length === 0, "fuzzy-near entities must stay separate");
  for (const entity of [fuzzy1, fuzzy2, fuzzy3]) {
    assert((await store.getEntity(alice, entity.id))?.status === "active", "fuzzy entities stay active");
  }
  store.close?.();
}

/** §6.4/FR-11: snapshot selection keeps only stable, high-confidence, current, non-sensitive facts. */
async function testSnapshotSelectionRules(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p3-snap", "alice");
  const snapshotter = createOntologySnapshotter({ store });

  const self = await store.insertEntity(alice, { type: "Person", canonicalName: ONTOLOGY_SELF_ENTITY_NAME });
  const secret = await store.insertEntity(alice, { type: "Person", canonicalName: "secret-self", sensitivity: "sensitive" });

  const included1 = await seedAssertion(store, alice, self.id, "prefers", { objectValue: "深色主题", confidence: 0.9 });
  const included2 = await seedAssertion(store, alice, self.id, "madeDecision", { objectValue: "周五上线", confidence: 0.7 });
  await seedAssertion(store, alice, self.id, "prefers", { objectValue: "咖啡", confidence: 0.5 }); // below minConfidence
  await seedAssertion(store, alice, self.id, "prefers", { objectValue: "瑜伽", sourceType: "inferred", confidence: 0.7 }); // inferred below stricter threshold
  await seedAssertion(store, alice, self.id, "prefers", { objectValue: "冷门偏好", status: "candidate", confidence: 0.95 }); // not active
  await seedAssertion(store, alice, secret.id, "prefers", { objectValue: "隐私偏好", confidence: 0.95 }); // sensitive subject
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const lastYear = new Date(Date.now() - 2 * 86_400_000).toISOString();
  await seedAssertion(store, alice, self.id, "usesTool", { objectValue: "旧工具", validFrom: lastYear, validTo: yesterday }); // expired

  const projection = await snapshotter.project(alice);
  assert(projection.assertionIds.length === 2, `only 2 eligible facts, got ${projection.assertionIds.length}`);
  assert(
    projection.assertionIds.includes(included1.id) && projection.assertionIds.includes(included2.id),
    "eligible assertions are the explicit high-confidence active current ones",
  );
  assert(projection.content.includes("用户偏好深色主题。"), "content renders the preference line");
  assert(projection.content.includes("用户决定周五上线。"), "content renders the decision line");
  assert(!projection.content.includes("咖啡"), "low-confidence fact excluded from content");
  assert(!projection.content.includes("瑜伽"), "low-confidence inferred fact excluded from content");
  assert(!projection.content.includes("冷门偏好"), "candidate excluded from content");
  assert(!projection.content.includes("隐私偏好"), "sensitive fact excluded from content (§10)");
  assert(!projection.content.includes("旧工具"), "expired fact excluded from content (valid-time)");
  assert(projection.estimatedTokens === estimateSnapshotTokens(projection.content), "token estimate is deterministic");
  assert(projection.estimatedTokens > 0, "token estimate is positive for non-empty content");

  // generate persists with an incremented version and audited write.
  const snapshot = await snapshotter.generate(alice);
  assert(snapshot.version === 1, "first snapshot version is 1");
  assert(snapshot.content === projection.content && snapshot.assertionIds.join() === projection.assertionIds.join(), "generate persists the projection");
  const audit = await store.listAuditEntries(alice, { recordKind: "snapshot" });
  assert(audit.length === 1 && audit[0]?.action === "put_snapshot", "snapshot write is audited");
  store.close?.();
}

/** §11.3: snapshot rebuild consistency — the projection is a pure function of assertions. */
async function testSnapshotRebuildConsistency(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p3-rebuild", "alice");
  const snapshotter = createOntologySnapshotter({ store });
  const consolidator = createOntologyConsolidator({ store });
  const self = await store.insertEntity(alice, { type: "Person", canonicalName: ONTOLOGY_SELF_ENTITY_NAME });
  await seedAssertion(store, alice, self.id, "prefers", { objectValue: "深色主题" });
  await seedAssertion(store, alice, self.id, "usesTool", { objectValue: "Cursor" });

  const v1 = await snapshotter.generate(alice);
  const initialVerify = await verifySnapshotRebuild(store, alice);
  assert(initialVerify.ok, "fresh snapshot verifies against the current assertions");

  // A no-op consolidation must not disturb the snapshot projection…
  const report = await consolidator.consolidate(alice);
  assert(report.snapshotWritten === false, "identical projection → no new snapshot version (idempotent)");
  assert(report.changed === false, "no merges + identical projection → no-op run");

  // …and regenerating yields identical content + assertionIds (rebuild 一致率 100%).
  const v2 = await snapshotter.generate(alice);
  assert(v2.version === 2, "explicit regeneration still bumps the version");
  assert(v2.content === v1.content, "rebuilt content is identical for identical inputs");
  assert(v2.assertionIds.join() === v1.assertionIds.join(), "rebuilt assertionIds are identical");
  const verify = await snapshotter.verify(alice);
  assert(verify.ok, `rebuilt snapshot should verify, got ${verify.mismatches.join("; ")}`);

  // Changing the assertion set invalidates the stored snapshot (pure function).
  await seedAssertion(store, alice, self.id, "hasGoal", { objectValue: "学会 Rust" });
  const stale = await snapshotter.verify(alice);
  assert(stale.ok === false && stale.mismatches.length > 0, "verify detects drift after assertions change");
  await snapshotter.generate(alice);
  const healed = await snapshotter.verify(alice);
  assert(healed.ok, "verify passes again after regeneration");
  store.close?.();
}

/** §4.6: full lifecycle keeps 100% of raw evidence, episodes and history. */
async function testRawRetentionLifecycle(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p3-retain", "alice");
  const hook = createOntologyCandidateLifecycleHook({ store });
  const resolver = createOntologyResolver({ store });
  const consolidator = createOntologyConsolidator({ store });

  // Extract → promote → supersede → consolidate.
  await hook.onLifecycle(hookRequest({ identity: alice, userMessage: "我用 Cursor 写代码，我喜欢深色主题。" }));
  const candidates = await store.findAssertions(alice, { status: "candidate" });
  assert(candidates.length === 2, `hook should produce 2 candidates, got ${candidates.length}`);
  const prefers = candidates.find(candidate => candidate.predicate === "prefers");
  await resolver.promoteAssertion(alice, prefers!.id);

  const newPref = await resolver.ingestCandidate(alice, {
    subject: { type: "Person", name: ONTOLOGY_SELF_ENTITY_NAME },
    predicate: "prefers",
    objectValue: "浅色主题",
    sourceType: "explicit",
    excerpt: "user explicitly said they switched to a light theme",
  });
  if (newPref.kind !== "stored") {
    throw new Error("unreachable");
  }
  const supersedeResult = await resolver.promoteAssertion(alice, newPref.assertion.id);
  assert(supersedeResult.superseded.length === 1, "the old preference is superseded (FR-07)");

  await consolidator.consolidate(alice, { requested: true });

  // Every assertion ever written is still present and carries evidence.
  const allAssertions = await store.findAssertions(alice, { limit: 1000 });
  assert(allAssertions.length === 3, `2 prefers (superseded+active) + 1 usesTool candidate, got ${allAssertions.length}`);
  let evidenceChecked = 0;
  for (const assertion of allAssertions) {
    for (const evidenceId of assertion.evidenceIds) {
      const evidence = await store.getEvidence(alice, evidenceId);
      assert(evidence !== undefined, `evidence ${evidenceId} must survive consolidation`);
      evidenceChecked += 1;
    }
  }
  assert(evidenceChecked === 3, `all 3 evidence rows retained, checked ${evidenceChecked}`);

  // Superseded history stays queryable with its original evidence (§4.4).
  const oldPref = await store.getAssertion(alice, prefers!.id);
  assert(oldPref?.status === "superseded" && oldPref.validTo !== undefined, "superseded fact kept with closed validity window");
  const oldEvidence = await store.getAssertionEvidence(alice, prefers!.id);
  assert(oldEvidence.length === 1 && oldEvidence[0]!.excerpt.includes("深色主题"), "superseded fact keeps its original evidence (drill-down)");
  const supersessions = await store.listSupersessions(alice);
  assert(supersessions.length === 1, "supersession relation retained");

  // Episodes retained.
  assert((await store.countEpisodes(alice)) === 1, "episode retained");
  assert((await store.listEpisodes(alice)).length === 1, "episode list retained");

  // Snapshot projects only the current fact (§4.4 默认只召回当前有效事实).
  const snapshot = (await store.getLatestSnapshot(alice))!;
  assert(snapshot.content.includes("浅色主题"), "snapshot contains the current preference");
  assert(!snapshot.content.includes("深色主题"), "snapshot excludes the superseded preference");
  store.close?.();
}

/** Phase 3: valid-time queries — current view excludes expired facts; asOf answers history. */
async function testValidTimeFiltering(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p3-time", "alice");
  const self = await store.insertEntity(alice, { type: "Person", canonicalName: ONTOLOGY_SELF_ENTITY_NAME });

  const expired = await seedAssertion(store, alice, self.id, "usesTool", {
    objectValue: "旧编辑器",
    validFrom: "2020-01-01T00:00:00.000Z",
    validTo: "2021-01-01T00:00:00.000Z",
  });
  const current = await seedAssertion(store, alice, self.id, "usesTool", {
    objectValue: "新编辑器",
    validFrom: "2021-06-01T00:00:00.000Z",
  });

  // Raw store view (no temporal flags) returns everything.
  const raw = await store.findAssertions(alice, { status: "active" });
  assert(raw.length === 2, "raw view returns both facts");

  // "Current facts" view excludes expired validTo.
  const currentView = await store.findAssertions(alice, { status: "active", excludeExpired: true });
  assert(currentView.length === 1 && currentView[0]?.id === current.id, "current view excludes the expired fact");
  assert((await store.countAssertions(alice, { status: "active", excludeExpired: true })) === 1, "count matches the current view");

  // Point-in-time history queries.
  const mid2020 = await store.findAssertions(alice, { status: "active", asOf: "2020-06-01T00:00:00.000Z" });
  assert(mid2020.length === 1 && mid2020[0]?.id === expired.id, "asOf 2020 sees only the then-valid fact");
  const in2022 = await store.findAssertions(alice, { status: "active", asOf: "2022-01-01T00:00:00.000Z" });
  assert(in2022.length === 1 && in2022[0]?.id === current.id, "asOf 2022 sees only the still-valid fact");
  const in2019 = await store.findAssertions(alice, { status: "active", asOf: "2019-01-01T00:00:00.000Z" });
  assert(in2019.length === 0, "asOf before any validFrom sees nothing");
  store.close?.();
}

/** FR-08: trigger evaluation fires (and doesn't fire) on the documented thresholds. */
async function testConsolidationTriggerEvaluation(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p3-trig", "alice");
  const consolidator = createOntologyConsolidator({
    store,
    assertionThreshold: 2,
    candidatePerPredicateThreshold: 2,
    episodeThreshold: 2,
  });
  const self = await store.insertEntity(alice, { type: "Person", canonicalName: ONTOLOGY_SELF_ENTITY_NAME });

  const idle = await consolidator.shouldConsolidate(alice);
  assert(!anyConsolidationTriggerFired(idle), "empty ontology → no trigger fires");

  const requested = await consolidator.shouldConsolidate(alice, { requested: true });
  assert(requested.requested && anyConsolidationTriggerFired(requested), "explicit user request fires");

  await seedAssertion(store, alice, self.id, "prefers", { objectValue: "A", status: "candidate" });
  await seedAssertion(store, alice, self.id, "prefers", { objectValue: "B", status: "candidate" });
  const candidateTrigger = await consolidator.shouldConsolidate(alice);
  assert(candidateTrigger.multipleCandidatesPerPredicate, "2 candidates on one predicate fires the candidate trigger");
  assert(!candidateTrigger.assertionCountExceeded, "assertion threshold not yet exceeded");

  await seedAssertion(store, alice, self.id, "hasGoal", { objectValue: "C" });
  const countTrigger = await consolidator.shouldConsolidate(alice);
  assert(countTrigger.assertionCountExceeded, "3+ assertions fires the count trigger");

  const disputed = await seedAssertion(store, alice, self.id, "avoids", { objectValue: "D", status: "candidate" });
  await store.updateAssertion(alice, disputed.id, { status: "disputed" });
  const conflictTrigger = await consolidator.shouldConsolidate(alice);
  assert(conflictTrigger.conflictDetected, "a disputed assertion fires the conflict trigger");

  await store.insertEpisode(alice, { sessionId: "s1", runId: "r1" });
  await store.insertEpisode(alice, { sessionId: "s1", runId: "r2" });
  const episodeTrigger = await consolidator.shouldConsolidate(alice);
  assert(episodeTrigger.episodesAccumulated, "2 episodes fires the episode trigger");

  const stats = await consolidator.computeStats(alice);
  assert(stats.assertionCount === 4 && stats.candidateCount === 2 && stats.episodeCount === 2, "stats are computed from the store");
  const withStats = await consolidator.shouldConsolidate(alice, { stats });
  assert(withStats.assertionCountExceeded && withStats.episodesAccumulated, "caller-provided stats are honored");
  store.close?.();
}

/** FR-08: a second consecutive consolidate is a no-op — nothing written. */
async function testConsolidateIdempotent(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p3-idem", "alice");
  const consolidator = createOntologyConsolidator({ store });
  const self = await store.insertEntity(alice, { type: "Person", canonicalName: ONTOLOGY_SELF_ENTITY_NAME });
  await store.insertEntity(alice, { type: "Tool", canonicalName: "VS Code" });
  await store.insertEntity(alice, { type: "Tool", canonicalName: "vs code" });
  await seedAssertion(store, alice, self.id, "prefers", { objectValue: "深色主题" });

  const first = await consolidator.consolidate(alice, { requested: true });
  assert(first.changed === true, "first run changes things (merge + initial snapshot)");
  assert(first.entityMerges.length === 1, "first run merges the duplicate");
  assert(first.snapshotWritten === true, "first run writes the initial snapshot");
  const snapshotAfterFirst = await store.getLatestSnapshot(alice);
  const auditAfterFirst = await store.listAuditEntries(alice);

  const second = await consolidator.consolidate(alice, { requested: true });
  assert(second.changed === false, "second run is a no-op");
  assert(second.entityMerges.length === 0, "nothing left to merge");
  assert(second.snapshotWritten === false, "identical projection → no new snapshot version");
  const snapshotAfterSecond = await store.getLatestSnapshot(alice);
  assert(snapshotAfterSecond?.version === snapshotAfterFirst?.version, "snapshot version untouched by the no-op run");
  const auditAfterSecond = await store.listAuditEntries(alice);
  assert(auditAfterSecond.length === auditAfterFirst.length, "no audit spam from a no-op run (documented choice)");
  store.close?.();
}

export const ontologyConsolidationTestCases: TestCase[] = [
  ["ontology consolidate merges exact duplicate entities only", testConsolidateMergesExactDuplicateEntities],
  ["ontology snapshot selection rules", testSnapshotSelectionRules],
  ["ontology snapshot rebuild consistency", testSnapshotRebuildConsistency],
  ["ontology raw retention across full lifecycle", testRawRetentionLifecycle],
  ["ontology valid-time filtering", testValidTimeFiltering],
  ["ontology consolidation trigger evaluation", testConsolidationTriggerEvaluation],
  ["ontology consolidate idempotency", testConsolidateIdempotent],
];
