import { CookingVideoError } from "./errors.js";

export interface ProductionMetricsWindow {
  windowStartedAt: string;
  windowEndedAt: string;
  apiRequests: number;
  apiErrors: number;
  jobsCompleted: number;
  jobsFailed: number;
  jobDurationP95Ms: number;
  queueDepth: number;
  queueOldestAgeMs: number;
  deadLetterDepth: number;
  modelCalls: number;
  modelFailures: number;
  workerHeartbeatAgeMs: Record<string, number>;
}

export interface CookingVideoSlo {
  apiAvailability: number;
  jobSuccessRate: number;
  jobDurationP95Ms: number;
  queueOldestAgeMs: number;
  modelSuccessRate: number;
  workerHeartbeatAgeMs: number;
}

export interface ProductionAlert {
  code: string;
  severity: "warning" | "critical";
  value: number;
  threshold: number;
  summary: string;
  runbook: string;
}

export interface ProductionHealthSnapshot {
  schemaVersion: "1.0";
  generatedAt: string;
  status: "healthy" | "degraded" | "unhealthy";
  sli: { apiAvailability: number; jobSuccessRate: number; modelSuccessRate: number };
  metrics: ProductionMetricsWindow;
  slo: CookingVideoSlo;
  alerts: ProductionAlert[];
}

export const DEFAULT_COOKING_VIDEO_SLO: CookingVideoSlo = {
  apiAvailability: 0.995,
  jobSuccessRate: 0.95,
  jobDurationP95Ms: 30 * 60_000,
  queueOldestAgeMs: 10 * 60_000,
  modelSuccessRate: 0.9,
  workerHeartbeatAgeMs: 120_000,
};

function ratio(success: number, total: number): number { return total === 0 ? 1 : success / total; }

export function evaluateProductionHealth(metrics: ProductionMetricsWindow, slo: CookingVideoSlo = DEFAULT_COOKING_VIDEO_SLO, now = new Date()): ProductionHealthSnapshot {
  const numeric = [metrics.apiRequests, metrics.apiErrors, metrics.jobsCompleted, metrics.jobsFailed, metrics.jobDurationP95Ms, metrics.queueDepth, metrics.queueOldestAgeMs, metrics.deadLetterDepth, metrics.modelCalls, metrics.modelFailures, ...Object.values(metrics.workerHeartbeatAgeMs)];
  if (numeric.some(value => !Number.isFinite(value) || value < 0) || metrics.apiErrors > metrics.apiRequests || metrics.modelFailures > metrics.modelCalls || Date.parse(metrics.windowStartedAt) >= Date.parse(metrics.windowEndedAt)) throw new CookingVideoError("JOB_INVALID", "Production metrics window is invalid.");
  const apiAvailability = ratio(metrics.apiRequests - metrics.apiErrors, metrics.apiRequests);
  const jobSuccessRate = ratio(metrics.jobsCompleted, metrics.jobsCompleted + metrics.jobsFailed);
  const modelSuccessRate = ratio(metrics.modelCalls - metrics.modelFailures, metrics.modelCalls);
  const alerts: ProductionAlert[] = [];
  const add = (code: string, severity: ProductionAlert["severity"], value: number, threshold: number, summary: string): void => { alerts.push({ code, severity, value, threshold, summary, runbook: `COOKING_PROMO_VIDEO_RUNBOOK.md#${code.toLowerCase().replace(/_/g, "-")}` }); };
  if (apiAvailability < slo.apiAvailability) add("API_AVAILABILITY", apiAvailability < slo.apiAvailability - 0.01 ? "critical" : "warning", apiAvailability, slo.apiAvailability, "API availability is below SLO.");
  if (jobSuccessRate < slo.jobSuccessRate) add("JOB_SUCCESS_RATE", jobSuccessRate < slo.jobSuccessRate - 0.1 ? "critical" : "warning", jobSuccessRate, slo.jobSuccessRate, "Job success rate is below SLO.");
  if (metrics.jobDurationP95Ms > slo.jobDurationP95Ms) add("JOB_LATENCY", "warning", metrics.jobDurationP95Ms, slo.jobDurationP95Ms, "Job P95 duration exceeds SLO.");
  if (metrics.queueOldestAgeMs > slo.queueOldestAgeMs) add("QUEUE_BACKLOG", metrics.queueOldestAgeMs > slo.queueOldestAgeMs * 3 ? "critical" : "warning", metrics.queueOldestAgeMs, slo.queueOldestAgeMs, "Oldest queued task exceeds SLO.");
  if (metrics.deadLetterDepth > 0) add("DEAD_LETTER", "critical", metrics.deadLetterDepth, 0, "Dead-letter tasks require intervention.");
  if (modelSuccessRate < slo.modelSuccessRate) add("MODEL_SUCCESS_RATE", "warning", modelSuccessRate, slo.modelSuccessRate, "Model success rate is below SLO.");
  for (const [worker, age] of Object.entries(metrics.workerHeartbeatAgeMs)) if (age > slo.workerHeartbeatAgeMs) add("WORKER_HEARTBEAT", "critical", age, slo.workerHeartbeatAgeMs, `Worker ${worker} heartbeat is stale.`);
  const status = alerts.some(alert => alert.severity === "critical") ? "unhealthy" : alerts.length > 0 ? "degraded" : "healthy";
  return { schemaVersion: "1.0", generatedAt: now.toISOString(), status, sli: { apiAvailability, jobSuccessRate, modelSuccessRate }, metrics: structuredClone(metrics), slo: structuredClone(slo), alerts };
}

export function renderPrometheusMetrics(snapshot: ProductionHealthSnapshot): string {
  const lines = [
    `cooking_video_api_availability ${snapshot.sli.apiAvailability}`,
    `cooking_video_job_success_rate ${snapshot.sli.jobSuccessRate}`,
    `cooking_video_model_success_rate ${snapshot.sli.modelSuccessRate}`,
    `cooking_video_job_duration_p95_ms ${snapshot.metrics.jobDurationP95Ms}`,
    `cooking_video_queue_depth ${snapshot.metrics.queueDepth}`,
    `cooking_video_queue_oldest_age_ms ${snapshot.metrics.queueOldestAgeMs}`,
    `cooking_video_dead_letter_depth ${snapshot.metrics.deadLetterDepth}`,
  ];
  for (const [worker, age] of Object.entries(snapshot.metrics.workerHeartbeatAgeMs).sort()) lines.push(`cooking_video_worker_heartbeat_age_ms{worker="${worker.replace(/[^A-Za-z0-9_.-]/g, "_")}"} ${age}`);
  return `${lines.join("\n")}\n`;
}
