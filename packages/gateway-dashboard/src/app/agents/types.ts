import type { AgentProfile, ThinkingLevel } from "../run/types.js";

export interface AgentsConfigState {
  profiles: readonly AgentProfile[];
  defaultProfileId?: string;
  configPath?: string;
}

export interface AgentProfileFormState {
  editingId: string;
  id: string;
  name: string;
  description: string;
  defaultModel: string;
  workspace: string;
  thinking: ThinkingLevel;
  systemPrompt: string;
  memoryEnabled: boolean;
  toolsEnabled: boolean;
  isDefault: boolean;
}

export const EMPTY_AGENT_PROFILE_FORM: AgentProfileFormState = {
  editingId: "",
  id: "",
  name: "",
  description: "",
  defaultModel: "",
  workspace: "",
  thinking: "",
  systemPrompt: "",
  memoryEnabled: true,
  toolsEnabled: true,
  isDefault: false,
};

export type { AgentProfile, ThinkingLevel };
