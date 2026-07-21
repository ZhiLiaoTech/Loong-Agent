import type { LoongEvent, LoongTurnResult } from "@loong/core";
import type { GatewayTierName } from "./gateway-agent-types.js";

export type GatewayStepMode = "propose" | "tool";

export interface GatewayStepHistoryMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface GatewayStepContext {
  intent?: string;
  history?: readonly GatewayStepHistoryMessage[];
  schemaRef?: string;
  memoryRefs?: readonly string[];
  metadata?: Record<string, unknown>;
}

export interface GatewayStepModelPolicy {
  tier?: GatewayTierName;
  model?: string;
  fallbacks?: readonly string[];
}

export interface GatewayStepBudget {
  maxTokens?: number;
  maxCostUsd?: number;
}

export interface GatewayStepExecuteParams {
  idempotencyKey: string;
  tenantId?: string;
  employeeId?: string;
  suiteRef?: { id: string; version: string };
  stepContext?: GatewayStepContext;
  message?: string;
  sessionId?: string;
  workspace?: string;
  profileId?: string;
  allowedTools?: readonly string[];
  modelPolicy?: GatewayStepModelPolicy;
  budget?: GatewayStepBudget;
  mode?: GatewayStepMode;
  toolsEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface GatewayStepProposal {
  action: string;
  params: unknown;
}

export interface GatewayStepUsage {
  tokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface GatewayStepResult {
  status: LoongTurnResult["status"];
  proposal?: GatewayStepProposal;
  toolResult?: unknown;
  events: LoongEvent[];
  usage: GatewayStepUsage;
  runId?: string;
  error?: string;
  replayed?: boolean;
}
