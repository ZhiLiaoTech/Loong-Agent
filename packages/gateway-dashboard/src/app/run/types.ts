import type { DragonEvent, GatewayProviderSummary } from "../../api/types.js";

export type ThinkingLevel = "" | "none" | "low" | "medium" | "high";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  streaming: boolean;
}

export interface RunSettings {
  profileId: string;
  sessionId: string;
  model: string;
  thinking: ThinkingLevel;
  workspace: string;
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
  messages?: readonly { role: string; content: string }[];
}

export type { DragonEvent, GatewayProviderSummary };
