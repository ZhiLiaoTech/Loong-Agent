import { randomUUID } from "node:crypto";
import path from "node:path";
import { JobStore, type JobStoreEvent } from "./job-store.js";
import { runJobPipeline, type RunJobOptions, type RunJobResult } from "./job-runner.js";
import type { JobStage } from "./types.js";

export type CookingVideoQueueStatus = "queued" | "running" | "cancelling" | "awaiting_review" | "completed" | "failed" | "cancelled";

export interface CookingVideoQueueItem {
  queueId: string;
  jobsRoot: string;
  jobId: string;
  status: CookingVideoQueueStatus;
  position: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  stage?: JobStage;
  error?: string;
  options: Pick<RunJobOptions, "approved" | "draft" | "allowAlignedStart" | "referenceCameraId" | "manualOffsets" | "template">;
}

export interface CookingVideoQueueEvent {
  phase: "queued" | "started" | "stage" | "completed" | "failed" | "cancelled";
  item: CookingVideoQueueItem;
  transition?: JobStoreEvent;
}

export interface CookingVideoQueueOptions {
  concurrency?: number;
  runner?: (store: JobStore, jobId: string, options: RunJobOptions) => Promise<RunJobResult>;
  onEvent?: (event: CookingVideoQueueEvent) => void;
}

interface InternalItem extends CookingVideoQueueItem { controller?: AbortController }

function clampConcurrency(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || value < 1 || value > 8) throw new Error("Cooking video concurrency must be an integer from 1 to 8.");
  return value;
}

export class CookingVideoQueue {
  readonly concurrency: number;
  readonly #runner: NonNullable<CookingVideoQueueOptions["runner"]>;
  readonly #onEvent: ((event: CookingVideoQueueEvent) => void) | undefined;
  readonly #items: InternalItem[] = [];
  #active = 0;

  constructor(options: CookingVideoQueueOptions = {}) {
    this.concurrency = clampConcurrency(options.concurrency);
    this.#runner = options.runner ?? runJobPipeline;
    this.#onEvent = options.onEvent;
  }

  list(): CookingVideoQueueItem[] {
    this.#refreshPositions();
    return this.#items.map(item => this.#snapshot(item));
  }

  enqueue(input: { jobsRoot: string; jobId: string; options?: RunJobOptions }, now = new Date()): CookingVideoQueueItem {
    const jobsRoot = path.resolve(input.jobsRoot);
    const existing = this.#items.find(item => item.jobsRoot === jobsRoot && item.jobId === input.jobId && ["queued", "running", "cancelling"].includes(item.status));
    if (existing) return this.#snapshot(existing);
    if (this.#items.length >= 200) {
      const removable = this.#items.findIndex(item => ["awaiting_review", "completed", "failed", "cancelled"].includes(item.status));
      if (removable >= 0) this.#items.splice(removable, 1);
      else throw new Error("Cooking video queue limit of 200 active items has been reached.");
    }
    const item: InternalItem = {
      queueId: randomUUID(), jobsRoot, jobId: input.jobId, status: "queued", position: 0,
      createdAt: now.toISOString(), options: {
        ...(input.options?.approved !== undefined ? { approved: input.options.approved } : {}),
        ...(input.options?.draft !== undefined ? { draft: input.options.draft } : {}),
        ...(input.options?.allowAlignedStart !== undefined ? { allowAlignedStart: input.options.allowAlignedStart } : {}),
        ...(input.options?.referenceCameraId ? { referenceCameraId: input.options.referenceCameraId } : {}),
        ...(input.options?.manualOffsets ? { manualOffsets: { ...input.options.manualOffsets } } : {}),
        ...(input.options?.template ? { template: input.options.template } : {}),
      },
    };
    this.#items.push(item);
    this.#refreshPositions();
    this.#emit("queued", item);
    queueMicrotask(() => this.#drain());
    return this.#snapshot(item);
  }

  cancel(queueId: string): CookingVideoQueueItem {
    const item = this.#items.find(candidate => candidate.queueId === queueId);
    if (!item) throw new Error(`Unknown cooking video queue item: ${queueId}.`);
    if (item.status === "queued") {
      item.status = "cancelled"; item.completedAt = new Date().toISOString();
      this.#refreshPositions(); this.#emit("cancelled", item);
    } else if (item.status === "running") {
      item.status = "cancelling"; item.controller?.abort("Cancelled from cooking video queue.");
    }
    return this.#snapshot(item);
  }

  async waitForIdle(): Promise<void> {
    while (this.#active > 0 || this.#items.some(item => item.status === "queued")) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }

  #drain(): void {
    while (this.#active < this.concurrency) {
      const item = this.#items.find(candidate => candidate.status === "queued");
      if (!item) break;
      this.#start(item);
    }
    this.#refreshPositions();
  }

  #start(item: InternalItem): void {
    this.#active += 1;
    item.status = "running"; item.position = 0; item.startedAt = new Date().toISOString();
    item.controller = new AbortController();
    this.#emit("started", item);
    const store = new JobStore(item.jobsRoot, { onEvent: transition => {
      if (transition.type === "job.transition" && typeof transition.to === "string") item.stage = transition.to as JobStage;
      this.#emit("stage", item, transition);
    }});
    void this.#runner(store, item.jobId, { ...item.options, signal: item.controller.signal }).then(result => {
      item.status = result.stoppedForApproval ? "awaiting_review" : "completed";
      item.stage = result.state.status;
      item.completedAt = new Date().toISOString();
      this.#emit("completed", item);
    }).catch(error => {
      item.status = item.controller?.signal.aborted ? "cancelled" : "failed";
      item.completedAt = new Date().toISOString();
      item.error = error instanceof Error ? error.message : String(error);
      this.#emit(item.status === "cancelled" ? "cancelled" : "failed", item);
    }).finally(() => {
      item.controller = undefined; this.#active -= 1; this.#drain();
    });
  }

  #refreshPositions(): void {
    let position = 0;
    for (const item of this.#items) item.position = item.status === "queued" ? ++position : 0;
  }

  #snapshot(item: InternalItem): CookingVideoQueueItem {
    const { controller: _controller, ...snapshot } = item;
    return structuredClone(snapshot);
  }

  #emit(phase: CookingVideoQueueEvent["phase"], item: InternalItem, transition?: JobStoreEvent): void {
    try { this.#onEvent?.({ phase, item: this.#snapshot(item), ...(transition ? { transition: structuredClone(transition) } : {}) }); } catch { /* observers are isolated */ }
  }
}
