import { CookingVideoError } from "./errors.js";
import { modelMetricErrorCode, modelMetricStatus } from "./observability.js";
import type { ModelCallMetric, VisionEvidenceRequest, VisionEvidenceResponse } from "./types.js";
import { validateVisionResponse } from "./vision-evidence.js";

export interface VisionModelCallContext {
  signal: AbortSignal;
  attempt: number;
  batchIndex: number;
}

export type VisionModelClient = (request: VisionEvidenceRequest, context: VisionModelCallContext) => Promise<unknown>;

export interface VisionAdapterOptions {
  allowFrameTransfer: boolean;
  maxItemsPerCall?: number;
  maxTotalItems?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  estimatedCostPerItemUsd?: number;
  maxBudgetUsd?: number;
  signal?: AbortSignal;
  onMetric?: (metric: ModelCallMetric) => void | Promise<void>;
}

export interface VisionAdapterResult {
  response: VisionEvidenceResponse;
  metrics: { calls: number; attempts: number; failedCalls: number; itemCount: number; estimatedCostUsd: number; durationMs: number };
}

async function emitMetric(sink: VisionAdapterOptions["onMetric"], metric: ModelCallMetric): Promise<void> {
  try { await sink?.(metric); } catch { /* telemetry must not change model-call behavior */ }
}

function parseResponse(raw: unknown): VisionEvidenceResponse {
  if (typeof raw !== "string") return raw as VisionEvidenceResponse;
  try {
    return JSON.parse(raw) as VisionEvidenceResponse;
  } catch {
    throw new CookingVideoError("VISION_RESPONSE_INVALID", "Vision model returned non-JSON output.");
  }
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, external?: AbortSignal): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new CookingVideoError("MODEL_TIMEOUT", `Vision model call exceeded ${timeoutMs}ms.`)), timeoutMs);
  const signal = external ? AbortSignal.any([external, timeout.signal]) : timeout.signal;
  try {
    if (signal.aborted) throw signal.reason;
    return await Promise.race([
      operation(signal),
      new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runVisionAdapter(request: VisionEvidenceRequest, client: VisionModelClient, options: VisionAdapterOptions): Promise<VisionAdapterResult> {
  if (options.allowFrameTransfer !== true) throw new CookingVideoError("VISION_RESPONSE_REQUIRED", "Vision frame transfer requires explicit authorization.");
  if (!Array.isArray(request.items) || request.items.length === 0 || request.items.some(item => {
    const portable = item.imagePath.replace(/\\/g, "/");
    return !portable.startsWith("frames/vision/") || portable.split("/").includes("..");
  })) throw new CookingVideoError("EVENT_INPUT_INVALID", "Vision adapter only accepts evidence paths inside frames/vision/.");
  const maxItemsPerCall = options.maxItemsPerCall ?? 20;
  const maxTotalItems = options.maxTotalItems ?? 120;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxAttempts = options.maxAttempts ?? 2;
  for (const [value, minimum, maximum, label] of [
    [maxItemsPerCall, 1, 20, "maxItemsPerCall"], [maxTotalItems, 1, 500, "maxTotalItems"],
    [timeoutMs, 10, 300_000, "timeoutMs"], [maxAttempts, 1, 3, "maxAttempts"],
  ] as const) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) throw new CookingVideoError("JOB_INVALID", `${label} must be between ${minimum} and ${maximum}.`);
  }
  if (request.items.length > maxTotalItems) throw new CookingVideoError("MODEL_BUDGET_EXCEEDED", `Vision request has ${request.items.length} items; limit is ${maxTotalItems}.`);
  const costPerItem = options.estimatedCostPerItemUsd ?? 0;
  if (costPerItem < 0 || !Number.isFinite(costPerItem)) throw new CookingVideoError("JOB_INVALID", "estimatedCostPerItemUsd must be non-negative.");
  if (options.maxBudgetUsd !== undefined && (!Number.isFinite(options.maxBudgetUsd) || options.maxBudgetUsd < 0)) {
    throw new CookingVideoError("JOB_INVALID", "maxBudgetUsd must be non-negative.");
  }
  const minimumCostUsd = Math.round(request.items.length * costPerItem * 1_000_000) / 1_000_000;
  if (options.maxBudgetUsd !== undefined && minimumCostUsd > options.maxBudgetUsd) {
    throw new CookingVideoError("MODEL_BUDGET_EXCEEDED", `Minimum vision cost $${minimumCostUsd} exceeds budget $${options.maxBudgetUsd}.`);
  }
  const detections: VisionEvidenceResponse["detections"] = [];
  let attempts = 0;
  let calls = 0;
  let failedCalls = 0;
  let durationMs = 0;
  let estimatedCostUsd = 0;
  for (let offset = 0, batchIndex = 0; offset < request.items.length; offset += maxItemsPerCall, batchIndex += 1) {
    const batch: VisionEvidenceRequest = { ...request, items: request.items.slice(offset, offset + maxItemsPerCall) };
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const callCost = batch.items.length * costPerItem;
      if (options.maxBudgetUsd !== undefined && estimatedCostUsd + callCost > options.maxBudgetUsd + Number.EPSILON) {
        throw new CookingVideoError("MODEL_BUDGET_EXCEEDED", `Vision retry would exceed budget $${options.maxBudgetUsd}.`);
      }
      attempts += 1;
      calls += 1;
      estimatedCostUsd = Math.round((estimatedCostUsd + callCost) * 1_000_000) / 1_000_000;
      const startedAt = new Date();
      const startedMs = performance.now();
      try {
        const raw = await withTimeout(signal => client(batch, { signal, attempt, batchIndex }), timeoutMs, options.signal);
        const batchDetections = validateVisionResponse(batch, parseResponse(raw)).detections;
        const callDurationMs = Math.max(0, Math.round(performance.now() - startedMs));
        durationMs += callDurationMs;
        await emitMetric(options.onMetric, {
          schemaVersion: "1.0", jobId: request.jobId, operation: "vision", status: "succeeded", attempt, batchIndex,
          startedAt: startedAt.toISOString(), durationMs: callDurationMs, inputUnits: batch.items.length,
          outputUnits: batchDetections.length, estimatedCostUsd: callCost,
        });
        detections.push(...batchDetections);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        failedCalls += 1;
        const callDurationMs = Math.max(0, Math.round(performance.now() - startedMs));
        const metricStatus = modelMetricStatus(error, options.signal);
        durationMs += callDurationMs;
        await emitMetric(options.onMetric, {
          schemaVersion: "1.0", jobId: request.jobId, operation: "vision", status: metricStatus, attempt, batchIndex,
          startedAt: startedAt.toISOString(), durationMs: callDurationMs, inputUnits: batch.items.length,
          outputUnits: 0, estimatedCostUsd: callCost, errorCode: modelMetricErrorCode(error, metricStatus),
        });
        if (options.signal?.aborted) throw new CookingVideoError("JOB_CANCELLED", "Vision model call was cancelled.");
        if (attempt === maxAttempts) break;
      }
    }
    if (lastError !== undefined) {
      if (lastError instanceof CookingVideoError) throw lastError;
      throw new CookingVideoError("MODEL_CALL_FAILED", `Vision model failed after ${maxAttempts} attempt(s).`, { cause: lastError instanceof Error ? lastError.message : String(lastError) });
    }
  }
  const response = validateVisionResponse(request, { schemaVersion: "1.0", jobId: request.jobId, detections });
  return { response, metrics: { calls, attempts, failedCalls, itemCount: request.items.length, estimatedCostUsd, durationMs } };
}
