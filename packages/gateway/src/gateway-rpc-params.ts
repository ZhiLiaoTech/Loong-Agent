import type { LoongCronJob } from "@loong/cron";
import type { LoongThinkingLevel, LoongTurnResult } from "@loong/core";
import type {
  ApprovalStatus,
  EmployeeRegistry,
  OrgTicket,
  ToolPolicyDocument,
} from "@loong/org";
import type { GatewayTierName } from "./gateway-agent-types.js";

export type GatewayModelProviderType = "openai-compatible" | "anthropic";

export interface GatewayModelProviderConfig {
  id: string;
  type: GatewayModelProviderType;
  displayName?: string;
  apiKey?: string;
  apiKeyConfigured?: boolean;
  baseUrl?: string;
  defaultModel?: string;
  supportsToolCalling?: boolean;
  enabled?: boolean;
}

export interface GatewayModelConfig {
  providers: readonly GatewayModelProviderConfig[];
  appliesOn: "next-turn";
  configPath?: string;
}

export interface GatewayModelConfigSaveParams {
  providers: readonly GatewayModelProviderConfig[];
}

export interface GatewayModelConfigStore {
  load(): Promise<GatewayModelConfig>;
  save(config: GatewayModelConfigSaveParams): Promise<GatewayModelConfig>;
}

// --- Tier scheduling ---------------------------------------------------------

export type GatewayTierClassifierMode = "heuristic" | "fixed";

export interface GatewayTierSpec {
  model?: string;
  modelFallbacks?: readonly string[];
  thinking?: LoongThinkingLevel;
  maxContextChars?: number;
  toolsEnabled?: boolean;
  memoryEnabled?: boolean;
  systemPromptAddendum?: string;
}

export interface GatewayTierKeywordHint {
  tier: GatewayTierName;
  words: readonly string[];
}

export interface GatewayTierConfig {
  enabled: boolean;
  tiers: {
    fast?: GatewayTierSpec;
    standard?: GatewayTierSpec;
    deep?: GatewayTierSpec;
  };
  classifier: {
    mode: GatewayTierClassifierMode;
    fixedTier?: GatewayTierName;
    keywordHints?: readonly GatewayTierKeywordHint[];
  };
  appliesOn: "next-turn";
  configPath?: string;
}

export interface GatewayTierConfigSaveParams {
  enabled: boolean;
  tiers: {
    fast?: GatewayTierSpec;
    standard?: GatewayTierSpec;
    deep?: GatewayTierSpec;
  };
  classifier: {
    mode: GatewayTierClassifierMode;
    fixedTier?: GatewayTierName;
    keywordHints?: readonly GatewayTierKeywordHint[];
  };
}

export interface GatewayTierConfigStore {
  load(): Promise<GatewayTierConfig>;
  save(config: GatewayTierConfigSaveParams): Promise<GatewayTierConfig>;
  /**
   * Subscribed by the gateway so a save can hot-swap the runtime's tier
   * decisions for the next turn without restart.
   */
  onChange?(listener: (config: GatewayTierConfig) => void): () => void;
}

export interface GatewayTierClassifyParams {
  message: string;
  attachments?: readonly { kind: "image" | "text" | "document"; mimeType: string; size?: number }[];
  workspace?: string;
  toolsEnabled?: boolean;
  memoryRecallCount?: number;
  hasSkillLoaded?: boolean;
}

export interface GatewayTierClassifyResult {
  tier: GatewayTierName;
  source: "fixed" | "heuristic" | "inherited" | "explicit-input";
  score: number;
  reason: string;
  resolvedModel?: string;
  resolvedThinking?: LoongThinkingLevel;
  resolvedMaxContextChars?: number;
  resolvedToolsEnabled?: boolean;
  resolvedMemoryEnabled?: boolean;
}

export type GatewayEmployeeSaveParams = EmployeeRegistry;

export interface GatewayEmployeeWorkspaceGetParams {
  workspace?: string;
  employeeId?: string;
  profileId?: string;
}

export interface GatewayEmployeeWorkspaceSaveParams {
  workspace: string;
  role?: string;
  workflow?: string;
  memory?: string;
  enabledSkills?: string[];
}

export type GatewayToolPolicySaveParams = ToolPolicyDocument;

export interface GatewayApprovalListParams {
  status?: ApprovalStatus;
  assignedApproverId?: string;
  runId?: string;
  toolCallId?: string;
  sessionId?: string;
}

export interface GatewayApprovalResolveParams {
  id: string;
  resolvedBy?: string;
  note?: string;
}

export interface GatewayKpiSnapshotParams {
  templateId: string;
  employeeId?: string;
}

export type GatewayTicketUpsertParams = OrgTicket;

export interface GatewayTrajectoryListParams {
  sessionId: string;
  status?: LoongTurnResult["status"];
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface GatewayTrajectoryGetParams {
  sessionId: string;
  runId: string;
  maxEvents?: number;
}

export interface GatewayToolInvokeParams {
  toolName: string;
  input?: unknown;
  sessionId?: string;
  workspace?: string;
  metadata?: Record<string, unknown>;
}

export interface GatewaySuiteReleaseInstallParams {
  sourceDir: string;
  overwrite?: boolean;
  installedAt?: string;
  maxTextFileBytes?: number;
}

export interface GatewaySuiteInstallParams extends GatewaySuiteReleaseInstallParams {}

export interface GatewaySuiteInstanceMaterializeParams {
  tenantId: string;
  agentInstanceId: string;
  suiteId: string;
  suiteVersion: string;
  employeeId?: string;
  overwrite?: boolean;
  createdAt?: string;
  metadata?: Record<string, unknown>;
  maxTextFileBytes?: number;
}

export interface GatewayMemoryCandidateListParams {
  status?: "pending" | "promoted" | "rejected" | "all";
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface GatewayMemoryCandidatePromoteParams {
  id: string;
  scope?: "user" | "project" | "session" | "skill";
  content?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayMemoryCandidateRejectParams {
  id: string;
  reason?: string;
}

export interface GatewayCronJobUpsertParams extends LoongCronJob {
  enabled?: boolean;
  nextRunAt?: string;
}

export interface GatewayCronJobRemoveParams {
  id: string;
}

// ---------------------------------------------------------------------------
// Phase 5 (FR-12/13/14): ontology user-control RPC params.
// Every ontology RPC carries an explicit `userId`; the gateway resolves it to
// the gateway-scoped identity ({ tenantId: GATEWAY_DEFAULT_TENANT_ID, userId })
// exactly like turn identity resolution — identity is never free-form and the
// ontology store enforces tenant/user isolation on every query (§10).
// ---------------------------------------------------------------------------

export interface GatewayOntologyKnowledgeListParams {
  userId: string;
}

export interface GatewayOntologyAssertionExplainParams {
  userId: string;
  assertionId: string;
}

export interface GatewayOntologyConflictsListParams {
  userId: string;
}

export interface GatewayOntologyCandidateListParams {
  userId: string;
  status?: "candidate" | "active" | "disputed" | "superseded" | "retracted" | "all";
  limit?: number;
}

export interface GatewayOntologyCandidatePromoteParams {
  userId: string;
  id: string;
}

export interface GatewayOntologyCandidateRejectParams {
  userId: string;
  id: string;
  reason?: string;
  dontAskAgain?: boolean;
}

export interface GatewayOntologyAssertionCorrectParams {
  userId: string;
  assertionId: string;
  correction: {
    objectEntity?: { type: string; name: string; aliases?: string[] };
    objectValue?: string | number | boolean;
    excerpt: string;
    confidence?: number;
  };
  reason?: string;
}

export interface GatewayOntologyAssertionRetractParams {
  userId: string;
  assertionId: string;
  reason?: string;
}

export interface GatewayOntologyEvidenceDeleteParams {
  userId: string;
  evidenceId: string;
  reason?: string;
}

export interface GatewayOntologyEntityDeleteParams {
  userId: string;
  entityId: string;
  reason?: string;
}

export interface GatewayOntologyCategoryDeleteParams {
  userId: string;
  predicate?: string;
  sourceType?: "explicit" | "observed" | "inferred" | "imported";
  entityType?: string;
  reason?: string;
}

export interface GatewayOntologyDeleteAllParams {
  userId: string;
  reason?: string;
}

export interface GatewayOntologyEntityUnmergeParams {
  userId: string;
  entityId: string;
}

export interface GatewayOntologySnapshotRegenerateParams {
  userId: string;
}

export interface GatewayOntologyExportParams {
  userId: string;
  /** 敏感 Evidence 原文导出需用户单独确认 (FR-14); also requires write permission. */
  includeSensitiveEvidence?: boolean;
}

export interface GatewayOntologyImportParams {
  userId: string;
  payload: unknown;
}

// ---------------------------------------------------------------------------
// Phase 3.0: obligation（任务契约）RPC params — 先记录不裁定
// (docs/OBLIGATION_EVIDENCE_CHAIN_DESIGN.md §3/§11).
// Every obligation RPC carries an explicit `userId` resolved to the
// gateway-scoped identity exactly like the ontology RPCs — the obligation
// store enforces tenant/user isolation on every query (§9).
// ---------------------------------------------------------------------------

export type GatewayObligationStatus =
  | "pending"
  | "dispatched"
  | "evidence_collecting"
  | "validating"
  | "fulfilled"
  | "blocked_recoverable"
  | "blocked_hard"
  | "expired";

export type GatewayObligationValidatorKind =
  | "schema"
  | "tool_assertion"
  | "test_command"
  | "human_confirm"
  | "model_review";

export interface GatewayObligationCreateItem {
  seq?: number;
  acceptance: string;
  validator: GatewayObligationValidatorKind;
  validatorConfig?: Record<string, unknown>;
  required?: boolean;
  deadlineAt?: string;
}

export interface GatewayObligationCreateParams {
  userId: string;
  employeeId: string;
  requesterUserId?: string;
  source?: string;
  statement: string;
  items: GatewayObligationCreateItem[];
  budget?: { maxTokens?: number; maxCostUsd?: number };
  deadlineAt?: string;
  retryBudget?: number;
  /** 执行载体：提供任意字段即视为已派发（创建后推进到 dispatched）。 */
  dispatch?: { instanceId?: string; runId?: string; idempotencyKey?: string };
}

export interface GatewayObligationListParams {
  userId: string;
  status?: GatewayObligationStatus;
  limit?: number;
}

export interface GatewayObligationGetParams {
  userId: string;
  id: string;
}

export type GatewayObligationEvidenceRef =
  | { kind: "wf_event"; instanceId: string; seq: number }
  | { kind: "ontology_evidence"; tenantId: string; userId: string; evidenceId: string }
  | { kind: "ontology_episode"; tenantId: string; userId: string; episodeId: string }
  | { kind: "step_result"; idempotencyKey: string };

export interface GatewayObligationAttachEvidenceParams {
  userId: string;
  obligationId: string;
  itemId?: string;
  ref: GatewayObligationEvidenceRef;
}

export type GatewayObligationDanglingKind = "untouched" | "silent" | "unvalidated";

export interface GatewayObligationOverdueListParams {
  userId: string;
  kind?: GatewayObligationDanglingKind;
  now?: string;
  olderThan?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Phase 3.1: 三态裁定 RPC params（§6/§11）— validate / human verdict / retry。
// All three are write-probe gated exactly like obligation.create.
// ---------------------------------------------------------------------------

export interface GatewayObligationValidateParams {
  userId: string;
  obligationId: string;
}

export type GatewayObligationVerdict = "pass" | "recoverable_block" | "hard_block";

export interface GatewayObligationHumanVerdictParams {
  userId: string;
  obligationId: string;
  itemId: string;
  verdict: GatewayObligationVerdict;
  reason?: string;
}

export interface GatewayObligationRetryParams {
  userId: string;
  obligationId: string;
}
