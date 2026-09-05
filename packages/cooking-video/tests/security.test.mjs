import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTenantObjectKey, CookingVideoError, parseFfprobePayload, resolveWithin, runProcess } from "../dist/index.js";

test("security: rejects traversal in local and object-storage paths", () => {
  assert.throws(() => resolveWithin(path.resolve("safe-root"), "../escape.mp4"), error => error instanceof CookingVideoError && error.code === "PATH_OUTSIDE_JOB");
  assert.throws(() => buildTenantObjectKey({ tenantId: "tenant-a", jobId: "job-a", assetId: "source", fileName: "..\\escape.mp4" }), error => error instanceof CookingVideoError && error.code === "UPLOAD_INVALID");
});

test("security: rejects hostile ffprobe sizes, stream counts, and durations", () => {
  const video = overrides => JSON.stringify({ format: { duration: "10", ...overrides.format }, streams: [{ codec_type: "video", width: 1920, height: 1080, avg_frame_rate: "30/1", ...overrides.stream }] });
  assert.throws(() => parseFfprobePayload(video({ stream: { width: 1_000_000 } })), error => error instanceof CookingVideoError && error.code === "MEDIA_UNREADABLE");
  assert.throws(() => parseFfprobePayload(video({ stream: { avg_frame_rate: "1000/1" } })), error => error instanceof CookingVideoError && error.code === "MEDIA_UNREADABLE");
  assert.throws(() => parseFfprobePayload(video({ format: { duration: "999999999999" } })), error => error instanceof CookingVideoError && error.code === "MEDIA_UNREADABLE");
  assert.throws(() => parseFfprobePayload(JSON.stringify({ format: { duration: "10" }, streams: Array.from({ length: 65 }, () => ({ codec_type: "video" })) })), error => error instanceof CookingVideoError && error.code === "MEDIA_UNREADABLE");
});

test("security: process arguments never receive shell interpretation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cooking-injection-"));
  const marker = path.join(root, "must-not-exist.txt");
  try {
    const payload = `;require('node:fs').writeFileSync(${JSON.stringify(marker)},'owned')`;
    const result = await runProcess(process.execPath, ["-e", "process.stdout.write(process.argv[1])", payload]);
    assert.equal(result.stdout, payload);
    await assert.rejects(() => stat(marker), error => error.code === "ENOENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("security: terminates tools that emit excessive output", async () => {
  await assert.rejects(() => runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(65536))"], { maxOutputBytes: 1024 }), error => error instanceof CookingVideoError && error.code === "PROCESS_FAILED");
});
