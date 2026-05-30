import type { AISummarizationConfig } from "./ai-summarization.js";
import type { SessionMessageCompactionOptions } from "./session-message-compaction.js";
import type { LoongThinkingLevel, LoongTurnInput } from "./types.js";

/** Profile fields merged into a turn when CLI/Gateway resolves agents.json. */
export interface LoongAgentProfile {
  id: string;
  name: string;
  description?: string;
  defaultModel?: string;
  workspace?: string;
  thinking?: LoongThinkingLevel;
  systemPrompt?: string;
  toolsEnabled?: boolean;
  memoryEnabled?: boolean;
  sessionCompaction?: SessionMessageCompactionOptions | false;
  aiSummarization?: AISummarizationConfig | false;
}

export interface LoongAgentConfigSnapshot {
  profiles: readonly LoongAgentProfile[];
  defaultProfileId?: string;
}

export function findAgentProfile(
  config: LoongAgentConfigSnapshot,
  profileId: string | undefined,
): LoongAgentProfile | undefined {
  const id = profileId?.trim() || config.defaultProfileId?.trim();
  if (!id) {
    return undefined;
  }
  return config.profiles.find(profile => profile.id === id);
}

/**
 * Applies profile defaults only where the caller did not already set a field.
 */
export function mergeAgentProfileIntoTurnInput(
  input: LoongTurnInput,
  profile: LoongAgentProfile | undefined,
): LoongTurnInput {
  if (!profile) {
    return input;
  }
  return {
    ...input,
    ...(input.model === undefined && profile.defaultModel !== undefined ? { model: profile.defaultModel } : {}),
    ...(input.workspace === undefined && profile.workspace !== undefined ? { workspace: profile.workspace } : {}),
    ...(input.thinking === undefined && profile.thinking !== undefined ? { thinking: profile.thinking } : {}),
    ...(input.systemPrompt === undefined && profile.systemPrompt !== undefined ? { systemPrompt: profile.systemPrompt } : {}),
    ...(input.toolsEnabled === undefined && profile.toolsEnabled !== undefined ? { toolsEnabled: profile.toolsEnabled } : {}),
    ...(input.memoryEnabled === undefined && profile.memoryEnabled !== undefined ? { memoryEnabled: profile.memoryEnabled } : {}),
    metadata: {
      ...(input.metadata ?? {}),
      ...(profile.id ? { profileId: profile.id } : {}),
      ...(profile.sessionCompaction !== undefined ? { sessionCompaction: profile.sessionCompaction } : {}),
      ...(profile.aiSummarization !== undefined ? { aiSummarization: profile.aiSummarization } : {}),
    },
  };
}
