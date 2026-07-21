import { badRequest } from "./gateway-http.js";
import { isRecord, normalizeBoundedText, normalizeShortText } from "./gateway-parse.js";
import type {
  GatewayStepContext,
  GatewayStepExecuteParams,
  GatewayStepHistoryMessage,
  GatewayStepMode,
} from "./gateway-step-types.js";
import type { GatewayTierName } from "./gateway-agent-types.js";

export function parseGatewayStepExecuteParams(value: unknown): GatewayStepExecuteParams {
  if (!isRecord(value)) {
    badRequest("step.execute requires params.");
  }
  if (typeof value.idempotencyKey !== "string" || !value.idempotencyKey.trim()) {
    badRequest("step.execute requires params.idempotencyKey.");
  }
  const params: GatewayStepExecuteParams = {
    idempotencyKey: normalizeShortText(value.idempotencyKey, "idempotencyKey", 200),
  };

  if (typeof value.tenantId === "string" && value.tenantId.trim()) {
    params.tenantId = normalizeShortText(value.tenantId, "tenantId", 200);
  }
  if (typeof value.employeeId === "string" && value.employeeId.trim()) {
    params.employeeId = normalizeShortText(value.employeeId, "employeeId", 200);
  }
  if (typeof value.sessionId === "string" && value.sessionId.trim()) {
    params.sessionId = normalizeShortText(value.sessionId, "sessionId", 200);
  }
  if (typeof value.workspace === "string" && value.workspace.trim()) {
    params.workspace = normalizeShortText(value.workspace, "workspace", 4000);
  }
  if (typeof value.profileId === "string" && value.profileId.trim()) {
    params.profileId = normalizeShortText(value.profileId, "profileId", 200);
  }
  if (typeof value.message === "string" && value.message.trim()) {
    params.message = normalizeBoundedText(value.message, "message", 16_000);
  }
  if (value.suiteRef !== undefined) {
    if (!isRecord(value.suiteRef)) {
      badRequest("step.execute suiteRef must be an object.");
    }
    if (typeof value.suiteRef.id !== "string" || !value.suiteRef.id.trim()) {
      badRequest("step.execute suiteRef.id is required.");
    }
    if (typeof value.suiteRef.version !== "string" || !value.suiteRef.version.trim()) {
      badRequest("step.execute suiteRef.version is required.");
    }
    params.suiteRef = {
      id: normalizeShortText(value.suiteRef.id, "suiteRef.id", 200),
      version: normalizeShortText(value.suiteRef.version, "suiteRef.version", 120),
    };
  }
  if (value.stepContext !== undefined) {
    params.stepContext = parseStepContext(value.stepContext);
  }
  if (value.allowedTools !== undefined) {
    if (!Array.isArray(value.allowedTools)) {
      badRequest("step.execute allowedTools must be an array.");
    }
    params.allowedTools = value.allowedTools.map((entry, index) => {
      if (typeof entry !== "string" || !entry.trim()) {
        badRequest(`step.execute allowedTools[${index}] must be a non-empty string.`);
      }
      return normalizeShortText(entry, `allowedTools[${index}]`, 200);
    });
  }
  if (value.modelPolicy !== undefined) {
    if (!isRecord(value.modelPolicy)) {
      badRequest("step.execute modelPolicy must be an object.");
    }
    params.modelPolicy = {};
    if (value.modelPolicy.tier !== undefined) {
      if (value.modelPolicy.tier !== "fast" && value.modelPolicy.tier !== "standard" && value.modelPolicy.tier !== "deep") {
        badRequest("step.execute modelPolicy.tier is invalid.");
      }
      params.modelPolicy.tier = value.modelPolicy.tier as GatewayTierName;
    }
    if (typeof value.modelPolicy.model === "string" && value.modelPolicy.model.trim()) {
      params.modelPolicy.model = normalizeShortText(value.modelPolicy.model, "modelPolicy.model", 200);
    }
    if (value.modelPolicy.fallbacks !== undefined) {
      if (!Array.isArray(value.modelPolicy.fallbacks)) {
        badRequest("step.execute modelPolicy.fallbacks must be an array.");
      }
      params.modelPolicy.fallbacks = value.modelPolicy.fallbacks.map((entry, index) => {
        if (typeof entry !== "string" || !entry.trim()) {
          badRequest(`step.execute modelPolicy.fallbacks[${index}] must be a non-empty string.`);
        }
        return normalizeShortText(entry, `modelPolicy.fallbacks[${index}]`, 200);
      });
    }
  }
  if (value.budget !== undefined) {
    if (!isRecord(value.budget)) {
      badRequest("step.execute budget must be an object.");
    }
    params.budget = {};
    if (value.budget.maxTokens !== undefined) {
      const maxTokens = value.budget.maxTokens;
      if (typeof maxTokens !== "number" || !Number.isFinite(maxTokens) || maxTokens <= 0) {
        badRequest("step.execute budget.maxTokens must be a positive number.");
      }
      params.budget.maxTokens = Math.floor(maxTokens);
    }
    if (value.budget.maxCostUsd !== undefined) {
      const maxCostUsd = value.budget.maxCostUsd;
      if (typeof maxCostUsd !== "number" || !Number.isFinite(maxCostUsd) || maxCostUsd < 0) {
        badRequest("step.execute budget.maxCostUsd must be a non-negative number.");
      }
      params.budget.maxCostUsd = maxCostUsd;
    }
  }
  if (value.mode !== undefined) {
    if (value.mode !== "propose" && value.mode !== "tool") {
      badRequest("step.execute mode must be propose or tool.");
    }
    params.mode = value.mode as GatewayStepMode;
  }
  if (value.toolsEnabled !== undefined) {
    if (typeof value.toolsEnabled !== "boolean") {
      badRequest("step.execute toolsEnabled must be a boolean.");
    }
    params.toolsEnabled = value.toolsEnabled;
  }
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) {
      badRequest("step.execute metadata must be an object.");
    }
    params.metadata = value.metadata;
  }

  if (!params.stepContext?.intent?.trim() && !params.message?.trim()) {
    badRequest("step.execute requires params.message or params.stepContext.intent.");
  }

  return params;
}

function parseStepContext(value: unknown): GatewayStepContext {
  if (!isRecord(value)) {
    badRequest("step.execute stepContext must be an object.");
  }
  const context: GatewayStepContext = {};
  if (typeof value.intent === "string" && value.intent.trim()) {
    context.intent = normalizeBoundedText(value.intent, "stepContext.intent", 16_000);
  }
  if (value.history !== undefined) {
    if (!Array.isArray(value.history)) {
      badRequest("step.execute stepContext.history must be an array.");
    }
    context.history = value.history.map((entry, index) => parseHistoryMessage(entry, index));
  }
  if (typeof value.schemaRef === "string" && value.schemaRef.trim()) {
    context.schemaRef = normalizeShortText(value.schemaRef, "stepContext.schemaRef", 400);
  }
  if (value.memoryRefs !== undefined) {
    if (!Array.isArray(value.memoryRefs)) {
      badRequest("step.execute stepContext.memoryRefs must be an array.");
    }
    context.memoryRefs = value.memoryRefs.map((entry, index) => {
      if (typeof entry !== "string" || !entry.trim()) {
        badRequest(`step.execute stepContext.memoryRefs[${index}] must be a non-empty string.`);
      }
      return normalizeShortText(entry, `stepContext.memoryRefs[${index}]`, 400);
    });
  }
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) {
      badRequest("step.execute stepContext.metadata must be an object.");
    }
    context.metadata = value.metadata;
  }
  return context;
}

function parseHistoryMessage(value: unknown, index: number): GatewayStepHistoryMessage {
  if (!isRecord(value)) {
    badRequest(`step.execute stepContext.history[${index}] must be an object.`);
  }
  if (value.role !== "system" && value.role !== "user" && value.role !== "assistant" && value.role !== "tool") {
    badRequest(`step.execute stepContext.history[${index}].role is invalid.`);
  }
  if (typeof value.content !== "string") {
    badRequest(`step.execute stepContext.history[${index}].content must be a string.`);
  }
  return {
    role: value.role,
    content: normalizeBoundedText(value.content, `stepContext.history[${index}].content`, 16_000),
  };
}
