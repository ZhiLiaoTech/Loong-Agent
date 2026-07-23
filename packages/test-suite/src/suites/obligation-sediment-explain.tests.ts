import type { MemoryIdentity } from "@loong/core";
import {
  createObligationService,
  createOntologyObligationSedimenter,
  createSqliteObligationStore,
  createSqliteOntologyStore,
  evaluateObligationStoppingRule,
  obligationSedimentEpisodeId,
  obligationSedimentEvidenceId,
  type Obligation,
  type ObligationBudget,
  type ObligationCreateInput,
  type ObligationItem,
  type ObligationRecord,
  type ObligationSedimenter,
  type ObligationService,
  type ObligationStatus,
  type ObligationStore,
  type ObligationUsageAggregate,
  type OntologyStore,
} from "@loong/memory";
import { assert } from "../lib/test-helpers.js";
import type { TestCase } from "../runner.js";

/**
 * Phase 3.2 acceptance tests（记忆沉淀 + 解释链 + Loop 对接）:
 * docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md §7/§8/§11 Phase 3.2 checklist —
 * terminal sedimentation into ontology episodes/evidence (idempotent, correct
 * refs, blocked_recoverable excluded), explainObligation provenance chain
 * (timeline order, item verdict detail, resolved/dangling/external evidence,
 * retry history, final verdict + operator, sedimentation view), Loop stopping
 * rule matrix + awaitVerdict polling, isolation and audit hygiene on new paths.
 */

const TENANT = "t-p32";
const PAST = "2020-01-01T00:00:00.000Z";
const FAR_NOW = "2030-01-01T00:00:00.000Z";

function alice(): MemoryIdentity {
  return { tenantId: TENANT, userId: "alice" };
}

function bob(): MemoryIdentity {
  return { tenantId: TENANT, userId: "bob" };
}

interface Fixture {
  store: ObligationStore;
  ontologyStore: OntologyStore;
  service: ObligationService;
}

function fixture(options: {
  subject?: unknown;
  sedimenter?: ObligationSedimenter | null;
  usage?: ObligationUsageAggregate;
} = {}): Fixture {
  const store = createSqliteObligationStore({ databasePath: ":memory:" });
  const ontologyStore = createSqliteOntologyStore({ databasePath: ":memory:" });
  const sedimenter = options.sedimenter === null
    ? undefined
    : options.sedimenter ?? createOntologyObligationSedimenter({ ontologyStore });
  const service = createObligationService({
    store,
    ontologyStore,
    ...("subject" in options ? { subjectResolver: () => options.subject } : {}),
    ...(sedimenter !== undefined ? { sedimenter } : {}),
    ...(options.usage !== undefined ? { usageResolver: () => options.usage } : {}),
  });
  return { store, ontologyStore, service };
}

function baseInput(overrides: Partial<ObligationCreateInput> = {}): ObligationCreateInput {
  return {
    employeeId: "emp-1",
    requesterUserId: "alice",
    statement: "退款单 R-3 完成退款闭环",
    items: [
      {
        acceptance: "退款提案通过 schema 校验",
        validator: "schema",
        validatorConfig: {
          schema: { type: "object", properties: { proposal: { properties: { action: { const: "refund" } } } } },
        },
      },
    ],
    ...overrides,
  };
}

async function reachValidating(
  service: ObligationService,
  identity: MemoryIdentity,
  input: ObligationCreateInput,
): Promise<ObligationRecord> {
  const created = await service.createObligation(identity, input);
  for (const item of created.items) {
    await service.attachEvidence(identity, created.obligation.id, {
      itemId: item.id,
      ref: { kind: "wf_event", instanceId: "wf-p32", seq: item.seq },
    });
  }
  const record = await service.getObligation(identity, created.obligation.id);
  assert(record !== undefined, "obligation should exist");
  assert(record.obligation.status === "validating", `expected validating, got ${record.obligation.status}`);
  return record;
}

async function expectReject(fn: () => Promise<unknown>, marker: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(marker), `expected rejection containing "${marker}", got: ${message}`);
    return;
  }
  throw new Error(`expected rejection containing "${marker}" but the call succeeded`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// 1. 终态沉淀（§7）：fulfilled / blocked_hard / expired 沉淀 episode+evidence
//    到契约自身 identity；载体 sessionId/runId 正确；ontology 审计留痕；
//    blocked_recoverable（非终态）不沉淀。
// ---------------------------------------------------------------------------
async function testSedimentationOnTerminalStates(): Promise<void> {
  const subject = { proposal: { action: "refund" } };
  const { service, ontologyStore } = fixture({ subject });
  const identity = alice();

  // fulfilled（带执行载体：episode 关联 instanceId/runId）。
  const fulfilledRecord = await reachValidating(service, identity, baseInput({
    carrier: { instanceId: "wf-sed-1", runId: "run-sed-1", idempotencyKey: "sed-fulfilled" },
  }));
  const fulfilledId = fulfilledRecord.obligation.id;
  const fulfilledReport = await service.validateObligation(identity, fulfilledId, { operator: "p32-test" });
  assert(fulfilledReport.outcome === "fulfilled", `expected fulfilled, got ${fulfilledReport.outcome}`);

  const episode = await ontologyStore.getEpisode(identity, obligationSedimentEpisodeId(fulfilledId));
  assert(episode !== undefined, "fulfilled terminal should sediment an episode");
  assert(episode.sessionId === "wf-sed-1", `episode sessionId should be the carrier instanceId, got ${episode.sessionId}`);
  assert(episode.runId === "run-sed-1", `episode runId should be the carrier runId, got ${episode.runId}`);
  assert(episode.summary?.includes("[fulfilled]") === true, `episode summary should carry the status, got ${episode.summary}`);
  assert(episode.summary.includes("退款单 R-3"), "episode summary should carry the statement");

  const evidence = await ontologyStore.getEvidence(identity, obligationSedimentEvidenceId(fulfilledId));
  assert(evidence !== undefined, "fulfilled terminal should sediment an evidence record");
  assert(evidence.source === "obligation-verdict", `sediment evidence source should be obligation-verdict, got ${evidence.source}`);
  assert(evidence.excerpt.includes(`obligation: ${fulfilledId}`), "report should reference the obligation id");
  assert(evidence.excerpt.includes("status: fulfilled"), "report should carry the terminal status");
  assert(evidence.excerpt.includes("[pass] (schema, required)"), `report should carry item verdict lines, got:\n${evidence.excerpt}`);
  assert(evidence.excerpt.includes("evidenceLinks: 1"), "report should count evidence links");

  const ontologyAudits = await ontologyStore.listAuditEntries(identity, {});
  const sedimentAudits = ontologyAudits.filter(entry => entry.source === "obligation.sediment");
  assert(sedimentAudits.some(entry => entry.action === "insert_episode" && entry.recordId === episode.id),
    "sediment episode insert should be audited");
  assert(sedimentAudits.some(entry => entry.action === "insert_evidence" && entry.recordId === evidence.id),
    "sediment evidence insert should be audited");

  // blocked_hard（无载体：sessionId/runId 以 obligation 兜底）。
  const hardRecord = await reachValidating(service, identity, baseInput({
    statement: "schema 不符契约",
    items: [{
      acceptance: "action 必须是 chargeback",
      validator: "schema",
      validatorConfig: { schema: { type: "object", properties: { proposal: { properties: { action: { const: "chargeback" } } } } } },
    }],
  }));
  const hardId = hardRecord.obligation.id;
  const hardReport = await service.validateObligation(identity, hardId);
  assert(hardReport.outcome === "blocked_hard", `expected blocked_hard, got ${hardReport.outcome}`);
  const hardEpisode = await ontologyStore.getEpisode(identity, obligationSedimentEpisodeId(hardId));
  assert(hardEpisode?.summary?.includes("[blocked_hard]") === true, "blocked_hard should sediment with its status");
  assert(hardEpisode.sessionId === `obligation:${hardId}`, "carrier-less obligation falls back to obligation-derived session id");
  const hardEvidence = await ontologyStore.getEvidence(identity, obligationSedimentEvidenceId(hardId));
  assert(hardEvidence?.excerpt.includes("[hard_block] (schema, required)") === true, "report should carry the hard_block item line");

  // expired（异常归档，§3.2）：sweep 后同样沉淀。
  const expiring = await service.createObligation(identity, baseInput({
    statement: "过期契约",
    deadlineAt: PAST,
    carrier: { idempotencyKey: "sed-expired" },
  }));
  const swept = await service.sweepExpired(identity, FAR_NOW);
  assert(swept.some(obligation => obligation.id === expiring.obligation.id), "setup: obligation should be swept");
  const expiredEpisode = await ontologyStore.getEpisode(identity, obligationSedimentEpisodeId(expiring.obligation.id));
  assert(expiredEpisode?.summary?.includes("[expired]") === true, "expired should sediment as 异常归档");

  // blocked_recoverable 不是终态：不沉淀。
  const recoverableFixture = fixture();
  const recoverableRecord = await reachValidating(recoverableFixture.service, identity, baseInput({
    statement: "可恢复阻断契约",
    items: [{
      acceptance: "subject 缺失",
      validator: "tool_assertion",
      validatorConfig: { subjectPath: "missing", assertions: [{ path: "anything", op: "exists" }] },
    }],
  }));
  const recoverableReport = await recoverableFixture.service.validateObligation(identity, recoverableRecord.obligation.id);
  assert(recoverableReport.outcome === "blocked_recoverable", `expected blocked_recoverable, got ${recoverableReport.outcome}`);
  const recoverableEpisode = await recoverableFixture.ontologyStore.getEpisode(
    identity,
    obligationSedimentEpisodeId(recoverableRecord.obligation.id),
  );
  assert(recoverableEpisode === undefined, "blocked_recoverable is NOT terminal and must not sediment");
}

// ---------------------------------------------------------------------------
// 2. 沉淀幂等：重复终态通知不产生第二条 episode/evidence；部分补齐也可重入。
// ---------------------------------------------------------------------------
async function testSedimentationIdempotent(): Promise<void> {
  const subject = { proposal: { action: "refund" } };
  const { service, ontologyStore } = fixture({ subject });
  const identity = alice();
  const record = await reachValidating(service, identity, baseInput());
  const id = record.obligation.id;
  await service.validateObligation(identity, id);

  const sedimenter = createOntologyObligationSedimenter({ ontologyStore });
  const terminal = await service.getObligation(identity, id);
  assert(terminal !== undefined, "terminal record should exist");
  // 直接重复通知两次（模拟重试风暴/双写）：仍只有一条沉淀。
  await sedimenter.onObligationTerminal(identity, { record: terminal, via: "duplicate-notify" });
  await sedimenter.onObligationTerminal(identity, { record: terminal, via: "duplicate-notify" });

  const episodes = await ontologyStore.listEpisodes(identity, {});
  const sedimentEpisodes = episodes.filter(episode => episode.id.startsWith("oblsed_ep_"));
  assert(sedimentEpisodes.length === 1, `duplicate notifications must not duplicate episodes, got ${sedimentEpisodes.length}`);
  const evidenceList = await ontologyStore.listEvidence(identity, {});
  const sedimentEvidence = evidenceList.filter(entry => entry.id.startsWith("oblsed_ev_"));
  assert(sedimentEvidence.length === 1, `duplicate notifications must not duplicate evidence, got ${sedimentEvidence.length}`);

  const episodeBefore = await ontologyStore.getEpisode(identity, obligationSedimentEpisodeId(id));
  const episodeAfter = await ontologyStore.getEpisode(identity, obligationSedimentEpisodeId(id));
  assert(episodeBefore?.capturedAt === episodeAfter?.capturedAt, "idempotent skip must keep the original episode");
}

// ---------------------------------------------------------------------------
// 3. 沉淀 best-effort：sedimenter 抛错不影响裁定主流程（投影失败不回滚终态）。
// ---------------------------------------------------------------------------
async function testSedimentationBestEffort(): Promise<void> {
  const subject = { proposal: { action: "refund" } };
  const failing: ObligationSedimenter = {
    async onObligationTerminal() {
      throw new Error("ontology store on fire");
    },
  };
  const { service, ontologyStore } = fixture({ subject, sedimenter: failing });
  const identity = alice();
  const record = await reachValidating(service, identity, baseInput());
  const report = await service.validateObligation(identity, record.obligation.id);
  assert(report.outcome === "fulfilled", "sedimenter failure must not break the verdict path");
  const episode = await ontologyStore.getEpisode(identity, obligationSedimentEpisodeId(record.obligation.id));
  assert(episode === undefined, "failed sedimenter leaves no projection (explain/dangling tolerant)");
}

// ---------------------------------------------------------------------------
// 4. 解释链完备性（§7/FR-12 同构）：四身份、时间线顺序、逐项 verdict、证据
//    解引用、retry 历史、终态裁定与 operator、沉淀视图。
// ---------------------------------------------------------------------------
async function testExplainChainCompleteness(): Promise<void> {
  const subject = { proposal: { action: "refund" } };
  const { service, ontologyStore } = fixture({ subject });
  const identity = alice();

  const seeded = await ontologyStore.insertEvidence(identity, {
    source: "p32-test",
    excerpt: "溯源证据原文-marker-7c1",
    sessionId: "sess-explain",
    runId: "run-explain",
  });

  const created = await service.createObligation(identity, baseInput({
    statement: "解释链契约",
    retryBudget: 1,
    carrier: { instanceId: "wf-explain-1", runId: "run-explain-1", idempotencyKey: "explain-key" },
    items: [
      {
        acceptance: "schema 校验",
        validator: "schema",
        validatorConfig: { schema: { type: "object", properties: { proposal: { properties: { action: { const: "refund" } } } } } },
      },
      { acceptance: "人工确认到账", validator: "human_confirm" },
    ],
  }));
  const id = created.obligation.id;
  const [schemaItem, humanItem] = created.items;
  assert(schemaItem && humanItem, "two items expected");

  await service.attachEvidence(identity, id, {
    itemId: schemaItem.id,
    ref: { kind: "ontology_evidence", tenantId: TENANT, userId: "alice", evidenceId: seeded.id },
  });
  await service.attachEvidence(identity, id, {
    itemId: humanItem.id,
    ref: { kind: "wf_event", instanceId: "wf-explain-1", seq: 7 },
  });
  const firstReport = await service.validateObligation(identity, id);
  assert(firstReport.outcome === "awaiting", `setup: human pending should await, got ${firstReport.outcome}`);

  const recoverable = await service.submitHumanVerdict(identity, id, {
    itemId: humanItem.id,
    verdict: "recoverable_block",
    reason: "回执模糊，需重试",
  }, { operator: "alice" });
  assert(recoverable.outcome === "blocked_recoverable", `setup: human recoverable, got ${recoverable.outcome}`);

  await service.retryObligation(identity, id, { operator: "p32-test" });
  await service.attachEvidence(identity, id, {
    itemId: humanItem.id,
    ref: { kind: "wf_event", instanceId: "wf-explain-1", seq: 8 },
  });
  const finalReport = await service.submitHumanVerdict(identity, id, {
    itemId: humanItem.id,
    verdict: "pass",
    reason: "已确认到账",
  }, { operator: "alice" });
  assert(finalReport.outcome === "fulfilled", `setup: should fulfill, got ${finalReport.outcome} (${finalReport.reason})`);

  const explanation = await service.explainObligation(identity, id);
  assert(explanation !== undefined, "explain should return the chain");

  // 四身份。
  assert(explanation.fourIdentities.request.userId === "alice"
    && explanation.fourIdentities.request.employeeId === "emp-1"
    && explanation.fourIdentities.request.requesterUserId === "alice", "request identity should be complete");
  assert(explanation.fourIdentities.contract.itemCount === 2
    && explanation.fourIdentities.contract.requiredItemCount === 2
    && explanation.fourIdentities.contract.retryBudget === 0, "contract identity should reflect retry consumption");
  assert(explanation.fourIdentities.carrier.instanceId === "wf-explain-1"
    && explanation.fourIdentities.carrier.runId === "run-explain-1"
    && explanation.fourIdentities.carrier.idempotencyKey === "explain-key", "carrier identity should be complete");
  assert(explanation.fourIdentities.record.sedimented === true, "record identity should show sedimentation");

  // 时间线：seq 单调递增，覆盖全部事件类别。
  const timeline = explanation.timeline;
  assert(timeline.length > 0, "timeline must not be empty");
  for (let index = 1; index < timeline.length; index += 1) {
    assert(timeline[index]!.seq > timeline[index - 1]!.seq, "timeline must be ordered by audit seq");
  }
  const kinds = new Set(timeline.map(entry => entry.kind));
  for (const kind of ["created", "transition", "evidence_attached", "verdict_recorded", "retry_budget"] as const) {
    assert(kinds.has(kind), `timeline should contain ${kind} entries`);
  }
  assert(timeline[0]!.kind === "created", "timeline should start with creation");
  const verdictEntries = timeline.filter(entry => entry.kind === "verdict_recorded");
  assert(verdictEntries.length === 3, `expected 3 verdict entries (schema pass + 2 human), got ${verdictEntries.length}`);
  const humanVerdictEntries = verdictEntries.filter(entry => entry.itemId === humanItem.id);
  assert(humanVerdictEntries.every(entry => entry.operator === "alice"), "human verdict timeline entries must carry the confirming operator");
  const schemaVerdict = verdictEntries.find(entry => entry.itemId === schemaItem.id);
  assert(schemaVerdict?.validator === "schema" && schemaVerdict.verdict === "pass", "schema verdict entry should carry validator + verdict");

  // 逐项解释与证据解引用。
  const schemaExplanation = explanation.items.find(entry => entry.item.id === schemaItem.id);
  assert(schemaExplanation?.item.verdict === "pass", "schema item should be passed");
  const resolvedEvidence = schemaExplanation?.evidence[0]?.resolution;
  assert(resolvedEvidence?.kind === "ontology_evidence" && resolvedEvidence.status === "resolved",
    "ontology evidence ref should resolve");
  if (resolvedEvidence?.kind === "ontology_evidence" && resolvedEvidence.status === "resolved") {
    assert(resolvedEvidence.evidence.excerpt.includes("marker-7c1"), "resolved evidence should carry the excerpt (in-boundary read)");
  }
  const humanExplanation = explanation.items.find(entry => entry.item.id === humanItem.id);
  assert(humanExplanation?.item.verdict === "pass" && humanExplanation.item.verdictReason === "已确认到账",
    "human item should carry the final verdict + reason");
  const humanResolutions = humanExplanation?.evidence.map(entry => entry.resolution) ?? [];
  assert(humanResolutions.length === 2 && humanResolutions.every(resolution => resolution.kind === "wf_event" && resolution.status === "external"),
    "wf_event refs should be marked external (not dereferenced)");

  // retry 历史 + 终态裁定。
  assert(explanation.retryHistory.length === 1, `expected one retry event, got ${explanation.retryHistory.length}`);
  assert(explanation.retryHistory[0]?.budgetFrom === 1 && explanation.retryHistory[0].budgetTo === 0,
    "retry history should carry budget from/to");
  assert(explanation.retryHistory[0]?.via === "obligation.retry", "retry event should carry the via");
  assert(explanation.finalVerdict?.status === "fulfilled", "final verdict should be fulfilled");
  assert(explanation.finalVerdict.operator === "alice", `final verdict operator should be alice, got ${explanation.finalVerdict.operator}`);
  assert(explanation.finalVerdict.via === "obligation.verdict.human", "final verdict should record the human via");

  // 沉淀视图 + Loop 停止信号。
  assert(explanation.sedimentation.sedimented === true, "sedimentation view should be present");
  assert(explanation.sedimentation.episode?.summary?.includes("[fulfilled]") === true, "sediment episode should be linked");
  assert(explanation.stoppingRule.shouldStop === true && explanation.stoppingRule.outcome === "success",
    "stopping rule should signal success-stop on fulfilled");
  assert(explanation.verdictSummary.hasNonModelRequiredPass === true, "verdict summary should show a non-model pass");
  assert(explanation.audit.length === explanation.timeline.length, "audit view should back the timeline 1:1");
}

// ---------------------------------------------------------------------------
// 5. 证据解引用三态：resolved（episode/evidence 原文）/ dangling（挂接后被删
//    或缺 store）/ external（wf_event/step_result 不解引用）。
// ---------------------------------------------------------------------------
async function testExplainEvidenceResolutionStates(): Promise<void> {
  const subject = { proposal: { action: "refund" } };
  const { service, ontologyStore } = fixture({ subject });
  const identity = alice();

  const episode = await ontologyStore.insertEpisode(identity, {
    sessionId: "sess-resolve",
    runId: "run-resolve",
    summary: "执行片段摘要",
  });
  const evidence = await ontologyStore.insertEvidence(identity, {
    source: "p32-test",
    excerpt: "待删除的证据原文",
  });

  const created = await service.createObligation(identity, baseInput({
    items: [
      {
        acceptance: "schema 校验",
        validator: "schema",
        validatorConfig: { schema: { type: "object", properties: { proposal: { properties: { action: { const: "refund" } } } } } },
      },
      { acceptance: "人工确认", validator: "human_confirm", required: false },
    ],
  }));
  const id = created.obligation.id;
  const [schemaItem, optionalItem] = created.items;
  assert(schemaItem && optionalItem, "two items expected");

  await service.attachEvidence(identity, id, {
    itemId: schemaItem.id,
    ref: { kind: "ontology_episode", tenantId: TENANT, userId: "alice", episodeId: episode.id },
  });
  await service.attachEvidence(identity, id, {
    ref: { kind: "ontology_evidence", tenantId: TENANT, userId: "alice", evidenceId: evidence.id },
  });
  await service.attachEvidence(identity, id, {
    ref: { kind: "step_result", idempotencyKey: "resolve-step" },
  });

  // 挂接后删除 evidence → 指针悬空（读方容忍）。
  await ontologyStore.deleteEvidence(identity, evidence.id, { operator: "p32-test" });

  const explanation = await service.explainObligation(identity, id);
  assert(explanation !== undefined, "explain should return the chain");
  const itemResolution = explanation.items[0]?.evidence[0]?.resolution;
  assert(itemResolution?.kind === "ontology_episode" && itemResolution.status === "resolved", "episode ref should resolve");
  if (itemResolution?.kind === "ontology_episode" && itemResolution.status === "resolved") {
    assert(itemResolution.episode.summary === "执行片段摘要", "resolved episode should carry its summary");
  }
  const contractResolutions = explanation.contractEvidence.map(entry => entry.resolution);
  const dangling = contractResolutions.find(resolution => resolution.status === "dangling");
  assert(dangling?.kind === "ontology_evidence", "deleted evidence should surface as dangling (no error, no leak)");
  const external = contractResolutions.find(resolution => resolution.status === "external");
  assert(external?.kind === "step_result", "step_result refs should be external");
}

// ---------------------------------------------------------------------------
// 6. Loop 停止信号矩阵（§8）：终态 > 预算 > 在途；budget 接线后经
//    getObligationStatus 暴露 usage + stoppingRule。
// ---------------------------------------------------------------------------
function syntheticRecord(options: {
  status: ObligationStatus;
  retryBudget?: number;
  budget?: ObligationBudget;
  items?: { validator?: ObligationItem["validator"]; required?: boolean; verdict?: ObligationItem["verdict"] }[];
}): ObligationRecord {
  const now = "2026-01-01T00:00:00.000Z";
  const obligation: Obligation = {
    id: "obl_synthetic",
    identity: alice(),
    employeeId: "emp-1",
    source: "rpc",
    statement: "synthetic",
    status: options.status,
    retryBudget: options.retryBudget ?? 2,
    createdAt: now,
    updatedAt: now,
    ...(options.budget !== undefined ? { budget: options.budget } : {}),
  };
  const items: ObligationItem[] = (options.items ?? [{}]).map((item, index) => ({
    id: `obi_${index}`,
    obligationId: obligation.id,
    seq: index + 1,
    acceptance: `item ${index}`,
    validator: item.validator ?? "schema",
    validatorConfig: {},
    required: item.required ?? true,
    ...(item.verdict !== undefined ? { verdict: item.verdict } : {}),
    createdAt: now,
    updatedAt: now,
  }));
  return { obligation, items, evidenceLinks: [] };
}

async function testStoppingRuleMatrix(): Promise<void> {
  const fulfilled = evaluateObligationStoppingRule(syntheticRecord({ status: "fulfilled", items: [{ verdict: "pass" }] }));
  assert(fulfilled.shouldStop === true && fulfilled.outcome === "success", "fulfilled should stop with success");

  const hard = evaluateObligationStoppingRule(syntheticRecord({ status: "blocked_hard" }));
  assert(hard.shouldStop === true && hard.outcome === "failure", "blocked_hard should stop with failure");

  const expired = evaluateObligationStoppingRule(syntheticRecord({ status: "expired" }));
  assert(expired.shouldStop === true && expired.outcome === "failure", "expired should stop with failure");

  const validating = evaluateObligationStoppingRule(syntheticRecord({ status: "validating" }));
  assert(validating.shouldStop === false && validating.reason.includes("validation"), "validating should keep running");

  const awaitingHuman = evaluateObligationStoppingRule(syntheticRecord({
    status: "validating",
    items: [{ validator: "human_confirm" }],
  }));
  assert(awaitingHuman.shouldStop === false && awaitingHuman.reason.includes("human"), "human-pending should keep waiting");

  const recoverable = evaluateObligationStoppingRule(syntheticRecord({ status: "blocked_recoverable", retryBudget: 1 }));
  assert(recoverable.shouldStop === false && recoverable.reason.includes("1 retry"), "blocked_recoverable is not terminal");

  const dispatched = evaluateObligationStoppingRule(syntheticRecord({ status: "dispatched" }));
  assert(dispatched.shouldStop === false, "dispatched should keep running");

  // 预算硬限（§8）：在途超支 → 停止（failure）；终态优先于预算。
  const overBudget = evaluateObligationStoppingRule(
    syntheticRecord({ status: "validating", budget: { maxTokens: 100 } }),
    { totalTokens: 150, stepCount: 3 },
  );
  assert(overBudget.shouldStop === true && overBudget.outcome === "failure" && overBudget.budgetExceeded === true,
    "in-flight budget overflow should stop the loop with failure");

  const fulfilledOverBudget = evaluateObligationStoppingRule(
    syntheticRecord({ status: "fulfilled", budget: { maxTokens: 100 }, items: [{ verdict: "pass" }] }),
    { totalTokens: 150 },
  );
  assert(fulfilledOverBudget.shouldStop === true && fulfilledOverBudget.outcome === "success"
    && fulfilledOverBudget.budgetExceeded === true, "terminal verdict takes precedence over budget");

  const underBudget = evaluateObligationStoppingRule(
    syntheticRecord({ status: "validating", budget: { maxCostUsd: 1 } }),
    { totalCostUsd: 0.5 },
  );
  assert(underBudget.shouldStop === false, "usage within budget should not stop");

  // usageResolver 接线后：getObligationStatus 暴露 usage + stoppingRule。
  const subject = { proposal: { action: "refund" } };
  const { service } = fixture({ subject, usage: { totalTokens: 500, totalCostUsd: 0.2, stepCount: 2 } });
  const identity = alice();
  const record = await reachValidating(service, identity, baseInput({ budget: { maxTokens: 100 } }));
  const status = await service.getObligationStatus(identity, record.obligation.id);
  assert(status?.usage?.totalTokens === 500, "usage should be surfaced from the resolver");
  assert(status.stoppingRule.budgetExceeded === true && status.stoppingRule.shouldStop === true,
    "over-budget in-flight contract should signal stop via getObligationStatus");
  const missing = await service.getObligationStatus(identity, "obl_missing");
  assert(missing === undefined, "unknown obligation should return undefined");
}

// ---------------------------------------------------------------------------
// 7. awaitObligationVerdict：单轮询 / 已终态立即返回 / 等待到终态 / 未知拒绝。
// ---------------------------------------------------------------------------
async function testAwaitObligationVerdict(): Promise<void> {
  const subject = { proposal: { action: "refund" } };
  const { service } = fixture({ subject });
  const identity = alice();

  // 单轮询：validating → timedOut。
  const pendingRecord = await reachValidating(service, identity, baseInput({
    items: [{ acceptance: "人工确认", validator: "human_confirm" }],
  }));
  const singlePoll = await service.awaitObligationVerdict(identity, pendingRecord.obligation.id, { timeoutMs: 0 });
  assert(singlePoll.timedOut === true && singlePoll.stoppingRule.shouldStop === false && singlePoll.polls === 1,
    "single poll on an in-flight contract should report timedOut");

  // 等待到终态：后台推进人工确认 → fulfilled。
  const driver = (async () => {
    await sleep(60);
    await service.submitHumanVerdict(identity, pendingRecord.obligation.id, {
      itemId: pendingRecord.items[0]!.id,
      verdict: "pass",
    }, { operator: "alice" });
  })();
  const awaited = await service.awaitObligationVerdict(identity, pendingRecord.obligation.id, {
    timeoutMs: 5000,
    pollIntervalMs: 20,
  });
  await driver;
  assert(awaited.timedOut === false, `await should resolve before timeout, got polls=${awaited.polls}`);
  assert(awaited.stoppingRule.shouldStop === true && awaited.stoppingRule.outcome === "success",
    "await should surface the success stop");
  assert(awaited.record.obligation.status === "fulfilled", "await should return the terminal record");

  // 已终态：立即返回（polls=1）。
  const instant = await service.awaitObligationVerdict(identity, pendingRecord.obligation.id, { timeoutMs: 1000 });
  assert(instant.polls === 1 && instant.timedOut === false, "terminal contract should resolve on the first poll");

  await expectReject(
    () => service.awaitObligationVerdict(identity, "obl_missing", { timeoutMs: 0 }),
    "not found",
  );
}

// ---------------------------------------------------------------------------
// 8. 新路径身份隔离：explain / getObligationStatus / 沉淀物跨用户不可见。
// ---------------------------------------------------------------------------
async function testExplainIsolation(): Promise<void> {
  const subject = { proposal: { action: "refund" } };
  const { service, ontologyStore } = fixture({ subject });
  const identity = alice();
  const record = await reachValidating(service, identity, baseInput());
  const id = record.obligation.id;
  await service.validateObligation(identity, id);

  for (const intruder of [bob(), { tenantId: "t-other", userId: "alice" }]) {
    assert(await service.explainObligation(intruder, id) === undefined, "cross-identity explain must be invisible");
    assert(await service.getObligationStatus(intruder, id) === undefined, "cross-identity status must be invisible");
    await expectReject(
      () => service.awaitObligationVerdict(intruder, id, { timeoutMs: 0 }),
      "not found",
    );
    // 沉淀物同样按 identity 隔离（episode/evidence 写在 alice 命名空间）。
    assert(await ontologyStore.getEpisode(intruder, obligationSedimentEpisodeId(id)) === undefined,
      "cross-identity sediment episode must be invisible");
    assert(await ontologyStore.getEvidence(intruder, obligationSedimentEvidenceId(id)) === undefined,
      "cross-identity sediment evidence must be invisible");
  }
}

// ---------------------------------------------------------------------------
// 9. 审计与边界卫生（§5.2/§9/§7）：obligation 审计绝不内联证据原文；沉淀
//    报告只由元数据生成（不含挂接证据的 excerpt）；裁定不进 assertions。
// ---------------------------------------------------------------------------
async function testSedimentationBoundaryHygiene(): Promise<void> {
  const secretExcerpt = "SECRET-EVIDENCE-原文-4d2a 不应出边界";
  const subject = { proposal: { action: "refund" } };
  const { service, ontologyStore } = fixture({ subject });
  const identity = alice();

  const seeded = await ontologyStore.insertEvidence(identity, { source: "p32-test", excerpt: secretExcerpt });
  const created = await service.createObligation(identity, baseInput());
  const id = created.obligation.id;
  await service.attachEvidence(identity, id, {
    itemId: created.items[0]!.id,
    ref: { kind: "ontology_evidence", tenantId: TENANT, userId: "alice", evidenceId: seeded.id },
  });
  await service.validateObligation(identity, id);

  // obligation 审计（含 verdict/transition/attach 全量）不得含证据原文。
  const obligationAudits = await service.listAudit(identity, {});
  assert(!JSON.stringify(obligationAudits).includes(secretExcerpt),
    "obligation audit detail must never embed evidence excerpts");

  // 沉淀报告只含契约/裁定元数据：不含挂接证据的 excerpt。
  const sediment = await ontologyStore.getEvidence(identity, obligationSedimentEvidenceId(id));
  assert(sediment !== undefined, "sediment evidence should exist");
  assert(!sediment.excerpt.includes(secretExcerpt),
    "verdict report must be built from metadata only — never copy linked evidence excerpts");
  assert(sediment.excerpt.includes("退款单 R-3"), "report should carry the statement (contract metadata)");

  // 裁定不进 ontology_assertions（§7 铁律二）。
  const assertionCount = await ontologyStore.countAssertions(identity, {});
  assert(assertionCount === 0, `obligation verdicts must never land in ontology_assertions, got ${assertionCount}`);
}

export const obligationSedimentExplainTestCases: TestCase[] = [
  ["obligation-sediment: terminal states sediment episode+evidence; blocked_recoverable excluded", testSedimentationOnTerminalStates],
  ["obligation-sediment: duplicate terminal notifications never duplicate artifacts", testSedimentationIdempotent],
  ["obligation-sediment: sedimenter failure never breaks the verdict path", testSedimentationBestEffort],
  ["obligation-explain: full provenance chain (timeline/items/evidence/retry/final verdict/sediment)", testExplainChainCompleteness],
  ["obligation-explain: evidence resolution states resolved/dangling/external", testExplainEvidenceResolutionStates],
  ["obligation-loop: stopping rule matrix incl. budget hard limit and get status", testStoppingRuleMatrix],
  ["obligation-loop: awaitObligationVerdict polls until terminal or timeout", testAwaitObligationVerdict],
  ["obligation-explain: new paths are identity-isolated incl. sediment artifacts", testExplainIsolation],
  ["obligation-sediment: audits hold no excerpts; verdicts never enter assertions", testSedimentationBoundaryHygiene],
];
