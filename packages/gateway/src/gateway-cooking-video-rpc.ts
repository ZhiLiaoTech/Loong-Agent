import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  CookingVideoQueue,
  JobStore,
  listReviewJobs,
  loadReviewWorkspace,
  prepareReviewRerender,
  saveReviewEdit,
  submitReview,
  resolveExistingWithin,
  type EditDecision,
  type ReviewRecord,
  type CookingVideoQueueEvent,
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

export interface CookingVideoGatewayServiceOptions {
  concurrency?: number;
  onQueueEvent?: (event: CookingVideoQueueEvent) => void;
}

export class CookingVideoGatewayService {
  readonly #queue: CookingVideoQueue;

  constructor(options: CookingVideoGatewayServiceOptions = {}) {
    this.#queue = new CookingVideoQueue({
      ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
      ...(options.onQueueEvent !== undefined ? { onEvent: options.onQueueEvent } : {}),
    });
  }

  async handle(type: string, params: Record<string, unknown>): Promise<unknown> {
    if (type === "cooking.video.queue.list") {
      const root = typeof params.jobsRoot === "string" && params.jobsRoot.trim() ? path.resolve(params.jobsRoot.trim()) : undefined;
      return { concurrency: this.#queue.concurrency, items: this.#queue.list().filter(item => root === undefined || item.jobsRoot === root) };
    }
    if (type === "cooking.video.queue.cancel") return this.#queue.cancel(requiredString(params, "queueId"));

    const store = storeFor(params);
    if (type === "cooking.video.jobs.list") return { jobs: await listReviewJobs(store) };
    const jobId = requiredString(params, "jobId");
    if (type === "cooking.video.queue.enqueue") {
      await store.load(jobId);
      return this.#queue.enqueue({ jobsRoot: store.jobsRoot, jobId, options: {
        approved: params.approved === true,
        draft: params.draft === true,
        allowAlignedStart: params.allowAlignedStart === true,
      }});
    }
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
      return this.#queue.enqueue({ jobsRoot: store.jobsRoot, jobId, options: { approved: true, draft: params.draft === true } });
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
}
