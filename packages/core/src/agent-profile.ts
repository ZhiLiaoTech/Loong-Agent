import type { SessionMessageCompactionOptions } from "./session-message-compaction.js";
import type { DragonThinkingLevel, DragonTurnInput } from "./types.js";

/** Profile fields merged into a turn when CLI/Gateway resolves agents.json. */
export interface DragonAgentProfile {
  id: string;
  name: string;
  description?: string;
  defaultModel?: string;
  workspace?: string;
  thinking?: DragonThinkingLevel;
  systemPrompt?: string;
  toolsEnabled?: boolean;
  memoryEnabled?: boolean;
  sessionCompaction?: SessionMessageCompactionOptions | false;
}

export interface DragonAgentConfigSnapshot {
  profiles: readonly DragonAgentProfile[];
  defaultProfileId?: string;
}

export function findAgentProfile(
  config: DragonAgentConfigSnapshot,
  profileId: string | undefined,
): DragonAgentProfile | undefined {
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
  input: DragonTurnInput,
  profile: DragonAgentProfile | undefined,
): DragonTurnInput {
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
    },
  };
}
