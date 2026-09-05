import { randomUUID } from "node:crypto";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { captionsToSrt, buildRemotionRenderProps, remotionCompositionId } from "./editing.js";
import { CookingVideoError } from "./errors.js";
import { JobStore } from "./job-store.js";
import { readJsonFile, writeJsonAtomic } from "./json-files.js";
import { validateEditDecision } from "./render.js";
import { validatePromotionalCopy } from "./copy-validation.js";
import { resolveWithin } from "./paths.js";
import type {
  CookingVideoReviewWorkspace,
  EditDecision,
  EditReviewState,
  EventTimeline,
  JobState,
  MediaManifest,
  QualityReport,
  ReviewRecord,
  SyncMap,
} from "./types.js";
import { writeFile } from "node:fs/promises";

async function readOptional<T>(file: string): Promise<T | undefined> {
  try {
    return await readJsonFile<T>(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function initialReview(jobId: string, updatedAt: string): EditReviewState {
  return { schemaVersion: "1.0", jobId, revision: 1, verdict: "pending", updatedAt, history: [] };
}

export async function listReviewJobs(store: JobStore): Promise<JobState[]> {
  let entries;
  try {
    entries = await readdir(store.jobsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const states = await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
    try {
      const loaded = await store.load(entry.name);
      await access(path.join(loaded.paths.edit, "edit-decision.json"));
      return loaded.state;
    } catch { return undefined; }
  }));
  return states.filter((value): value is JobState => value !== undefined)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function loadReviewWorkspace(store: JobStore, jobId: string): Promise<CookingVideoReviewWorkspace> {
  const loaded = await store.load(jobId);
  const decisionFile = path.join(loaded.paths.edit, "edit-decision.json");
  const [manifest, decision, sync, timeline, quality, savedReview, renderResult] = await Promise.all([
    readJsonFile<MediaManifest>(path.join(loaded.paths.analysis, "media-manifest.json")),
    readJsonFile<EditDecision>(decisionFile),
    readOptional<SyncMap>(path.join(loaded.paths.analysis, "sync-map.json")),
    readOptional<EventTimeline>(path.join(loaded.paths.analysis, "event-timeline.json")),
    readOptional<QualityReport>(path.join(loaded.paths.output, "quality-report.json")),
    readOptional<EditReviewState>(path.join(loaded.paths.edit, "review-state.json")),
    readOptional<{ relativeOutputPath?: string }>(path.join(loaded.paths.output, "render-result.json")),
  ]);
  const review = savedReview ?? initialReview(jobId, loaded.state.updatedAt);
  if (review.jobId !== jobId || review.revision < 1) {
    throw new CookingVideoError("ARTIFACT_INVALID", `Invalid review state for ${jobId}.`);
  }
  return {
    job: loaded.job,
    state: loaded.state,
    review,
    manifest,
    ...(sync ? { sync } : {}),
    ...(timeline ? { timeline } : {}),
    decision,
    ...(quality ? { quality } : {}),
    ...(renderResult?.relativeOutputPath ? { previewPath: resolveWithin(loaded.paths.root, renderResult.relativeOutputPath) } : {}),
  };
}

export async function saveReviewEdit(
  store: JobStore,
  jobId: string,
  expectedRevision: number,
  decision: EditDecision,
  now = new Date(),
): Promise<CookingVideoReviewWorkspace> {
  const workspace = await loadReviewWorkspace(store, jobId);
  if (workspace.review.revision !== expectedRevision) {
    throw new CookingVideoError("EDIT_REVISION_CONFLICT", `EDL revision changed from ${expectedRevision} to ${workspace.review.revision}.`);
  }
  validateEditDecision(decision, workspace.manifest);
  const loaded = await store.load(jobId);
  validatePromotionalCopy(loaded.job, decision);
  const review: EditReviewState = {
    ...workspace.review,
    revision: expectedRevision + 1,
    verdict: "pending",
    updatedAt: now.toISOString(),
  };
  await Promise.all([
    writeJsonAtomic(path.join(loaded.paths.edit, "edit-decision.json"), decision),
    writeJsonAtomic(path.join(loaded.paths.edit, "render-props.json"), {
      schemaVersion: "1.0",
      compositionId: remotionCompositionId(decision),
      publicDirectory: loaded.paths.root,
      props: buildRemotionRenderProps(loaded.job, decision, workspace.manifest),
    }),
    writeFile(path.join(loaded.paths.edit, "captions.srt"), captionsToSrt(decision.segments, decision.endCard), "utf8"),
    writeJsonAtomic(path.join(loaded.paths.edit, "review-state.json"), review),
  ]);
  return loadReviewWorkspace(store, jobId);
}

export async function submitReview(
  store: JobStore,
  jobId: string,
  expectedRevision: number,
  verdict: ReviewRecord["verdict"],
  options: { note?: string; reviewer?: string } = {},
  now = new Date(),
): Promise<EditReviewState> {
  const workspace = await loadReviewWorkspace(store, jobId);
  if (workspace.review.revision !== expectedRevision) {
    throw new CookingVideoError("EDIT_REVISION_CONFLICT", `EDL revision changed from ${expectedRevision} to ${workspace.review.revision}.`);
  }
  if ((verdict === "rejected" || verdict === "changes_requested") && !options.note?.trim()) {
    throw new CookingVideoError("REVIEW_ACTION_INVALID", "A review note is required when rejecting or requesting changes.");
  }
  const createdAt = now.toISOString();
  const record: ReviewRecord = {
    id: randomUUID(), revision: expectedRevision, verdict, createdAt,
    ...(options.note?.trim() ? { note: options.note.trim().slice(0, 500) } : {}),
    ...(options.reviewer?.trim() ? { reviewer: options.reviewer.trim().slice(0, 80) } : {}),
  };
  const review: EditReviewState = {
    ...workspace.review,
    verdict,
    updatedAt: createdAt,
    history: [...workspace.review.history, record],
  };
  const paths = store.paths(jobId);
  await writeJsonAtomic(path.join(paths.edit, "review-state.json"), review);
  return review;
}

export async function prepareReviewRerender(store: JobStore, jobId: string): Promise<void> {
  const loaded = await store.load(jobId);
  if (loaded.state.status === "awaiting_review") return;
  if (["completed", "failed", "validating"].includes(loaded.state.status)) {
    await store.transition(jobId, "editing");
    await store.transition(jobId, "awaiting_review", { outputFiles: ["edit/edit-decision.json", "edit/render-props.json", "edit/captions.srt"] });
    return;
  }
  if (loaded.state.status === "editing") {
    await store.transition(jobId, "awaiting_review", { outputFiles: ["edit/edit-decision.json", "edit/render-props.json", "edit/captions.srt"] });
    return;
  }
  throw new CookingVideoError("JOB_STATE_INVALID", `Job ${jobId} cannot be re-rendered from ${loaded.state.status}.`);
}
