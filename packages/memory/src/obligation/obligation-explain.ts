import type { MemoryIdentity } from "@loong/core";
import type { OntologyEpisode, OntologyEvidence } from "../ontology/ontology-types.js";
import type { ObligationStoppingRule, ObligationUsageAggregate } from "./obligation-loop.js";
import type {
  ObligationAuditRecord,
  ObligationEvidenceLink,
  ObligationRecord,
} from "./obligation-store.js";
import type {
  ObligationBudget,
  ObligationEvidenceRefKind,
  ObligationItem,
  ObligationStatus,
  ObligationValidatorKind,
  ObligationVerdict,
} from "./obligation-types.js";
import { isObligationTerminalStatus } from "./obligation-loop.js";
import type { ObligationVerdictSummary } from "./obligation-service.js";

/**
 * Phase 3.2 (docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md §7): explainObligation
 * 解释链 —— FR-12 `explainAssertion()` 的同构实现
 * （packages/memory/src/ontology/ontology-user-control.ts 的
 * OntologyAssertionExplanation）。
 *
 * 一次调用回答「这件事为什么算做完 / 不算做完、谁确认的、证据是什么」：
 * 契约（四身份，§3.4）→ 验收项（validator + verdict + 理由）→ 证据指针
 * （ontology 指针按调用方 identity 解引用到 episode/evidence 原文；外部
 * wf_event / step_result 只标 external；悬空/不可解引用标 dangling，读方
 * 容忍，§5.2/§9）→ verdict 时间线（obligation_audit_log 折叠）→ retry
 * 历史 → 终态裁定与 operator → 终态沉淀（§7）。
 *
 * 本模块只放类型与纯折叠函数；组装（store/ontology 访问）在
 * obligation-service.ts。
 */

export type ObligationTimelineKind =
  | "created"
  | "carrier_updated"
  | "transition"
  | "evidence_attached"
  | "verdict_recorded"
  | "retry_budget";

/** 由 obligation_audit_log（契约行 + 验收项行）折叠的时间线条目。 */
export interface ObligationTimelineEntry {
  seq: number;
  at: string;
  kind: ObligationTimelineKind;
  operator: string;
  source?: string;
  // transition
  from?: ObligationStatus;
  to?: ObligationStatus;
  via?: string;
  reason?: string;
  // evidence_attached
  refKind?: ObligationEvidenceRefKind;
  refHash?: string;
  itemId?: string;
  // verdict_recorded
  verdict?: ObligationVerdict;
  validator?: ObligationValidatorKind;
  // carrier_updated
  fields?: string[];
  // retry_budget
  budgetFrom?: number;
  budgetTo?: number;
}

export interface ObligationRetryEvent {
  at: string;
  operator: string;
  via?: string;
  budgetFrom?: number;
  budgetTo?: number;
}

/** 终态裁定（最后一次落入终态的 transition 审计行）。 */
export interface ObligationFinalVerdict {
  status: ObligationStatus;
  at: string;
  operator: string;
  via?: string;
  reason?: string;
}

/** 证据指针的解引用结果（§5.2：读方容忍悬空，不解引用跨 identity 内容）。 */
export type ObligationEvidenceResolution =
  | { kind: "ontology_evidence"; status: "resolved"; evidence: OntologyEvidence }
  | { kind: "ontology_episode"; status: "resolved"; episode: OntologyEpisode }
  | { kind: "ontology_evidence" | "ontology_episode"; status: "dangling" }
  | { kind: "wf_event" | "step_result"; status: "external" };

export interface ObligationExplainedEvidence {
  link: ObligationEvidenceLink;
  resolution: ObligationEvidenceResolution;
}

export interface ObligationItemExplanation {
  item: ObligationItem;
  /** 该项的项级证据（含解引用结果）。 */
  evidence: ObligationExplainedEvidence[];
}

/** §3.4 四种可独立校验身份的投影。 */
export interface ObligationFourIdentities {
  /** 身份一：请求归属。 */
  request: {
    tenantId: string;
    userId: string;
    employeeId: string;
    requesterUserId?: string;
    source: string;
  };
  /** 身份二：任务契约。 */
  contract: {
    statement: string;
    itemCount: number;
    requiredItemCount: number;
    budget?: ObligationBudget;
    deadlineAt?: string;
    retryBudget: number;
  };
  /** 身份三：执行载体。 */
  carrier: {
    instanceId?: string;
    runId?: string;
    idempotencyKey?: string;
  };
  /** 身份四：事实记录（指针计数 + 沉淀锚点）。 */
  record: {
    evidenceLinkCount: number;
    auditCount: number;
    sedimented: boolean;
    sedimentEpisodeId: string;
    sedimentEvidenceId: string;
  };
}

/** §7 终态沉淀的解引用视图。 */
export interface ObligationSedimentationView {
  sedimented: boolean;
  episodeId: string;
  evidenceId: string;
  episode?: OntologyEpisode;
}

/** explainObligation 的返回：全链路一次解答。 */
export interface ObligationExplanation {
  identity: MemoryIdentity;
  record: ObligationRecord;
  fourIdentities: ObligationFourIdentities;
  verdictSummary: ObligationVerdictSummary;
  stoppingRule: ObligationStoppingRule;
  usage?: ObligationUsageAggregate;
  timeline: ObligationTimelineEntry[];
  items: ObligationItemExplanation[];
  /** 契约级（非项级）证据。 */
  contractEvidence: ObligationExplainedEvidence[];
  retryHistory: ObligationRetryEvent[];
  finalVerdict?: ObligationFinalVerdict;
  sedimentation: ObligationSedimentationView;
  /** 全量审计（FR-12 同构：契约行 + 验收项行，按 seq 排序）。 */
  audit: ObligationAuditRecord[];
}

// ---------------------------------------------------------------------------
// Pure folding helpers (audit rows → timeline / retry history / final verdict)
// ---------------------------------------------------------------------------

export function foldObligationAuditTimeline(audits: readonly ObligationAuditRecord[]): ObligationTimelineEntry[] {
  const entries: ObligationTimelineEntry[] = [];
  for (const audit of audits) {
    const base = {
      seq: audit.seq,
      at: audit.createdAt,
      operator: audit.operator,
      ...(audit.source !== undefined ? { source: audit.source } : {}),
    };
    const detail = audit.detail ?? {};
    switch (audit.action) {
      case "create":
        entries.push({ ...base, kind: "created" });
        break;
      case "update_carrier":
        entries.push({
          ...base,
          kind: "carrier_updated",
          ...(Array.isArray(detail.fields) ? { fields: detail.fields.filter((field): field is string => typeof field === "string") } : {}),
        });
        break;
      case "transition":
        entries.push({
          ...base,
          kind: "transition",
          ...(typeof detail.from === "string" ? { from: detail.from as ObligationStatus } : {}),
          ...(typeof detail.to === "string" ? { to: detail.to as ObligationStatus } : {}),
          ...(typeof detail.via === "string" ? { via: detail.via } : {}),
          ...(typeof detail.reason === "string" ? { reason: detail.reason } : {}),
        });
        break;
      case "attach_evidence":
        entries.push({
          ...base,
          kind: "evidence_attached",
          ...(typeof detail.kind === "string" ? { refKind: detail.kind as ObligationEvidenceRefKind } : {}),
          ...(typeof detail.refHash === "string" ? { refHash: detail.refHash } : {}),
          ...(typeof detail.itemId === "string" ? { itemId: detail.itemId } : {}),
        });
        break;
      case "record_verdict":
        entries.push({
          ...base,
          kind: "verdict_recorded",
          itemId: audit.recordId,
          ...(typeof detail.verdict === "string" ? { verdict: detail.verdict as ObligationVerdict } : {}),
          ...(typeof detail.validator === "string" ? { validator: detail.validator as ObligationValidatorKind } : {}),
          ...(typeof detail.via === "string" ? { via: detail.via } : {}),
        });
        break;
      case "retry_budget":
        entries.push({
          ...base,
          kind: "retry_budget",
          ...(typeof detail.from === "number" ? { budgetFrom: detail.from } : {}),
          ...(typeof detail.to === "number" ? { budgetTo: detail.to } : {}),
          ...(typeof detail.via === "string" ? { via: detail.via } : {}),
        });
        break;
    }
  }
  return entries.sort((left, right) => left.seq - right.seq);
}

export function extractObligationRetryHistory(audits: readonly ObligationAuditRecord[]): ObligationRetryEvent[] {
  return audits
    .filter(audit => audit.action === "retry_budget")
    .map(audit => ({
      at: audit.createdAt,
      operator: audit.operator,
      ...(typeof audit.detail?.via === "string" ? { via: audit.detail.via } : {}),
      ...(typeof audit.detail?.from === "number" ? { budgetFrom: audit.detail.from } : {}),
      ...(typeof audit.detail?.to === "number" ? { budgetTo: audit.detail.to } : {}),
    }))
    .sort((left, right) => left.at.localeCompare(right.at));
}

export function extractObligationFinalVerdict(audits: readonly ObligationAuditRecord[]): ObligationFinalVerdict | undefined {
  const terminalTransitions = audits.filter(
    audit => audit.action === "transition"
      && typeof audit.detail?.to === "string"
      && isObligationTerminalStatus(audit.detail.to as ObligationStatus),
  );
  const last = terminalTransitions[terminalTransitions.length - 1];
  if (last === undefined) {
    return undefined;
  }
  return {
    status: last.detail?.to as ObligationStatus,
    at: last.createdAt,
    operator: last.operator,
    ...(typeof last.detail?.via === "string" ? { via: last.detail.via } : {}),
    ...(typeof last.detail?.reason === "string" ? { reason: last.detail.reason } : {}),
  };
}
