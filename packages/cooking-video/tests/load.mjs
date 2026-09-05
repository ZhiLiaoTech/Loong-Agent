import { performance } from "node:perf_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JobStore, PersistentCookingVideoQueue, planNextWorkerTask, runPersistentWorkerOnce } from "../dist/index.js";

function intArg(name, fallback, min, max) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? fallback : Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

const taskCount = intArg("--tasks", 100, 1, 10_000);
const workers = intArg("--workers", 4, 1, 64);
const rounds = intArg("--rounds", 3, 1, 10_000);
const soakSeconds = intArg("--soak-seconds", 0, 0, 86_400);
const maxErrorRate = Number(process.env.LOONG_LOAD_MAX_ERROR_RATE ?? "0");
const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-load-"));
const durations = [];
let errors = 0;
let attempted = 0;
const errorCodes = {};
const errorSamples = [];
const startedAt = new Date().toISOString();
const started = performance.now();

try {
  const queue = new PersistentCookingVideoQueue(path.join(root, "queue"));
  const store = new JobStore(path.join(root, "jobs"));
  for (let round = 0; round < rounds || (soakSeconds > 0 && performance.now() - started < soakSeconds * 1000); round += 1) {
    for (let index = 0; index < taskCount; index += 1) {
      const id = `load-${round}-${index}`;
      await queue.enqueue(planNextWorkerTask(id, "created", `task-${id}`), `${id}/ingest/v1`);
      attempted += 1;
    }
    await Promise.all(Array.from({ length: workers }, async (_, workerIndex) => {
      for (;;) {
        const taskStarted = performance.now();
        const consumed = await runPersistentWorkerOnce(queue, store, "media", `load-worker-${workerIndex}`, {
          executor: async (_store, role, task) => ({ taskId: task.taskId, jobId: task.jobId, role, action: task.action, state: { schemaVersion: "1.0", jobId: task.jobId, status: "ingested", createdAt: "", updatedAt: "", stages: [] } }),
        }).catch(error => {
          errors += 1;
          const code = typeof error?.code === "string" ? error.code : error?.name ?? "UNKNOWN";
          errorCodes[code] = (errorCodes[code] ?? 0) + 1;
          if (errorSamples.length < 5) errorSamples.push({ code, message: error?.message, stack: error?.stack?.split("\n").slice(0, 3) });
          return undefined;
        });
        if (!consumed) break;
        durations.push(performance.now() - taskStarted);
      }
    }));
  }
  durations.sort((a, b) => a - b);
  const elapsedMs = performance.now() - started;
  const completed = (await queue.list("completed")).length;
  const percentile = value => durations[Math.min(durations.length - 1, Math.floor(durations.length * value))] ?? 0;
  const report = {
    schemaVersion: "1.0",
    startedAt,
    completedAt: new Date().toISOString(),
    configuration: { taskCount, workers, rounds, soakSeconds },
    results: { attempted, completed, errors, errorCodes, errorSamples, errorRate: errors / attempted, elapsedMs: Math.round(elapsedMs), throughputPerSecond: Number((completed / (elapsedMs / 1000)).toFixed(2)), latencyMs: { p50: Number(percentile(0.5).toFixed(2)), p95: Number(percentile(0.95).toFixed(2)), max: Number((durations.at(-1) ?? 0).toFixed(2)) } },
    memory: { rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (completed !== attempted || report.results.errorRate > maxErrorRate) process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
