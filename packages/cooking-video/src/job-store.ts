import { appendFile, mkdir, stat } from "node:fs/promises";
import { CookingVideoError } from "./errors.js";
import { readJsonFile, writeJsonAtomic } from "./json-files.js";
import { jobPaths, type JobPaths } from "./paths.js";
import { JOB_STAGES, type CookingVideoJob, type JobStage, type JobState, type StageRecord } from "./types.js";
import { validateJob } from "./validation.js";

const ALLOWED_TRANSITIONS: Record<JobStage, readonly JobStage[]> = {
  created: ["ingesting", "cancelled"],
  ingesting: ["ingested", "failed", "cancelled"],
  ingested: ["syncing", "ingesting", "cancelled"],
  syncing: ["synced", "failed", "cancelled"],
  synced: ["analyzing", "syncing", "cancelled"],
  analyzing: ["analyzed", "failed", "cancelled"],
  analyzed: ["selecting", "analyzing", "cancelled"],
  selecting: ["selected", "failed", "cancelled"],
  selected: ["editing", "selecting", "cancelled"],
  editing: ["awaiting_review", "rendering", "failed", "cancelled"],
  awaiting_review: ["editing", "rendering", "cancelled"],
  rendering: ["validating", "failed", "cancelled"],
  validating: ["completed", "failed", "editing", "rendering", "cancelled"],
  completed: ["ingesting", "editing", "rendering"],
  failed: ["ingesting", "syncing", "analyzing", "selecting", "editing", "rendering", "validating", "cancelled"],
  cancelled: [],
};

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class JobStore {
  readonly jobsRoot: string;

  constructor(jobsRoot: string) {
    this.jobsRoot = jobsRoot;
  }

  paths(jobId: string): JobPaths {
    return jobPaths(this.jobsRoot, jobId);
  }

  async create(rawJob: unknown, now = new Date()): Promise<{ job: CookingVideoJob; state: JobState; paths: JobPaths }> {
    const job = validateJob(rawJob);
    const paths = this.paths(job.jobId);
    if (await exists(paths.root)) {
      throw new CookingVideoError("JOB_EXISTS", `Job already exists: ${job.jobId}.`);
    }
    await Promise.all([
      paths.input,
      paths.proxy,
      paths.frames,
      paths.analysis,
      paths.edit,
      paths.output,
      paths.state,
    ].map(directory => mkdir(directory, { recursive: true })));
    const timestamp = now.toISOString();
    const state: JobState = {
      schemaVersion: "1.0",
      jobId: job.jobId,
      status: "created",
      createdAt: timestamp,
      updatedAt: timestamp,
      stages: [],
    };
    await writeJsonAtomic(paths.jobFile, job);
    await writeJsonAtomic(paths.stateFile, state);
    await this.appendEvent(paths, { type: "job.created", at: timestamp, jobId: job.jobId });
    return { job, state, paths };
  }

  async load(jobId: string): Promise<{ job: CookingVideoJob; state: JobState; paths: JobPaths }> {
    const paths = this.paths(jobId);
    try {
      const [rawJob, state] = await Promise.all([
        readJsonFile<unknown>(paths.jobFile),
        readJsonFile<JobState>(paths.stateFile),
      ]);
      const job = validateJob(rawJob);
      if (state.jobId !== jobId || !JOB_STAGES.includes(state.status)) {
        throw new CookingVideoError("JOB_STATE_INVALID", `Invalid state for job ${jobId}.`);
      }
      return { job, state, paths };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new CookingVideoError("JOB_NOT_FOUND", `Job not found: ${jobId}.`);
      }
      throw error;
    }
  }

  async transition(
    jobId: string,
    next: JobStage,
    details: Partial<Omit<StageRecord, "stage" | "status" | "attempt" | "startedAt">> = {},
    now = new Date(),
  ): Promise<JobState> {
    const loaded = await this.load(jobId);
    if (!ALLOWED_TRANSITIONS[loaded.state.status].includes(next)) {
      throw new CookingVideoError("JOB_STATE_INVALID", `Cannot transition ${loaded.state.status} -> ${next}.`);
    }
    const timestamp = now.toISOString();
    const terminal = next === "failed" || next === "cancelled";
    const previousAttempts = loaded.state.stages.filter(record => record.stage === next).length;
    const stages = loaded.state.stages.map(record => {
      if (record.status !== "running") return record;
      const status = next === "failed" ? "failed" : next === "cancelled" ? "cancelled" : "completed";
      return {
        ...record,
        status,
        completedAt: timestamp,
        ...(terminal ? details : {}),
      } satisfies StageRecord;
    });
    const record: StageRecord = {
      stage: next,
      status: terminal ? next : next.endsWith("ing") ? "running" : "completed",
      attempt: previousAttempts + 1,
      startedAt: timestamp,
      ...(next.endsWith("ing") ? {} : { completedAt: timestamp }),
      ...details,
    };
    const state: JobState = {
      ...loaded.state,
      status: next,
      updatedAt: timestamp,
      inputDigest: details.inputDigest ?? loaded.state.inputDigest,
      stages: [...stages, record],
    };
    await writeJsonAtomic(loaded.paths.stateFile, state);
    await this.appendEvent(loaded.paths, { type: "job.transition", at: timestamp, from: loaded.state.status, to: next });
    return state;
  }

  private async appendEvent(paths: JobPaths, event: Record<string, unknown>): Promise<void> {
    await appendFile(paths.eventsFile, `${JSON.stringify(event)}\n`, "utf8");
  }
}
