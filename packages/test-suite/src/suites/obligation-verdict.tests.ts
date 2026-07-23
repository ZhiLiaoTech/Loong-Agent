import type { MemoryIdentity } from "@loong/core";
import {
  createObligationService,
  createSqliteObligationStore,
  createSqliteOntologyStore,
  obligationVerdictStateOf,
  summarizeObligationRecord,
  type ObligationCommandRunner,
  type ObligationCreateInput,
  type ObligationModelReviewer,
  type ObligationService,
  type ObligationStore,
} from "@loong/memory";
import { assert } from "../lib/test-helpers.js";
import type { TestCase } from "../runner.js";

/**
 * Phase 3.1 acceptance tests（三态裁定生效）:
 * docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md §6/§10/§11 Phase 3.1 checklist —
 * validator engine (schema-lite / tool_assertion / test_command / model_review /
 * human_confirm), three-way verdict aggregation with retry_budget, deadline
 * sweep backstop, terminal-state rejection, identity isolation on verdict
 * paths, and the「ok 即终态」下线 surfacing (verdictState / verdictSummary).
 */

const TENANT = "t-p31";
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
  service: ObligationService;
}

function fixture(options: {
  subject?: unknown;
  commandRunner?: ObligationCommandRunner;
  modelReviewer?: ObligationModelReviewer;
} = {}): Fixture {
  const store = createSqliteObligationStore({ databasePath: ":memory:" });
  const ontologyStore = createSqliteOntologyStore({ databasePath: ":memory:" });
  const service = createObligationService({
    store,
    ontologyStore,
    ...("subject" in options ? { subjectResolver: () => options.subject } : {}),
    ...(options.commandRunner !== undefined ? { commandRunner: options.commandRunner } : {}),
    ...(options.modelReviewer !== undefined ? { modelReviewer: options.modelReviewer } : {}),
  });
  return { store, service };
}

function verdictInput(overrides: Partial<ObligationCreateInput> = {}): ObligationCreateInput {
  return {
    employeeId: "emp-1",
    requesterUserId: "alice",
    statement: "退款单 R-2 完成退款闭环",
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

/** 建契约并挂齐全部验收项的项级证据 → validating。 */
async function reachValidating(
  service: ObligationService,
  identity: MemoryIdentity,
  input: ObligationCreateInput,
) {
  const created = await service.createObligation(identity, input);
  for (const item of created.items) {
    await service.attachEvidence(identity, created.obligation.id, {
      itemId: item.id,
      ref: { kind: "wf_event", instanceId: "wf-v", seq: item.seq },
    });
  }
  const record = await service.getObligation(identity, created.obligation.id);
  assert(record !== undefined, "obligation should exist");
  assert(
    record.obligation.status === "validating",
    `expected validating after full coverage, got ${record.obligation.status}`,
  );
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

// ---------------------------------------------------------------------------
// 1. schema 验证器：结构通过 → pass → fulfilled（含 subjectPath 项）；
//    结构不符 → hard_block → blocked_hard。
// ---------------------------------------------------------------------------
async function testSchemaValidatorPassAndFail(): Promise<void> {
  const subject = { proposal: { action: "refund", amount: 12 } };
  const { service } = fixture({ subject });
  const identity = alice();

  const passing = await reachValidating(service, identity, verdictInput({
    items: [
      {
        acceptance: "提案为 object 且 action 为 refund",
        validator: "schema",
        validatorConfig: {
          schema: {
            type: "object",
            required: ["proposal"],
            properties: { proposal: { type: "object", properties: { action: { const: "refund" } } } },
          },
        },
      },
      {
        acceptance: "subjectPath 定位后 amount 为 number",
        validator: "schema",
        validatorConfig: { subjectPath: "proposal", schema: { type: "object", properties: { amount: { type: "number" } } } },
      },
    ],
  }));
  const report = await service.validateObligation(identity, passing.obligation.id, {
    operator: "p31-test",
    source: "obligation-verdict.tests",
  });
  assert(report.outcome === "fulfilled", `expected fulfilled, got ${report.outcome} (${report.reason})`);
  assert(report.record.obligation.status === "fulfilled", "status should be fulfilled");
  assert(typeof report.record.obligation.fulfilledAt === "string", "fulfilledAt should be stamped");
  assert(report.itemResults.length === 2 && report.itemResults.every(entry => entry.executed && entry.verdict === "pass"),
    "both schema items should execute and pass");

  const failing = await reachValidating(service, identity, verdictInput({
    statement: "schema 不符的契约",
    items: [
      {
        acceptance: "action 必须是 chargeback",
        validator: "schema",
        validatorConfig: { schema: { type: "object", properties: { proposal: { properties: { action: { const: "chargeback" } } } } } },
      },
    ],
  }));
  const failed = await service.validateObligation(identity, failing.obligation.id);
  assert(failed.outcome === "blocked_hard", `schema mismatch should hard-block, got ${failed.outcome}`);
  assert(failed.record.obligation.status === "blocked_hard", "status should be blocked_hard");
  assert(failed.record.items[0]?.verdict === "hard_block", "item verdict should be hard_block");
  assert(failed.record.items[0]?.verdictReason?.includes("schema validation failed") === true,
    `verdict reason should cite schema failure, got ${failed.record.items[0]?.verdictReason}`);
}

// ---------------------------------------------------------------------------
// 2. tool_assertion 验证器：确定性表达式过/败；subject 缺失 → recoverable_block。
// ---------------------------------------------------------------------------
async function testToolAssertionValidator(): Promise<void> {
  const subject = { toolResult: { status: "done", count: 3, note: "refund completed" } };
  const { service } = fixture({ subject });
  const identity = alice();

  const passing = await reachValidating(service, identity, verdictInput({
    items: [
      {
        acceptance: "status=done 且 count>=1 且 note 以 refund 开头",
        validator: "tool_assertion",
        validatorConfig: {
          assertions: [
            { path: "toolResult.status", op: "equals", value: "done" },
            { path: "toolResult.count", op: "gte", value: 1 },
            { path: "toolResult.note", op: "matches", value: "^refund" },
          ],
        },
      },
    ],
  }));
  const passReport = await service.validateObligation(identity, passing.obligation.id);
  assert(passReport.outcome === "fulfilled", `assertions should pass, got ${passReport.outcome} (${passReport.reason})`);

  const failing = await reachValidating(service, identity, verdictInput({
    statement: "断言不符的契约",
    items: [
      {
        acceptance: "status 必须在 [queued, running] 内",
        validator: "tool_assertion",
        validatorConfig: { assertions: [{ path: "toolResult.status", op: "in", value: ["queued", "running"] }] },
      },
    ],
  }));
  const failReport = await service.validateObligation(identity, failing.obligation.id);
  assert(failReport.outcome === "blocked_hard", `assertion failure should hard-block, got ${failReport.outcome}`);
  assert(failReport.record.items[0]?.verdictReason?.includes("tool assertion failed") === true,
    `verdict reason should cite assertion failure, got ${failReport.record.items[0]?.verdictReason}`);

  // subject 缺失（服务未接 subjectResolver）→ 证据不足 → recoverable_block。
  const noSubject = fixture();
  const missing = await reachValidating(noSubject.service, identity, verdictInput({
    statement: "subject 缺失的契约",
    items: [
      {
        acceptance: "需要 subject 才能断言",
        validator: "tool_assertion",
        validatorConfig: { assertions: [{ path: "toolResult.status", op: "exists" }] },
      },
    ],
  }));
  const missingReport = await noSubject.service.validateObligation(identity, missing.obligation.id);
  assert(missingReport.outcome === "blocked_recoverable",
    `missing subject should be recoverable (retry budget 2), got ${missingReport.outcome}`);
  assert(missingReport.record.items[0]?.verdict === "recoverable_block", "item verdict should be recoverable_block");
  assert(missingReport.record.items[0]?.verdictReason?.includes("subject unavailable") === true,
    "reason should cite the unavailable subject");
}

// ---------------------------------------------------------------------------
// 3. test_command：未配置 commandRunner → validate 抛错（fail-closed，
//    不落任何 verdict）；fake runner exit 0 → pass；非 0 → recoverable；
//    超时 → recoverable；recoverableOnNonZeroExit:false → hard_block；
//    timeoutMs 默认 5000、上限 60000。
// ---------------------------------------------------------------------------
async function testCommandRunnerFailClosed(): Promise<void> {
  const { service } = fixture(); // 无 commandRunner
  const identity = alice();
  const record = await reachValidating(service, identity, verdictInput({
    items: [{ acceptance: "单测通过", validator: "test_command", validatorConfig: { command: "pnpm test" } }],
  }));
  const id = record.obligation.id;
  await expectReject(
    () => service.validateObligation(identity, id),
    "commandRunner",
  );
  const after = await service.getObligation(identity, id);
  assert(after?.obligation.status === "validating", "fail-closed rejection must not move the contract");
  assert(after?.items[0]?.verdict === undefined, "fail-closed rejection must not write verdicts");
  const audits = await service.listAudit(identity, { recordId: id });
  assert(!audits.some(entry => entry.action === "record_verdict"), "no record_verdict audit may be written");
}

async function testTestCommandValidator(): Promise<void> {
  const identity = alice();
  const calls: { command: string; timeoutMs: number }[] = [];
  const runner: ObligationCommandRunner = async (command, options) => {
    calls.push({ command, timeoutMs: options.timeoutMs });
    if (command.includes("fail-soft")) {
      return { exitCode: 3 };
    }
    if (command.includes("hang")) {
      return { exitCode: -1, timedOut: true };
    }
    if (command.includes("fail-hard")) {
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  };
  const { service } = fixture({ commandRunner: runner });

  const passing = await reachValidating(service, identity, verdictInput({
    items: [{ acceptance: "构建通过", validator: "test_command", validatorConfig: { command: "pnpm build" } }],
  }));
  const passReport = await service.validateObligation(identity, passing.obligation.id);
  assert(passReport.outcome === "fulfilled", `exit 0 should fulfill, got ${passReport.outcome}`);
  assert(calls[0]?.timeoutMs === 5000, `default timeout should be 5000ms, got ${calls[0]?.timeoutMs}`);

  const softFail = await reachValidating(service, identity, verdictInput({
    statement: "测试红但可重试",
    items: [{ acceptance: "单测通过", validator: "test_command", validatorConfig: { command: "pnpm fail-soft" } }],
  }));
  const softReport = await service.validateObligation(identity, softFail.obligation.id);
  assert(softReport.outcome === "blocked_recoverable", `non-zero exit defaults to recoverable, got ${softReport.outcome}`);
  assert(softReport.record.items[0]?.verdictReason?.includes("exit") === true, "reason should cite the exit code");

  const hanging = await reachValidating(service, identity, verdictInput({
    statement: "命令超时",
    items: [{ acceptance: "命令完成", validator: "test_command", validatorConfig: { command: "pnpm hang", timeoutMs: 1000 } }],
  }));
  const hangReport = await service.validateObligation(identity, hanging.obligation.id);
  assert(hangReport.outcome === "blocked_recoverable", `timeout should be recoverable, got ${hangReport.outcome}`);
  assert(hangReport.record.items[0]?.verdictReason?.includes("timed out") === true, "reason should cite the timeout");

  const hardFail = await reachValidating(service, identity, verdictInput({
    statement: "明确失败不可重试",
    items: [{
      acceptance: "lint 通过",
      validator: "test_command",
      validatorConfig: { command: "pnpm fail-hard", recoverableOnNonZeroExit: false, timeoutMs: 999_999 },
    }],
  }));
  const hardReport = await service.validateObligation(identity, hardFail.obligation.id);
  assert(hardReport.outcome === "blocked_hard", `recoverableOnNonZeroExit:false should hard-block, got ${hardReport.outcome}`);
  const lastCall = calls[calls.length - 1];
  assert(lastCall?.timeoutMs === 60_000, `timeoutMs should clamp to 60000, got ${lastCall?.timeoutMs}`);
}

// ---------------------------------------------------------------------------
// 4. model_review 不可单独定论（§6.1/§10）：全模型通过 → blocked_hard；
//    搭配 schema（确定性）→ fulfilled；模型低分 → recoverable（只作佐证）。
// ---------------------------------------------------------------------------
async function testModelReviewCannotBeSoleVerdict(): Promise<void> {
  const identity = alice();
  const reviewer: ObligationModelReviewer = async input => ({
    score: typeof input.rubric === "string" && input.rubric.includes("低分") ? 0.2 : 0.9,
    rationale: "rubric-scored",
  });
  const subject = { proposal: { action: "refund" } };
  const { service } = fixture({ subject, modelReviewer: reviewer });

  const modelOnly = await reachValidating(service, identity, verdictInput({
    statement: "仅模型评审的契约",
    items: [{ acceptance: "模型认为完成", validator: "model_review", validatorConfig: { rubric: "完成度" } }],
  }));
  const soleReport = await service.validateObligation(identity, modelOnly.obligation.id);
  assert(soleReport.record.items[0]?.verdict === "pass", "model item itself may pass");
  assert(soleReport.outcome === "blocked_hard", `model-only pass must not fulfill, got ${soleReport.outcome}`);
  assert(soleReport.reason.includes("cannot be the sole verdict basis"),
    `reason should cite 模型评审不可单独定论, got: ${soleReport.reason}`);

  const paired = await reachValidating(service, identity, verdictInput({
    statement: "模型+确定性搭配的契约",
    items: [
      { acceptance: "模型认为完成", validator: "model_review", validatorConfig: { rubric: "完成度" } },
      {
        acceptance: "schema 确定性校验",
        validator: "schema",
        validatorConfig: { schema: { type: "object", properties: { proposal: { properties: { action: { const: "refund" } } } } } },
      },
    ],
  }));
  const pairedReport = await service.validateObligation(identity, paired.obligation.id);
  assert(pairedReport.outcome === "fulfilled", `model+schema should fulfill, got ${pairedReport.outcome} (${pairedReport.reason})`);
  const summary = summarizeObligationRecord(pairedReport.record);
  assert(summary.hasNonModelRequiredPass === true, "paired contract has a non-model required pass");

  const lowScore = await reachValidating(service, identity, verdictInput({
    statement: "模型低分的契约",
    items: [
      { acceptance: "模型认为完成", validator: "model_review", validatorConfig: { rubric: "低分场景" } },
      {
        acceptance: "schema 确定性校验",
        validator: "schema",
        validatorConfig: { schema: { type: "object", properties: { proposal: { properties: { action: { const: "refund" } } } } } },
      },
    ],
  }));
  const lowReport = await service.validateObligation(identity, lowScore.obligation.id);
  assert(lowReport.record.items[0]?.verdict === "recoverable_block",
    `model failure only counts as 佐证 (recoverable), got ${lowReport.record.items[0]?.verdict}`);
  assert(lowReport.outcome === "blocked_recoverable", `model low score should be recoverable, got ${lowReport.outcome}`);
}

// ---------------------------------------------------------------------------
// 5. retry_budget（§6.2）：budget 0 → 首次 recoverable 即 blocked_hard；
//    budget 1 → blocked_recoverable（进入不扣）→ retry → dispatched（扣到 0）
//    → 重新归集 → validating → 再次 recoverable → blocked_hard；
//    retry 审计留痕（retry_budget from/to + transition via）。
// ---------------------------------------------------------------------------
async function testRetryBudgetLifecycle(): Promise<void> {
  const identity = alice();

  // budget 0：首次 recoverable 直接升级 hard_block，不经 blocked_recoverable。
  const zeroBudget = fixture();
  const zeroRecord = await reachValidating(zeroBudget.service, identity, verdictInput({
    statement: "零预算契约",
    retryBudget: 0,
    items: [{
      acceptance: "需要 subject",
      validator: "tool_assertion",
      validatorConfig: { assertions: [{ path: "anything", op: "exists" }] },
    }],
  }));
  const zeroReport = await zeroBudget.service.validateObligation(identity, zeroRecord.obligation.id);
  assert(zeroReport.outcome === "blocked_hard", `budget 0 should escalate immediately, got ${zeroReport.outcome}`);
  assert(zeroReport.reason.includes("retry budget exhausted"), `reason should cite exhaustion, got: ${zeroReport.reason}`);

  // budget 1：blocked_recoverable（budget 保持 1）→ retry → dispatched（budget 0）。
  const oneBudget = fixture();
  const oneRecord = await reachValidating(oneBudget.service, identity, verdictInput({
    statement: "一次重试预算的契约",
    retryBudget: 1,
    items: [{
      acceptance: "需要 subject",
      validator: "tool_assertion",
      validatorConfig: { assertions: [{ path: "anything", op: "exists" }] },
    }],
  }));
  const id = oneRecord.obligation.id;
  const firstReport = await oneBudget.service.validateObligation(identity, id);
  assert(firstReport.outcome === "blocked_recoverable", `budget 1 should be recoverable, got ${firstReport.outcome}`);
  assert(firstReport.record.obligation.retryBudget === 1, "entering blocked_recoverable must not consume budget");

  // blocked_recoverable 上不允许直接挂证据（须先 retry）。
  await expectReject(
    () => oneBudget.service.attachEvidence(identity, id, {
      itemId: oneRecord.items[0]!.id,
      ref: { kind: "wf_event", instanceId: "wf-retry", seq: 9 },
    }),
    "retry the obligation first",
  );

  const retried = await oneBudget.service.retryObligation(identity, id, { operator: "p31-test", source: "obligation-verdict.tests" });
  assert(retried.obligation.status === "dispatched", `retry should re-dispatch (§3.2), got ${retried.obligation.status}`);
  assert(retried.obligation.retryBudget === 0, `retry consumes one budget on re-dispatch, got ${retried.obligation.retryBudget}`);

  const audits = await oneBudget.service.listAudit(identity, { recordId: id });
  const budgetAudit = audits.find(entry => entry.action === "retry_budget");
  assert(budgetAudit?.detail?.from === 1 && budgetAudit.detail.to === 0, "retry_budget audit should record from 1 to 0");
  const retryTransition = audits.filter(entry => entry.action === "transition")
    .find(entry => entry.detail?.via === "obligation.retry");
  assert(retryTransition?.detail?.from === "blocked_recoverable" && retryTransition.detail.to === "dispatched",
    "retry transition should be audited blocked_recoverable → dispatched");

  // 重新归集（旧项级链接仍在 → 首个新证据即回 validating）→ 再裁定 → budget 0 → hard。
  await oneBudget.service.attachEvidence(identity, id, {
    itemId: oneRecord.items[0]!.id,
    ref: { kind: "wf_event", instanceId: "wf-retry", seq: 10 },
  });
  const backToValidating = await oneBudget.service.getObligation(identity, id);
  assert(backToValidating?.obligation.status === "validating",
    `re-collected evidence should return to validating, got ${backToValidating?.obligation.status}`);
  const secondReport = await oneBudget.service.validateObligation(identity, id);
  assert(secondReport.outcome === "blocked_hard", `budget exhausted after retry should hard-block, got ${secondReport.outcome}`);

  // 非 blocked_recoverable 状态不允许 retry。
  await expectReject(
    () => oneBudget.service.retryObligation(identity, id),
    "Only blocked_recoverable",
  );
}

// ---------------------------------------------------------------------------
// 6. human_confirm 流：机器项先行裁定，人工项保持 awaiting；operator 必须显式
//    且写入审计；非 human 项/非 validating 拒绝；人工 pass 后自动 fulfilled。
// ---------------------------------------------------------------------------
async function testHumanVerdictFlow(): Promise<void> {
  const subject = { proposal: { action: "refund" } };
  const { service } = fixture({ subject });
  const identity = alice();
  const record = await reachValidating(service, identity, verdictInput({
    statement: "需要人工确认的契约",
    items: [
      {
        acceptance: "schema 确定性校验",
        validator: "schema",
        validatorConfig: { schema: { type: "object", properties: { proposal: { properties: { action: { const: "refund" } } } } } },
      },
      { acceptance: "运营同学确认退款到账", validator: "human_confirm", validatorConfig: { prompt: "确认到账截图" } },
    ],
  }));
  const id = record.obligation.id;
  const schemaItem = record.items[0]!;
  const humanItem = record.items[1]!;

  const report = await service.validateObligation(identity, id);
  assert(report.outcome === "awaiting", `human item pending should keep awaiting, got ${report.outcome}`);
  assert(report.record.obligation.status === "validating", "awaiting keeps validating");
  assert(schemaItem.id === report.itemResults[0]?.itemId && report.itemResults[0].verdict === "pass",
    "schema item should have passed");
  const humanResult = report.itemResults.find(entry => entry.itemId === humanItem.id);
  assert(humanResult?.executed === false && humanResult.skipped === "human_confirm",
    "human_confirm items are never machine-executed");
  const awaitingSummary = summarizeObligationRecord(report.record);
  assert(awaitingSummary.pendingHumanItemIds.join(",") === humanItem.id, "summary should list the pending human item");

  // operator 必须显式（确认人本人）。
  await expectReject(
    () => service.submitHumanVerdict(identity, id, { itemId: humanItem.id, verdict: "pass" }),
    "explicit operator",
  );
  // 非 human_confirm 项拒绝人工裁定。
  await expectReject(
    () => service.submitHumanVerdict(identity, id, { itemId: schemaItem.id, verdict: "pass" }, { operator: "alice" }),
    "human_confirm items",
  );

  const finalReport = await service.submitHumanVerdict(identity, id, {
    itemId: humanItem.id,
    verdict: "pass",
    reason: "已确认到账",
  }, { operator: "alice", source: "obligation-verdict.tests" });
  assert(finalReport.outcome === "fulfilled", `human pass should fulfill, got ${finalReport.outcome} (${finalReport.reason})`);
  assert(finalReport.record.obligation.status === "fulfilled", "status should be fulfilled");

  const audits = await service.listAudit(identity, { recordId: humanItem.id });
  const humanAudit = audits.find(entry => entry.action === "record_verdict");
  assert(humanAudit?.operator === "alice", `human verdict audit operator must be the confirming user, got ${humanAudit?.operator}`);
  assert(humanAudit?.recordKind === "obligation_item", "verdict audit recordKind should be obligation_item");
  assert(humanAudit?.detail?.via === "obligation.verdict.human" && humanAudit.detail.verdict === "pass",
    "human verdict audit detail should carry via + verdict");
  assert(humanAudit?.detail?.obligationId === id, "verdict audit detail should reference the obligation");

  // fulfilled 之后不再接受人工裁定。
  await expectReject(
    () => service.submitHumanVerdict(identity, id, { itemId: humanItem.id, verdict: "pass" }, { operator: "alice" }),
    "validating",
  );
}

// ---------------------------------------------------------------------------
// 7. 超时兜底 sweep（§6.3/§10）：dispatched / evidence_collecting / validating /
//    blocked_recoverable 且 deadline 已过 → expired（via=deadline_sweep）；
//    pending / fulfilled / 未到期不受影响；身份隔离；global 逐 identity 归因。
// ---------------------------------------------------------------------------
async function testSweepExpiredBackstop(): Promise<void> {
  const subject = { proposal: { action: "refund" } };
  const { service } = fixture({ subject });
  const identity = alice();

  const dispatched = await service.createObligation(identity, verdictInput({
    statement: "派发后沉默", deadlineAt: PAST, carrier: { idempotencyKey: "sweep-dispatched" },
  }));
  const collecting = await service.createObligation(identity, verdictInput({
    statement: "收集中超时", deadlineAt: PAST, carrier: { idempotencyKey: "sweep-collecting" },
  }));
  await service.attachEvidence(identity, collecting.obligation.id, {
    ref: { kind: "step_result", idempotencyKey: "sweep-collecting" },
  });
  const validating = await reachValidating(service, identity, verdictInput({
    statement: "待裁定超时",
    deadlineAt: PAST,
    items: [{ acceptance: "人工确认", validator: "human_confirm" }],
  }));
  const blockedRecoverable = await reachValidating(service, identity, verdictInput({
    statement: "可恢复阻断超时",
    deadlineAt: PAST,
    items: [{
      acceptance: "subject 缺失",
      validator: "tool_assertion",
      validatorConfig: { subjectPath: "missing", assertions: [{ path: "anything", op: "exists" }] },
    }],
  }));
  await service.validateObligation(identity, blockedRecoverable.obligation.id);
  const blockedCheck = await service.getObligation(identity, blockedRecoverable.obligation.id);
  assert(blockedCheck?.obligation.status === "blocked_recoverable", "setup: obligation should be blocked_recoverable");

  const pending = await service.createObligation(identity, verdictInput({ statement: "未派发", deadlineAt: PAST }));
  const fulfilled = await reachValidating(service, identity, verdictInput({ statement: "已完成", deadlineAt: PAST }));
  await service.validateObligation(identity, fulfilled.obligation.id);
  const futureDeadline = await service.createObligation(identity, verdictInput({
    statement: "未到期", deadlineAt: FUTURE, carrier: { idempotencyKey: "sweep-future" },
  }));
  // bob 的过期契约：alice 的 sweep 不可见。
  const bobOverdue = await service.createObligation(bob(), verdictInput({
    statement: "bob 的过期契约", deadlineAt: PAST, carrier: { idempotencyKey: "sweep-bob" },
  }));

  const swept = await service.sweepExpired(identity, FAR_NOW);
  const sweptIds = swept.map(obligation => obligation.id).sort();
  const expected = [dispatched.obligation.id, collecting.obligation.id, validating.obligation.id, blockedRecoverable.obligation.id].sort();
  assert(sweptIds.join(",") === expected.join(","), `sweep should expire exactly the in-flight overdue set, got ${sweptIds}`);
  assert(swept.every(obligation => obligation.status === "expired"), "swept obligations should be expired");

  for (const kept of [pending.obligation.id, fulfilled.obligation.id, futureDeadline.obligation.id]) {
    const record = await service.getObligation(identity, kept);
    assert(record?.obligation.status !== "expired", `pending/fulfilled/future obligations must survive the sweep: ${kept}`);
  }
  const bobRecord = await service.getObligation(bob(), bobOverdue.obligation.id);
  assert(bobRecord?.obligation.status === "dispatched", "alice's sweep must not touch bob's obligations");

  const sweepAudits = await service.listAudit(identity, { recordId: dispatched.obligation.id });
  const expiredTransition = sweepAudits.find(entry => entry.action === "transition" && entry.detail?.to === "expired");
  assert(expiredTransition?.detail?.via === "deadline_sweep", "expired transition should be audited via deadline_sweep");
  assert(expiredTransition?.operator === "system" && expiredTransition.source === "obligation.sweep",
    "sweep audits should carry the system operator");

  // global sweep：跨 identity，逐行按行 identity 归因。
  const globalSwept = await service.sweepExpiredSystem(FAR_NOW);
  const bobSwept = globalSwept.find(record => record.obligation.id === bobOverdue.obligation.id);
  assert(bobSwept?.identity.userId === "bob", "global sweep should attribute rows to their own identity");
  assert(bobSwept?.obligation.status === "expired", "global sweep should expire bob's overdue obligation");
  const bobAudits = await service.listAudit(bob(), { recordId: bobOverdue.obligation.id });
  assert(bobAudits.some(entry => entry.action === "transition" && entry.detail?.to === "expired"),
    "bob's expired transition should be audited under bob's identity");

  // expired 是终态：再次 sweep 不再返回。
  const again = await service.sweepExpired(identity, FAR_NOW);
  assert(again.length === 0, "already-expired obligations must not be swept twice");
}

// ---------------------------------------------------------------------------
// 8. 终态拒绝后续工作（「ok 即终态」下线后，裁定只能由验证器体系给出）：
//    fulfilled / blocked_hard / expired 拒绝 attach / validate / retry / human。
// ---------------------------------------------------------------------------
async function testTerminalStatesRejectFurtherWork(): Promise<void> {
  const subject = { proposal: { action: "refund" } };
  const { service } = fixture({ subject });
  const identity = alice();

  const fulfilledRecord = await reachValidating(service, identity, verdictInput({
    carrier: { idempotencyKey: "terminal-fulfilled" },
  }));
  const fulfilledId = fulfilledRecord.obligation.id;
  await service.validateObligation(identity, fulfilledId);

  await expectReject(
    () => service.attachEvidence(identity, fulfilledId, {
      ref: { kind: "wf_event", instanceId: "wf-terminal", seq: 1 },
    }),
    "Cannot attach evidence",
  );
  await expectReject(
    () => service.validateObligation(identity, fulfilledId),
    "must be validating",
  );
  await expectReject(
    () => service.retryObligation(identity, fulfilledId),
    "Only blocked_recoverable",
  );
  // step 回执归集同样被拒绝（契约已终态，不再吞证据）。
  await expectReject(
    () => service.attachStepResult(identity, "terminal-fulfilled", { runId: "run-late" }),
    "Cannot attach evidence",
  );

  const hardRecord = await reachValidating(service, identity, verdictInput({
    statement: "硬阻断契约",
    items: [{
      acceptance: "action 必须是 chargeback",
      validator: "schema",
      validatorConfig: { schema: { type: "object", properties: { proposal: { properties: { action: { const: "chargeback" } } } } } },
    }],
  }));
  await service.validateObligation(identity, hardRecord.obligation.id);
  await expectReject(
    () => service.validateObligation(identity, hardRecord.obligation.id),
    "must be validating",
  );
  await expectReject(
    () => service.attachEvidence(identity, hardRecord.obligation.id, {
      ref: { kind: "wf_event", instanceId: "wf-terminal", seq: 2 },
    }),
    "Cannot attach evidence",
  );
}

// ---------------------------------------------------------------------------
// 9. 「ok 即终态」下线 surfacing：attachStepResult 携带 verdictState；
//    summarizeObligationRecord 给出裁定摘要；obligationVerdictStateOf 映射。
// ---------------------------------------------------------------------------
async function testVerdictStateSurfacing(): Promise<void> {
  const subject = { proposal: { action: "refund" } };
  const { service } = fixture({ subject });
  const identity = alice();

  // 回执只把契约推到 evidence_collecting：verdictState = collecting（ok ≠ 完成）。
  const created = await service.createObligation(identity, verdictInput({
    carrier: { idempotencyKey: "surfacing-key" },
  }));
  const attached = await service.attachStepResult(identity, "surfacing-key", { runId: "run-surfacing" });
  assert(attached.attached === true, "known key should attach");
  assert(attached.verdictState === "collecting", `receipt alone should be collecting, got ${attached.verdictState}`);
  assert(obligationVerdictStateOf("validating") === "awaiting_verdict", "validating maps to awaiting_verdict");
  assert(obligationVerdictStateOf("blocked_recoverable") === "blocked_recoverable", "terminal-ish states map 1:1");

  // 覆盖齐套后再归集回执：verdictState = awaiting_verdict。
  await service.attachEvidence(identity, created.obligation.id, {
    itemId: created.items[0]!.id,
    ref: { kind: "wf_event", instanceId: "wf-surfacing", seq: 1 },
  });
  const attachedAgain = await service.attachStepResult(identity, "surfacing-key", { runId: "run-surfacing-2" });
  assert(attachedAgain.verdictState === "awaiting_verdict",
    `full coverage should surface awaiting_verdict, got ${attachedAgain.verdictState}`);

  // 裁定完成后：summary 反映 fulfilled。
  const report = await service.validateObligation(identity, created.obligation.id);
  assert(report.outcome === "fulfilled", `schema item should fulfill, got ${report.outcome} (${report.reason})`);
  const summary = summarizeObligationRecord(report.record);
  assert(summary.status === "fulfilled" && summary.verdictState === "fulfilled", "summary should surface fulfilled");
  assert(summary.itemCounts.total === 1 && summary.itemCounts.passed === 1, "summary counts should reflect the pass");
  assert(summary.hasNonModelRequiredPass === true, "schema pass counts as non-model");
  assert(summary.pendingHumanItemIds.length === 0, "no pending human items");
  assert(typeof summary.fulfilledAt === "string", "summary should carry fulfilledAt");

  // 未知幂等键：attached:false，无 verdictState。
  const missing = await service.attachStepResult(identity, "surfacing-nobody");
  assert(missing.attached === false && missing.verdictState === undefined, "unknown key carries no verdict state");
}

// ---------------------------------------------------------------------------
// 10. 裁定路径身份隔离：跨用户 validate / human verdict / retry / sweep 全部
//     不可见；record_verdict 审计 detail 不携带验证对象内容。
// ---------------------------------------------------------------------------
async function testVerdictPathIsolationAndAuditHygiene(): Promise<void> {
  const secretMarker = "SECRET-SUBJECT-9f8e7d";
  const subject = { proposal: { action: "refund", note: secretMarker } };
  const { service } = fixture({ subject });
  const identity = alice();

  const record = await reachValidating(service, identity, verdictInput({
    statement: "隔离与审计卫生契约",
    retryBudget: 1,
    items: [
      {
        acceptance: "schema 校验",
        validator: "schema",
        validatorConfig: { schema: { type: "object", properties: { proposal: { properties: { action: { const: "refund" } } } } } },
      },
      { acceptance: "人工确认", validator: "human_confirm" },
    ],
  }));
  const id = record.obligation.id;

  for (const intruder of [bob(), { tenantId: "t-other", userId: "alice" }]) {
    await expectReject(() => service.validateObligation(intruder, id), "not found");
    await expectReject(
      () => service.submitHumanVerdict(intruder, id, { itemId: record.items[1]!.id, verdict: "pass" }, { operator: "mallory" }),
      "not found",
    );
    await expectReject(() => service.retryObligation(intruder, id), "not found");
    const swept = await service.sweepExpired(intruder, FAR_NOW);
    assert(swept.length === 0, "cross-identity sweep must see nothing");
  }

  // 写 verdict 后：审计 detail 只含指针/元数据，绝不含 subject 内容（§9）。
  await service.validateObligation(identity, id, { operator: "p31-test", source: "obligation-verdict.tests" });
  const obligationAudits = await service.listAudit(identity, { recordId: id });
  const itemAudits = await service.listAudit(identity, { recordId: record.items[0]!.id });
  const serialized = JSON.stringify([...obligationAudits, ...itemAudits]);
  assert(!serialized.includes(secretMarker), "verdict audits must never embed subject content");
  const verdictAudit = itemAudits.find(entry => entry.action === "record_verdict");
  assert(verdictAudit?.detail?.obligationId === id && verdictAudit.detail.verdict === "pass",
    "record_verdict audit should carry obligationId + verdict");
  assert(verdictAudit?.detail?.validator === "schema", "record_verdict audit should carry the validator kind");
}

export const obligationVerdictTestCases: TestCase[] = [
  ["obligation-verdict: schema validator passes/fails and subjectPath shifts the subject", testSchemaValidatorPassAndFail],
  ["obligation-verdict: tool_assertion deterministic expressions and missing-subject recoverable", testToolAssertionValidator],
  ["obligation-verdict: test_command without a runner fails closed without writing verdicts", testCommandRunnerFailClosed],
  ["obligation-verdict: test_command exit codes, timeout and timeoutMs clamping", testTestCommandValidator],
  ["obligation-verdict: model_review can never be the sole verdict basis", testModelReviewCannotBeSoleVerdict],
  ["obligation-verdict: retry budget deduction on re-dispatch and exhaustion escalation", testRetryBudgetLifecycle],
  ["obligation-verdict: human_confirm flow with operator audit and auto-aggregate", testHumanVerdictFlow],
  ["obligation-verdict: deadline sweep expires in-flight obligations with identity attribution", testSweepExpiredBackstop],
  ["obligation-verdict: terminal states reject attach, validate, retry and receipts", testTerminalStatesRejectFurtherWork],
  ["obligation-verdict: verdictState surfaces on receipts and summaries (ok 即终态 下线)", testVerdictStateSurfacing],
  ["obligation-verdict: verdict paths are identity-isolated and audits hold no subject content", testVerdictPathIsolationAndAuditHygiene],
];
