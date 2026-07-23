import type { MemoryIdentity } from "@loong/core";
import {
  createGatewayStepObligationRecorder,
  createInMemoryStepIdempotencyStore,
  executeGatewayStep,
  type GatewayStepExecuteDeps,
} from "@loong/gateway";
import {
  createObligationService,
  createSqliteObligationStore,
  createSqliteOntologyStore,
  obligationEmployeeUserId,
  type ObligationCreateInput,
  type ObligationService,
  type ObligationStore,
  type OntologyStore,
} from "@loong/memory";
import { assert, createEventRuntime } from "../lib/test-helpers.js";
import type { TestCase } from "../runner.js";

/**
 * Phase 3.0 acceptance tests（先记录不裁定）+ 3.1 状态机守卫回归:
 * docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md §11 Phase 3.0 checklist —
 * recording lifecycle, evidence ref integrity (§5.2/§9), 三类断裂点 dangling
 * detection, identity isolation, overdue query correctness, audit entries,
 * and the §3.2 state-machine transition guards (3.1: verdict transitions
 * allowed from validating; illegal edges still rejected).
 */

const TENANT = "t-p3";
const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";
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

function fixture(options: { withOntology?: boolean } = {}): Fixture {
  const store = createSqliteObligationStore({ databasePath: ":memory:" });
  const ontologyStore = createSqliteOntologyStore({ databasePath: ":memory:" });
  const service = createObligationService({
    store,
    ...(options.withOntology === false ? {} : { ontologyStore }),
  });
  return { store, ontologyStore, service };
}

function baseCreateInput(overrides: Partial<ObligationCreateInput> = {}): ObligationCreateInput {
  return {
    employeeId: "emp-1",
    requesterUserId: "alice",
    statement: "退款单 R-1 完成退款闭环",
    items: [
      { acceptance: "退款提案通过 schema 校验", validator: "schema" },
    ],
    ...overrides,
  };
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

// ---------------------------------------------------------------------------
// 1. 全记录生命周期：create(pending) → attach → dispatched → evidence_collecting
//    →（required 覆盖齐套）validating（3.0 记录终态），全程审计留痕。
// ---------------------------------------------------------------------------
async function testRecordingLifecycle(): Promise<void> {
  const { service } = fixture();
  const identity = alice();
  const created = await service.createObligation(identity, baseCreateInput(), {
    operator: "p3-test",
    source: "obligation.tests",
  });
  const id = created.obligation.id;
  assert(created.obligation.status === "pending", `expected pending, got ${created.obligation.status}`);
  assert(created.obligation.employeeId === "emp-1", "employeeId should persist");
  assert(created.obligation.requesterUserId === "alice", "requesterUserId should persist");
  assert(created.obligation.source === "rpc", `source should default to rpc, got ${created.obligation.source}`);
  assert(created.obligation.retryBudget === 2, `retryBudget should default to 2, got ${created.obligation.retryBudget}`);
  assert(created.items.length === 1 && created.items[0]!.seq === 1 && created.items[0]!.required, "item should be auto-sequenced and required");
  assert(created.items[0]!.verdict === undefined, "3.0 items must never carry a verdict");

  const itemId = created.items[0]!.id;
  const attached = await service.attachEvidence(identity, id, {
    itemId,
    ref: { kind: "wf_event", instanceId: "wf-inst-1", seq: 3 },
  }, { operator: "p3-test", source: "obligation.tests" });
  assert(attached.inserted === true, "first attach should insert the link");
  assert(attached.record.obligation.status === "validating",
    `required coverage complete should advance to validating, got ${attached.record.obligation.status}`);
  assert(attached.record.evidenceLinks.length === 1, "one evidence link expected");
  assert(attached.record.evidenceLinks[0]!.itemId === itemId, "link should be item-scoped");

  const audits = await service.listAudit(identity, { recordId: id });
  const actions = audits.map(entry => entry.action);
  assert(actions[0] === "create", `first audit should be create, got ${actions.join(",")}`);
  assert(actions.includes("attach_evidence"), "attach_evidence audit expected");
  const transitions = audits.filter(entry => entry.action === "transition").map(entry => `${entry.detail?.from}->${entry.detail?.to}`);
  assert(
    transitions.join("|") === "pending->dispatched|dispatched->evidence_collecting|evidence_collecting->validating",
    `unexpected transition audit chain: ${transitions.join("|")}`,
  );
  assert(audits.every(entry => entry.operator === "p3-test" && entry.source === "obligation.tests"),
    "audit operator/source should come from write meta");
}

// ---------------------------------------------------------------------------
// 2. 带执行载体创建 → 直接 dispatched；幂等键可查回同一契约。
// ---------------------------------------------------------------------------
async function testCreateWithCarrierDispatches(): Promise<void> {
  const { service, store } = fixture();
  const identity = alice();
  const created = await service.createObligation(identity, baseCreateInput({
    carrier: { instanceId: "wf-inst-9", idempotencyKey: "key-dispatch-1" },
  }));
  assert(created.obligation.status === "dispatched", `carrier create should be dispatched, got ${created.obligation.status}`);
  assert(created.obligation.idempotencyKey === "key-dispatch-1", "idempotencyKey should persist");
  assert(created.obligation.instanceId === "wf-inst-9", "instanceId should persist");

  const found = await store.findObligationByIdempotencyKey(identity, "key-dispatch-1");
  assert(found?.id === created.obligation.id, "idempotency key lookup should find the same obligation");

  const audits = await service.listAudit(identity, { recordId: created.obligation.id });
  const dispatchTransition = audits.find(entry => entry.action === "transition" && entry.detail?.to === "dispatched");
  assert(dispatchTransition?.detail?.via === "create_with_carrier", "dispatch transition should be audited with via=create_with_carrier");
}

// ---------------------------------------------------------------------------
// 3. 证据归集幂等：同一 ref 重复挂接去重（ref_hash 主键）。
// ---------------------------------------------------------------------------
async function testEvidenceAttachIdempotent(): Promise<void> {
  const { service } = fixture();
  const identity = alice();
  const created = await service.createObligation(identity, baseCreateInput());
  const ref = { kind: "step_result", idempotencyKey: "key-dup-1" } as const;
  const first = await service.attachEvidence(identity, created.obligation.id, { ref });
  const second = await service.attachEvidence(identity, created.obligation.id, { ref });
  assert(first.inserted === true, "first attach inserts");
  assert(second.inserted === false, "second attach of the same ref must dedup");
  assert(second.link.refHash === first.link.refHash, "dedup should return the same ref hash");
  const record = await service.getObligation(identity, created.obligation.id);
  assert(record?.evidenceLinks.length === 1, `expected exactly 1 link, got ${record?.evidenceLinks.length}`);
}

// ---------------------------------------------------------------------------
// 4. ontology_evidence 指针完整性：必须解析到同一 identity 下的真实记录；
//    不存在 / 跨用户 / 无 ontology store（fail-closed）一律拒绝。
// ---------------------------------------------------------------------------
async function testOntologyEvidenceRefIntegrity(): Promise<void> {
  const { service, ontologyStore } = fixture();
  const identity = alice();
  const seeded = await ontologyStore.insertEvidence(identity, {
    source: "p3-test",
    excerpt: "seed excerpt for obligation ref",
    sessionId: "sess-1",
    runId: "run-1",
  });
  const created = await service.createObligation(identity, baseCreateInput());
  const okRef = {
    kind: "ontology_evidence",
    tenantId: TENANT,
    userId: "alice",
    evidenceId: seeded.id,
  } as const;
  const attached = await service.attachEvidence(identity, created.obligation.id, { ref: okRef });
  assert(attached.inserted === true, "resolvable ontology evidence ref should attach");

  await expectReject(
    () => service.attachEvidence(identity, created.obligation.id, {
      ref: { kind: "ontology_evidence", tenantId: TENANT, userId: "alice", evidenceId: "ev_missing" },
    }),
    "does not resolve",
  );

  // 跨用户引用：即使 bob 的证据真实存在，也不能挂到 alice 的契约上。
  const bobEvidence = await ontologyStore.insertEvidence(bob(), { source: "p3-test", excerpt: "bob excerpt" });
  await expectReject(
    () => service.attachEvidence(identity, created.obligation.id, {
      ref: { kind: "ontology_evidence", tenantId: TENANT, userId: "bob", evidenceId: bobEvidence.id },
    }),
    "caller",
  );

  // fail-closed：服务未配置 ontology store 时 ontology 指针一律拒绝。
  const closed = fixture({ withOntology: false });
  const closedCreated = await closed.service.createObligation(identity, baseCreateInput());
  await expectReject(
    () => closed.service.attachEvidence(identity, closedCreated.obligation.id, { ref: okRef }),
    "ontology store",
  );
}

// ---------------------------------------------------------------------------
// 5. ontology_episode 指针完整性：同 identity 解析存在才可挂接。
// ---------------------------------------------------------------------------
async function testOntologyEpisodeRefIntegrity(): Promise<void> {
  const { service, ontologyStore } = fixture();
  const identity = alice();
  const episode = await ontologyStore.insertEpisode(identity, {
    sessionId: "sess-ep",
    runId: "run-ep",
    summary: "episode summary",
  });
  const created = await service.createObligation(identity, baseCreateInput());
  const attached = await service.attachEvidence(identity, created.obligation.id, {
    ref: { kind: "ontology_episode", tenantId: TENANT, userId: "alice", episodeId: episode.id },
  });
  assert(attached.inserted === true, "resolvable ontology episode ref should attach");
  await expectReject(
    () => service.attachEvidence(identity, created.obligation.id, {
      ref: { kind: "ontology_episode", tenantId: TENANT, userId: "alice", episodeId: "epi_missing" },
    }),
    "does not resolve",
  );
}

// ---------------------------------------------------------------------------
// 6. 外部逻辑外键（wf_event / step_result）：只做形态校验，不做存在性检查。
// ---------------------------------------------------------------------------
async function testExternalRefShapeValidation(): Promise<void> {
  const { service } = fixture();
  const identity = alice();
  const created = await service.createObligation(identity, baseCreateInput());
  const ok = await service.attachEvidence(identity, created.obligation.id, {
    ref: { kind: "wf_event", instanceId: "wf-inst-x", seq: 0 },
  });
  assert(ok.inserted === true, "well-formed external ref should attach without existence checks");
  await expectReject(
    () => service.attachEvidence(identity, created.obligation.id, {
      ref: { kind: "wf_event", instanceId: "wf-inst-x", seq: -1 },
    }),
    "seq",
  );
  await expectReject(
    () => service.attachEvidence(identity, created.obligation.id, {
      ref: { kind: "step_result", idempotencyKey: "  " },
    }),
    "cannot be empty",
  );
}

// ---------------------------------------------------------------------------
// 7. 覆盖门槛：只有全部 required 项都有项级证据才进 validating；
//    可选项与契约级证据不计入覆盖。
// ---------------------------------------------------------------------------
async function testRequiredCoverageGating(): Promise<void> {
  const { service } = fixture();
  const identity = alice();
  const created = await service.createObligation(identity, baseCreateInput({
    items: [
      { acceptance: "提案通过 schema 校验", validator: "schema" },
      { acceptance: "退款副作用幂等落库", validator: "tool_assertion" },
      { acceptance: "审计备注完整（建议项）", validator: "model_review", required: false },
    ],
  }));
  const id = created.obligation.id;
  const [item1, item2, item3] = created.items;
  assert(item1 && item2 && item3, "three items expected");

  // 契约级证据：不计入项覆盖。
  const contractLevel = await service.attachEvidence(identity, id, {
    ref: { kind: "step_result", idempotencyKey: "key-coverage" },
  });
  assert(contractLevel.record.obligation.status === "evidence_collecting",
    `contract-level evidence must not complete coverage, got ${contractLevel.record.obligation.status}`);

  const optionalOnly = await service.attachEvidence(identity, id, {
    itemId: item3.id,
    ref: { kind: "wf_event", instanceId: "wf-cov", seq: 1 },
  });
  assert(optionalOnly.record.obligation.status === "evidence_collecting",
    "optional item coverage must not advance to validating");

  const firstRequired = await service.attachEvidence(identity, id, {
    itemId: item1.id,
    ref: { kind: "wf_event", instanceId: "wf-cov", seq: 2 },
  });
  assert(firstRequired.record.obligation.status === "evidence_collecting",
    "partial required coverage should keep collecting");

  const full = await service.attachEvidence(identity, id, {
    itemId: item2.id,
    ref: { kind: "wf_event", instanceId: "wf-cov", seq: 3 },
  });
  assert(full.record.obligation.status === "validating",
    `full required coverage should advance to validating, got ${full.record.obligation.status}`);
  const lastTransition = full.record.evidenceLinks.length;
  assert(lastTransition === 4, `expected 4 links total, got ${lastTransition}`);
}

// ---------------------------------------------------------------------------
// 8. 挂接目标校验：未知 obligation / 未知 item 一律拒绝。
// ---------------------------------------------------------------------------
async function testAttachTargetValidation(): Promise<void> {
  const { service } = fixture();
  const identity = alice();
  const created = await service.createObligation(identity, baseCreateInput());
  await expectReject(
    () => service.attachEvidence(identity, "obl_missing", {
      ref: { kind: "step_result", idempotencyKey: "key-x" },
    }),
    "not found",
  );
  await expectReject(
    () => service.attachEvidence(identity, created.obligation.id, {
      itemId: "obi_missing",
      ref: { kind: "step_result", idempotencyKey: "key-y" },
    }),
    "item",
  );
}

// ---------------------------------------------------------------------------
// 9. 断裂点一（路由完成无人接手）untouched：dispatched 且零证据且超 cutoff。
// ---------------------------------------------------------------------------
async function testDanglingUntouched(): Promise<void> {
  const { service } = fixture();
  const identity = alice();
  const untouched = await service.createObligation(identity, baseCreateInput({
    statement: "已派发但无人接手",
    carrier: { idempotencyKey: "key-untouched" },
  }));
  const pending = await service.createObligation(identity, baseCreateInput({ statement: "未派发" }));
  const collecting = await service.createObligation(identity, baseCreateInput({
    statement: "已有证据回流",
    carrier: { idempotencyKey: "key-collecting" },
  }));
  await service.attachEvidence(identity, collecting.obligation.id, {
    ref: { kind: "step_result", idempotencyKey: "key-collecting" },
  });

  const rows = await service.listDangling(identity, { kind: "untouched", now: FAR_NOW, olderThan: FUTURE });
  const ids = rows.map(row => row.obligation.id);
  assert(ids.length === 1 && ids[0] === untouched.obligation.id, `only the untouched obligation should dangle, got ${ids}`);
  assert(rows[0]!.evidenceCount === 0, "untouched record should report zero evidence");
  assert(!ids.includes(pending.obligation.id), "pending is not 'dispatched-but-untouched'");
  assert(!ids.includes(collecting.obligation.id), "evidence_collecting is not untouched");

  const none = await service.listDangling(identity, { kind: "untouched", now: FAR_NOW, olderThan: PAST });
  assert(none.length === 0, "fresh obligations must not dangle under a past cutoff");
}

// ---------------------------------------------------------------------------
// 10. 断裂点二（派发后长期无响应）silent：deadline 已过的在途契约。
// ---------------------------------------------------------------------------
async function testDanglingSilent(): Promise<void> {
  const { service } = fixture();
  const identity = alice();
  const overdueDispatched = await service.createObligation(identity, baseCreateInput({
    statement: "派发后沉默",
    deadlineAt: PAST,
    carrier: { idempotencyKey: "key-silent-1" },
  }));
  const overdueCollecting = await service.createObligation(identity, baseCreateInput({
    statement: "收集中但已超时",
    deadlineAt: PAST,
    carrier: { idempotencyKey: "key-silent-2" },
  }));
  await service.attachEvidence(identity, overdueCollecting.obligation.id, {
    ref: { kind: "step_result", idempotencyKey: "key-silent-2" },
  });
  const futureDeadline = await service.createObligation(identity, baseCreateInput({
    statement: "deadline 未到",
    deadlineAt: FUTURE,
    carrier: { idempotencyKey: "key-silent-3" },
  }));
  const pendingOverdue = await service.createObligation(identity, baseCreateInput({
    statement: "未派发但已超时",
    deadlineAt: PAST,
  }));

  const rows = await service.listDangling(identity, { kind: "silent", now: FAR_NOW });
  const ids = rows.map(row => row.obligation.id);
  assert(ids.includes(overdueDispatched.obligation.id), "overdue dispatched should be silent");
  assert(ids.includes(overdueCollecting.obligation.id), "overdue evidence_collecting should be silent");
  assert(!ids.includes(futureDeadline.obligation.id), "future deadline must not be silent");
  assert(!ids.includes(pendingOverdue.obligation.id), "pending is not 'dispatched-but-silent'");
}

// ---------------------------------------------------------------------------
// 11. 断裂点三（结果返回但没有验收）unvalidated：有证据但仍停在收集中。
// ---------------------------------------------------------------------------
async function testDanglingUnvalidated(): Promise<void> {
  const { service } = fixture();
  const identity = alice();
  const unvalidated = await service.createObligation(identity, baseCreateInput({
    statement: "有产出未验收",
    items: [
      { acceptance: "提案通过 schema 校验", validator: "schema" },
      { acceptance: "副作用落库", validator: "tool_assertion" },
    ],
    carrier: { idempotencyKey: "key-unvalidated" },
  }));
  await service.attachEvidence(identity, unvalidated.obligation.id, {
    ref: { kind: "step_result", idempotencyKey: "key-unvalidated" },
  });
  // 覆盖未齐（只有契约级证据）→ 停在 evidence_collecting。
  const validated = await service.createObligation(identity, baseCreateInput({
    statement: "已进入待裁定",
    carrier: { idempotencyKey: "key-validating" },
  }));
  const validatingItem = validated.items[0]!;
  await service.attachEvidence(identity, validated.obligation.id, {
    itemId: validatingItem.id,
    ref: { kind: "wf_event", instanceId: "wf-val", seq: 1 },
  });

  const rows = await service.listDangling(identity, { kind: "unvalidated", now: FAR_NOW, olderThan: FUTURE });
  const ids = rows.map(row => row.obligation.id);
  assert(ids.length === 1 && ids[0] === unvalidated.obligation.id, `only the unvalidated obligation should dangle, got ${ids}`);
  assert(rows[0]!.evidenceCount === 1, "unvalidated record should report its evidence count");
  assert(!ids.includes(validated.obligation.id), "validating (3.0 记录终态) is not 'returned-but-unvalidated'");
}

// ---------------------------------------------------------------------------
// 12. 身份隔离：跨用户/跨租户对契约与审计完全不可见。
// ---------------------------------------------------------------------------
async function testIdentityIsolation(): Promise<void> {
  const { service, store } = fixture();
  const identity = alice();
  const created = await service.createObligation(identity, baseCreateInput({
    carrier: { idempotencyKey: "key-isolation" },
  }));
  await service.attachEvidence(identity, created.obligation.id, {
    ref: { kind: "step_result", idempotencyKey: "key-isolation" },
  });

  for (const intruder of [bob(), { tenantId: "t-other", userId: "alice" }]) {
    const fetched = await service.getObligation(intruder, created.obligation.id);
    assert(fetched === undefined, "cross-identity get must be invisible");
    const listed = await service.listObligations(intruder, {});
    assert(listed.length === 0, "cross-identity list must be empty");
    const found = await store.findObligationByIdempotencyKey(intruder, "key-isolation");
    assert(found === undefined, "cross-identity idempotency lookup must be invisible");
    await expectReject(
      () => service.attachEvidence(intruder, created.obligation.id, {
        ref: { kind: "step_result", idempotencyKey: "key-isolation" },
      }),
      "not found",
    );
    const dangling = await service.listDangling(intruder, { kind: "silent", now: FAR_NOW });
    assert(dangling.length === 0, "cross-identity dangling list must be empty");
    const audits = await service.listAudit(intruder, { recordId: created.obligation.id });
    assert(audits.length === 0, "cross-identity audit must be invisible");
  }
}

// ---------------------------------------------------------------------------
// 13. 审计 detail 只存指针与元数据：绝不复制证据原文（§9/§5.2）。
// ---------------------------------------------------------------------------
async function testAuditContainsNoExcerpt(): Promise<void> {
  const { service, ontologyStore } = fixture();
  const identity = alice();
  const secretExcerpt = "用户手机号 13800001111 不应进审计";
  const seeded = await ontologyStore.insertEvidence(identity, { source: "p3-test", excerpt: secretExcerpt });
  const created = await service.createObligation(identity, baseCreateInput());
  await service.attachEvidence(identity, created.obligation.id, {
    ref: { kind: "ontology_evidence", tenantId: TENANT, userId: "alice", evidenceId: seeded.id },
  }, { operator: "p3-test", source: "obligation.tests" });

  const audits = await service.listAudit(identity, { recordId: created.obligation.id });
  assert(audits.length >= 2, "create + attach audits expected");
  const serialized = JSON.stringify(audits);
  assert(!serialized.includes(secretExcerpt), "audit detail must never contain evidence excerpts");
  assert(!serialized.includes("13800001111"), "audit detail must never contain sensitive content");
  const attachAudit = audits.find(entry => entry.action === "attach_evidence");
  assert(typeof attachAudit?.detail?.refHash === "string", "attach audit should record the ref hash pointer");
  assert(attachAudit?.detail?.kind === "ontology_evidence", "attach audit should record the ref kind");
}

// ---------------------------------------------------------------------------
// 14. 状态机守卫（3.1 起）：非法迁移仍被拒（pending→终态 / dispatched→pending /
//     终态无出边）；validating → fulfilled/blocked_*/expired 裁定迁移已放行，
//     fulfilled 落 fulfilled_at；同状态幂等 no-op 不写审计。
// ---------------------------------------------------------------------------
async function testTransitionGuardsPhase31(): Promise<void> {
  const { service, store } = fixture();
  const identity = alice();
  const created = await service.createObligation(identity, baseCreateInput());
  const id = created.obligation.id;

  // pending → 终态：3.1 状态机下依旧非法。
  for (const target of ["fulfilled", "blocked_recoverable", "blocked_hard", "expired"] as const) {
    await expectReject(
      () => store.transitionStatus(identity, id, target),
      "is not a permitted obligation status transition",
    );
  }
  // 逆迁移同样拒绝（dispatched → pending）。
  await store.transitionStatus(identity, id, "dispatched");
  await expectReject(
    () => store.transitionStatus(identity, id, "pending"),
    "is not a permitted obligation status transition",
  );

  // 同状态幂等 no-op：不写新审计。
  const before = await service.listAudit(identity, { recordId: id });
  const noop = await store.transitionStatus(identity, id, "dispatched");
  assert(noop.status === "dispatched", "same-status transition should be an idempotent no-op");
  const after = await service.listAudit(identity, { recordId: id });
  assert(after.length === before.length, "same-status no-op must not append audit rows");

  // 3.1：validating → fulfilled / blocked_* / expired 由状态机放行（裁定语义
  // 由 service 聚合保证；store 只做迁移守卫），fulfilled 迁移落 fulfilled_at。
  await store.transitionStatus(identity, id, "evidence_collecting");
  await store.transitionStatus(identity, id, "validating");
  const fulfilled = await store.transitionStatus(identity, id, "fulfilled");
  assert(fulfilled.status === "fulfilled", "3.1 allows validating → fulfilled");
  assert(typeof fulfilled.fulfilledAt === "string" && fulfilled.fulfilledAt.length > 0, "fulfilled_at should be stamped");

  // 终态无出边。
  await expectReject(
    () => store.transitionStatus(identity, id, "dispatched"),
    "is not a permitted obligation status transition",
  );
}

// ---------------------------------------------------------------------------
// 15. step.execute 回执自动归集：executeGatewayStep 的 obligationRecorder 钩子
//     按幂等键找到契约、回填 runId、挂 step_result 证据；重放不重复挂接；
//     记录器失败绝不让 step 失败。
// ---------------------------------------------------------------------------
async function testStepExecutionRecordingHook(): Promise<void> {
  const { service } = fixture();
  const employeeIdentity: MemoryIdentity = { tenantId: TENANT, userId: obligationEmployeeUserId("emp-1") };
  const created = await service.createObligation(employeeIdentity, baseCreateInput({
    source: "orchestration",
    carrier: { idempotencyKey: "step-key-1", instanceId: "wf-step-1" },
  }));
  assert(created.obligation.status === "dispatched", "carrier create should be dispatched");

  const recorder = createGatewayStepObligationRecorder(service);
  const agentTurnDeps: GatewayStepExecuteDeps["agentTurnDeps"] = {
    runtime: createEventRuntime(),
    runInLane: (_sessionId, task) => task(),
    runs: {
      registerRunStart() {},
      completeRun() {},
      failRun() {},
      deleteRunSession() {},
    },
  };
  const deps: GatewayStepExecuteDeps = {
    idempotencyStore: createInMemoryStepIdempotencyStore(),
    agentTurnDeps,
    resolveAgentParams: async params => params,
    obligationRecorder: recorder,
  };
  const result = await executeGatewayStep(deps, {
    idempotencyKey: "step-key-1",
    tenantId: TENANT,
    employeeId: "emp-1",
    mode: "propose",
    message: "给出退款提案",
  });
  assert(result.status === "ok", `step should execute ok, got ${result.status}`);

  const record = await service.getObligation(employeeIdentity, created.obligation.id);
  assert(record?.obligation.runId === result.runId, `runId should be backfilled, got ${record?.obligation.runId}`);
  assert(record?.obligation.status === "evidence_collecting",
    `step receipt should advance to evidence_collecting, got ${record?.obligation.status}`);
  const stepLinks = record?.evidenceLinks.filter(link => link.kind === "step_result") ?? [];
  assert(stepLinks.length === 1, `exactly one step_result link expected, got ${stepLinks.length}`);

  // 幂等重放：结果来自缓存，记录钩子不再触发。
  const replayed = await executeGatewayStep(deps, {
    idempotencyKey: "step-key-1",
    tenantId: TENANT,
    employeeId: "emp-1",
    mode: "propose",
    message: "给出退款提案",
  });
  assert(replayed.replayed === true, "second execution should replay from the idempotency store");
  const afterReplay = await service.getObligation(employeeIdentity, created.obligation.id);
  assert(afterReplay?.evidenceLinks.length === 1, "replay must not duplicate evidence links");

  // 记录器失败：step 照常返回（best-effort 记录）。
  const failingDeps: GatewayStepExecuteDeps = {
    ...deps,
    idempotencyStore: createInMemoryStepIdempotencyStore(),
    obligationRecorder: {
      async attachStepResult() {
        throw new Error("recording backend down");
      },
    },
  };
  const resilient = await executeGatewayStep(failingDeps, {
    idempotencyKey: "step-key-2",
    tenantId: TENANT,
    employeeId: "emp-1",
    mode: "propose",
    message: "给出退款提案",
  });
  assert(resilient.status === "ok", "recorder failure must never fail the step");
}

// ---------------------------------------------------------------------------
// 16. service.attachStepResult：显式回执归集；未知幂等键 → attached:false。
// ---------------------------------------------------------------------------
async function testAttachStepResultExplicit(): Promise<void> {
  const { service } = fixture();
  const identity = alice();
  const created = await service.createObligation(identity, baseCreateInput({
    carrier: { idempotencyKey: "key-explicit" },
  }));
  const missing = await service.attachStepResult(identity, "key-nobody", { runId: "run-x" });
  assert(missing.attached === false, "unknown idempotency key should report attached:false");

  const attached = await service.attachStepResult(identity, "key-explicit", { runId: "run-explicit" });
  assert(attached.attached === true, "known idempotency key should attach");
  assert(attached.obligationId === created.obligation.id, "attach should target the carrier obligation");
  assert(attached.record?.obligation.runId === "run-explicit", "runId should be backfilled");
  assert(attached.record?.obligation.status === "evidence_collecting", "status should advance to evidence_collecting");
  const audits = await service.listAudit(identity, { recordId: created.obligation.id });
  assert(audits.some(entry => entry.operator === "step-execution" && entry.source === "step.execute"),
    "step receipt audits should carry the step-execution operator");
}

export const obligationTestCases: TestCase[] = [
  ["obligation: recording lifecycle pending→dispatched→evidence_collecting→validating with audit", testRecordingLifecycle],
  ["obligation: create with carrier dispatches and idempotency key resolves", testCreateWithCarrierDispatches],
  ["obligation: evidence attach is idempotent by ref hash", testEvidenceAttachIdempotent],
  ["obligation: ontology evidence refs must resolve under the caller identity", testOntologyEvidenceRefIntegrity],
  ["obligation: ontology episode refs must resolve under the caller identity", testOntologyEpisodeRefIntegrity],
  ["obligation: external refs (wf_event/step_result) are shape-validated only", testExternalRefShapeValidation],
  ["obligation: validating requires full required-item coverage", testRequiredCoverageGating],
  ["obligation: attach rejects unknown obligations and items", testAttachTargetValidation],
  ["obligation: dangling untouched detection (dispatched-but-untouched)", testDanglingUntouched],
  ["obligation: dangling silent detection (dispatched-but-silent)", testDanglingSilent],
  ["obligation: dangling unvalidated detection (returned-but-unvalidated)", testDanglingUnvalidated],
  ["obligation: cross-tenant and cross-user isolation", testIdentityIsolation],
  ["obligation: audit detail holds pointers only, never excerpts", testAuditContainsNoExcerpt],
  ["obligation: transition guards follow the 3.1 state machine", testTransitionGuardsPhase31],
  ["obligation: step.execute hook records receipts (replay-safe, failure-resilient)", testStepExecutionRecordingHook],
  ["obligation: attachStepResult resolves by idempotency key", testAttachStepResultExplicit],
];
