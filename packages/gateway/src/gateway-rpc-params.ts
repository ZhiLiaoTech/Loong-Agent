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
