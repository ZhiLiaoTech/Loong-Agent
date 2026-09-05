import path from "node:path";
import { cleanupJobTemporaryFiles } from "./cleanup.js";
import { computeJobInputDigest } from "./digest.js";
import { CookingVideoError } from "./errors.js";
import { detectJobEvents } from "./event-detection.js";
import { createJobEdit } from "./editing.js";
import { JobStore } from "./job-store.js";
import { readJsonFile } from "./json-files.js";
import { ingestMedia } from "./media.js";
import { reviewVideo } from "./quality.js";
import { renderJob, type RenderResult } from "./render.js";
import { selectJobShots } from "./shot-selection.js";
import { synchronizeJob } from "./sync.js";
import type { JobStage, JobState } from "./types.js";
import type { RunJobOptions } from "./job-runner.js";

export type CookingVideoWorkerRole = "media" | "model" | "render";
export type CookingVideoWorkerAction = "ingest" | "sync" | "detect" | "select" | "edit" | "render" | "validate";

export interface CookingVideoWorkerTask {
  schemaVersion: "1.0";
  taskId: string;
  jobId: string;
  role: CookingVideoWorkerRole;
  action: CookingVideoWorkerAction;
  expectedStatus: JobStage;
}

export interface CookingVideoWorkerResult {
  taskId: string;
  jobId: string;
  role: CookingVideoWorkerRole;
  action: CookingVideoWorkerAction;
  state: JobState;
}

const ACTIONS: Record<CookingVideoWorkerAction, { role: CookingVideoWorkerRole; expectedStatus: JobStage }> = {
  ingest: { role: "media", expectedStatus: "created" },
  sync: { role: "media", expectedStatus: "ingested" },
  detect: { role: "model", expectedStatus: "synced" },
  select: { role: "model", expectedStatus: "analyzed" },
  edit: { role: "model", expectedStatus: "selected" },
  render: { role: "render", expectedStatus: "awaiting_review" },
  validate: { role: "render", expectedStatus: "validating" },
};

const NEXT_ACTION: Partial<Record<JobStage, CookingVideoWorkerAction>> = {
  created: "ingest",
  ingested: "sync",
  synced: "detect",
  analyzed: "select",
  selected: "edit",
  awaiting_review: "render",
  validating: "validate",
};

const RUNNING_STAGE: Record<CookingVideoWorkerAction, JobStage> = {
  ingest: "ingesting",
  sync: "syncing",
  detect: "analyzing",
  select: "selecting",
  edit: "editing",
  render: "rendering",
  validate: "validating",
};

export function workerRoleForAction(action: CookingVideoWorkerAction): CookingVideoWorkerRole {
  const definition = ACTIONS[action];
  if (!definition) throw new CookingVideoError("JOB_STATE_INVALID", `Unsupported worker action: ${action}.`);
  return definition.role;
}

export function planNextWorkerTask(jobId: string, status: JobStage, taskId: string): CookingVideoWorkerTask | undefined {
  const action = NEXT_ACTION[status];
  if (!action) return undefined;
  return { schemaVersion: "1.0", taskId, jobId, role: ACTIONS[action].role, action, expectedStatus: status };
}

function validateTask(task: CookingVideoWorkerTask, configuredRole: CookingVideoWorkerRole): void {
  const definition = ACTIONS[task.action];
  if (task.schemaVersion !== "1.0" || !definition || task.role !== definition.role || configuredRole !== definition.role || task.expectedStatus !== definition.expectedStatus) {
    throw new CookingVideoError("JOB_STATE_INVALID", "Worker task does not match the configured role, action, or expected state.");
  }
}

async function failTask(store: JobStore, jobId: string, action: CookingVideoWorkerAction, expectedStatus: JobStage, signal: AbortSignal | undefined, error: unknown): Promise<never> {
  const loaded = await store.load(jobId);
  if (loaded.state.status === "failed" || loaded.state.status === "cancelled") throw error;
  if (signal?.aborted) {
    await store.transition(jobId, "cancelled", { errorCode: "JOB_CANCELLED", errorMessage: "Worker task was cancelled." });
    throw new CookingVideoError("JOB_CANCELLED", `Job ${jobId} was cancelled.`);
  }
  if (loaded.state.status === expectedStatus && expectedStatus !== "validating") {
    await store.transition(jobId, RUNNING_STAGE[action]);
  }
  await store.transition(jobId, "failed", {
    errorCode: error instanceof CookingVideoError ? error.code : "PROCESS_FAILED",
    errorMessage: error instanceof Error ? error.message : String(error),
  });
  throw error;
}

export async function executeCookingVideoWorkerTask(store: JobStore, configuredRole: CookingVideoWorkerRole, task: CookingVideoWorkerTask, options: RunJobOptions = {}): Promise<CookingVideoWorkerResult> {
  validateTask(task, configuredRole);
  const loaded = await store.load(task.jobId);
  if (loaded.state.status !== task.expectedStatus) {
    throw new CookingVideoError("JOB_STATE_INVALID", `Worker expected ${task.expectedStatus}, found ${loaded.state.status}.`);
  }
  if (task.action === "render" && loaded.job.brief.requireHumanApproval === true && options.approved !== true) {
    throw new CookingVideoError("APPROVAL_REQUIRED", "The current EDL must be approved before rendering.");
  }
  try {
    if (task.action === "ingest") {
      const inputDigest = await computeJobInputDigest(loaded.job, loaded.paths);
      await store.transition(task.jobId, "ingesting", { inputDigest });
      const manifest = await ingestMedia(loaded.job, loaded.paths, { signal: options.signal });
      await store.transition(task.jobId, "ingested", { outputFiles: ["analysis/media-manifest.json", "analysis/scene-cuts.json", ...manifest.sources.flatMap(source => [source.proxyPath, source.contactSheetPath].filter((value): value is string => Boolean(value)))] });
    } else if (task.action === "sync") {
      await store.transition(task.jobId, "syncing");
      await synchronizeJob(loaded.paths, { referenceCameraId: options.referenceCameraId, manualOffsets: options.manualOffsets, allowAlignedStart: options.allowAlignedStart });
      await store.transition(task.jobId, "synced", { outputFiles: ["analysis/sync-map.json"] });
    } else if (task.action === "detect") {
      await store.transition(task.jobId, "analyzing");
      const timeline = await detectJobEvents(loaded.job, loaded.paths, { signal: options.signal });
      await store.transition(task.jobId, "analyzed", { outputFiles: ["analysis/event-timeline.json", ...timeline.events.flatMap(event => event.evidenceFrames)] });
    } else if (task.action === "select") {
      await store.transition(task.jobId, "selecting");
      await selectJobShots(loaded.paths, new Date(), { signal: options.signal });
      await store.transition(task.jobId, "selected", { outputFiles: ["analysis/shot-candidates.json"] });
    } else if (task.action === "edit") {
      await store.transition(task.jobId, "editing");
      await createJobEdit(loaded.paths, loaded.job, options.template);
      await store.transition(task.jobId, "awaiting_review", { outputFiles: ["edit/edit-decision.json", "edit/render-props.json", "edit/captions.srt"] });
    } else if (task.action === "render") {
      await store.transition(task.jobId, "rendering");
      const rendered = await renderJob(loaded.job, loaded.paths, { approved: options.approved, draft: options.draft, signal: options.signal });
      await store.transition(task.jobId, "validating", { outputFiles: [rendered.relativeOutputPath, "output/render-result.json"] });
    } else {
      const saved = await readJsonFile<Omit<RenderResult, "outputPath">>(path.join(loaded.paths.output, "render-result.json"));
      const report = await reviewVideo(task.jobId, loaded.paths, path.basename(saved.relativeOutputPath), { signal: options.signal });
      if (report.status === "fail") {
        await store.transition(task.jobId, "failed", { errorCode: "QUALITY_GATE_FAILED", errorMessage: "One or more quality checks failed.", outputFiles: ["output/quality-report.json"] });
        throw new CookingVideoError("QUALITY_GATE_FAILED", "One or more quality checks failed.");
      }
      await store.transition(task.jobId, "completed", { outputFiles: ["output/quality-report.json"] });
    }
    return { taskId: task.taskId, jobId: task.jobId, role: configuredRole, action: task.action, state: (await store.load(task.jobId)).state };
  } catch (error) {
    await cleanupJobTemporaryFiles(loaded.paths);
    return failTask(store, task.jobId, task.action, task.expectedStatus, options.signal, error);
  }
}
