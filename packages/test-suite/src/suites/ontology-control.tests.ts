import type { MemoryIdentity } from "@loong/core";
import {
  createOntologyConsolidator,
  createOntologyRetriever,
  createOntologySnapshotter,
  createOntologyUserControlService,
  createSqliteOntologyStore,
  ONTOLOGY_SELF_ENTITY_NAME,
  type OntologyStore,
} from "@loong/memory";
import { assert, delay } from "../lib/test-helpers.js";
import type { TestCase } from "../runner.js";

/**
 * Phase 5 (用户控制面) acceptance tests: FR-12 查看与解释, FR-13 纠正与遗忘,
 * FR-14 导入导出, §10 deletion completeness, §11 acceptance invariants.
 */

function identity(tenantId: string, userId: string): MemoryIdentity {
  return { tenantId, userId };
}

async function seedEntity(
  store: OntologyStore,
  alice: MemoryIdentity,
  type: string,
  canonicalName: string,
  options: { aliases?: string[]; sensitivity?: "normal" | "personal" | "sensitive" } = {},
) {
  return await store.insertEntity(alice, {
    type,
    canonicalName,
    ...(options.aliases !== undefined ? { aliases: options.aliases } : {}),
    ...(options.sensitivity !== undefined ? { sensitivity: options.sensitivity } : {}),
  });
}

interface SeedFactOptions {
  objectEntityId?: string;
  objectValue?: string;
  confidence?: number;
  sourceType?: "explicit" | "observed" | "inferred" | "imported";
  status?: "candidate" | "active" | "disputed" | "superseded" | "retracted";
  excerpt?: string;
  evidenceSessionId?: string;
  evidenceRunId?: string;
  extraEvidence?: number;
}

async function seedFact(
  store: OntologyStore,
  alice: MemoryIdentity,
  subjectId: string,
  predicate: string,
  options: SeedFactOptions = {},
) {
  const evidence = await store.insertEvidence(alice, {
    source: "p5-test",
    excerpt: options.excerpt ?? `seed excerpt for ${predicate}`,
    ...(options.evidenceSessionId !== undefined ? { sessionId: options.evidenceSessionId } : {}),
    ...(options.evidenceRunId !== undefined ? { runId: options.evidenceRunId } : {}),
  });
  const evidenceIds = [evidence.id];
  for (let index = 0; index < (options.extraEvidence ?? 0); index += 1) {
    const extra = await store.insertEvidence(alice, {
      source: "p5-test",
      excerpt: `extra excerpt ${index} for ${predicate}`,
    });
    evidenceIds.push(extra.id);
  }
  const assertion = await store.insertAssertion(alice, {
    subjectId,
    predicate,
    ...(options.objectEntityId !== undefined ? { objectEntityId: options.objectEntityId } : {}),
    ...(options.objectValue !== undefined ? { objectValue: options.objectValue } : {}),
    confidence: options.confidence ?? 0.9,
    sourceType: options.sourceType ?? "explicit",
    status: options.status ?? "active",
    evidenceIds,
  });
  return { assertion, evidence, evidenceIds };
}

function service(store: OntologyStore) {
  return createOntologyUserControlService({ store });
}

/** FR-12: knowledge is grouped by predicate with source/confidence/evidence metadata. */
async function testExplainUserKnowledge(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p5", "alice");
  const bob = identity("t-p5", "bob");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");
  await seedFact(store, alice, self.id, "usesTool", { objectEntityId: cursor.id });
  await seedFact(store, alice, self.id, "prefers", { objectValue: "深色主题", sourceType: "observed", confidence: 0.7 });
  await seedFact(store, alice, self.id, "hasSkill", { objectValue: "TypeScript", sourceType: "inferred", confidence: 0.8 });
  await seedFact(store, alice, self.id, "hasGoal", { objectValue: "候选目标", status: "candidate" });
  await seedFact(store, alice, self.id, "avoids", { objectValue: "争议项", status: "disputed" });

  const explanation = await service(store).explainUserKnowledge(alice);
  assert(explanation.activeCount === 3, `expected 3 active facts, got ${explanation.activeCount}`);
  assert(explanation.candidateCount === 1, "candidate count should be reported");
  assert(explanation.disputedCount === 1, "disputed count should be reported");
  assert(explanation.inferredActiveCount === 1, "inferred active count should be reported");
  const predicates = explanation.groups.map(group => group.predicate);
  assert(predicates.join(",") === "hasSkill,usesTool,prefers", `groups should follow vocabulary order, got ${predicates}`);
  const usesTool = explanation.groups.find(group => group.predicate === "usesTool")!.facts[0]!;
  assert(usesTool.line === "用户通常使用Cursor。", `unexpected line: ${usesTool.line}`);
  assert(usesTool.sourceType === "explicit" && usesTool.evidenceCount === 1 && usesTool.confidence === 0.9,
    "fact metadata should carry sourceType, evidence count and confidence");

  // §10: another user sees nothing of alice's knowledge.
  const bobs = await service(store).explainUserKnowledge(bob);
  assert(bobs.activeCount === 0 && bobs.groups.length === 0, "cross-user knowledge must be invisible");
  store.close?.();
}

/** FR-12: full provenance chain — evidence, episodes, supersede chain, audit history. */
async function testExplainAssertionProvenance(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p5", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const vscode = await seedEntity(store, alice, "Tool", "VS Code");
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");
  const old = await seedFact(store, alice, self.id, "usesTool", { objectEntityId: vscode.id });
  const current = await seedFact(store, alice, self.id, "usesTool", {
    objectEntityId: cursor.id,
    excerpt: "用户说：我已经切到 Cursor 了。",
    evidenceSessionId: "session-x",
    evidenceRunId: "run-x",
  });
  await store.supersedeAssertion(alice, old.assertion.id, current.assertion.id);
  await store.insertEpisode(alice, {
    sessionId: "session-x",
    runId: "run-x",
    messageIds: ["m-1"],
    summary: "切换编辑器",
  });

  const control = service(store);
  const explained = await control.explainAssertion(alice, current.assertion.id);
  assert(explained.line === "用户通常使用Cursor。", "explain should render the fact");
  assert(explained.supersedes?.id === old.assertion.id, "supersede chain should point to the old fact");
  assert(explained.evidence.length === 1 && explained.evidence[0]!.excerpt.includes("切到 Cursor"),
    "evidence excerpts with provenance must be returned");
  assert(explained.episodes.length === 1 && explained.episodes[0]!.summary === "切换编辑器",
    "linked episodes must be returned");
  const auditActions = explained.audit.map(entry => entry.action);
  assert(auditActions.includes("insert_assertion") && auditActions.includes("supersede_assertion"),
    `audit history should cover the assertion lifecycle, got ${auditActions}`);

  const explainedOld = await control.explainAssertion(alice, old.assertion.id);
  assert(explainedOld.supersededBy?.id === current.assertion.id, "the old fact should point at its replacement");
  store.close?.();
}

/** FR-12: conflicts and inferred-only views. */
async function testListConflictsAndInferred(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p5", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  await seedFact(store, alice, self.id, "usesTool", { objectValue: "Cursor", status: "disputed" });
  await seedFact(store, alice, self.id, "hasSkill", { objectValue: "TypeScript", sourceType: "inferred", confidence: 0.8 });
  await seedFact(store, alice, self.id, "prefers", { objectValue: "深色主题" });

  const control = service(store);
  const conflicts = await control.listConflicts(alice);
  assert(conflicts.length === 1 && conflicts[0]!.line.includes("Cursor"), "conflicts list should carry the disputed fact");
  const inferred = await control.listInferred(alice);
  assert(inferred.length === 1 && inferred[0]!.sourceType === "inferred", "inferred view should only list inferred facts");
  store.close?.();
}

/** FR-13 + §11.2/§11.3: a user correction supersedes the old fact, which stops being recalled. */
async function testCorrectAssertionStopsOldFact(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p5", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const vscode = await seedEntity(store, alice, "Tool", "VS Code");
  const old = await seedFact(store, alice, self.id, "usesTool", { objectEntityId: vscode.id });

  const control = service(store);
  const result = await control.correctAssertion(alice, old.assertion.id, {
    objectEntity: { type: "Tool", name: "Cursor" },
    excerpt: "用户纠正：我现在用的是 Cursor，不是 VS Code。",
  });
  assert(result.corrected.status === "active", "the correction should become active");
  assert(result.corrected.sourceType === "explicit", "a user correction is an explicit fact");
  const previous = await store.getAssertion(alice, old.assertion.id);
  assert(previous?.status === "superseded", "the old fact must be superseded");
  assert(typeof previous?.validTo === "string", "the old fact's valid time must be closed");
  assert(result.superseded.some(assertion => assertion.id === old.assertion.id), "result should list the superseded fact");

  const retriever = createOntologyRetriever({ store });
  const oldRecall = await retriever.recall(alice, "VS Code 还能用吗？");
  assert(!oldRecall.tier2.some(candidate => candidate.assertion.id === old.assertion.id),
    "§11: after a user correction the old fact must not be recalled as current");
  const newRecall = await retriever.recall(alice, "Cursor 好用吗？");
  const corrected = newRecall.tier2.find(candidate => candidate.assertion.id === result.corrected.id);
  assert(corrected !== undefined, "the corrected fact should be recalled");
  assert(corrected.transition?.line.includes("目前已改用Cursor"), "the correction should render as a transition");
  store.close?.();
}

/** FR-13: correcting to an already-existing fact merges into it. */
async function testCorrectAssertionMergesIntoExisting(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p5", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");
  const vscode = await seedEntity(store, alice, "Tool", "VS Code");
  const existing = await seedFact(store, alice, self.id, "usesTool", { objectEntityId: cursor.id });
  const disputed = await seedFact(store, alice, self.id, "usesTool", { objectEntityId: vscode.id, status: "disputed" });

  const result = await service(store).correctAssertion(alice, disputed.assertion.id, {
    objectEntity: { type: "Tool", name: "Cursor" },
    excerpt: "用户确认：就是 Cursor。",
  });
  assert(result.mergedIntoExisting, "correction should merge into the identical active fact");
  assert(result.corrected.id === existing.assertion.id, "the existing fact absorbs the correction");
  const old = await store.getAssertion(alice, disputed.assertion.id);
  assert(old?.status === "superseded" && typeof old.validTo === "string",
    "the disputed fact must be superseded with a closed valid time");
  store.close?.();
}

/** FR-13: retract removes a fact from recall; double retract fails. */
async function testRetractAssertion(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p5", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");
  const { assertion } = await seedFact(store, alice, self.id, "usesTool", { objectEntityId: cursor.id });

  const control = service(store);
  const retracted = await control.retractAssertion(alice, assertion.id, "用户要求忘记");
  assert(retracted.status === "retracted", "assertion should be retracted");
  const recall = await createOntologyRetriever({ store }).recall(alice, "Cursor 好用吗？");
  assert(!recall.tier2.some(candidate => candidate.assertion.id === assertion.id),
    "a retracted fact must not be recalled");
  await assertThrows(() => control.retractAssertion(alice, assertion.id), "already retracted");
  store.close?.();
}

/** FR-13 + §10: deleting the last evidence retracts the assertion first; audit never stores excerpts. */
async function testDeleteEvidenceCascade(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p5", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const single = await seedFact(store, alice, self.id, "prefers", { objectValue: "深色主题", excerpt: "SECRET-EXCERPT-ONE" });
  const multi = await seedFact(store, alice, self.id, "hasSkill", { objectValue: "TypeScript", extraEvidence: 1 });

  const control = service(store);
  const result = await control.deleteEvidence(alice, single.evidence.id, "用户要求删除这条证据");
  assert(result.retractedAssertionIds.length === 1 && result.retractedAssertionIds[0] === single.assertion.id,
    "the assertion whose last evidence was deleted must be retracted, not left evidence-less");
  const retracted = await store.getAssertion(alice, single.assertion.id);
  assert(retracted?.status === "retracted", "assertion should be retracted before evidence deletion");
  assert(await store.getEvidence(alice, single.evidence.id) === undefined, "evidence row must be physically deleted");

  const second = await control.deleteEvidence(alice, multi.evidenceIds[0]!);
  assert(second.retractedAssertionIds.length === 0, "an assertion with remaining evidence stays live");
  const stillActive = await store.getAssertion(alice, multi.assertion.id);
  assert(stillActive?.status === "active" && stillActive.evidenceIds.length === 1,
    "the assertion stays active on its remaining evidence");

  // §10: audit trail exists but never contains the raw excerpt.
  const audit = await store.listAuditEntries(alice, { recordKind: "evidence", recordId: single.evidence.id });
  assert(audit.some(entry => entry.action === "delete_evidence"), "evidence deletion must be audited");
  const auditJson = JSON.stringify(audit);
  assert(!auditJson.includes("SECRET-EXCERPT-ONE"), "audit detail must not contain the deleted excerpt");
  const deleteEntry = audit.find(entry => entry.action === "delete_evidence")!;
  assert(String(deleteEntry.detail?.reason ?? "").includes("用户要求删除"), "audit should carry the operator reason");
  store.close?.();
}

/** FR-13: deleting an entity retracts its live assertions; history stays. */
async function testDeleteEntity(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p5", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");
  const active = await seedFact(store, alice, self.id, "usesTool", { objectEntityId: cursor.id });
  const historical = await seedFact(store, alice, self.id, "relatedToProject", {
    objectEntityId: cursor.id, status: "superseded",
  });

  const result = await service(store).deleteEntity(alice, cursor.id, "不再使用");
  assert(result.retractedAssertionIds.length === 1 && result.retractedAssertionIds[0] === active.assertion.id,
    "live assertions about the entity must be retracted");
  assert(await store.getEntity(alice, cursor.id) === undefined, "entity row must be physically deleted");
  const untouched = await store.getAssertion(alice, historical.assertion.id);
  assert(untouched?.status === "superseded", "historical assertions stay untouched");
  store.close?.();
}

/** FR-13: category deletion is physical, complete, and regenerates the snapshot. */
async function testDeleteCategory(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p5", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const prefFact = await seedFact(store, alice, self.id, "prefers", { objectValue: "深色主题" });
  const inferredFact = await seedFact(store, alice, self.id, "hasSkill", {
    objectValue: "TypeScript", sourceType: "inferred", confidence: 0.8,
  });
  const keepFact = await seedFact(store, alice, self.id, "usesTool", { objectValue: "Cursor" });
  await createOntologySnapshotter({ store }).generate(alice);

  const control = service(store);
  const byPredicate = await control.deleteCategory(alice, { predicate: "prefers" }, "清理偏好");
  assert(byPredicate.deletedAssertions === 1, "predicate category delete should remove matching assertions");
  assert(await store.getAssertion(alice, prefFact.assertion.id) === undefined, "deleted assertions are physically gone");
  assert(byPredicate.deletedEvidence === 1, "unreferenced evidence should be cleaned up");
  assert(byPredicate.snapshotRegenerated, "snapshot must be regenerated after deletion");
  const snapshot = await store.getLatestSnapshot(alice);
  assert(snapshot !== undefined && !snapshot.content.includes("深色主题"),
    "deleted facts must not resurface from the snapshot");

  const bySourceType = await control.deleteCategory(alice, { sourceType: "inferred" });
  assert(bySourceType.deletedAssertions === 1, "sourceType category delete should remove inferred facts");
  assert(await store.getAssertion(alice, inferredFact.assertion.id) === undefined, "inferred fact physically gone");
  assert(await store.getAssertion(alice, keepFact.assertion.id) !== undefined, "other facts remain");

  await assertThrows(() => control.deleteCategory(alice, {}), "exactly one");
  await assertThrows(() => control.deleteCategory(alice, { predicate: "prefers", sourceType: "inferred" }), "exactly one");
  store.close?.();
}

/** FR-13 + §11.1: deleteAll → recall, snapshot and export are all empty; audit survives. */
async function testDeleteAllUserOntology(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p5", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");
  await seedFact(store, alice, self.id, "usesTool", { objectEntityId: cursor.id });
  await store.insertEpisode(alice, { sessionId: "s-1", runId: "r-1" });
  await createOntologySnapshotter({ store }).generate(alice);

  const control = service(store);
  const result = await control.deleteAllUserOntology(alice, "用户要求全部遗忘");
  assert(result.deletedAssertions === 1 && result.deletedEntities === 2 && result.deletedEvidence === 1
    && result.deletedEpisodes === 1 && result.deletedSnapshots === 1,
  `deleteAll counts wrong: ${JSON.stringify(result)}`);

  // §11.1: 删除用户数据后搜索和上下文召回结果为 0.
  const recall = await createOntologyRetriever({ store }).recall(alice, "Cursor 好用吗？");
  assert(recall.tier1.content === "" && recall.tier2.length === 0 && recall.matchedEntities.length === 0,
    "after deleteAll the retriever must recall nothing");
  assert(await store.getLatestSnapshot(alice) === undefined, "no snapshot may survive deleteAll");
  const exported = await control.exportUserOntology(alice);
  assert(exported.entities.length === 0 && exported.assertions.length === 0 && exported.evidence.length === 0,
    "export after deleteAll must be empty");

  // The audit log itself is preserved (accountability) and records the deletion.
  const audit = await store.listAuditEntries(alice, {});
  assert(audit.length > 0, "the audit log survives deleteAll");
  assert(audit.some(entry => entry.action === "delete_assertions" && entry.recordId === "*"),
    "deleteAll must write a summary audit entry");
  store.close?.();
}

/** FR-13: unmerge undoes a consolidator merge and re-points the recorded assertions. */
async function testUnmergeEntity(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p5", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const survivor = await seedEntity(store, alice, "Tool", "VS Code", { aliases: ["code"] });
  await delay(5);
  const duplicate = await seedEntity(store, alice, "Tool", "vs code");
  const { assertion } = await seedFact(store, alice, self.id, "usesTool", { objectEntityId: duplicate.id });

  const consolidator = createOntologyConsolidator({ store });
  const report = await consolidator.consolidate(alice, { requested: true });
  assert(report.entityMerges.length === 1, "fixture should produce exactly one merge");
  const merged = await store.getEntity(alice, duplicate.id);
  assert(merged?.status === "merged", "the duplicate should be merged away");
  const repointed = await store.getAssertion(alice, assertion.id);
  assert(repointed?.objectEntityId === survivor.id, "merge should re-point the assertion to the survivor");

  const control = service(store);
  const restored = await control.unmergeEntity(alice, duplicate.id);
  assert(restored.restoredEntity.status === "active", "unmerge restores the entity to active");
  assert(restored.assertionIds.includes(assertion.id), "unmerge should re-point the recorded assertion set");
  const backAgain = await store.getAssertion(alice, assertion.id);
  assert(backAgain?.objectEntityId === duplicate.id, "assertion should point at the restored entity again");
  const updatedSurvivor = await store.getEntity(alice, survivor.id);
  assert(!updatedSurvivor!.aliases.some(alias => alias.toLowerCase() === "vs code"),
    "the survivor should give the merged entity's names back");
  const audit = await store.listAuditEntries(alice, { recordKind: "entity", recordId: duplicate.id });
  assert(audit.some(entry => entry.action === "unmerge_entity"), "unmerge must be audited");

  await assertThrows(() => control.unmergeEntity(alice, survivor.id), "not merged");
  store.close?.();
}

/** FR-14: sensitive evidence excerpts are redacted unless explicitly confirmed. */
async function testExportSensitiveRedaction(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p5", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const salary = await seedEntity(store, alice, "Constraint", "薪资", { sensitivity: "sensitive" });
  await seedFact(store, alice, self.id, "constrainedBy", { objectEntityId: salary.id, excerpt: "SECRET-SALARY-DETAIL" });
  await seedFact(store, alice, self.id, "prefers", { objectValue: "深色主题", excerpt: "用户公开说喜欢深色主题" });

  const control = service(store);
  const redacted = await control.exportUserOntology(alice);
  const sensitiveEvidence = redacted.evidence.find(item => item.excerptRedacted === true);
  assert(sensitiveEvidence !== undefined, "sensitive evidence must be redacted by default");
  assert(!JSON.stringify(redacted).includes("SECRET-SALARY-DETAIL"), "redacted export must not leak the excerpt");
  assert(redacted.evidence.some(item => item.excerpt === "用户公开说喜欢深色主题"),
    "non-sensitive excerpts are exported by default");
  assert(redacted.formatVersion === "ontology-export/v1", "export carries the format version");
  assert(redacted.entities.length === 2 && redacted.assertions.length === 2, "entities and assertions are exported");

  const confirmed = await control.exportUserOntology(alice, { includeSensitiveEvidence: true });
  assert(JSON.stringify(confirmed.evidence).includes("SECRET-SALARY-DETAIL"),
    "explicit confirmation includes sensitive excerpts");
  store.close?.();
}

/** FR-14: export/import round-trip preserves knowledge; re-import dedups. */
async function testExportImportRoundTrip(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p5", "alice");
  const bob = identity("t-p5", "bob");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");
  await seedFact(store, alice, self.id, "usesTool", { objectEntityId: cursor.id, excerpt: "用户说用 Cursor" });
  await seedFact(store, alice, self.id, "prefers", { objectValue: "深色主题" });

  const control = service(store);
  const exported = await control.exportUserOntology(alice);

  const report = await control.importUserOntology(bob, exported);
  assert(report.assertionsImported === 2 && report.promoted === 2, `import should promote both facts: ${JSON.stringify(report)}`);
  assert(report.entitiesCreated === 2, "import should create the missing entities");
  const bobsKnowledge = await control.explainUserKnowledge(bob);
  assert(bobsKnowledge.activeCount === 2, "bob should see the imported knowledge");
  const importedFact = bobsKnowledge.groups.flatMap(group => group.facts)
    .find(fact => fact.line.includes("Cursor"))!;
  assert(importedFact.sourceType === "imported", "imported facts carry sourceType=imported");
  const alicesKnowledge = await control.explainUserKnowledge(alice);
  assert(alicesKnowledge.activeCount === 2, "alice's knowledge is untouched by bob's import");

  // Re-import into the same user: dedup absorbs, no duplicate active facts.
  const reimport = await control.importUserOntology(bob, exported);
  const bobsAfter = await control.explainUserKnowledge(bob);
  assert(bobsAfter.activeCount === 2, `re-import must not duplicate facts, got ${bobsAfter.activeCount}`);
  assert(reimport.promoted === 0, "re-import promotes nothing new");
  const audit = await store.listAuditEntries(bob, { recordKind: "import" });
  assert(audit.length === 2, "imports are audited");
  store.close?.();
}

/** FR-14: import validates the payload. */
async function testImportValidation(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p5", "alice");
  const control = service(store);
  await assertThrows(() => control.importUserOntology(alice, null), "must be an object");
  await assertThrows(() => control.importUserOntology(alice, { formatVersion: "v0" }), "formatVersion");
  await assertThrows(
    () => control.importUserOntology(alice, { formatVersion: "ontology-export/v1", identity: { tenantId: "t", userId: "u" } }),
    "missing",
  );
  store.close?.();
}

/** FR-13: snapshot regeneration handles normal and empty ontologies. */
async function testRegenerateSnapshot(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p5", "alice");
  const control = service(store);

  const empty = await control.regenerateSnapshot(alice);
  assert(empty.empty && empty.snapshot === undefined, "an empty ontology has no stored snapshot");

  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  await seedFact(store, alice, self.id, "prefers", { objectValue: "深色主题" });
  const regenerated = await control.regenerateSnapshot(alice);
  assert(regenerated.snapshot !== undefined && regenerated.snapshot.content.includes("深色主题"),
    "regeneration writes a fresh snapshot");
  assert((await store.getLatestSnapshot(alice))?.version === 1, "first generated snapshot is v1");

  await control.deleteAllUserOntology(alice);
  const emptied = await control.regenerateSnapshot(alice);
  assert(emptied.empty, "after deleteAll regeneration reports empty");
  store.close?.();
}

async function assertThrows(run: () => Promise<unknown>, messagePart: string): Promise<void> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  assert(thrown !== undefined, `expected an error containing "${messagePart}"`);
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  assert(message.includes(messagePart), `error "${message}" should contain "${messagePart}"`);
}

export const ontologyControlTestCases: TestCase[] = [
  ["ontology control explain user knowledge", testExplainUserKnowledge],
  ["ontology control explain assertion provenance", testExplainAssertionProvenance],
  ["ontology control conflicts and inferred views", testListConflictsAndInferred],
  ["ontology control correction supersedes old fact", testCorrectAssertionStopsOldFact],
  ["ontology control correction merges into existing", testCorrectAssertionMergesIntoExisting],
  ["ontology control retract assertion", testRetractAssertion],
  ["ontology control delete evidence cascade", testDeleteEvidenceCascade],
  ["ontology control delete entity", testDeleteEntity],
  ["ontology control delete category", testDeleteCategory],
  ["ontology control delete all wipes recall", testDeleteAllUserOntology],
  ["ontology control unmerge entity", testUnmergeEntity],
  ["ontology control export redacts sensitive evidence", testExportSensitiveRedaction],
  ["ontology control export import round trip", testExportImportRoundTrip],
  ["ontology control import validation", testImportValidation],
  ["ontology control regenerate snapshot", testRegenerateSnapshot],
];
