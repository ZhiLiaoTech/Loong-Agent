import path from "node:path";
import { CookingVideoError } from "./errors.js";
import { computeJobInputDigest } from "./digest.js";
import { detectMachineEvents } from "./event-detection.js";
import { createJobEdit } from "./editing.js";
import { JobStore } from "./job-store.js";
import { readJsonFile } from "./json-files.js";
import { ingestMedia } from "./media.js";
import { reviewVideo } from "./quality.js";
import { renderJob, type RenderResult } from "./render.js";
import { selectJobShots } from "./shot-selection.js";
import { synchronizeJob } from "./sync.js";
import type { JobStage, JobState } from "./types.js";

export interface RunJobOptions {
  referenceCameraId?: string;
  manualOffsets?: Record<string, number>;
  template?: "15s" | "30s";
  approved?: boolean;
  draft?: boolean;
  signal?: AbortSignal;
}

export interface RunJobResult {
  state: JobState;
  stoppedForApproval: boolean;
}

function failedStage(state: JobState): JobStage | undefined {
  return [...state.stages].reverse().find(record => record.stage !== "failed" && record.status === "failed")?.stage;
}

async function markFailed(store: JobStore, jobId: string, error: unknown): Promise<never> {
  const code = error instanceof CookingVideoError ? error.code : "PROCESS_FAILED";
  await store.transition(jobId, "failed", {
    errorCode: code,
    errorMessage: error instanceof Error ? error.message : String(error),
  });
  throw error;
}

export async function runJobPipeline(store: JobStore, jobId: string, options: RunJobOptions = {}): Promise<RunJobResult> {
  let rendered: RenderResult | undefined;
  let currentInputDigest: string | undefined;
  for (;;) {
    const loaded = await store.load(jobId);
    let status = loaded.state.status;
    if (status === "completed") {
      currentInputDigest ??= await computeJobInputDigest(loaded.job, loaded.paths);
      if (loaded.state.inputDigest === currentInputDigest) {
        return { state: loaded.state, stoppedForApproval: false };
      }
      status = "created";
    }
    if (status === "cancelled") throw new CookingVideoError("JOB_CANCELLED", `Job ${jobId} is cancelled.`);
    if (status === "failed") {
      const failed = failedStage(loaded.state);
      const retryMap: Partial<Record<JobStage, JobStage>> = {
        ingesting: "created",
        syncing: "ingested",
        analyzing: "synced",
        selecting: "analyzed",
        editing: "selected",
        rendering: "awaiting_review",
        validating: "validating",
      };
      status = failed === undefined ? "created" : retryMap[failed] ?? "created";
    }
    try {
      if (status === "created") {
        currentInputDigest ??= await computeJobInputDigest(loaded.job, loaded.paths);
        await store.transition(jobId, "ingesting", { inputDigest: currentInputDigest });
        const manifest = await ingestMedia(loaded.job, loaded.paths, { signal: options.signal });
        await store.transition(jobId, "ingested", { outputFiles: ["analysis/media-manifest.json", "analysis/scene-cuts.json", ...manifest.sources.flatMap(source => [source.proxyPath, source.contactSheetPath].filter((value): value is string => Boolean(value)))] });
      } else if (status === "ingested") {
        await store.transition(jobId, "syncing");
        await synchronizeJob(loaded.paths, { referenceCameraId: options.referenceCameraId, manualOffsets: options.manualOffsets });
        await store.transition(jobId, "synced", { outputFiles: ["analysis/sync-map.json"] });
      } else if (status === "synced") {
        await store.transition(jobId, "analyzing");
        const timeline = await detectMachineEvents(loaded.job, loaded.paths, { signal: options.signal });
        await store.transition(jobId, "analyzed", { outputFiles: ["analysis/event-timeline.json", ...timeline.events.flatMap(event => event.evidenceFrames)] });
      } else if (status === "analyzed") {
        await store.transition(jobId, "selecting");
        await selectJobShots(loaded.paths, new Date(), { signal: options.signal });
        await store.transition(jobId, "selected", { outputFiles: ["analysis/shot-candidates.json"] });
      } else if (status === "selected") {
        await store.transition(jobId, "editing");
        await createJobEdit(loaded.paths, loaded.job, options.template);
        await store.transition(jobId, "awaiting_review", { outputFiles: ["edit/edit-decision.json", "edit/render-props.json", "edit/captions.srt"] });
      } else if (status === "awaiting_review") {
        if (loaded.job.brief.requireHumanApproval === true && options.approved !== true) {
          return { state: loaded.state, stoppedForApproval: true };
        }
        await store.transition(jobId, "rendering");
        rendered = await renderJob(loaded.job, loaded.paths, { approved: options.approved, draft: options.draft, signal: options.signal });
        await store.transition(jobId, "validating", { outputFiles: [rendered.relativeOutputPath, "output/render-result.json"] });
      } else if (status === "validating") {
        if (rendered === undefined) {
          const saved = await readJsonFile<Omit<RenderResult, "outputPath">>(path.join(loaded.paths.output, "render-result.json"));
          rendered = { ...saved, outputPath: path.join(loaded.paths.root, saved.relativeOutputPath) };
        }
        const report = await reviewVideo(jobId, loaded.paths, path.basename(rendered.relativeOutputPath), { signal: options.signal });
        if (report.status === "fail") {
          await store.transition(jobId, "failed", { errorCode: "QUALITY_GATE_FAILED", errorMessage: "One or more quality checks failed.", outputFiles: ["output/quality-report.json"] });
          throw new CookingVideoError("QUALITY_GATE_FAILED", "One or more quality checks failed.");
        }
        const state = await store.transition(jobId, "completed", { outputFiles: ["output/quality-report.json"] });
        return { state, stoppedForApproval: false };
      } else {
        throw new CookingVideoError("JOB_STATE_INVALID", `Cannot run pipeline from state ${status}.`);
      }
    } catch (error) {
      const current = await store.load(jobId);
      if (current.state.status === "failed") throw error;
      if (options.signal?.aborted) {
        await store.transition(jobId, "cancelled", {
          errorCode: "JOB_CANCELLED",
          errorMessage: "Job execution was cancelled.",
        });
        throw new CookingVideoError("JOB_CANCELLED", `Job ${jobId} was cancelled.`);
      }
      return await markFailed(store, jobId, error);
    }
  }
}
