import { CookingVideoError } from "./errors.js";
import { modelMetricErrorCode, modelMetricStatus } from "./observability.js";
import type { ModelCallMetric, ShotQualityRequest, ShotQualityResponse } from "./types.js";

export type ShotQualityModelClient = (request: ShotQualityRequest, context: { signal: AbortSignal; attempt: number }) => Promise<unknown>;

function parse(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw) as unknown; } catch { throw new CookingVideoError("MODEL_CALL_FAILED", "Shot quality model returned non-JSON output."); }
}

function score(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }

export function validateShotQualityResponse(request: ShotQualityRequest, raw: unknown): ShotQualityResponse {
  const value = parse(raw) as ShotQualityResponse;
  if (!value || typeof value !== "object" || value.schemaVersion !== "1.0" || value.jobId !== request.jobId || !Array.isArray(value.scores)
    || Object.keys(value).some(key => !["schemaVersion", "jobId", "scores"].includes(key))) throw new CookingVideoError("MODEL_CALL_FAILED", "Shot quality response has an invalid structure.");
  const requested = new Set(request.items.map(item => item.candidateId));
  const seen = new Set<string>();
  for (const item of value.scores) {
    if (!item || typeof item !== "object" || Object.keys(item).some(key => !["candidateId", "foodAppeal", "actionSalience", "productVisibility", "composition"].includes(key))
      || typeof item.candidateId !== "string" || !requested.has(item.candidateId) || seen.has(item.candidateId)
      || !score(item.foodAppeal) || !score(item.actionSalience) || !score(item.productVisibility) || !score(item.composition)) {
      throw new CookingVideoError("MODEL_CALL_FAILED", "Shot quality response contains an invalid score.");
    }
    seen.add(item.candidateId);
  }
  if (seen.size !== requested.size) throw new CookingVideoError("MODEL_CALL_FAILED", "Shot quality response must score every requested candidate exactly once.");
  return structuredClone(value);
}

export interface ShotQualityAdapterOptions { allowFrameTransfer: boolean; timeoutMs?: number; maxAttempts?: number; estimatedCostPerCallUsd?: number; maxBudgetUsd?: number; signal?: AbortSignal; onMetric?: (metric: ModelCallMetric) => void | Promise<void> }

async function emitMetric(sink: ShotQualityAdapterOptions["onMetric"], metric: ModelCallMetric): Promise<void> { try { await sink?.(metric); } catch { /* isolated telemetry */ } }

export async function runShotQualityAdapter(request: ShotQualityRequest, client: ShotQualityModelClient, options: ShotQualityAdapterOptions): Promise<{ response: ShotQualityResponse; attempts: number; estimatedCostUsd: number }> {
  if (!options.allowFrameTransfer) throw new CookingVideoError("VISION_RESPONSE_REQUIRED", "Shot quality frame transfer requires explicit authorization.");
  const ids = new Set(request.items.map(item => item.candidateId));
  if (!request.items.length || request.items.length > 120 || ids.size !== request.items.length || request.items.some(item => { const file = item.imagePath.replace(/\\/g, "/"); return !file.startsWith("frames/") || file.split("/").includes(".."); })) throw new CookingVideoError("EVENT_INPUT_INVALID", "Shot quality request must contain 1-120 unique, job-local evidence frames.");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxAttempts = options.maxAttempts ?? 2;
  const cost = options.estimatedCostPerCallUsd ?? 0;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 300_000 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new CookingVideoError("JOB_INVALID", "Shot quality timeout or attempts are invalid.");
  if (!Number.isFinite(cost) || cost < 0 || (options.maxBudgetUsd !== undefined && (!Number.isFinite(options.maxBudgetUsd) || options.maxBudgetUsd < 0))) throw new CookingVideoError("JOB_INVALID", "Shot quality cost or budget is invalid.");
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.maxBudgetUsd !== undefined && attempt * cost > options.maxBudgetUsd + Number.EPSILON) throw new CookingVideoError("MODEL_BUDGET_EXCEEDED", "Shot quality retry would exceed its budget.");
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new CookingVideoError("MODEL_TIMEOUT", "Shot quality model call timed out.")), timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
    const startedAt = new Date(); const startedMs = performance.now();
    try {
      if (signal.aborted) throw signal.reason;
      const response = await Promise.race([client(request, { signal, attempt }), new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))]);
      const validated = validateShotQualityResponse(request, response); const durationMs = Math.max(0, Math.round(performance.now() - startedMs));
      await emitMetric(options.onMetric, { schemaVersion: "1.0", jobId: request.jobId, operation: "shot_quality", status: "succeeded", attempt, startedAt: startedAt.toISOString(), durationMs, inputUnits: request.items.length, outputUnits: validated.scores.length, estimatedCostUsd: cost });
      return { response: validated, attempts: attempt, estimatedCostUsd: Math.round(attempt * cost * 1_000_000) / 1_000_000 };
    } catch (error) {
      lastError = error; const status = modelMetricStatus(error, options.signal);
      await emitMetric(options.onMetric, { schemaVersion: "1.0", jobId: request.jobId, operation: "shot_quality", status, attempt, startedAt: startedAt.toISOString(), durationMs: Math.max(0, Math.round(performance.now() - startedMs)), inputUnits: request.items.length, outputUnits: 0, estimatedCostUsd: cost, errorCode: modelMetricErrorCode(error, status) });
      if (options.signal?.aborted) throw new CookingVideoError("JOB_CANCELLED", "Shot quality model call was cancelled.");
    }
    finally { clearTimeout(timer); }
  }
  if (lastError instanceof CookingVideoError) throw lastError;
  throw new CookingVideoError("MODEL_CALL_FAILED", `Shot quality model failed after ${maxAttempts} attempt(s).`);
}
