import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { JobStore, processInbox, runJobPipeline } from "../dist/index.js";
import fixtureJob from "./fixtures/job.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-real-e2e-"));

try {
  await execFileAsync("ffmpeg", ["-version"], { windowsHide: true });
  const jobsRoot = path.join(root, "jobs");
  const inbox = path.join(root, "inbox");
  const batch = path.join(inbox, fixtureJob.jobId);
  await mkdir(batch, { recursive: true });
  const store = new JobStore(jobsRoot);
  await Promise.all([
    execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=4",
      "-f", "lavfi", "-i", "sine=frequency=880:duration=4", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
      path.join(batch, "top.mp4"),
    ], { windowsHide: true }),
    execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "smptebars=size=1280x720:rate=30:duration=4",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
      path.join(batch, "front.mp4"),
    ], { windowsHide: true }),
  ]);
  await writeFile(path.join(batch, "_READY"), "");
  const intake = await processInbox(inbox, jobsRoot, {
    batchId: fixtureJob.jobId,
    referenceCameraId: "front",
    allowAlignedStart: true,
    template: "15s",
    draft: true,
  });
  assert.equal(intake.consumed.length, 1);
  assert.equal(intake.processed[0]?.status, "awaiting_review");
  assert.equal(intake.processed[0]?.stoppedForApproval, true);
  assert.deepEqual(intake.failed, []);
  const approved = await processInbox(inbox, jobsRoot, {
    batchId: fixtureJob.jobId,
    referenceCameraId: "front",
    allowAlignedStart: true,
    template: "15s",
    approved: true,
    draft: true,
  });
  assert.equal(approved.processed[0]?.status, "completed");
  assert.deepEqual(approved.failed, []);
  const created = await store.load(fixtureJob.jobId);
  const syncMap = JSON.parse(await readFile(path.join(created.paths.analysis, "sync-map.json"), "utf8"));
  assert.equal(syncMap.method, "aligned_start");
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
