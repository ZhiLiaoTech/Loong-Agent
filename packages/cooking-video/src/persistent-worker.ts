import { createHash } from "node:crypto";
import { CookingVideoError } from "./errors.js";
import { JobStore } from "./job-store.js";
import { PersistentCookingVideoQueue, type PersistentWorkerTask } from "./persistent-queue.js";
import { executeCookingVideoWorkerTask, type CookingVideoWorkerResult, type CookingVideoWorkerRole } from "./worker-runtime.js";
import type { RunJobOptions } from "./job-runner.js";

export interface PersistentWorkerRunOptions {
  jobOptions?: RunJobOptions;
  renewEveryMs?: number;
  executor?: typeof executeCookingVideoWorkerTask;
}

function retryable(error: unknown): boolean {
  if (!(error instanceof CookingVideoError)) return true;
  return !["JOB_INVALID", "JOB_STATE_INVALID", "PATH_OUTSIDE_JOB", "MEDIA_UNREADABLE", "MEDIA_TOOL_MISSING", "APPROVAL_REQUIRED", "QUEUE_TASK_INVALID"].includes(error.code);
}

export async function runPersistentWorkerOnce(queue: PersistentCookingVideoQueue, store: JobStore, role: CookingVideoWorkerRole, workerId: string, options: PersistentWorkerRunOptions = {}): Promise<{ queueItem: PersistentWorkerTask; result?: CookingVideoWorkerResult } | undefined> {
  const claimed = await queue.claim(role, workerId);
  if (!claimed) return undefined;
  const executor = options.executor ?? executeCookingVideoWorkerTask;
  let renewalError: unknown;
  let renewal = Promise.resolve();
  const interval = setInterval(() => {
    renewal = renewal.then(() => queue.renew(claimed.queueTaskId, workerId, claimed.leaseToken!).then(() => undefined)).catch(error => { renewalError = error; });
  }, options.renewEveryMs ?? 20_000);
  interval.unref();
  try {
    const result = await executor(store, role, claimed.task, options.jobOptions);
    clearInterval(interval);
    await renewal;
    if (renewalError) throw renewalError;
    const digest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
    const queueItem = await queue.complete(claimed.queueTaskId, workerId, claimed.leaseToken!, digest);
    return { queueItem, result };
  } catch (error) {
    if (error instanceof CookingVideoError && error.code === "QUEUE_LEASE_LOST") throw error;
    const queueItem = await queue.fail(claimed.queueTaskId, workerId, claimed.leaseToken!, error instanceof CookingVideoError ? error.code : "UNEXPECTED", retryable(error));
    return { queueItem };
  } finally {
    clearInterval(interval);
  }
}
