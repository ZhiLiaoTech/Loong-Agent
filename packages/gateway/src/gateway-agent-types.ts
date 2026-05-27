import type { DragonSource, DragonThinkingLevel, SessionMessageCompactionOptions } from "@dragon/core";

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
  source?: DragonSource;
  workspace?: string;
  model?: string;
  thinking?: DragonThinkingLevel;
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
  thinking?: DragonThinkingLevel;
  memoryEnabled?: boolean;
  toolsEnabled?: boolean;
  systemPrompt?: string;
  sessionCompaction?: SessionMessageCompactionOptions | false;
}

export interface GatewayAgentConfig {
  profiles: readonly GatewayAgentProfileConfig[];
  defaultProfileId?: string;
  configPath?: string;
  sessionCompaction?: SessionMessageCompactionOptions | false;
}

export interface GatewayAgentConfigSaveParams {
  profiles: readonly GatewayAgentProfileConfig[];
  defaultProfileId?: string;
  sessionCompaction?: SessionMessageCompactionOptions | false;
}

export interface GatewayAgentConfigStore {
  load(): Promise<GatewayAgentConfig>;
  save(config: GatewayAgentConfigSaveParams): Promise<GatewayAgentConfig>;
}
