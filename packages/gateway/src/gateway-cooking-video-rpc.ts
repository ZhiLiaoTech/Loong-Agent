import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  JobStore,
  listReviewJobs,
  loadReviewWorkspace,
  prepareReviewRerender,
  runJobPipeline,
  saveReviewEdit,
  submitReview,
  resolveExistingWithin,
  type EditDecision,
  type ReviewRecord,
} from "@loong/cooking-video";

const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;

function requiredString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`cooking video RPC requires params.${key}.`);
  return value.trim();
}

function requiredRevision(params: Record<string, unknown>): number {
  const value = params.revision;
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("cooking video RPC requires a positive params.revision.");
  return Number(value);
}

function storeFor(params: Record<string, unknown>): JobStore {
  return new JobStore(path.resolve(requiredString(params, "jobsRoot")));
}

export async function handleCookingVideoRpc(type: string, params: Record<string, unknown>): Promise<unknown> {
  const store = storeFor(params);
  if (type === "cooking.video.jobs.list") return { jobs: await listReviewJobs(store) };
  const jobId = requiredString(params, "jobId");
  if (type === "cooking.video.workspace.get") return loadReviewWorkspace(store, jobId);
  if (type === "cooking.video.edit.save") {
    if (typeof params.decision !== "object" || params.decision === null) throw new Error("cooking.video.edit.save requires params.decision.");
    return saveReviewEdit(store, jobId, requiredRevision(params), params.decision as EditDecision);
  }
  if (type === "cooking.video.review.submit") {
    const verdict = requiredString(params, "verdict") as ReviewRecord["verdict"];
    if (!["approved", "changes_requested", "rejected"].includes(verdict)) throw new Error(`Unsupported review verdict: ${verdict}.`);
    return submitReview(store, jobId, requiredRevision(params), verdict, {
      ...(typeof params.note === "string" ? { note: params.note } : {}),
      ...(typeof params.reviewer === "string" ? { reviewer: params.reviewer } : {}),
    });
  }
  if (type === "cooking.video.rerender") {
    const workspace = await loadReviewWorkspace(store, jobId);
    if (workspace.review.verdict !== "approved") throw new Error("Approve the current EDL revision before rendering.");
    await prepareReviewRerender(store, jobId);
    return runJobPipeline(store, jobId, { approved: true, draft: params.draft === true });
  }
  if (type === "cooking.video.preview.read") {
    const workspace = await loadReviewWorkspace(store, jobId);
    if (!workspace.previewPath) return { dataUrl: undefined };
    const paths = store.paths(jobId);
    const previewPath = await resolveExistingWithin(paths.root, path.relative(paths.root, workspace.previewPath));
    const outputRelative = path.relative(paths.output, previewPath);
    if (outputRelative.startsWith("..") || path.isAbsolute(outputRelative) || path.extname(previewPath).toLowerCase() !== ".mp4") {
      throw new Error("Preview artifact must be an MP4 inside the job output directory.");
    }
    const info = await stat(previewPath);
    if (info.size > MAX_PREVIEW_BYTES) throw new Error("Preview exceeds the 64 MB RPC preview limit.");
    const contents = await readFile(previewPath);
    return { dataUrl: `data:video/mp4;base64,${contents.toString("base64")}`, fileName: path.basename(previewPath) };
  }
  throw new Error(`Unsupported cooking video RPC: ${type}.`);
}
