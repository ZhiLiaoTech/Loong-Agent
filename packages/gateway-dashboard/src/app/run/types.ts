import type { LoongEvent, GatewayProviderSummary } from "../../api/index.js";

export interface AgentAiSummarizationConfig {
  enabled?: boolean;
  model?: string;
  keepRecentTurns?: number;
  maxSummaryChars?: number;
  summaryPrompt?: string;
  timeoutMs?: number;
}

export type ThinkingLevel = "" | "none" | "low" | "medium" | "high";

import type { ChatActivityStep } from "./activity/types.js";

export type {
  ActivityGranularity,
  ActivityStepStatus,
  ActivityCategory,
  ChatActivityStep,
  ChatActivityPreferences,
} from "./activity/types.js";

export { DEFAULT_CHAT_ACTIVITY_PREFERENCES } from "./activity/types.js";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  streaming: boolean;
  /** Set when the run ended in error, was cancelled, or timed out. */
  outcome?: "error" | "cancelled" | "timeout";
  /** Human-readable failure reason shown below the assistant text. */
  errorDetail?: string;
  /** Gateway run id for war-room linking on assistant turns. */
  runId?: string;
  /** Live processing steps shown beside the assistant bubble. */
  activities?: readonly ChatActivityStep[];
  /** Whether the activity panel is expanded (auto-collapses after run completes). */
  activitiesExpanded?: boolean;
}

export interface RunSettings {
  profileId: string;
  employeeId: string;
  sessionId: string;
  model: string;
  thinking: ThinkingLevel;
  workspace: string;
  /** Gateway query loop: auto-continue after tool-iteration cap. */
  queryLoop: boolean;
  /** Finish-task mode: query loop + forceQueryLoop until done or max turns. */
  finishTask: boolean;
  queryLoopMaxTurns: number;
}

export interface DigitalEmployeeSummary {
  id: string;
  displayName: string;
  profileId: string;
  positionId: string;
  unitId: string;
  status: "active" | "inactive";
}

export interface EmployeeCatalogState {
  employees: readonly DigitalEmployeeSummary[];
  defaultEmployeeId?: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  defaultModel?: string;
  workspace?: string;
  thinking?: ThinkingLevel;
  systemPrompt?: string;
  toolsEnabled?: boolean;
  memoryEnabled?: boolean;
  aiSummarization?: AgentAiSummarizationConfig | false;
}

export interface AgentConfigState {
  profiles: readonly AgentProfile[];
  defaultProfileId?: string;
}

export interface GatewayRunRecord {
  runId: string;
  sessionId?: string;
  state: string;
  messagePreview?: string;
  error?: string;
  result?: {
    assistantPreview?: string;
    status?: string;
  };
}

export interface AgentRunResult {
  runId: string;
  status: string;
  error?: string;
  messages?: readonly { role: string; content: string }[];
}

export type { LoongEvent, GatewayProviderSummary };
