import { parseAiSummarizationValue, parseSessionCompactionValue } from "@loong/core";
import { badRequest } from "./gateway-http.js";
import {
  isLoongThinking,
  isRecord,
  normalizeBoundedText,
  normalizeShortText,
} from "./gateway-parse.js";
import type {
  GatewayAgentConfig,
  GatewayAgentConfigSaveParams,
  GatewayAgentProfileConfig,
} from "./gateway-agent-types.js";

export function parseAgentConfigSaveParams(value: unknown): GatewayAgentConfigSaveParams {
  if (!isRecord(value) || !Array.isArray(value.profiles)) {
    badRequest("agent.config.save requires params.profiles.");
  }
  const params: GatewayAgentConfigSaveParams = {
    profiles: value.profiles.map((profile, index) => parseAgentProfileConfig(profile, index)),
  };
  if (typeof value.defaultProfileId === "string" && value.defaultProfileId.trim()) {
    params.defaultProfileId = normalizeShortText(value.defaultProfileId, "defaultProfileId", 120);
  }
  const rootCompaction = parseSessionCompactionValue(value.sessionCompaction);
  if (rootCompaction !== undefined) {
    params.sessionCompaction = rootCompaction;
  }
  const rootAiSummarization = parseAiSummarizationValue(value.aiSummarization);
  if (rootAiSummarization !== undefined) {
    params.aiSummarization = rootAiSummarization;
  }
  return params;
}

export function parseAgentProfileConfig(value: unknown, index: number): GatewayAgentProfileConfig {
  if (!isRecord(value)) {
    badRequest(`agent.config.save profile ${index + 1} must be an object.`);
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    badRequest(`agent.config.save profile ${index + 1} requires id.`);
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    badRequest(`agent.config.save profile ${index + 1} requires name.`);
  }
  const profile: GatewayAgentProfileConfig = {
    id: normalizeShortText(value.id, "profile id", 120),
    name: normalizeShortText(value.name, "profile name", 160),
  };
  if (typeof value.description === "string" && value.description.trim()) {
    profile.description = normalizeBoundedText(value.description, "description", 1000);
  }
  if (typeof value.defaultModel === "string" && value.defaultModel.trim()) {
    profile.defaultModel = normalizeShortText(value.defaultModel, "defaultModel", 200);
  }
  if (typeof value.workspace === "string" && value.workspace.trim()) {
    profile.workspace = normalizeShortText(value.workspace, "workspace", 4000);
  }
  if (value.thinking !== undefined) {
    if (!isLoongThinking(value.thinking)) {
      badRequest("agent.config.save profile thinking is invalid.");
    }
    profile.thinking = value.thinking;
  }
  if (typeof value.memoryEnabled === "boolean") {
    profile.memoryEnabled = value.memoryEnabled;
  }
  if (typeof value.toolsEnabled === "boolean") {
    profile.toolsEnabled = value.toolsEnabled;
  }
  if (typeof value.systemPrompt === "string" && value.systemPrompt.trim()) {
    profile.systemPrompt = normalizeBoundedText(value.systemPrompt, "systemPrompt", 16_000);
  }
  const profileCompaction = parseSessionCompactionValue(value.sessionCompaction);
  if (profileCompaction !== undefined) {
    profile.sessionCompaction = profileCompaction;
  }
  const profileAiSummarization = parseAiSummarizationValue(value.aiSummarization);
  if (profileAiSummarization !== undefined) {
    profile.aiSummarization = profileAiSummarization;
  }
  return profile;
}

export function sanitizeAgentConfig(config: GatewayAgentConfig): GatewayAgentConfig {
  const sanitized: GatewayAgentConfig = {
    profiles: config.profiles.map(profile => sanitizeAgentProfile(profile)),
  };
  if (config.defaultProfileId !== undefined) {
    sanitized.defaultProfileId = trimBounded(config.defaultProfileId, 120);
  }
  if (config.configPath !== undefined) {
    sanitized.configPath = trimBounded(config.configPath, 1000);
  }
  if (config.sessionCompaction !== undefined) {
    sanitized.sessionCompaction = config.sessionCompaction;
  }
  if (config.aiSummarization !== undefined) {
    sanitized.aiSummarization = config.aiSummarization;
  }
  return sanitized;
}

function sanitizeAgentProfile(profile: GatewayAgentProfileConfig): GatewayAgentProfileConfig {
  const summary: GatewayAgentProfileConfig = {
    id: trimBounded(profile.id, 120),
    name: trimBounded(profile.name, 160),
  };
  if (profile.description !== undefined) {
    summary.description = trimBounded(profile.description, 1000);
  }
  if (profile.defaultModel !== undefined) {
    summary.defaultModel = trimBounded(profile.defaultModel, 200);
  }
  if (profile.workspace !== undefined) {
    summary.workspace = trimBounded(profile.workspace, 4000);
  }
  if (profile.thinking !== undefined) {
    summary.thinking = profile.thinking;
  }
  if (profile.memoryEnabled !== undefined) {
    summary.memoryEnabled = profile.memoryEnabled;
  }
  if (profile.toolsEnabled !== undefined) {
    summary.toolsEnabled = profile.toolsEnabled;
  }
  if (profile.systemPrompt !== undefined) {
    summary.systemPrompt = trimBounded(profile.systemPrompt, 16_000);
  }
  if (profile.sessionCompaction !== undefined) {
    summary.sessionCompaction = profile.sessionCompaction;
  }
  if (profile.aiSummarization !== undefined) {
    summary.aiSummarization = profile.aiSummarization;
  }
  return summary;
}

function trimBounded(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(0, maxChars);
}
