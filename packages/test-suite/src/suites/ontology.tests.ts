import type { LoongLifecycleHookRequest, MemoryIdentity } from "@loong/core";
import type { ToolDefinition, ToolInvocation } from "@loong/tools";
import {
  createOntologyCandidateLifecycleHook,
  createOntologyCandidateTools,
  createOntologyResolver,
  createSqliteOntologyStore,
  isOntologyEntityType,
  isOntologyPredicate,
  ONTOLOGY_ENTITY_TYPES,
  ONTOLOGY_PREDICATES,
  ONTOLOGY_SELF_ENTITY_NAME,
  validateAssertionSensitivity,
  type OntologyCandidateDraft,
  type OntologyCandidateListOutput,
  type OntologyCandidatePromoteOutput,
  type OntologyCandidateRejectOutput,
  type OntologyStore,
} from "@loong/memory";
import { assert } from "../lib/test-helpers.js";
import type { TestCase } from "../runner.js";

/**
 * Phase 2 (轻量本体 MVP) acceptance tests for the ontology memory upgrade.
 * See docs/ONTOLOGY_MEMORY_REQUIREMENTS.md §7.2 (FR-04..FR-07), §10, §11.
 */

function identity(tenantId: string, userId: string): MemoryIdentity {
  return { tenantId, userId };
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

function preferDraft(objectValue: string, sourceType: OntologyCandidateDraft["sourceType"] = "explicit"): OntologyCandidateDraft {
  return {
    subject: { type: "Person", name: ONTOLOGY_SELF_ENTITY_NAME },
    predicate: "prefers",
    objectValue,
    sourceType,
    excerpt: `user said they prefer ${objectValue}`,
  };
}

function hookRequest(overrides: Partial<LoongLifecycleHookRequest>): LoongLifecycleHookRequest {
  return {
    phase: "end",
    status: "ok",
    runId: "run-onto-1",
    sessionId: "session-onto-1",
    source: "cli",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** §11.1: cross-user/cross-tenant leakage on ALL ontology tables must be 0. */
async function testOntologyCrossUserIsolation(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const ITERATIONS = 50;
  let checks = 0;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const identityA = identity(`tenant-${i % 4}`, `user-${i}`);
    const identityB = i % 3 === 0
      ? identity(`tenant-other-${i % 2}`, identityA.userId) // same user id, different tenant
      : identity(identityA.tenantId, `user-other-${i}`); // same tenant, different user
    const marker = `mk${i}`;

    const entity = await store.insertEntity(identityA, {
      type: "Tool",
      canonicalName: `Cursor-${marker}`,
      aliases: [`cursor-alias-${marker}`],
    });
    const evidence = await store.insertEvidence(identityA, {
      sessionId: `s-${marker}`,
      runId: `r-${marker}`,
      source: "isolation-test",
      excerpt: `evidence excerpt ${marker}`,
    });
    const assertion = await store.insertAssertion(identityA, {
      subjectId: entity.id,
      predicate: "usesTool",
      objectEntityId: entity.id,
      confidence: 0.8,
      sourceType: "explicit",
      status: "candidate",
      evidenceIds: [evidence.id],
    });
    const evidence2 = await store.insertEvidence(identityA, {
      source: "isolation-test",
      excerpt: `second excerpt ${marker}`,
    });
    const assertion2 = await store.insertAssertion(identityA, {
      subjectId: entity.id,
      predicate: "usesTool",
      objectValue: `tool-${marker}`,
      confidence: 0.9,
      sourceType: "explicit",
      status: "candidate",
      evidenceIds: [evidence2.id],
    });
    await store.supersedeAssertion(identityA, assertion.id, assertion2.id);
    const episode = await store.insertEpisode(identityA, {
      sessionId: `s-${marker}`,
      runId: `r-${marker}`,
      summary: `episode ${marker}`,
    });
    await store.putSnapshot(identityA, {
      identity: identityA,
      version: 1,
      content: `snapshot ${marker}`,
      assertionIds: [assertion2.id],
      estimatedTokens: 42,
      generatedAt: new Date().toISOString(),
    });
    await store.putCandidateReview(identityA, { key: `review-${marker}`, decision: "dont_ask" });

    // Every read path from identity B must see zero of A's data.
    assert((await store.listEntities(identityB)).length === 0, `iteration ${i}: B must not list A entities`);
    checks += 1;
    assert((await store.findEntitiesByName(identityB, `Cursor-${marker}`)).length === 0, `iteration ${i}: B must not resolve A entity by name`);
    checks += 1;
    assert((await store.findEntitiesByName(identityB, `cursor-alias-${marker}`)).length === 0, `iteration ${i}: B must not resolve A entity by alias`);
    checks += 1;
    assert((await store.getEntity(identityB, entity.id)) === undefined, `iteration ${i}: B must not read A entity by id`);
    checks += 1;
    assert((await store.findAssertions(identityB)).length === 0, `iteration ${i}: B must not list A assertions`);
    checks += 1;
    assert((await store.getAssertion(identityB, assertion.id)) === undefined, `iteration ${i}: B must not read A assertion by id`);
    checks += 1;
    assert((await store.getAssertionEvidence(identityB, assertion.id)).length === 0, `iteration ${i}: B must not read A assertion evidence`);
    checks += 1;
    assert((await store.getEvidence(identityB, evidence.id)) === undefined, `iteration ${i}: B must not read A evidence by id`);
    checks += 1;
    assert((await store.listEpisodes(identityB)).length === 0, `iteration ${i}: B must not list A episodes`);
    checks += 1;
    assert((await store.getEpisode(identityB, episode.id)) === undefined, `iteration ${i}: B must not read A episode by id`);
    checks += 1;
    assert((await store.getLatestSnapshot(identityB)) === undefined, `iteration ${i}: B must not read A snapshot`);
    checks += 1;
    assert((await store.getCandidateReview(identityB, `review-${marker}`)) === undefined, `iteration ${i}: B must not read A review marker`);
    checks += 1;
    assert((await store.listSupersessions(identityB)).length === 0, `iteration ${i}: B must not list A supersessions`);
    checks += 1;
    assert((await store.listAuditEntries(identityB)).length === 0, `iteration ${i}: B must not list A audit entries`);
    checks += 1;

    // A sees its own data (sanity).
    assert((await store.listEntities(identityA)).length === 1, `iteration ${i}: A should see its own entity`);
    assert((await store.findAssertions(identityA)).length === 2, `iteration ${i}: A should see its own assertions`);
    assert((await store.listSupersessions(identityA)).length === 1, `iteration ${i}: A should see its supersession`);
    checks += 3;
  }
  assert(checks === ITERATIONS * 17, `expected ${ITERATIONS * 17} isolation checks, ran ${checks}`);
  store.close?.();
}

/** §5: the controlled vocabulary is closed — unknown types/predicates are rejected at write time. */
async function testOntologyControlledVocabularyRejection(): Promise<void> {
  assert(ONTOLOGY_ENTITY_TYPES.length === 13, "doc §5.1 defines exactly 13 entity types");
  assert(ONTOLOGY_PREDICATES.length === 14, "doc §5.2 defines exactly 14 predicates");
  assert(isOntologyEntityType("Person") && !isOntologyEntityType("Alien"), "entity type guard works");
  assert(isOntologyPredicate("prefers") && !isOntologyPredicate("lovesX"), "predicate guard works");

  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-vocab", "alice");

  await assertRejects(
    () => store.insertEntity(alice, { type: "Alien", canonicalName: "Zorg" }),
    /Unknown ontology entity type/,
    "unknown entity type must be rejected on insert",
  );
  const self = await store.insertEntity(alice, { type: "Person", canonicalName: "self" });
  const evidence = await store.insertEvidence(alice, { source: "test", excerpt: "user said so" });
  await assertRejects(
    () => store.insertAssertion(alice, {
      subjectId: self.id,
      predicate: "lovesX",
      objectValue: "tea",
      confidence: 0.9,
      sourceType: "explicit",
      status: "candidate",
      evidenceIds: [evidence.id],
    }),
    /Unknown ontology predicate/,
    "unknown predicate must be rejected on assertion insert",
  );

  const resolver = createOntologyResolver({ store });
  await assertRejects(
    () => resolver.ingestCandidate(alice, {
      subject: { type: "Person", name: "self" },
      predicate: "lovesX",
      objectValue: "tea",
      sourceType: "explicit",
      excerpt: "user said they love tea",
    }),
    /Unknown ontology predicate/,
    "models must not mint new predicates (rejected at write time)",
  );
  await assertRejects(
    () => resolver.ingestCandidate(alice, {
      subject: { type: "Alien", name: "self" },
      predicate: "prefers",
      objectValue: "tea",
      sourceType: "explicit",
      excerpt: "user said they prefer tea",
    }),
    /Unknown ontology subject entity type/,
    "unknown subject entity type must be rejected at write time",
  );
  await assertRejects(
    () => resolver.ingestCandidate(alice, {
      subject: { type: "Person", name: "self" },
      predicate: "usesTool",
      objectEntity: { type: "Gadget", name: "hammer" },
      sourceType: "explicit",
      excerpt: "user said they use a hammer",
    }),
    /Unknown ontology object entity type/,
    "unknown object entity type must be rejected at write time",
  );
  store.close?.();
}

/** FR-04: the lifecycle hook stores structured candidates + raw evidence + episode. */
async function testOntologyCandidateHookProducesStructuredCandidates(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-hook", "alice");
  const hook = createOntologyCandidateLifecycleHook({ store });

  await hook.onLifecycle(hookRequest({
    identity: alice,
    userMessage: "我用 Cursor 写代码，我喜欢深色主题。我决定本周五上线。",
  }));

  const candidates = await store.findAssertions(alice, { status: "candidate" });
  assert(candidates.length === 3, `expected 3 structured candidates, got ${candidates.length}`);
  const predicates = candidates.map(candidate => candidate.predicate).sort();
  assert(
    predicates.join(",") === "madeDecision,prefers,usesTool",
    `expected prefers/usesTool/madeDecision candidates, got ${predicates.join(",")}`,
  );
  for (const candidate of candidates) {
    assert(candidate.evidenceIds.length === 1, "each candidate must carry exactly one evidence row");
    assert(candidate.identity.userId === "alice", "candidate must be identity-scoped");
    const evidence = await store.getAssertionEvidence(alice, candidate.id);
    assert(evidence.length === 1, "evidence lookup by assertion must work");
    assert(evidence[0]?.sessionId === "session-onto-1", "evidence keeps the session ref");
    assert(evidence[0]?.runId === "run-onto-1", "evidence keeps the run ref");
    assert(evidence[0]!.excerpt.length > 0, "evidence keeps the raw excerpt");
  }
  const usesTool = candidates.find(candidate => candidate.predicate === "usesTool");
  assert(usesTool?.objectEntityId !== undefined, "usesTool candidate should reference a Tool entity");
  const toolEntity = await store.getEntity(alice, usesTool!.objectEntityId!);
  assert(toolEntity?.type === "Tool" && toolEntity.canonicalName === "Cursor", "Tool entity 'Cursor' should be resolved");
  const subjects = await store.findEntitiesByName(alice, ONTOLOGY_SELF_ENTITY_NAME);
  assert(subjects.length === 1 && subjects[0]?.type === "Person", "the self Person entity should be created once");
  const episodes = await store.listEpisodes(alice);
  assert(episodes.length === 1, "one episode should be recorded for the turn");
  assert(episodes[0]?.sessionId === "session-onto-1" && episodes[0]?.runId === "run-onto-1", "episode keeps session/run refs");

  const entities = await store.listEntities(alice);
  assert(entities.length === 3, `expected self + Tool + Decision entities, got ${entities.length}`);
  store.close?.();
}

/** Missing-identity and non-end phases must not write anything; sensitive facts are not extracted. */
async function testOntologyCandidateHookGuards(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-hook-guard", "alice");
  const hook = createOntologyCandidateLifecycleHook({ store });

  // No identity → silently skipped (§4.1).
  await hook.onLifecycle(hookRequest({ userMessage: "我喜欢深色主题" }));
  // Non-end phases and failed turns → skipped.
  await hook.onLifecycle(hookRequest({ phase: "start", identity: alice, userMessage: "我喜欢深色主题" }));
  await hook.onLifecycle(hookRequest({ status: "error", identity: alice, userMessage: "我喜欢深色主题" }));
  // §10: sensitive facts default to NOT extracted.
  await hook.onLifecycle(hookRequest({ identity: alice, userMessage: "我喜欢用密码管理器" }));
  assert((await store.findAssertions(alice)).length === 0, "no candidates should be stored for guarded turns");
  assert((await store.listEpisodes(alice)).length === 0, "no episodes should be stored for guarded turns");

  // Hedged statements are inferred and stay candidates — never auto-active (§4.3).
  await hook.onLifecycle(hookRequest({ identity: alice, userMessage: "我可能喜欢深色主题" }));
  const candidates = await store.findAssertions(alice);
  assert(candidates.length === 1, "hedged statement should produce one candidate");
  assert(candidates[0]?.sourceType === "inferred", "hedged statement should be marked inferred");
  assert(candidates[0]?.status === "candidate", "inferred candidates never enter active status automatically");
  store.close?.();
}

/** FR-06: repeat the same fact → one assertion, confidence bumped, evidence merged. */
async function testOntologyPromoteDedupsRepeatedFacts(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-dedup", "alice");
  const resolver = createOntologyResolver({ store });

  const first = await resolver.ingestCandidate(alice, preferDraft("深色主题"));
  assert(first.kind === "stored" && first.merged === false, "first sight stores a new candidate");
  if (first.kind !== "stored") {
    throw new Error("unreachable");
  }
  assert(first.assertion.confidence === 0.9, "explicit facts start at 0.9 confidence");

  const second = await resolver.ingestCandidate(alice, {
    ...preferDraft("深色主题"),
    excerpt: "user repeated they prefer dark themes",
  });
  assert(second.kind === "stored" && second.merged === true, "repeat should merge into the existing candidate");
  if (second.kind !== "stored") {
    throw new Error("unreachable");
  }
  assert(second.assertion.id === first.assertion.id, "repeat must not create a parallel assertion");
  assert(second.assertion.evidenceIds.length === 2, "repeat should merge evidence ids");
  assert(second.assertion.confidence > 0.9, "repeat should bump confidence");

  const promoted = await resolver.promoteAssertion(alice, first.assertion.id);
  assert(promoted.assertion.status === "active", "promote should activate the candidate");
  assert(promoted.assertion.evidenceIds.length === 2, "§11.2: the active assertion keeps its evidence");

  // Repeating the same fact after activation merges into the active assertion.
  const third = await resolver.ingestCandidate(alice, {
    ...preferDraft("深色主题"),
    excerpt: "user mentioned dark themes a third time",
  });
  assert(third.kind === "stored" && third.merged === true, "post-activation repeat should merge into the active assertion");
  if (third.kind !== "stored") {
    throw new Error("unreachable");
  }
  assert(third.assertion.id === first.assertion.id, "post-activation repeat must not create a parallel assertion");
  assert(third.assertion.status === "active", "the canonical assertion stays active");
  assert(third.assertion.evidenceIds.length === 3, "all evidence merged");

  const all = await store.findAssertions(alice);
  assert(all.length === 1, `exactly one assertion should exist for the repeated fact, got ${all.length}`);
  const active = await store.findAssertions(alice, { status: "active" });
  assert(active.length === 1 && active[0]?.evidenceIds.length === 3, "single active assertion with merged evidence");
  store.close?.();
}

/** FR-07: 用户 prefers Cursor → 改用 VS Code supersedes the old preference. */
async function testOntologySupersedeFlow(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-supersede", "alice");
  const resolver = createOntologyResolver({ store });

  const cursorDraft = await resolver.ingestCandidate(alice, preferDraft("Cursor"));
  if (cursorDraft.kind !== "stored") {
    throw new Error("unreachable");
  }
  const cursorPromoted = await resolver.promoteAssertion(alice, cursorDraft.assertion.id);
  assert(cursorPromoted.assertion.status === "active", "first preference becomes active");

  const vscodeDraft = await resolver.ingestCandidate(alice, {
    ...preferDraft("VS Code"),
    excerpt: "user explicitly said they switched to VS Code",
  });
  if (vscodeDraft.kind !== "stored") {
    throw new Error("unreachable");
  }
  const vscodePromoted = await resolver.promoteAssertion(alice, vscodeDraft.assertion.id);
  assert(vscodePromoted.assertion.status === "active", "the new explicit preference becomes active");
  assert(vscodePromoted.superseded.length === 1, "the old preference should be superseded");
  assert(vscodePromoted.disputed.length === 0, "an explicit update is not ambiguous");

  const oldAssertion = await store.getAssertion(alice, cursorDraft.assertion.id);
  assert(oldAssertion?.status === "superseded", "Cursor preference → superseded");
  assert(oldAssertion?.validTo !== undefined, "superseded assertion keeps its validity window (§4.4)");
  assert(oldAssertion!.evidenceIds.length > 0, "superseded assertion keeps its original evidence");

  const supersessions = await store.listSupersessions(alice);
  assert(supersessions.length === 1, "one supersedes relation should be recorded");
  assert(
    supersessions[0]?.supersededAssertionId === cursorDraft.assertion.id
      && supersessions[0]?.supersedingAssertionId === vscodeDraft.assertion.id,
    "VS Code assertion → supersedes → Cursor assertion",
  );

  const active = await store.findAssertions(alice, { status: "active" });
  assert(active.length === 1 && active[0]?.objectValue === "VS Code", "only the new preference stays active");
  store.close?.();
}

/** FR-07/§4.3: ambiguous conflicts are disputed on both sides — never silently picked. */
async function testOntologyDisputedAmbiguity(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-disputed", "alice");
  const resolver = createOntologyResolver({ store });

  // Two equally-strong (observed) conflicting facts: both become disputed.
  const cursorObserved = await resolver.ingestCandidate(alice, preferDraft("Cursor", "observed"));
  if (cursorObserved.kind !== "stored") {
    throw new Error("unreachable");
  }
  await resolver.promoteAssertion(alice, cursorObserved.assertion.id);
  const vscodeObserved = await resolver.ingestCandidate(alice, {
    ...preferDraft("VS Code", "observed"),
    excerpt: "observed the user working in VS Code",
  });
  if (vscodeObserved.kind !== "stored") {
    throw new Error("unreachable");
  }
  const ambiguous = await resolver.promoteAssertion(alice, vscodeObserved.assertion.id);
  assert(ambiguous.assertion.status === "disputed", "ambiguous promote must not activate the new fact");
  assert(ambiguous.superseded.length === 0, "ambiguous conflict must not supersede anything");
  assert(ambiguous.disputed.length === 2, "both sides should be marked disputed");
  const existing = await store.getAssertion(alice, cursorObserved.assertion.id);
  assert(existing?.status === "disputed", "the previously active fact is disputed too — never silently pick");

  // A weaker (inferred) fact cannot override an explicit user statement (§4.3).
  const tabsExplicit = await resolver.ingestCandidate(alice, preferDraft("Tabs"));
  if (tabsExplicit.kind !== "stored") {
    throw new Error("unreachable");
  }
  await resolver.promoteAssertion(alice, tabsExplicit.assertion.id);
  const spacesInferred = await resolver.ingestCandidate(alice, {
    ...preferDraft("Spaces", "inferred"),
    excerpt: "the user might prefer spaces",
  });
  if (spacesInferred.kind !== "stored") {
    throw new Error("unreachable");
  }
  const weaker = await resolver.promoteAssertion(alice, spacesInferred.assertion.id);
  assert(weaker.assertion.status === "disputed", "the inferred candidate is flagged disputed");
  const explicitFact = await store.getAssertion(alice, tabsExplicit.assertion.id);
  assert(explicitFact?.status === "active", "the explicit fact stands (模型推断不能自动覆盖用户明确事实)");
  store.close?.();
}

/** FR-06 step 7 + §10: structural validator rules. */
async function testOntologyValidatorRules(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-validator", "alice");
  const self = await store.insertEntity(alice, { type: "Person", canonicalName: "self" });
  const evidence = await store.insertEvidence(alice, { source: "test", excerpt: "user said so" });

  // §11.2: every active assertion has evidence.
  await assertRejects(
    () => store.insertAssertion(alice, {
      subjectId: self.id,
      predicate: "prefers",
      objectValue: "tea",
      confidence: 0.9,
      sourceType: "explicit",
      status: "active",
      evidenceIds: [],
    }),
    /at least one evidence/,
    "active assertion without evidence must be rejected",
  );
  await assertRejects(
    () => store.insertAssertion(alice, {
      subjectId: self.id,
      predicate: "prefers",
      objectValue: "tea",
      confidence: 1.5,
      sourceType: "explicit",
      status: "candidate",
      evidenceIds: [evidence.id],
    }),
    /between 0 and 1/,
    "confidence outside [0,1] must be rejected",
  );
  await assertRejects(
    () => store.insertAssertion(alice, {
      subjectId: "ent_missing",
      predicate: "prefers",
      objectValue: "tea",
      confidence: 0.9,
      sourceType: "explicit",
      status: "candidate",
      evidenceIds: [evidence.id],
    }),
    /existing entity/,
    "assertion must reference an existing subject",
  );
  await assertRejects(
    () => store.insertAssertion(alice, {
      subjectId: self.id,
      predicate: "prefers",
      confidence: 0.9,
      sourceType: "explicit",
      status: "candidate",
      evidenceIds: [evidence.id],
    }),
    /exactly one object form/,
    "assertion without an object must be rejected",
  );
  await assertRejects(
    () => store.insertAssertion(alice, {
      subjectId: self.id,
      predicate: "prefers",
      objectValue: "tea",
      confidence: 0.9,
      sourceType: "explicit",
      status: "candidate",
      evidenceIds: ["evd_missing"],
    }),
    /evidence not found/,
    "assertion evidence must reference existing evidence rows",
  );

  // Merged/deleted subjects cannot take new assertions.
  const merged = await store.insertEntity(alice, { type: "Tool", canonicalName: "Old Tool" });
  await store.updateEntity(alice, { ...merged, status: "merged" });
  await assertRejects(
    () => store.insertAssertion(alice, {
      subjectId: merged.id,
      predicate: "usesTool",
      objectValue: "Old Tool",
      confidence: 0.9,
      sourceType: "explicit",
      status: "candidate",
      evidenceIds: [evidence.id],
    }),
    /merged/,
    "assertions on a merged subject must be rejected",
  );

  // §10: inferred + sensitive is rejected (validator + write path).
  let threw = false;
  try {
    validateAssertionSensitivity("inferred", "sensitive");
  } catch {
    threw = true;
  }
  assert(threw, "validator must reject inferred + sensitive");
  const resolver = createOntologyResolver({ store });
  await assertRejects(
    () => resolver.ingestCandidate(alice, {
      subject: { type: "Person", name: "self" },
      predicate: "prefers",
      objectValue: "private fact",
      sourceType: "inferred",
      sensitivity: "sensitive",
      excerpt: "model guessed something private",
    }),
    /sensitive/,
    "inferred sensitive facts must be rejected at write time",
  );
  store.close?.();
}

/** §10: every write is audited with operator/source; audit is identity-scoped and excerpt-free. */
async function testOntologyAuditLog(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-audit", "alice");
  const bob = identity("t-audit", "bob");

  const entity = await store.insertEntity(alice, {
    type: "Person",
    canonicalName: "self",
  }, { operator: "test-operator", source: "test-suite" });
  const secretExcerpt = `evidence excerpt ${Date.now()} secret-marker`;
  const evidence = await store.insertEvidence(alice, {
    source: "test-suite",
    excerpt: secretExcerpt,
  }, { operator: "test-operator" });
  const assertion = await store.insertAssertion(alice, {
    subjectId: entity.id,
    predicate: "prefers",
    objectValue: "tea",
    confidence: 0.9,
    sourceType: "explicit",
    status: "candidate",
    evidenceIds: [evidence.id],
  }, { operator: "test-operator", detail: { transition: "none->candidate" } });
  await store.updateAssertion(alice, assertion.id, { status: "active" }, {
    operator: "reviewer",
    detail: { transition: "candidate->active" },
  });

  const entries = await store.listAuditEntries(alice);
  const actions: string[] = entries.map(entry => entry.action);
  for (const expected of ["insert_entity", "insert_evidence", "insert_assertion", "update_assertion"]) {
    assert(actions.includes(expected), `audit log should contain ${expected}, got ${actions.join(",")}`);
  }
  for (const entry of entries) {
    assert(entry.operator.length > 0, "every audit entry records an operator");
    assert(entry.identity.userId === "alice", "audit entries are identity-scoped");
  }
  assert(
    entries.some(entry => entry.operator === "reviewer" && entry.detail?.transition === "candidate->active"),
    "review transition should be audited with operator and detail",
  );
  // §10: the audit log must not record full sensitive evidence.
  assert(
    !JSON.stringify(entries).includes(secretExcerpt),
    "audit log must not contain raw evidence excerpts",
  );
  assert((await store.listAuditEntries(bob)).length === 0, "another user must not see alice's audit entries");
  store.close?.();
}

/** FR-05: review tools — list, promote through resolver, reject with "don't ask again". */
async function testOntologyReviewTools(): Promise<void> {
  const store = createSqliteOntologyStore({ databasePath: ":memory:" });
  const alice = identity("t-tools", "alice");
  const bob = identity("t-tools", "bob");
  const resolver = createOntologyResolver({ store });
  const tools = createOntologyCandidateTools({ store, resolver });
  const listTool = tools.find(tool => tool.name === "ontology_candidates_list");
  const promoteTool = tools.find(tool => tool.name === "ontology_candidate_promote");
  const rejectTool = tools.find(tool => tool.name === "ontology_candidate_reject");
  assert(listTool && promoteTool && rejectTool, "all three review tools should be registered");
  assert(listTool!.permission === "allow", "listing stays permission-free");
  assert(promoteTool!.permission === "ask" && rejectTool!.permission === "ask", "writes follow the ask-permission policy");

  let invocationCounter = 0;
  const invokeTool = async (
    tool: ToolDefinition,
    input: unknown,
    identityValue?: MemoryIdentity,
  ) => {
    invocationCounter += 1;
    const invocation: ToolInvocation = {
      id: `inv-${invocationCounter}`,
      name: tool.name,
      input,
      sessionId: "s-tools",
      ...(identityValue !== undefined ? { metadata: { identity: identityValue } } : {}),
    };
    return tool.invoke(invocation);
  };

  // Identity is mandatory.
  const anonymous = await invokeTool(listTool!, { status: "candidate" });
  assert(anonymous.ok === false, "tools must refuse to run without a trustworthy identity");

  // Seed one candidate for alice.
  const seeded = await resolver.ingestCandidate(alice, preferDraft("主题A"));
  if (seeded.kind !== "stored") {
    throw new Error("unreachable");
  }

  const listed = await invokeTool(listTool!, { status: "candidate" }, alice);
  assert(listed.ok === true, "listing with identity should succeed");
  const listOutput = listed.output as OntologyCandidateListOutput;
  assert(listOutput.candidates.length === 1, "one structured candidate should be listed");
  assert(listOutput.candidates[0]?.subject?.canonicalName === ONTOLOGY_SELF_ENTITY_NAME, "candidate subject should be hydrated");
  assert(listOutput.candidates[0]?.assertion.evidenceIds.length === 1, "listed candidate keeps its evidence ref");

  // Cross-user: bob cannot see or promote alice's candidate.
  const bobList = await invokeTool(listTool!, { status: "candidate" }, bob);
  assert(bobList.ok === true && (bobList.output as OntologyCandidateListOutput).candidates.length === 0, "bob must not see alice's candidates");
  const bobPromote = await invokeTool(promoteTool!, { id: seeded.assertion.id }, bob);
  assert(bobPromote.ok === false, "bob must not promote alice's candidate");

  // Promote through the resolver (FR-06 pipeline).
  const promoted = await invokeTool(promoteTool!, { id: seeded.assertion.id }, alice);
  assert(promoted.ok === true, "promote should succeed");
  const promoteOutput = promoted.output as OntologyCandidatePromoteOutput;
  assert(promoteOutput.assertion.status === "active", "promoted assertion becomes active");
  assert(promoteOutput.assertion.evidenceIds.length === 1, "§11.2: promoted assertion keeps evidence");

  // Reject with reason + "don't ask again" suppresses future identical candidates.
  const rejectedSeed = await resolver.ingestCandidate(alice, preferDraft("主题B"));
  if (rejectedSeed.kind !== "stored") {
    throw new Error("unreachable");
  }
  const rejected = await invokeTool(rejectTool!, { id: rejectedSeed.assertion.id, reason: "not useful", dontAskAgain: true }, alice);
  assert(rejected.ok === true, "reject should succeed");
  const rejectOutput = rejected.output as OntologyCandidateRejectOutput;
  assert(rejectOutput.assertion.status === "retracted", "rejected candidate is retracted");
  assert(rejectOutput.dontAskAgain === true, "don't-ask-again flag should be recorded");

  const suppressed = await resolver.ingestCandidate(alice, {
    ...preferDraft("主题B"),
    excerpt: "user mentioned 主题B again",
  });
  assert(suppressed.kind === "skipped", "identical future candidates should be suppressed by the review marker");

  // A different fact is not suppressed.
  const other = await resolver.ingestCandidate(alice, preferDraft("主题C"));
  assert(other.kind === "stored", "unrelated facts are not suppressed");
  store.close?.();
}

export const ontologyTestCases: TestCase[] = [
  ["ontology sqlite cross-user isolation (all tables)", testOntologyCrossUserIsolation],
  ["ontology controlled vocabulary rejection", testOntologyControlledVocabularyRejection],
  ["ontology candidate hook produces structured candidates", testOntologyCandidateHookProducesStructuredCandidates],
  ["ontology candidate hook guards (identity/sensitive/inferred)", testOntologyCandidateHookGuards],
  ["ontology promote dedups repeated facts", testOntologyPromoteDedupsRepeatedFacts],
  ["ontology supersede flow (FR-07 Cursor to VS Code)", testOntologySupersedeFlow],
  ["ontology disputed ambiguity never silently picks", testOntologyDisputedAmbiguity],
  ["ontology validator rules", testOntologyValidatorRules],
  ["ontology audit log", testOntologyAuditLog],
  ["ontology review tools (list/promote/reject/dont-ask)", testOntologyReviewTools],
];
