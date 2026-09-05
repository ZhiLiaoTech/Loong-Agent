import { appendFile, readFile, stat } from "node:fs/promises";
import { CookingVideoError } from "./errors.js";
import { JobStore } from "./job-store.js";
import type { CookingVideoMetricsSummary, JobState, ModelCallMetric, ModelCallStatus, ModelOperation } from "./types.js";

const MAX_METRICS_BYTES = 8 * 1024 * 1024;
const OPERATIONS: readonly ModelOperation[] = ["vision", "shot_quality", "copy"];
const STATUSES: readonly ModelCallStatus[] = ["succeeded", "failed", "timeout", "cancelled"];

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function validateMetric(metric: ModelCallMetric): ModelCallMetric {
  if (metric.schemaVersion !== "1.0" || !metric.jobId || !OPERATIONS.includes(metric.operation) || !STATUSES.includes(metric.status)
    || !Number.isInteger(metric.attempt) || metric.attempt < 1 || !Number.isFinite(Date.parse(metric.startedAt))
    || !Number.isFinite(metric.durationMs) || metric.durationMs < 0 || !Number.isInteger(metric.inputUnits) || metric.inputUnits < 0
    || !Number.isInteger(metric.outputUnits) || metric.outputUnits < 0 || !Number.isFinite(metric.estimatedCostUsd) || metric.estimatedCostUsd < 0) {
    throw new CookingVideoError("JOB_INVALID", "Model call metric is invalid.");
  }
  return structuredClone(metric);
}

function emptyOperation(): CookingVideoMetricsSummary["model"]["byOperation"][ModelOperation] {
  return { calls: 0, failed: 0, estimatedCostUsd: 0, totalDurationMs: 0 };
}

export function summarizeCookingVideoMetrics(jobId: string, state: JobState, metrics: readonly ModelCallMetric[], now = new Date()): CookingVideoMetricsSummary {
  const durations = metrics.map(metric => metric.durationMs).sort((a, b) => a - b);
  const totalDurationMs = metrics.reduce((sum, metric) => sum + metric.durationMs, 0);
  const byOperation: CookingVideoMetricsSummary["model"]["byOperation"] = { vision: emptyOperation(), shot_quality: emptyOperation(), copy: emptyOperation() };
  for (const metric of metrics) {
    const operation = byOperation[metric.operation];
    operation.calls += 1;
    if (metric.status !== "succeeded") operation.failed += 1;
    operation.estimatedCostUsd = rounded(operation.estimatedCostUsd + metric.estimatedCostUsd);
    operation.totalDurationMs += metric.durationMs;
  }
  const stageDurations = state.stages.map(stage => stage.completedAt ? Math.max(0, Date.parse(stage.completedAt) - Date.parse(stage.startedAt)) : 0);
  return {
    schemaVersion: "1.0", jobId, generatedAt: now.toISOString(),
    model: {
      calls: metrics.length,
      succeeded: metrics.filter(metric => metric.status === "succeeded").length,
      failed: metrics.filter(metric => metric.status === "failed").length,
      timedOut: metrics.filter(metric => metric.status === "timeout").length,
      cancelled: metrics.filter(metric => metric.status === "cancelled").length,
      inputUnits: metrics.reduce((sum, metric) => sum + metric.inputUnits, 0),
      outputUnits: metrics.reduce((sum, metric) => sum + metric.outputUnits, 0),
      estimatedCostUsd: rounded(metrics.reduce((sum, metric) => sum + metric.estimatedCostUsd, 0)),
      totalDurationMs,
      averageDurationMs: metrics.length === 0 ? 0 : Math.round(totalDurationMs / metrics.length),
      p95DurationMs: durations.length === 0 ? 0 : durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)]!,
      byOperation,
    },
    pipeline: {
      stageAttempts: state.stages.length,
      failedStages: state.stages.filter(stage => stage.status === "failed").length,
      totalDurationMs: stageDurations.reduce((sum, duration) => sum + duration, 0),
    },
  };
}

export class CookingVideoMetricsStore {
  readonly #store: JobStore;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(jobsRoot: string) {
    this.#store = new JobStore(jobsRoot);
  }

  record = async (rawMetric: ModelCallMetric): Promise<void> => {
    const metric = validateMetric(rawMetric);
    const loaded = await this.#store.load(metric.jobId);
    this.#writeChain = this.#writeChain.catch(() => undefined).then(() => appendFile(loaded.paths.modelMetricsFile, `${JSON.stringify(metric)}\n`, "utf8"));
    await this.#writeChain;
  };

  async list(jobId: string): Promise<ModelCallMetric[]> {
    const loaded = await this.#store.load(jobId);
    try {
      const info = await stat(loaded.paths.modelMetricsFile);
      if (info.size > MAX_METRICS_BYTES) throw new CookingVideoError("JOB_INVALID", "Model metrics file exceeds the 8 MB read limit.");
      const contents = await readFile(loaded.paths.modelMetricsFile, "utf8");
      return contents.split(/\r?\n/).filter(Boolean).map((line, index) => {
        try {
          const metric = validateMetric(JSON.parse(line) as ModelCallMetric);
          if (metric.jobId !== jobId) throw new CookingVideoError("JOB_INVALID", `Metric belongs to unexpected job ${metric.jobId}.`);
          return metric;
        }
        catch (error) { throw new CookingVideoError("JOB_INVALID", `Invalid model metric at line ${index + 1}.`, { cause: error instanceof Error ? error.message : String(error) }); }
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async summary(jobId: string, now = new Date()): Promise<CookingVideoMetricsSummary> {
    const [{ state }, metrics] = await Promise.all([this.#store.load(jobId), this.list(jobId)]);
    return summarizeCookingVideoMetrics(jobId, state, metrics, now);
  }
}

export function modelMetricStatus(error: unknown, signal?: AbortSignal): ModelCallStatus {
  if (signal?.aborted) return "cancelled";
  if (error instanceof CookingVideoError && error.code === "MODEL_TIMEOUT") return "timeout";
  return "failed";
}

export function modelMetricErrorCode(error: unknown, status?: ModelCallStatus): string {
  if (status === "cancelled") return "JOB_CANCELLED";
  return error instanceof CookingVideoError ? error.code : "MODEL_CALL_FAILED";
}
