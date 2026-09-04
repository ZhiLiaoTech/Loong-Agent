import type { LoongAgentRuntime, LoongTurnResult, MemoryIdentity } from "@loong/core";
import {
  createInMemoryStepIdempotencyStore,
  executeGatewayStep,
  executeObligationBoundStep,
  type GatewayObligationBoundStepParams,
  type GatewayStepExecuteDeps,
} from "@loong/gateway";
import {
  createObligationService,
  createOntologyObligationSedimenter,
  createSqliteObligationStore,
  createSqliteOntologyStore,
  obligationEmployeeUserId,
  obligationSedimentEpisodeId,
  type ObligationCreateInput,
  type ObligationService,
  type ObligationStore,
  type OntologyStore,
} from "@loong/memory";
import { assert } from "../lib/test-helpers.js";
import type { TestCase } from "../runner.js";

/**
 * Obligation-bound step execution 闭环验收（docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md
 * §4 六环节 / §6.2 重试 / §8 停止规则 / §10 幂等）：
 * execute → step_result 证据 → 关窗 validating → 裁定 → fulfilled / 自动重试 /
 * blocked / 重放幂等 / obligation-free 回归。
 */

const TENANT = "t-flow";
const EMPLOYEE = "emp-flow";

function flowIdentity(): MemoryIdentity {
  return { tenantId: TENANT, userId: obligationEmployeeUserId(EMPLOYEE) };
}

interface FlowFixture {
  store: ObligationStore;
  ontologyStore: OntologyStore;
  service: ObligationService;
  stepDeps: GatewayStepExecuteDeps;
  runtime: ScriptedRuntime;
}

interface ScriptedRuntime extends LoongAgentRuntime {
  calls: () => number;
}

/** 按调用序返回预置 turn（超出后重复最后一个），记录真实执行次数。 */
function createScriptedRuntime(turns: readonly (() => LoongTurnResult)[]): ScriptedRuntime {
  let calls = 0;
  return {
    calls: () => calls,
    async runTurn() {
      const build = turns[Math.min(calls, turns.length - 1)]!;
      calls += 1;
      return build();
    },
    subscribe() {
      return () => undefined;
    },
  };
}

let turnSeq = 0;

/** mode:"propose" 的执行结果：带/不带 proposal 元数据（extractProposalFromTurn 读取点）。 */
function proposalTurn(proposal: { action: string; params: Record<string, unknown> } | undefined): LoongTurnResult {
  turnSeq += 1;
  return {
    runId: `flow-run-${turnSeq}`,
    status: "ok",
    messages: [
      { id: `u-${turnSeq}`, role: "user", content: "处理退款单", createdAt: new Date().toISOString() },
      proposal !== undefined
        ? { id: `a-${turnSeq}`, role: "assistant", content: "", createdAt: new Date().toISOString(), metadata: { proposal } }
        : { id: `a-${turnSeq}`, role: "assistant", content: "暂时没有结论", createdAt: new Date().toISOString() },
    ],
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
  };
}

const REFUND_PROPOSAL = { action: "refund", params: { amount: 100 } };

function fixture(turns: readonly (() => LoongTurnResult)[]): FlowFixture {
  const store = createSqliteObligationStore({ databasePath: ":memory:" });
  const ontologyStore = createSqliteOntologyStore({ databasePath: ":memory:" });
  const service = createObligationService({
    store,
    ontologyStore,
    sedimenter: createOntologyObligationSedimenter({ ontologyStore }),
  });
  const runtime = createScriptedRuntime(turns);
  const stepDeps: GatewayStepExecuteDeps = {
    idempotencyStore: createInMemoryStepIdempotencyStore(),
    agentTurnDeps: {
      runtime,
      runInLane: (_sessionId, task) => task(),
      runs: {
        registerRunStart() {},
        completeRun() {},
        failRun() {},
        deleteRunSession() {},
      },
    },
    resolveAgentParams: async params => params,
  };
  return { store, ontologyStore, service, stepDeps, runtime };
}

/** 契约验收项：step result 的 proposal.action 必须为 "refund"（主体 = 本次 step result）。 */
function refundAssertionItem(): ObligationCreateInput["items"][number] {
  return {
    acceptance: "退款提案 action 为 refund",
    validator: "tool_assertion",
    validatorConfig: {
      subjectPath: "proposal",
      assertions: [{ path: "action", op: "equals", value: "refund" }],
    },
  };
}

function boundCreateParams(
  idempotencyKey: string,
  createOverrides: Partial<NonNullable<GatewayObligationBoundStepParams["obligation"]["create"]>> = {},
): GatewayObligationBoundStepParams {
  return {
    step: {
      idempotencyKey,
      tenantId: TENANT,
      employeeId: EMPLOYEE,
      mode: "propose",
      message: "处理退款单 R-1",
    },
    obligation: {
      create: {
        statement: "退款单 R-1 完成退款闭环",
        items: [refundAssertionItem()],
        ...createOverrides,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 1. 闭环 happy path：执行 → 证据 → 关窗 → 裁定 → fulfilled（completed_verified），
//    终态沉淀 episode，停止规则给出 success。
// ---------------------------------------------------------------------------
async function testBoundStepHappyPath(): Promise<void> {
  const { service, ontologyStore, stepDeps } = fixture([() => proposalTurn(REFUND_PROPOSAL)]);
  const identity = flowIdentity();
  const result = await executeObligationBoundStep(
    { step: stepDeps, obligations: service },
    boundCreateParams("flow-happy-1"),
  );

  assert(result.status === "ok", `step should execute ok, got ${result.status}`);
  const verdict = result.obligation;
  assert(verdict.outcome === "completed_verified", `expected completed_verified, got ${verdict.outcome}`);
  assert(verdict.status === "fulfilled" && verdict.verdictState === "fulfilled", `expected fulfilled, got ${verdict.status}`);
  assert(verdict.attempts === 1 && verdict.retries === 0, `single attempt expected, got ${verdict.attempts}/${verdict.retries}`);
  assert(verdict.verdictSummary.status === "fulfilled", "summary should carry fulfilled");
  assert(verdict.verdictSummary.itemCounts.passed === 1, "the required item should pass");
  assert(verdict.stoppingRule.shouldStop === true && verdict.stoppingRule.outcome === "success",
    `terminal stop signal expected, got ${JSON.stringify(verdict.stoppingRule)}`);
  assert(verdict.usage?.totalTokens === 15 && verdict.usage.stepCount === 1,
    `call usage should be aggregated, got ${JSON.stringify(verdict.usage)}`);
  assert(verdict.explainRef.rpc === "obligation.explain" && verdict.explainRef.obligationId === verdict.obligationId,
    "explain ref should point at obligation.explain");

  // 执行载体回填 + 证据挂接（契约级 step_result 链接）。
  const record = await service.getObligation(identity, verdict.obligationId);
  assert(record?.obligation.runId === result.runId, `runId should be backfilled, got ${record?.obligation.runId}`);
  const stepLinks = record?.evidenceLinks.filter(link => link.kind === "step_result") ?? [];
  assert(stepLinks.length === 1, `exactly one step_result link expected, got ${stepLinks.length}`);

  // 终态沉淀（§7）：确定性 id 的 episode 已写入。
  const episode = await ontologyStore.getEpisode(identity, obligationSedimentEpisodeId(verdict.obligationId));
  assert(episode?.summary?.includes("[fulfilled]") === true, "fulfilled should sediment an episode");
}

// ---------------------------------------------------------------------------
// 2. 可恢复阻断 → 进程内自动重试 → fulfilled：首次执行无 proposal（主体缺失 =
//    recoverable_block），retryObligation 扣减预算后以派生键重执行，第二次通过。
// ---------------------------------------------------------------------------
async function testBoundStepAutoRetryThenFulfilled(): Promise<void> {
  const { service, stepDeps } = fixture([
    () => proposalTurn(undefined),
    () => proposalTurn(REFUND_PROPOSAL),
  ]);
  const identity = flowIdentity();
  const result = await executeObligationBoundStep(
    { step: stepDeps, obligations: service },
    boundCreateParams("flow-retry-1"),
  );

  const verdict = result.obligation;
  assert(verdict.outcome === "completed_verified", `retry should converge to fulfilled, got ${verdict.outcome}`);
  assert(verdict.attempts === 2 && verdict.retries === 1, `two attempts / one retry expected, got ${verdict.attempts}/${verdict.retries}`);
  assert(verdict.remainingRetryBudget === 1, `one retry budget should remain, got ${verdict.remainingRetryBudget}`);
  assert(verdict.usage?.totalTokens === 30 && Math.abs((verdict.usage.totalCostUsd ?? 0) - 0.002) < 1e-9
    && verdict.usage.stepCount === 2,
    `usage should aggregate both attempts, got ${JSON.stringify(verdict.usage)}`);

  // 两次执行各挂一条 step_result 链接（原键 + 派生重试键）。
  const record = await service.getObligation(identity, verdict.obligationId);
  const stepLinks = record?.evidenceLinks.filter(link => link.kind === "step_result") ?? [];
  assert(stepLinks.length === 2, `both attempts should be linked, got ${stepLinks.length}`);
  const refKeys = stepLinks.map(link => (link.ref as { idempotencyKey: string }).idempotencyKey).sort();
  assert(refKeys.join("|") === "flow-retry-1|flow-retry-1#obligation-retry-1",
    `unexpected evidence ref keys: ${refKeys.join("|")}`);

  // 重试审计留痕（§6.2 重新派发）。
  const audits = await service.listAudit(identity, { recordId: verdict.obligationId });
  assert(audits.some(entry => entry.detail?.via === "obligation.retry"), "retry redispatch should be audited");
  assert(audits.some(entry => entry.detail?.via === "collection_window_closed"), "collection window close should be audited");
}

// ---------------------------------------------------------------------------
// 3. 重试预算耗尽 → blocked_hard：retryBudget=1，第二次仍 recoverable_block，
//    聚合在预算 0 时自动升级硬阻断（§6.2 错误放大防护）。
// ---------------------------------------------------------------------------
async function testBoundStepRetryBudgetExhausted(): Promise<void> {
  const { service, stepDeps, runtime } = fixture([() => proposalTurn(undefined)]);
  const identity = flowIdentity();
  const result = await executeObligationBoundStep(
    { step: stepDeps, obligations: service },
    boundCreateParams("flow-exhaust-1", { retryBudget: 1 }),
  );

  const verdict = result.obligation;
  assert(verdict.outcome === "blocked", `expected blocked after budget exhaustion, got ${verdict.outcome}`);
  assert(verdict.status === "blocked_hard", `expected blocked_hard, got ${verdict.status}`);
  assert(verdict.attempts === 2 && verdict.retries === 1,
    `one retry should have been spent, got attempts=${verdict.attempts} retries=${verdict.retries}`);
  assert(verdict.remainingRetryBudget === 0, `budget should be exhausted, got ${verdict.remainingRetryBudget}`);
  assert(verdict.stoppingRule.shouldStop === true && verdict.stoppingRule.outcome === "failure",
    "blocked_hard should surface a failure stop signal");
  assert(runtime.calls() === 2, `the retry should have re-executed the step, got ${runtime.calls()} calls`);

  // 预算耗尽升级路径的审计留痕（retry 扣减 + blocked_hard 迁移）。
  const audits = await service.listAudit(identity, { recordId: verdict.obligationId });
  assert(audits.some(entry => entry.detail?.via === "obligation.retry"), "retry redispatch should be audited");
  const transitions = audits
    .filter(entry => entry.action === "transition")
    .map(entry => `${String(entry.detail?.from)}->${String(entry.detail?.to)}`);
  assert(transitions.some(entry => entry.endsWith("->blocked_recoverable")), "first verdict should be blocked_recoverable");
  assert(transitions.some(entry => entry.endsWith("->blocked_hard")), "second verdict should escalate to blocked_hard");

  // 终态沉淀：blocked_hard 同样归档（§7）。
  const record = await service.getObligation(identity, verdict.obligationId);
  assert(record?.obligation.status === "blocked_hard", "persisted status should be blocked_hard");
}

// ---------------------------------------------------------------------------
// 4. 重放幂等：同一 idempotencyKey 重放 —— 不建第二条契约、不重挂证据、不重验、
//    不重复沉淀；响应仍携带终态裁定。
// ---------------------------------------------------------------------------
async function testBoundStepReplayIdempotency(): Promise<void> {
  const { service, ontologyStore, stepDeps, runtime } = fixture([() => proposalTurn(REFUND_PROPOSAL)]);
  const identity = flowIdentity();
  const deps = { step: stepDeps, obligations: service };
  const params = boundCreateParams("flow-replay-1");

  const first = await executeObligationBoundStep(deps, params);
  assert(first.obligation.outcome === "completed_verified", "first call should fulfill");
  const obligationId = first.obligation.obligationId;
  const auditsBefore = await service.listAudit(identity, { recordId: obligationId });
  const linksBefore = (await service.getObligation(identity, obligationId))?.evidenceLinks.length ?? -1;

  const replayed = await executeObligationBoundStep(deps, params);
  assert(replayed.replayed === true, "second call should replay from the idempotency store");
  assert(replayed.obligation.outcome === "completed_verified" && replayed.obligation.status === "fulfilled",
    "replay should still surface the terminal verdict");
  assert(runtime.calls() === 1, `replay must not re-execute the step, got ${runtime.calls()} calls`);

  const obligations = await service.listObligations(identity);
  assert(obligations.length === 1, `same-key replay must not create a second obligation, got ${obligations.length}`);
  const auditsAfter = await service.listAudit(identity, { recordId: obligationId });
  assert(auditsAfter.length === auditsBefore.length,
    `replay must not append audits, got ${auditsBefore.length} -> ${auditsAfter.length}`);
  const linksAfter = (await service.getObligation(identity, obligationId))?.evidenceLinks.length ?? -1;
  assert(linksAfter === linksBefore, `replay must not duplicate evidence links, got ${linksBefore} -> ${linksAfter}`);

  const episodes = await ontologyStore.listEpisodes(identity);
  const sedimented = episodes.filter(episode => episode.id === obligationSedimentEpisodeId(obligationId));
  assert(sedimented.length === 1, `exactly one sediment episode expected, got ${sedimented.length}`);
}

// ---------------------------------------------------------------------------
// 5. 绑定既有契约（obligationId 模式）+ 硬阻断响应：retryBudget=0 时
//    recoverable_block 直接升级 blocked_hard；响应携带裁定摘要、失败停止信号
//    与解释链指针。
// ---------------------------------------------------------------------------
async function testBoundStepBlockedCarriesVerdictSummary(): Promise<void> {
  const { service, stepDeps } = fixture([() => proposalTurn(undefined)]);
  const identity = flowIdentity();
  const created = await service.createObligation(identity, {
    employeeId: EMPLOYEE,
    statement: "退款单 R-2 完成退款闭环",
    items: [refundAssertionItem()],
    retryBudget: 0,
    carrier: { idempotencyKey: "flow-blocked-1" },
  });

  const result = await executeObligationBoundStep(
    { step: stepDeps, obligations: service },
    {
      step: {
        idempotencyKey: "flow-blocked-1",
        tenantId: TENANT,
        employeeId: EMPLOYEE,
        mode: "propose",
        message: "处理退款单 R-2",
      },
      obligation: { obligationId: created.obligation.id },
    },
  );

  const verdict = result.obligation;
  assert(verdict.outcome === "blocked", `expected blocked, got ${verdict.outcome}`);
  assert(verdict.status === "blocked_hard" && verdict.verdictState === "blocked_hard",
    `recoverable_block with zero budget should escalate to blocked_hard, got ${verdict.status}`);
  assert(verdict.attempts === 1 && verdict.retries === 0, "no retry should happen with zero budget");
  assert(verdict.remainingRetryBudget === 0, "budget should stay zero");
  assert(verdict.verdictSummary.itemCounts.recoverableBlock === 1, "the item verdict should be recoverable_block");
  assert(verdict.stoppingRule.shouldStop === true && verdict.stoppingRule.outcome === "failure",
    "blocked_hard should surface a failure stop signal");
  assert(verdict.explainRef.obligationId === created.obligation.id, "explain ref should point at the bound obligation");

  const obligations = await service.listObligations(identity);
  assert(obligations.length === 1, "binding mode must not auto-create obligations");
}

// ---------------------------------------------------------------------------
// 6. obligation-free 回归：裸 executeGatewayStep（无 recorder / 无闭环）行为不变，
//    响应不带 obligation 字段，也不产生契约。
// ---------------------------------------------------------------------------
async function testObligationFreeStepUnchanged(): Promise<void> {
  const { service, stepDeps } = fixture([() => proposalTurn(REFUND_PROPOSAL)]);
  const identity = flowIdentity();
  const result = await executeGatewayStep(stepDeps, {
    idempotencyKey: "flow-free-1",
    tenantId: TENANT,
    employeeId: EMPLOYEE,
    mode: "propose",
    message: "一个不需要契约的单步",
  });
  assert(result.status === "ok", `obligation-free step should execute ok, got ${result.status}`);
  assert(!("obligation" in result), "obligation-free step result must not carry an obligation verdict");
  assert(result.proposal?.action === "refund", "proposal extraction should keep working");
  const obligations = await service.listObligations(identity);
  assert(obligations.length === 0, `no obligation should be recorded, got ${obligations.length}`);
}

export const obligationStepFlowTestCases: TestCase[] = [
  ["obligation-step-flow: bound step happy path executes, validates and fulfills with sediment", testBoundStepHappyPath],
  ["obligation-step-flow: recoverable block auto-retries in-process and converges to fulfilled", testBoundStepAutoRetryThenFulfilled],
  ["obligation-step-flow: retry budget exhaustion escalates to blocked_hard", testBoundStepRetryBudgetExhausted],
  ["obligation-step-flow: same-key replay is idempotent (one obligation, one verdict, one episode)", testBoundStepReplayIdempotency],
  ["obligation-step-flow: blocked response binds an existing obligation and carries verdict summary", testBoundStepBlockedCarriesVerdictSummary],
  ["obligation-step-flow: obligation-free step execution stays unchanged", testObligationFreeStepUnchanged],
];
