import type { LoongContextRequest, MemoryIdentity } from "@loong/core";
import { createLoongRuntime } from "@loong/core";
import {
  createOntologyContextProvider,
  createOntologyRetriever,
  createOntologySnapshotter,
  createSqliteMemoryStoreV2,
  createSqliteOntologyStore,
  ONTOLOGY_RECALL_CONTEXT_PROVIDER_NAME,
  ONTOLOGY_SELF_ENTITY_NAME,
  type OntologyStore,
} from "@loong/memory";
import { assert } from "../lib/test-helpers.js";
import type { TestCase } from "../runner.js";

/**
 * Phase 4 (召回和注入) acceptance tests: FR-09 three-tier funnel, FR-10 hybrid
 * ranking, FR-11 output format, §4.5 bounded recall.
 */

function identity(tenantId: string, userId: string): MemoryIdentity {
  return { tenantId, userId };
}

interface SeedEntityOptions {
  aliases?: string[];
  sensitivity?: "normal" | "personal" | "sensitive";
}

async function seedEntity(
  store: OntologyStore,
  alice: MemoryIdentity,
  type: string,
  canonicalName: string,
  options: SeedEntityOptions = {},
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
  validFrom?: string;
  validTo?: string;
  evidenceSessionId?: string;
  evidenceRunId?: string;
  excerpt?: string;
}

async function seedFact(
  store: OntologyStore,
  alice: MemoryIdentity,
  subjectId: string,
  predicate: string,
  options: SeedFactOptions = {},
) {
  const evidence = await store.insertEvidence(alice, {
    source: "p4-test",
    excerpt: options.excerpt ?? `seed excerpt for ${predicate}`,
    ...(options.evidenceSessionId !== undefined ? { sessionId: options.evidenceSessionId } : {}),
    ...(options.evidenceRunId !== undefined ? { runId: options.evidenceRunId } : {}),
  });
  const assertion = await store.insertAssertion(alice, {
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
  return { assertion, evidence };
}

function contextRequest(
  message: string,
  sessionId: string,
  alice?: MemoryIdentity,
): LoongContextRequest {
  return {
    input: { sessionId, message, source: "cli" },
    history: [],
    runId: `run-${sessionId}`,
    createdAt: new Date().toISOString(),
    ...(alice !== undefined ? { identity: alice } : {}),
  };
}

/** FR-09 funnel: stored snapshot feeds tier 1; mention matching feeds tier 2. */
async function testRecallFunnelWithStoredSnapshot(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p4", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");
  const { assertion } = await seedFact(store, alice, self.id, "usesTool", { objectEntityId: cursor.id });
  await createOntologySnapshotter({ store }).generate(alice);

  const retriever = createOntologyRetriever({ store });
  const result = await retriever.recall(alice, "最近在 Cursor 里调试顺利吗？");

  assert(result.tier1.source === "stored", "tier 1 should come from the stored snapshot");
  assert(result.tier1.content.includes("- 用户通常使用Cursor。"), "tier 1 should contain the snapshot line");
  assert(result.matchedEntities.some(entity => entity.id === cursor.id), "Cursor should be a matched entity");
  const direct = result.tier2.find(candidate => candidate.assertion.id === assertion.id);
  assert(direct !== undefined, "the usesTool Cursor fact should be recalled in tier 2");
  assert(direct.hop === 0, "a fact about a mentioned entity is a direct mention (hop 0)");
  assert(result.drillDownHints[assertion.id] === 1, "drill-down hint should carry the evidence count");
  assert(result.exclusions.disputedCount === 0, "nothing disputed in this fixture");
  store.close?.();
}

/** FR-09: without a stored snapshot, tier 1 is projected on the fly (never persisted). */
async function testRecallProjectsSnapshotOnTheFly(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p4", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  await seedFact(store, alice, self.id, "prefers", { objectValue: "深色主题" });

  const retriever = createOntologyRetriever({ store });
  const result = await retriever.recall(alice, "帮我看看界面样式");

  assert(result.tier1.source === "projected", "tier 1 should be projected on the fly");
  assert(result.tier1.content.includes("- 用户偏好深色主题。"), "projected tier 1 should render the stable preference");
  const stored = await store.getLatestSnapshot(alice);
  assert(stored === undefined, "on-the-fly projection must not persist a snapshot");
  store.close?.();
}

/** §4.5 token budgets: tier 2 trims lowest scores first; tier 1 is never dropped. */
async function testRecallTokenBudgetTrimming(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p4", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const loong = await seedEntity(store, alice, "Project", "Loong");
  for (let index = 0; index < 12; index += 1) {
    await seedFact(store, alice, self.id, "relatedToProject", {
      objectEntityId: loong.id,
      confidence: 0.6 + index * 0.01,
    });
  }
  const retriever = createOntologyRetriever({ store });
  const result = await retriever.recall(alice, "Loong 进展如何？", {
    tier2TokenBudget: 100,
    totalTokenBudget: 400,
  });

  assert(result.tier2.length > 0, "at least one tier-2 fact is always kept");
  assert(result.tier2.length < 12, "tier 2 should be trimmed to the budget");
  assert(result.tier2DroppedCount === 12 - result.tier2.length, "dropped count should match the trim");
  assert(result.trimmed, "result should be marked trimmed");
  assert(result.tier1.content.length > 0, "tier 1 must never be silently dropped");
  // Lowest-confidence facts are dropped first (scores sorted desc before trimming).
  const keptConfidences = result.tier2.map(candidate => candidate.assertion.confidence);
  assert(Math.min(...keptConfidences) > 0.6, "the lowest-scored fact should be dropped first");
  store.close?.();
}

/** §4.5 status/temporal filters: candidate, retracted, expired and future facts are not recalled. */
async function testRecallStatusAndTemporalFilters(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p4", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");
  const active = await seedFact(store, alice, self.id, "usesTool", { objectEntityId: cursor.id });
  await seedFact(store, alice, self.id, "hasSkill", { objectEntityId: cursor.id, status: "candidate" });
  await seedFact(store, alice, self.id, "prefers", { objectEntityId: cursor.id, status: "retracted" });
  await seedFact(store, alice, self.id, "avoids", { objectEntityId: cursor.id, validTo: "2020-01-01T00:00:00.000Z" });
  await seedFact(store, alice, self.id, "hasGoal", { objectEntityId: cursor.id, validFrom: "2999-01-01T00:00:00.000Z" });

  const retriever = createOntologyRetriever({ store });
  const result = await retriever.recall(alice, "Cursor 好用吗？");
  const ids = result.tier2.map(candidate => candidate.assertion.id);
  assert(ids.length === 1 && ids[0] === active.assertion.id,
    `only the active, currently-valid fact should be recalled, got ${ids.length}`);
  store.close?.();
}

/** FR-10 relation distance: one hop by default, two hops only when requested; self-hub guard. */
async function testRecallHopExpansion(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p4", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const loong = await seedEntity(store, alice, "Project", "Loong");
  const colleague = await seedEntity(store, alice, "Person", "小周");
  const acme = await seedEntity(store, alice, "Organization", "Acme");
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");

  const direct = await seedFact(store, alice, colleague.id, "relatedToProject", { objectEntityId: loong.id });
  const oneHop = await seedFact(store, alice, colleague.id, "belongsTo", { objectEntityId: acme.id });
  const twoHop = await seedFact(store, alice, acme.id, "constrainedBy", { objectValue: "预算冻结" });
  // Self-hub guard fixture: mentioning Cursor must not flood tier 2 with the whole profile.
  await seedFact(store, alice, self.id, "usesTool", { objectEntityId: cursor.id });
  const unrelatedSelfFact = await seedFact(store, alice, self.id, "prefers", { objectValue: "深色主题" });

  const retriever = createOntologyRetriever({ store });
  const oneHopResult = await retriever.recall(alice, "Loong 项目都有谁参与？");
  const byId1 = new Map(oneHopResult.tier2.map(candidate => [candidate.assertion.id, candidate]));
  assert(byId1.get(direct.assertion.id)?.hop === 0, "assertion about Loong is direct");
  assert(byId1.get(oneHop.assertion.id)?.hop === 1, "colleague's organization is one hop away");
  assert(!byId1.has(twoHop.assertion.id), "two-hop facts are excluded by default");

  const twoHopResult = await retriever.recall(alice, "Loong 项目都有谁参与？", { maxHops: 2 });
  const byId2 = new Map(twoHopResult.tier2.map(candidate => [candidate.assertion.id, candidate]));
  assert(byId2.get(twoHop.assertion.id)?.hop === 2, "maxHops: 2 reaches the second hop");

  const guardResult = await retriever.recall(alice, "Cursor 的 vim 模式怎么开？");
  assert(!guardResult.tier2.some(candidate => candidate.assertion.id === unrelatedSelfFact.assertion.id),
    "hop expansion must not flood tier 2 through the self hub");
  store.close?.();
}

/** FR-10 hybrid ranking: source type, confidence and relation distance order the result. */
async function testRecallRankingOrder(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p4", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const loong = await seedEntity(store, alice, "Project", "Loong");
  const explicit = await seedFact(store, alice, self.id, "worksOn", {
    objectEntityId: loong.id, sourceType: "explicit", confidence: 0.7,
  });
  const inferred = await seedFact(store, alice, loong.id, "relatedToProject", {
    objectValue: "推理出的关联", sourceType: "inferred", confidence: 0.8,
  });
  const highConfidence = await seedFact(store, alice, loong.id, "constrainedBy", {
    objectValue: "三个月交付", sourceType: "explicit", confidence: 0.95,
  });

  const retriever = createOntologyRetriever({ store });
  const result = await retriever.recall(alice, "Loong 的情况", { tier2TokenBudget: 1500 });
  const ids = result.tier2.map(candidate => candidate.assertion.id);
  assert(ids.indexOf(explicit.assertion.id) < ids.indexOf(inferred.assertion.id),
    "explicit fact should outrank an inferred fact at comparable confidence");
  assert(ids.indexOf(highConfidence.assertion.id) < ids.indexOf(explicit.assertion.id),
    "higher confidence should outrank lower confidence at the same distance");
  store.close?.();
}

/** §4.5 sensitivity + FR-11 dispute transparency. */
async function testRecallSensitivityAndDisputeFilters(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p4", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const salary = await seedEntity(store, alice, "Constraint", "薪资", { sensitivity: "sensitive" });
  const health = await seedEntity(store, alice, "Constraint", "体检报告", { sensitivity: "personal" });
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");
  await seedFact(store, alice, self.id, "constrainedBy", { objectEntityId: salary.id });
  await seedFact(store, alice, self.id, "constrainedBy", { objectEntityId: health.id });
  const disputed = await seedFact(store, alice, self.id, "usesTool", {
    objectEntityId: cursor.id, status: "disputed",
  });

  const retriever = createOntologyRetriever({ store });
  const result = await retriever.recall(alice, "薪资和体检报告有什么注意事项？");
  assert(result.tier2.length === 0, "sensitive and personal facts are never injected by default");
  assert(result.exclusions.sensitiveExcludedCount >= 2, "sensitivity exclusions should be counted");

  const personalRetriever = createOntologyRetriever({ store, includePersonal: true });
  const personalResult = await personalRetriever.recall(alice, "体检报告有什么注意事项？");
  assert(personalResult.tier2.some(candidate => candidate.assertion.objectEntityId === health.id),
    "includePersonal opts into personal facts");
  assert(!personalResult.tier2.some(candidate => candidate.assertion.objectEntityId === salary.id),
    "sensitive facts stay excluded even with includePersonal");

  const disputedResult = await retriever.recall(alice, "Cursor 还用吗？");
  assert(!disputedResult.tier2.some(candidate => candidate.assertion.id === disputed.assertion.id),
    "disputed facts are not injected");
  assert(disputedResult.exclusions.disputedCount === 1, "disputed facts are surfaced in metadata");
  assert(disputedResult.exclusions.disputedAssertionIds[0] === disputed.assertion.id,
    "disputed assertion ids are exposed for transparency");
  store.close?.();
}

/** FR-07 + FR-11: superseded facts are never injected; the active fact carries a transition line. */
async function testRecallSupersededTransition(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p4", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const vscode = await seedEntity(store, alice, "Tool", "VS Code");
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");
  const old = await seedFact(store, alice, self.id, "usesTool", { objectEntityId: vscode.id });
  const current = await seedFact(store, alice, self.id, "usesTool", { objectEntityId: cursor.id });
  await store.supersedeAssertion(alice, old.assertion.id, current.assertion.id);

  const retriever = createOntologyRetriever({ store });
  const result = await retriever.recall(alice, "Cursor 用得顺手吗？");
  const recalled = result.tier2.find(candidate => candidate.assertion.id === current.assertion.id);
  assert(recalled !== undefined, "the current fact should be recalled");
  assert(recalled.transition?.supersededAssertionId === old.assertion.id,
    "transition should reference the superseded assertion");
  assert(recalled.transition?.line === "用户过去使用VS Code，目前已改用Cursor。",
    `unexpected transition line: ${recalled.transition?.line ?? "<missing>"}`);
  assert(!result.tier2.some(candidate => candidate.assertion.id === old.assertion.id),
    "the superseded fact must not be injected as a current fact");
  store.close?.();
}

/** FR-09 tier 3 + §4.6: drill-down returns every linked evidence excerpt and episode. */
async function testDrillDownReturnsEvidenceAndEpisodes(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p4", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");
  const { assertion, evidence } = await seedFact(store, alice, self.id, "usesTool", {
    objectEntityId: cursor.id,
    evidenceSessionId: "session-p4",
    evidenceRunId: "run-p4",
    excerpt: "用户说：我现在主力编辑器是 Cursor。",
  });
  const episode = await store.insertEpisode(alice, {
    sessionId: "session-p4",
    runId: "run-p4",
    messageIds: ["m-1"],
    summary: "用户讨论编辑器切换",
  });

  const retriever = createOntologyRetriever({ store });
  const byIds = await retriever.drillDown(alice, { assertionIds: [assertion.id] });
  assert(byIds.assertions.length === 1, "drill-down by id should return the assertion");
  const drilled = byIds.assertions[0]!;
  assert(drilled.evidence.length === 1 && drilled.evidence[0]!.id === evidence.id,
    "drill-down must return the linked evidence");
  assert(drilled.evidence[0]!.excerpt.includes("主力编辑器是 Cursor"), "evidence excerpt should be intact");
  assert(drilled.episodes.some(item => item.id === episode.id), "linked episode should be returned");

  const byEntity = await retriever.drillDown(alice, { entityIds: [cursor.id] });
  assert(byEntity.assertions.some(item => item.assertion.id === assertion.id),
    "drill-down by entity should find assertions touching the entity");

  const byQuery = await retriever.drillDown(alice, { query: "Cursor" });
  assert(byQuery.assertions.some(item => item.assertion.id === assertion.id),
    "drill-down by query should match entities by name");

  // §4.6 查询可逆: every recalled fact's evidence is retrievable.
  const recall = await retriever.recall(alice, "Cursor 怎么样？");
  for (const candidate of recall.tier2) {
    const drilledCandidate = await retriever.drillDown(alice, { assertionIds: [candidate.assertion.id] });
    const expected = candidate.assertion.evidenceIds.length;
    const actual = drilledCandidate.assertions[0]?.evidence.length ?? 0;
    assert(actual === expected, `evidence for ${candidate.assertion.id} should be fully retrievable (${actual}/${expected})`);
  }
  store.close?.();
}

/** FR-09 FTS 补充: optional MemoryStoreV2 results are appended to the recall. */
async function testRecallFtsSupplement(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const ftsStore = createSqliteMemoryStoreV2({ databasePath: ":memory:" });
  const alice = identity("t-p4", "alice");
  await ftsStore.remember({ identity: alice }, {
    scope: "user",
    content: "deployment runbook lives in the infra wiki",
  });

  const retriever = createOntologyRetriever({ store });
  const withoutFts = await retriever.recall(alice, "where is the deployment runbook?");
  assert(withoutFts.ftsSupplement.length === 0, "no FTS store configured → no supplement");
  const withFts = await retriever.recall(alice, "where is the deployment runbook?", { ftsStore });
  assert(withFts.ftsSupplement.some(line => line.includes("deployment runbook")),
    "FTS supplement should surface matching memory records");
  store.close?.();
}

/** FR-11 output format: header + bullet lines, priority and metadata wired. */
async function testProviderOutputFormat(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p4", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");
  await seedFact(store, alice, self.id, "usesTool", { objectEntityId: cursor.id });
  await createOntologySnapshotter({ store }).generate(alice);

  const provider = createOntologyContextProvider({ retriever: createOntologyRetriever({ store }) });
  assert(provider.name === ONTOLOGY_RECALL_CONTEXT_PROVIDER_NAME, "provider name should be ontology_recall");
  const items = await provider.buildContext(contextRequest("Cursor 好用吗？", "session-format", alice));
  assert(items.length === 1, "provider should return exactly one context item");
  const item = items[0]!;
  assert(item.priority === 25, "default priority should be 25");
  assert(item.content.startsWith("Relevant user knowledge:\n- "), "content should follow the FR-11 format");
  assert(item.content.includes("用户通常使用Cursor。"), "content should include the recalled fact");
  const metadata = item.metadata as Record<string, unknown>;
  assert(metadata.mode === "full", "first turn should be a full render");
  assert(typeof metadata.totalEstimatedTokens === "number", "token estimate should be reported");
  const hints = metadata.drillDownHints as Record<string, number>;
  assert(Object.keys(hints).length > 0, "drill-down hints should be present in metadata");

  // Empty knowledge base → nothing to inject.
  const emptyStore = createSqliteOntologyStore({ databasePath: ":memory:" });
  const emptyProvider = createOntologyContextProvider({ retriever: createOntologyRetriever({ store: emptyStore }) });
  const emptyItems = await emptyProvider.buildContext(contextRequest("随便聊聊", "session-empty", alice));
  assert(emptyItems.length === 0, "no facts → no context item");
  store.close?.();
  emptyStore.close?.();
}

/** FR-11 差量上下文: unchanged facts re-render as a compact summary; changes force a full render. */
async function testProviderDifferentialContext(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p4", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const vscode = await seedEntity(store, alice, "Tool", "VS Code");
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");
  const loong = await seedEntity(store, alice, "Project", "Loong");
  const old = await seedFact(store, alice, self.id, "usesTool", { objectEntityId: vscode.id });
  const current = await seedFact(store, alice, self.id, "usesTool", { objectEntityId: cursor.id });
  await store.supersedeAssertion(alice, old.assertion.id, current.assertion.id);
  await seedFact(store, alice, self.id, "prefers", { objectValue: "深色主题" });
  await seedFact(store, alice, self.id, "hasSkill", { objectValue: "TypeScript" });
  await seedFact(store, alice, self.id, "worksOn", { objectEntityId: loong.id });
  await seedFact(store, alice, self.id, "hasRole", { objectValue: "后端工程师" });

  const provider = createOntologyContextProvider({ retriever: createOntologyRetriever({ store }) });
  const first = (await provider.buildContext(contextRequest("Cursor 和 Loong 进展？", "session-diff", alice)))[0]!;
  assert((first.metadata as Record<string, unknown>).mode === "full", "first turn renders fully");
  assert(first.content.includes("用户过去使用VS Code，目前已改用Cursor。"), "full render includes the transition line");
  const firstLineCount = first.content.split("\n").length;

  const second = (await provider.buildContext(contextRequest("Cursor 和 Loong 进展？", "session-diff", alice)))[0]!;
  assert((second.metadata as Record<string, unknown>).mode === "compact", "unchanged facts should render compactly");
  assert(second.content.includes("未变化"), "compact render should be marked as unchanged");
  assert(second.content.includes("Cursor") && second.content.includes("深色主题"),
    "compact render must keep the facts visible to the model");
  assert(second.content.split("\n").length === 2, "compact render collapses to a header plus one summary line");
  assert(second.content.split("\n").length < firstLineCount, "compact render avoids re-expanding the bullet list");
  assert(!second.content.includes("过去使用"), "compact render drops transition expansions");

  // A different session starts with a full render.
  const otherSession = (await provider.buildContext(contextRequest("Cursor 好用吗？", "session-other", alice)))[0]!;
  assert((otherSession.metadata as Record<string, unknown>).mode === "full", "a new session renders fully");

  // A changed fact forces a full render again in the original session.
  await seedFact(store, alice, self.id, "prefers", { objectEntityId: cursor.id });
  const third = (await provider.buildContext(contextRequest("Cursor 怎么样？", "session-diff", alice)))[0]!;
  assert((third.metadata as Record<string, unknown>).mode === "full", "changed facts force a full render");

  // Opt-out: differential: false always renders fully.
  const alwaysFull = createOntologyContextProvider({
    retriever: createOntologyRetriever({ store }),
    differential: false,
  });
  await alwaysFull.buildContext(contextRequest("Cursor 好用吗？", "session-plain", alice));
  const again = (await alwaysFull.buildContext(contextRequest("Cursor 好用吗？", "session-plain", alice)))[0]!;
  assert((again.metadata as Record<string, unknown>).mode === "full", "differential: false disables the compact form");
  store.close?.();
}

/** §4.1: without a trustworthy identity the provider injects nothing. */
async function testProviderWithoutIdentityReturnsEmpty(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p4", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  await seedFact(store, alice, self.id, "prefers", { objectValue: "深色主题" });
  const provider = createOntologyContextProvider({ retriever: createOntologyRetriever({ store }) });
  const items = await provider.buildContext(contextRequest("深色主题怎么样？", "session-anon"));
  assert(items.length === 0, "anonymous turns must not receive user knowledge");
  store.close?.();
}

/** FR-09/core contract: memoryEnabled: false skips the ontology provider in the runtime. */
async function testRuntimeSkipsProviderWhenMemoryDisabled(): Promise<void> {
  const modelProvider = {
    id: "mock",
    displayName: "Mock",
    defaultModel: "mock-model",
    supportsToolCalling: false,
    async complete() {
      return { id: "mock-response", text: "ack" };
    },
  };
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-p4", "alice");
  const self = await seedEntity(store, alice, "Person", ONTOLOGY_SELF_ENTITY_NAME);
  const cursor = await seedEntity(store, alice, "Tool", "Cursor");
  await seedFact(store, alice, self.id, "usesTool", { objectEntityId: cursor.id });

  let buildCount = 0;
  const ontologyProvider = createOntologyContextProvider({ retriever: createOntologyRetriever({ store }) });
  const runtime = createLoongRuntime({
    providers: [modelProvider],
    defaultModel: "mock-model",
    contextProviders: [{
      name: ontologyProvider.name,
      async buildContext(request) {
        buildCount += 1;
        return ontologyProvider.buildContext(request);
      },
    }],
  });

  await runtime.runTurn({
    sessionId: "p4-memory-on",
    source: "cli",
    message: "Cursor 好用吗？",
    identity: alice,
  });
  assert(buildCount === 1, "provider should run when memory is enabled");

  await runtime.runTurn({
    sessionId: "p4-memory-off",
    source: "cli",
    message: "Cursor 好用吗？",
    identity: alice,
    memoryEnabled: false,
  });
  assert(buildCount === 1, "memoryEnabled: false should skip the ontology recall provider");
  store.close?.();
}

export const ontologyRecallTestCases: TestCase[] = [
  ["ontology recall funnel with stored snapshot", testRecallFunnelWithStoredSnapshot],
  ["ontology recall projects snapshot on the fly", testRecallProjectsSnapshotOnTheFly],
  ["ontology recall token budget trimming", testRecallTokenBudgetTrimming],
  ["ontology recall status and temporal filters", testRecallStatusAndTemporalFilters],
  ["ontology recall hop expansion", testRecallHopExpansion],
  ["ontology recall ranking order", testRecallRankingOrder],
  ["ontology recall sensitivity and dispute filters", testRecallSensitivityAndDisputeFilters],
  ["ontology recall superseded transition", testRecallSupersededTransition],
  ["ontology recall drill-down evidence and episodes", testDrillDownReturnsEvidenceAndEpisodes],
  ["ontology recall fts supplement", testRecallFtsSupplement],
  ["ontology recall provider output format", testProviderOutputFormat],
  ["ontology recall provider differential context", testProviderDifferentialContext],
  ["ontology recall provider requires identity", testProviderWithoutIdentityReturnsEmpty],
  ["ontology recall skipped when memory disabled", testRuntimeSkipsProviderWhenMemoryDisabled],
];
