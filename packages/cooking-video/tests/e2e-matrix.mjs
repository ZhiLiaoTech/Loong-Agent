import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { processInbox, scanInbox } from "../dist/index.js";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-e2e-matrix-"));
const inbox = path.join(root, "inbox");
const jobs = path.join(root, "jobs");
const colors = ["red", "blue", "green", "orange"];

async function createVideo(file, index, withAudio = true) {
  const args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${colors[index]}:s=320x240:r=15:d=4`];
  if (withAudio) args.push("-f", "lavfi", "-i", `sine=frequency=${440 + index * 110}:duration=4`, "-shortest");
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (withAudio) args.push("-c:a", "aac");
  args.push(file);
  await execFileAsync("ffmpeg", args, { windowsHide: true });
}

try {
  await execFileAsync("ffmpeg", ["-version"], { windowsHide: true });
  for (const count of [2, 3, 4]) {
    const batchId = `matrix-${count}-camera`;
    const batch = path.join(inbox, batchId);
    await mkdir(batch, { recursive: true });
    await Promise.all(Array.from({ length: count }, (_, index) => createVideo(path.join(batch, `${index === 0 ? "top" : index === 1 ? "front" : `side-${index}`}.mp4`), index, !(count === 3 && index === 2))));
    await writeFile(path.join(batch, "_READY"), "");
    const first = await processInbox(inbox, jobs, { batchId, allowAlignedStart: true, template: "15s", draft: true });
    assert.equal(first.processed[0]?.status, "awaiting_review", JSON.stringify(first.failed));
    const approved = await processInbox(inbox, jobs, { batchId, allowAlignedStart: true, template: "15s", draft: true, approved: true });
    assert.equal(approved.processed[0]?.status, "completed");
    assert.deepEqual(approved.failed, []);
  }

  const incomplete = path.join(inbox, "missing-camera");
  await mkdir(incomplete, { recursive: true });
  await Promise.all([writeFile(path.join(incomplete, "top.mp4"), "not-enough"), writeFile(path.join(incomplete, "_READY"), "")]);
  const incompleteScan = await scanInbox(inbox, jobs, { batchId: "missing-camera" });
  assert.equal(incompleteScan[0]?.status, "invalid");

  const damaged = path.join(inbox, "damaged-camera");
  await mkdir(damaged, { recursive: true });
  await Promise.all([writeFile(path.join(damaged, "top.mp4"), "damaged"), writeFile(path.join(damaged, "front.mp4"), "damaged"), writeFile(path.join(damaged, "_READY"), "")]);
  const damagedResult = await processInbox(inbox, jobs, { batchId: "damaged-camera", allowAlignedStart: true, draft: true });
  assert.equal(damagedResult.failed.length, 1);
  assert.match(damagedResult.failed[0].errorCode, /PROCESS_FAILED|MEDIA_UNREADABLE/);

  process.stdout.write("ok - 2/3/4 camera, no-audio, missing, and damaged fixtures passed\n");
} finally {
  await rm(root, { recursive: true, force: true });
}
