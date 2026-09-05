import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { CookingVideoError } from "./errors.js";
import { readJsonFile, writeJsonAtomic } from "./json-files.js";
import { resolveWithin } from "./paths.js";
import type { CookingVideoWorkerRole, CookingVideoWorkerTask } from "./worker-runtime.js";

export type PersistentTaskStatus = "queued" | "running" | "retry_wait" | "completed" | "dead_letter";

export interface PersistentWorkerTask {
  schemaVersion: "1.0";
  queueTaskId: string;
  idempotencyKey: string;
  task: CookingVideoWorkerTask;
  status: PersistentTaskStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  createdAt: string;
  updatedAt: string;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  completedAt?: string;
  resultDigest?: string;
  lastErrorCode?: string;
}

export interface PersistentQueueOptions {
  leaseMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  maxAttempts?: number;
}

const SAFE_WORKER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function iso(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new CookingVideoError("QUEUE_TASK_INVALID", "Queue time is invalid.");
  return value.toISOString();
}

function validateInt(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new CookingVideoError("QUEUE_TASK_INVALID", `${label} must be an integer from ${min} to ${max}.`);
  return value;
}

export class PersistentCookingVideoQueue {
  readonly #root: string;
  readonly #leaseMs: number;
  readonly #retryBaseMs: number;
  readonly #retryMaxMs: number;
  readonly #maxAttempts: number;

  constructor(root: string, options: PersistentQueueOptions = {}) {
    this.#root = path.resolve(root);
    this.#leaseMs = validateInt(options.leaseMs ?? 60_000, 1_000, 3_600_000, "leaseMs");
    this.#retryBaseMs = validateInt(options.retryBaseMs ?? 5_000, 100, 3_600_000, "retryBaseMs");
    this.#retryMaxMs = validateInt(options.retryMaxMs ?? 300_000, this.#retryBaseMs, 86_400_000, "retryMaxMs");
    this.#maxAttempts = validateInt(options.maxAttempts ?? 5, 1, 100, "maxAttempts");
  }

  async enqueue(task: CookingVideoWorkerTask, idempotencyKey: string, now = new Date()): Promise<PersistentWorkerTask> {
    if (!idempotencyKey || idempotencyKey.length > 512) throw new CookingVideoError("QUEUE_TASK_INVALID", "idempotencyKey is required and must not exceed 512 characters.");
    const queueTaskId = createHash("sha256").update(idempotencyKey).digest("hex");
    return this.#locked(queueTaskId, async () => {
      const existing = await this.#readOptional(queueTaskId);
      if (existing) {
        if (JSON.stringify(existing.task) !== JSON.stringify(task)) throw new CookingVideoError("QUEUE_TASK_INVALID", "Idempotency key was already used for a different task.");
        return existing;
      }
      const timestamp = iso(now);
      const item: PersistentWorkerTask = { schemaVersion: "1.0", queueTaskId, idempotencyKey, task: structuredClone(task), status: "queued", attempts: 0, maxAttempts: this.#maxAttempts, availableAt: timestamp, createdAt: timestamp, updatedAt: timestamp };
      await this.#save(item);
      return structuredClone(item);
    });
  }

  async claim(role: CookingVideoWorkerRole, workerId: string, now = new Date()): Promise<PersistentWorkerTask | undefined> {
    if (!SAFE_WORKER.test(workerId)) throw new CookingVideoError("QUEUE_TASK_INVALID", "workerId is invalid.");
    const items = await this.list();
    const candidates = items.filter(item => item.task.role === role && (["queued", "retry_wait"].includes(item.status) || (item.status === "running" && Date.parse(item.leaseExpiresAt ?? "") <= now.getTime()))).sort((a, b) => a.availableAt.localeCompare(b.availableAt) || a.createdAt.localeCompare(b.createdAt));
    for (const candidate of candidates) {
      let claimed: PersistentWorkerTask | undefined;
      try { claimed = await this.#locked(candidate.queueTaskId, async () => {
        const current = await this.#read(candidate.queueTaskId);
        const expired = current.status === "running" && Date.parse(current.leaseExpiresAt ?? "") <= now.getTime();
        if (expired && current.attempts >= current.maxAttempts) {
          current.status = "dead_letter";
          current.lastErrorCode = "LEASE_EXPIRED";
          current.updatedAt = iso(now);
          delete current.leaseOwner; delete current.leaseToken; delete current.leaseExpiresAt;
          await this.#save(current);
          return undefined;
        }
        if (current.task.role !== role || (!expired && !["queued", "retry_wait"].includes(current.status)) || Date.parse(current.availableAt) > now.getTime()) return undefined;
        current.status = "running";
        current.attempts += 1;
        current.leaseOwner = workerId;
        current.leaseToken = randomUUID();
        current.leaseExpiresAt = new Date(now.getTime() + this.#leaseMs).toISOString();
        current.updatedAt = iso(now);
        await this.#save(current);
        return structuredClone(current);
      }); } catch (error) {
        if (!(error instanceof CookingVideoError) || error.code !== "QUEUE_LEASE_LOST") throw error;
        continue;
      }
      if (claimed) return claimed;
    }
    return undefined;
  }

  async renew(queueTaskId: string, workerId: string, leaseToken: string, now = new Date()): Promise<PersistentWorkerTask> {
    return this.#mutateLease(queueTaskId, workerId, leaseToken, now, item => {
      item.leaseExpiresAt = new Date(now.getTime() + this.#leaseMs).toISOString();
      return item;
    });
  }

  async complete(queueTaskId: string, workerId: string, leaseToken: string, resultDigest: string, now = new Date()): Promise<PersistentWorkerTask> {
    if (!/^[a-f0-9]{64}$/.test(resultDigest)) throw new CookingVideoError("QUEUE_TASK_INVALID", "resultDigest must be a lowercase SHA-256 digest.");
    return this.#locked(queueTaskId, async () => {
      const item = await this.#read(queueTaskId);
      if (item.status === "completed" && item.resultDigest === resultDigest) return structuredClone(item);
      this.#assertLease(item, workerId, leaseToken, now);
      item.status = "completed"; item.resultDigest = resultDigest; item.completedAt = iso(now); item.updatedAt = iso(now);
      delete item.leaseOwner; delete item.leaseToken; delete item.leaseExpiresAt;
      await this.#save(item);
      return structuredClone(item);
    });
  }

  async fail(queueTaskId: string, workerId: string, leaseToken: string, errorCode: string, retryable: boolean, now = new Date()): Promise<PersistentWorkerTask> {
    return this.#mutateLease(queueTaskId, workerId, leaseToken, now, item => {
      item.lastErrorCode = errorCode.slice(0, 128);
      if (!retryable || item.attempts >= item.maxAttempts) {
        item.status = "dead_letter";
      } else {
        item.status = "retry_wait";
        const delay = Math.min(this.#retryMaxMs, this.#retryBaseMs * 2 ** Math.max(0, item.attempts - 1));
        item.availableAt = new Date(now.getTime() + delay).toISOString();
      }
      delete item.leaseOwner; delete item.leaseToken; delete item.leaseExpiresAt;
      return item;
    });
  }

  async requeueDeadLetter(queueTaskId: string, now = new Date()): Promise<PersistentWorkerTask> {
    return this.#locked(queueTaskId, async () => {
      const item = await this.#read(queueTaskId);
      if (item.status !== "dead_letter") throw new CookingVideoError("QUEUE_TASK_INVALID", "Only dead-letter tasks can be requeued.");
      item.status = "queued"; item.attempts = 0; item.availableAt = iso(now); item.updatedAt = iso(now); delete item.lastErrorCode;
      await this.#save(item);
      return structuredClone(item);
    });
  }

  async list(status?: PersistentTaskStatus): Promise<PersistentWorkerTask[]> {
    await mkdir(this.#tasksRoot(), { recursive: true });
    const names = (await readdir(this.#tasksRoot())).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    const items = await Promise.all(names.map(name => this.#read(name.slice(0, -5))));
    return items.filter(item => status === undefined || item.status === status).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async #mutateLease(queueTaskId: string, workerId: string, leaseToken: string, now: Date, change: (item: PersistentWorkerTask) => PersistentWorkerTask): Promise<PersistentWorkerTask> {
    return this.#locked(queueTaskId, async () => {
      const item = await this.#read(queueTaskId);
      this.#assertLease(item, workerId, leaseToken, now);
      const changed = change(item); changed.updatedAt = iso(now); await this.#save(changed); return structuredClone(changed);
    });
  }

  #assertLease(item: PersistentWorkerTask, workerId: string, leaseToken: string, now: Date): void {
    if (item.status !== "running" || item.leaseOwner !== workerId || item.leaseToken !== leaseToken || Date.parse(item.leaseExpiresAt ?? "") <= now.getTime()) throw new CookingVideoError("QUEUE_LEASE_LOST", "Worker lease is missing, expired, or owned by another worker.");
  }

  #tasksRoot(): string { return resolveWithin(this.#root, "tasks"); }
  #file(id: string): string {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new CookingVideoError("QUEUE_TASK_INVALID", "queueTaskId is invalid.");
    return resolveWithin(this.#tasksRoot(), `${id}.json`);
  }
  async #read(id: string): Promise<PersistentWorkerTask> { return readJsonFile<PersistentWorkerTask>(this.#file(id)); }
  async #readOptional(id: string): Promise<PersistentWorkerTask | undefined> { try { return await this.#read(id); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
  async #save(item: PersistentWorkerTask): Promise<void> { await writeJsonAtomic(this.#file(item.queueTaskId), item); }
  async #locked<T>(id: string, operation: () => Promise<T>, allowStaleRecovery = true): Promise<T> {
    await mkdir(this.#tasksRoot(), { recursive: true });
    const lockFile = resolveWithin(this.#tasksRoot(), `${id}.lock`);
    let handle;
    try { handle = await open(lockFile, "wx"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        if (allowStaleRecovery) {
          const metadata = await stat(lockFile).catch(() => undefined);
          if (metadata && Date.now() - metadata.mtimeMs > 30_000) {
            await rm(lockFile, { force: true });
            return this.#locked(id, operation, false);
          }
        }
        throw new CookingVideoError("QUEUE_LEASE_LOST", "Queue task is being modified by another process.");
      }
      throw error;
    }
    try { return await operation(); } finally { await handle.close(); await rm(lockFile, { force: true }); }
  }
}
