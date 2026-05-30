import type { LoongSource, LoongThinkingLevel, SessionMessageCompactionOptions, AISummarizationConfig } from "@loong/core";

export type GatewayTierName = "fast" | "standard" | "deep";

export interface GatewayAgentAttachment {
  kind: "image" | "text" | "document";
  mimeType: string;
  data: string;
  name?: string;
  size?: number;
}

export interface GatewayAgentParams {
  sessionId: string;
  message: string;
  source?: LoongSource;
  workspace?: string;
  model?: string;
  thinking?: LoongThinkingLevel;
  profileId?: string;
  employeeId?: string;
  systemPrompt?: string;
  toolsEnabled?: boolean;
  memoryEnabled?: boolean;
  attachments?: GatewayAgentAttachment[];
  tier?: GatewayTierName;
  queryLoop?: boolean;
  queryLoopMaxTurns?: number;
  metadata?: Record<string, unknown>;
}

export interface GatewayWebhookParams extends GatewayAgentParams {
  channel: string;
  userId?: string;
  threadId?: string;
}

export interface GatewayAgentProfileConfig {
  id: string;
  name: string;
  description?: string;
  defaultModel?: string;
  workspace?: string;
  thinking?: LoongThinkingLevel;
  memoryEnabled?: boolean;
  toolsEnabled?: boolean;
  systemPrompt?: string;
  sessionCompaction?: SessionMessageCompactionOptions | false;
  aiSummarization?: AISummarizationConfig | false;
}

export interface GatewayAgentConfig {
  profiles: readonly GatewayAgentProfileConfig[];
  defaultProfileId?: string;
  configPath?: string;
  sessionCompaction?: SessionMessageCompactionOptions | false;
  aiSummarization?: AISummarizationConfig | false;
}

export interface GatewayAgentConfigSaveParams {
  profiles: readonly GatewayAgentProfileConfig[];
  defaultProfileId?: string;
  sessionCompaction?: SessionMessageCompactionOptions | false;
  aiSummarization?: AISummarizationConfig | false;
}

export interface GatewayAgentConfigStore {
  load(): Promise<GatewayAgentConfig>;
  save(config: GatewayAgentConfigSaveParams): Promise<GatewayAgentConfig>;
}
