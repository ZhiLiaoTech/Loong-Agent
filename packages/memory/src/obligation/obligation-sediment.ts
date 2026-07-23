import type { MemoryIdentity } from "@loong/core";
import type { OntologyStore } from "../ontology/ontology-store.js";
import type { ObligationRecord } from "./obligation-store.js";

/**
 * Phase 3.2 (docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md §7): 契约终态记忆沉淀。
 *
 * 当契约进入终态（`fulfilled` / `blocked_hard` 归档；`expired` 异常归档，
 * §3.2），在**契约自身 identity**（系统任务即 `employee:{employeeId}`
 * 命名空间，§12 R4 —— 契约行的 user_id 已经是归属命名空间）的 ontology
 * store 中沉淀：
 *
 * - 一条 `OntologyEpisode`（sessionId/runId 关联执行载体，summary = 裁定摘要）
 *   —— 原始交互记录层；
 * - 一条 `OntologyEvidence`（source = "obligation-verdict"，excerpt = 验收报告
 *   摘要）—— 可溯源证据层。
 *
 * 真相源边界（§5.2）：报告只由契约元数据（statement / 状态 / 项 verdict /
 * verdictReason / 指针计数）生成，**不复制任何证据原文**；契约裁定从不写入
 * `ontology_assertions`（§7 铁律二，本模块不接触断言表面）。
 *
 * 幂等：episode / evidence 使用由 obligationId 派生的确定性 id，写入前做
 * 存在性检查——重复终态通知（重试风暴、重复 sweep、双写）不产生第二条沉淀。
 */

export const OBLIGATION_SEDIMENT_EVIDENCE_SOURCE = "obligation-verdict";
export const MAX_SEDIMENT_SUMMARY_CHARS = 2000;
export const MAX_SEDIMENT_REPORT_CHARS = 8000;

/** 确定性沉淀 id（幂等锚点）。 */
export function obligationSedimentEpisodeId(obligationId: string): string {
  return `oblsed_ep_${obligationId}`;
}

export function obligationSedimentEvidenceId(obligationId: string): string {
  return `oblsed_ev_${obligationId}`;
}

/** 服务在契约落到终态后发出的通知（record 为终态最新投影）。 */
export interface ObligationTerminalNotice {
  record: ObligationRecord;
  /** 终态来源，如 "obligation.validate" / "retry_budget_exhausted" / "deadline_sweep"。 */
  via: string;
  /** 聚合裁定理由（fulfilled / blocked_hard 时有）。 */
  reason?: string;
  operator?: string;
}

/**
 * 沉淀监听器（可插拔）：实现方把终态验收记录写进记忆层。实现必须是幂等的，
 * 且不得抛出破坏裁定主流程——服务侧同样按 best-effort 调用（投影失败不
 * 回滚裁定，与 3.0 step 记录钩子同姿态）。
 */
export interface ObligationSedimenter {
  onObligationTerminal(identity: MemoryIdentity, notice: ObligationTerminalNotice): Promise<void>;
}

export interface OntologyObligationSedimenterOptions {
  ontologyStore: OntologyStore;
  clock?: () => Date;
}

/** §7 默认沉淀器：终态 → OntologyEpisode + OntologyEvidence（确定性 id 幂等）。 */
export function createOntologyObligationSedimenter(options: OntologyObligationSedimenterOptions): ObligationSedimenter {
  const { ontologyStore } = options;
  return {
    async onObligationTerminal(identity, notice) {
      const obligation = notice.record.obligation;
      const episodeId = obligationSedimentEpisodeId(obligation.id);
      const evidenceId = obligationSedimentEvidenceId(obligation.id);
      const carrierSessionId = obligation.instanceId ?? `obligation:${obligation.id}`;
      const carrierRunId = obligation.runId ?? obligation.instanceId ?? `obligation:${obligation.id}`;
      const meta = {
        operator: notice.operator?.trim() ? notice.operator.trim() : "obligation-sediment",
        source: "obligation.sediment",
      };
      const capturedAt = options.clock?.().toISOString();
      // 逐件幂等：先前部分失败（只写了 episode）也能补齐 evidence。
      if ((await ontologyStore.getEpisode(identity, episodeId)) === undefined) {
        await ontologyStore.insertEpisode(identity, {
          id: episodeId,
          sessionId: carrierSessionId,
          runId: carrierRunId,
          summary: buildObligationSedimentSummary(notice),
          ...(capturedAt !== undefined ? { capturedAt } : {}),
        }, meta);
      }
      if ((await ontologyStore.getEvidence(identity, evidenceId)) === undefined) {
        await ontologyStore.insertEvidence(identity, {
          id: evidenceId,
          sessionId: carrierSessionId,
          runId: carrierRunId,
          source: OBLIGATION_SEDIMENT_EVIDENCE_SOURCE,
          excerpt: buildObligationVerdictReport(notice),
          ...(capturedAt !== undefined ? { capturedAt } : {}),
        }, meta);
      }
    },
  };
}

/** Episode summary：一行裁定摘要（有界）。 */
export function buildObligationSedimentSummary(notice: ObligationTerminalNotice): string {
  const obligation = notice.record.obligation;
  const base = `[${obligation.status}] ${obligation.statement}`;
  const reason = notice.reason ?? notice.record.items.find(item => item.verdict === "hard_block")?.verdictReason;
  const full = reason !== undefined ? `${base} — ${reason}` : base;
  return truncate(full, MAX_SEDIMENT_SUMMARY_CHARS);
}

/**
 * 验收报告摘要（evidence.excerpt）：只由契约元数据与裁定元数据构成——
 * statement / 状态 / via / 逐项 validator+verdict+reason / 证据指针计数。
 * 绝不内联证据原文（§5.2：excerpt 的唯一真相源是 ontology store 中的原始
 * 证据记录，这里生成的是裁定报告，不是证据复制）。
 */
export function buildObligationVerdictReport(notice: ObligationTerminalNotice): string {
  const { record } = notice;
  const obligation = record.obligation;
  const lines: string[] = [
    `obligation: ${obligation.id}`,
    `status: ${obligation.status}`,
    `statement: ${truncate(obligation.statement, 400)}`,
    `via: ${notice.via}`,
  ];
  if (notice.reason !== undefined) {
    lines.push(`reason: ${truncate(notice.reason, 600)}`);
  }
  if (obligation.runId !== undefined) {
    lines.push(`runId: ${obligation.runId}`);
  }
  if (obligation.instanceId !== undefined) {
    lines.push(`instanceId: ${obligation.instanceId}`);
  }
  if (obligation.fulfilledAt !== undefined) {
    lines.push(`fulfilledAt: ${obligation.fulfilledAt}`);
  }
  lines.push(`retryBudgetRemaining: ${obligation.retryBudget}`);
  lines.push("items:");
  for (const item of record.items) {
    const verdict = item.verdict ?? "unverified";
    const required = item.required ? "required" : "optional";
    const reason = item.verdictReason !== undefined ? ` — ${truncate(item.verdictReason, 300)}` : "";
    lines.push(`- [${verdict}] (${item.validator}, ${required}) ${truncate(item.acceptance, 200)}${reason}`);
  }
  const counts = new Map<string, number>();
  for (const link of record.evidenceLinks) {
    counts.set(link.kind, (counts.get(link.kind) ?? 0) + 1);
  }
  const breakdown = [...counts.entries()].map(([kind, count]) => `${kind}:${count}`).join(", ");
  lines.push(`evidenceLinks: ${record.evidenceLinks.length}${breakdown ? ` (${breakdown})` : ""}`);
  return truncate(lines.join("\n"), MAX_SEDIMENT_REPORT_CHARS);
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`;
}
