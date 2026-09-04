import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { JobStore, runJobPipeline } from "../dist/index.js";
import fixtureJob from "./fixtures/job.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-real-e2e-"));

try {
  await execFileAsync("ffmpeg", ["-version"], { windowsHide: true });
  const store = new JobStore(root);
  const created = await store.create(fixtureJob);
  await copyFile(path.join(testDir, "fixtures", "machine-events.jsonl"), path.join(created.paths.input, "machine-events.jsonl"));
  await Promise.all([
    execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=4",
      "-f", "lavfi", "-i", "sine=frequency=880:duration=4", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
      path.join(created.paths.input, "top.mp4"),
    ], { windowsHide: true }),
    execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "smptebars=size=1280x720:rate=30:duration=4",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
      path.join(created.paths.input, "front.mp4"),
    ], { windowsHide: true }),
  ]);
  const result = await runJobPipeline(store, fixtureJob.jobId, {
    referenceCameraId: "front",
    manualOffsets: { front: 100, top: 420 },
    template: "15s",
    approved: true,
    draft: true,
  });
  assert.equal(result.state.status, "completed");
  const loaded = await store.load(fixtureJob.jobId);
  assert.equal(loaded.state.stages.some(stage => stage.status === "running"), false);
  const cached = await runJobPipeline(store, fixtureJob.jobId, {
    referenceCameraId: "front",
    manualOffsets: { front: 100, top: 420 },
    template: "15s",
    approved: true,
    draft: true,
  });
  assert.equal(cached.state.stages.length, loaded.state.stages.length, "unchanged inputs should reuse the completed job");

  const cancelledJob = { ...fixtureJob, jobId: "synthetic-cancelled" };
  const cancelledCreated = await store.create(cancelledJob);
  await Promise.all([
    copyFile(path.join(created.paths.input, "top.mp4"), path.join(cancelledCreated.paths.input, "top.mp4")),
    copyFile(path.join(created.paths.input, "front.mp4"), path.join(cancelledCreated.paths.input, "front.mp4")),
    copyFile(path.join(testDir, "fixtures", "machine-events.jsonl"), path.join(cancelledCreated.paths.input, "machine-events.jsonl")),
  ]);
  const controller = new AbortController();
  controller.abort(new Error("fixture cancellation"));
  await assert.rejects(
    () => runJobPipeline(store, cancelledJob.jobId, { signal: controller.signal }),
    error => error.code === "JOB_CANCELLED",
  );
  assert.equal((await store.load(cancelledJob.jobId)).state.status, "cancelled");
  process.stdout.write(`ok - real ffmpeg pipeline completed in ${root}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
