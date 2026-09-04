import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CookingVideoError,
  computeJobInputDigest,
  JobStore,
  buildSyncMap,
  buildRenderArgs,
  captionsToSrt,
  createEditDecision,
  deduplicateEvidenceFiles,
  detectMachineEvents,
  estimateEnvelopeOffset,
  ingestMedia,
  importVisionDetections,
  parseMachineEvents,
  parseMotionSamples,
  parseSceneCutTimes,
  prepareVisionEvidence,
  parseFfprobePayload,
  resolveWithin,
  reviewVideo,
  runProcess,
  sanitizeCaption,
  selectShots,
  validateJob,
} from "../dist/index.js";

function sampleJob(jobId = "cook-001") {
  return {
    schemaVersion: "1.0",
    jobId,
    sources: [
      { cameraId: "top", path: "input/top.mp4", role: "food_closeup" },
      { cameraId: "front", path: "input/front.mp4", role: "machine_full" },
    ],
    brief: {
      formats: [{ aspectRatio: "9:16", durationSec: 30 }],
      requireHumanApproval: true,
    },
  };
}

test("validates a minimal two-camera job", () => {
  assert.equal(validateJob(sampleJob()).jobId, "cook-001");
});

test("rejects unsafe source paths and duplicate cameras", () => {
  const unsafe = sampleJob();
  unsafe.sources[0].path = "../secret.mp4";
  assert.throws(() => validateJob(unsafe), error => error instanceof CookingVideoError && error.code === "JOB_INVALID");

  const duplicate = sampleJob();
  duplicate.sources[1].cameraId = "top";
  assert.throws(() => validateJob(duplicate), error => error instanceof CookingVideoError && error.code === "JOB_INVALID");
});

test("resolveWithin blocks path traversal", () => {
  const root = path.resolve(os.tmpdir(), "approved-root");
  assert.equal(resolveWithin(root, "input/video.mp4"), path.join(root, "input", "video.mp4"));
  assert.throws(() => resolveWithin(root, "../outside.mp4"), error => error instanceof CookingVideoError && error.code === "PATH_OUTSIDE_JOB");
});

test("process runner terminates commands that exceed the output limit", async () => {
  await assert.rejects(
    () => runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(2048))"], { maxOutputBytes: 1024 }),
    error => error instanceof CookingVideoError && error.code === "PROCESS_FAILED",
  );
});

test("job store creates layout and enforces state transitions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-store-"));
  try {
    const store = new JobStore(root);
    const created = await store.create(sampleJob(), new Date("2026-09-04T00:00:00.000Z"));
    assert.equal(created.state.status, "created");
    assert.equal(JSON.parse(await readFile(created.paths.jobFile, "utf8")).jobId, "cook-001");

    const ingesting = await store.transition("cook-001", "ingesting", {}, new Date("2026-09-04T00:01:00.000Z"));
    assert.equal(ingesting.status, "ingesting");
    const ingested = await store.transition("cook-001", "ingested", { outputFiles: ["analysis/media-manifest.json"] });
    assert.equal(ingested.status, "ingested");
    assert.equal(ingested.stages.some(stage => stage.status === "running"), false);
    assert.equal(ingested.stages[0].status, "completed");
    await assert.rejects(() => store.transition("cook-001", "completed"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("job store closes a failed running stage and permits retry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-retry-"));
  try {
    const store = new JobStore(root);
    await store.create(sampleJob());
    await store.transition("cook-001", "ingesting");
    const failed = await store.transition("cook-001", "failed", { errorCode: "PROCESS_FAILED", errorMessage: "fixture failure" });
    assert.equal(failed.stages[0].status, "failed");
    assert.equal(failed.stages[0].errorCode, "PROCESS_FAILED");
    await store.transition("cook-001", "ingesting");
    const recovered = await store.transition("cook-001", "ingested");
    assert.equal(recovered.status, "ingested");
    assert.equal(recovered.stages.some(stage => stage.status === "running"), false);
    assert.equal(recovered.stages.filter(stage => stage.stage === "ingesting").length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("job input digest changes with source or machine-event content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-digest-"));
  try {
    const job = { ...sampleJob(), machineEventsPath: "input/machine-events.jsonl" };
    const store = new JobStore(root);
    const created = await store.create(job);
    await writeFile(path.join(created.paths.input, "top.mp4"), "top-v1");
    await writeFile(path.join(created.paths.input, "front.mp4"), "front-v1");
    await writeFile(path.join(created.paths.input, "machine-events.jsonl"), '{"timeMs":1,"event":"cooking_started"}\n');
    const first = await computeJobInputDigest(created.job, created.paths);
    await writeFile(path.join(created.paths.input, "top.mp4"), "top-v2");
    const second = await computeJobInputDigest(created.job, created.paths);
    assert.notEqual(first, second);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("parses ffprobe streams and frame rates", () => {
  const parsed = parseFfprobePayload(JSON.stringify({
    format: { duration: "12.345", format_name: "mov,mp4", tags: { creation_time: "2026-09-04T01:02:03.456Z" } },
    streams: [
      { index: 0, codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001", side_data_list: [{ rotation: -90 }] },
      { index: 1, codec_type: "audio", codec_name: "aac" },
    ],
  }));
  assert.equal(parsed.durationMs, 12345);
  assert.equal(parsed.streams[0].rotation, -90);
  assert.equal(parsed.creationTime, "2026-09-04T01:02:03.456Z");
  assert.ok(Math.abs(parsed.streams[0].frameRate - 29.970) < 0.001);
});

test("builds normalized manual synchronization offsets", () => {
  const sync = buildSyncMap({
    schemaVersion: "1.0",
    jobId: "cook-001",
    generatedAt: "2026-09-04T00:00:00.000Z",
    warnings: [],
    sources: [
      { cameraId: "top", path: "input/top.mp4", byteSize: 1, sha256: "a", durationMs: 1000, streams: [] },
      { cameraId: "front", role: "machine_full", path: "input/front.mp4", byteSize: 1, sha256: "b", durationMs: 1000, streams: [] },
    ],
  }, {
    referenceCameraId: "front",
    manualOffsets: { top: 420, front: 100 },
    now: new Date("2026-09-04T00:00:00.000Z"),
  });
  assert.equal(sync.method, "manual");
  assert.equal(sync.cameras.front.offsetMs, 0);
  assert.equal(sync.cameras.top.offsetMs, 320);
});

test("estimates positive and negative audio envelope offsets", () => {
  const reference = [0, 0, 1, 0.2, 0.8, 0, 0.4, 0, 0];
  const earlierTarget = [1, 0.2, 0.8, 0, 0.4, 0, 0, 0, 0];
  const laterTarget = [0, 0, 0, 0, 1, 0.2, 0.8, 0, 0.4];
  const positive = estimateEnvelopeOffset(reference, earlierTarget, 10, 400);
  const negative = estimateEnvelopeOffset(reference, laterTarget, 10, 400);
  assert.equal(positive.offsetMs, 200);
  assert.equal(negative.offsetMs, -200);
  assert.ok(positive.confidence > 0.9 && negative.confidence > 0.9);
});

test("builds timecode synchronization and rejects incomplete timecodes", () => {
  const manifest = {
    schemaVersion: "1.0",
    jobId: "cook-001",
    generatedAt: "2026-09-04T00:00:00.000Z",
    warnings: [],
    sources: [
      { cameraId: "front", path: "input/front.mp4", byteSize: 1, sha256: "a", durationMs: 1000, creationTime: "2026-09-04T00:00:00.000Z", streams: [] },
      { cameraId: "top", path: "input/top.mp4", byteSize: 1, sha256: "b", durationMs: 1000, creationTime: "2026-09-04T00:00:00.250Z", streams: [] },
    ],
  };
  const sync = buildSyncMap(manifest, { referenceCameraId: "front" });
  assert.equal(sync.method, "timecode");
  assert.equal(sync.cameras.top.offsetMs, 250);
  delete manifest.sources[1].creationTime;
  assert.throws(() => buildSyncMap(manifest), error => error instanceof CookingVideoError && error.code === "SYNC_INPUT_INVALID");
});

test("parses and normalizes machine event aliases", () => {
  const events = parseMachineEvents('{"timeMs":2000,"event":"stir_fry_started"}\n{"timeMs":1000,"event":"ingredient_added"}\n');
  assert.deepEqual(events.map(event => event.event), ["ingredient_added", "stir_fry"]);
  assert.throws(() => parseMachineEvents('{"timeMs":0,"event":"unsupported"}'), error => error instanceof CookingVideoError && error.code === "EVENT_INPUT_INVALID");
});

test("deduplicates identical evidence frames by content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-dedupe-"));
  try {
    const first = path.join(root, "first.jpg");
    const duplicate = path.join(root, "duplicate.jpg");
    const different = path.join(root, "different.jpg");
    await Promise.all([writeFile(first, "same"), writeFile(duplicate, "same"), writeFile(different, "different")]);
    assert.deepEqual(await deduplicateEvidenceFiles([first, duplicate, different]), [first, different]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("parses scene cut and motion metadata", () => {
  assert.deepEqual(parseSceneCutTimes("showinfo pts_time:1.25 foo\nshowinfo pts_time:3.5"), [1250, 3500]);
  assert.deepEqual(parseMotionSamples("frame:0 pts_time:0\nlavfi.signalstats.YDIF=0\nframe:1 pts_time:0.5\nlavfi.signalstats.YDIF=3.125"), [
    { timeMs: 0, score: 0 },
    { timeMs: 500, score: 3.125 },
  ]);
});

test("maps machine events through synchronization offsets and extracts evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-events-"));
  try {
    const job = { ...sampleJob(), machineEventsPath: "input/machine-events.jsonl" };
    const store = new JobStore(root);
    const created = await store.create(job);
    await writeFile(path.join(created.paths.input, "machine-events.jsonl"), '{"timeMs":1000,"event":"ingredient_added"}\n');
    await writeFile(path.join(created.paths.analysis, "media-manifest.json"), JSON.stringify({
      schemaVersion: "1.0", jobId: job.jobId, generatedAt: "2026-09-04T00:00:00.000Z", warnings: [],
      sources: [
        { cameraId: "top", path: "input/top.mp4", proxyPath: "proxy/top.mp4", byteSize: 1, sha256: "a", durationMs: 5000, streams: [] },
        { cameraId: "front", path: "input/front.mp4", proxyPath: "proxy/front.mp4", byteSize: 1, sha256: "b", durationMs: 5000, streams: [] },
      ],
    }));
    await writeFile(path.join(created.paths.analysis, "sync-map.json"), JSON.stringify({
      schemaVersion: "1.0", jobId: job.jobId, referenceCameraId: "front", method: "manual", confidence: 1,
      cameras: { top: { offsetMs: 250 }, front: { offsetMs: 0 } }, generatedAt: "2026-09-04T00:00:00.000Z",
    }));
    const calls = [];
    const timeline = await detectMachineEvents(created.job, created.paths, {
      runner: async (command, args) => { calls.push({ command, args: [...args] }); return { exitCode: 0, stdout: "", stderr: "" }; },
      now: new Date("2026-09-04T00:00:00.000Z"),
    });
    assert.equal(timeline.events.length, 2);
    assert.equal(timeline.events.find(event => event.cameraId === "top").endMs, 3750);
    assert.equal(calls.find(call => call.args.includes(path.join(created.paths.proxy, "top.mp4"))).args.includes("0.750"), true);
    assert.equal(timeline.events.every(event => event.evidenceFrames.length === 3), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepares bounded vision evidence and imports schema-constrained detections", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-vision-"));
  try {
    const store = new JobStore(root);
    const created = await store.create(sampleJob());
    await writeFile(path.join(created.paths.analysis, "media-manifest.json"), JSON.stringify({
      schemaVersion: "1.0", jobId: "cook-001", generatedAt: "2026-09-04T00:00:00.000Z", warnings: [],
      sources: [
        { cameraId: "top", path: "input/top.mp4", proxyPath: "proxy/top.mp4", byteSize: 1, sha256: "a", durationMs: 4000, streams: [] },
        { cameraId: "front", path: "input/front.mp4", proxyPath: "proxy/front.mp4", byteSize: 1, sha256: "b", durationMs: 4000, streams: [] },
      ],
    }));
    await writeFile(path.join(created.paths.analysis, "sync-map.json"), JSON.stringify({
      schemaVersion: "1.0", jobId: "cook-001", referenceCameraId: "front", method: "manual", confidence: 1,
      cameras: { top: { offsetMs: 200 }, front: { offsetMs: 0 } }, generatedAt: "2026-09-04T00:00:00.000Z",
    }));
    const calls = [];
    const request = await prepareVisionEvidence(created.paths, {
      runner: async (command, args) => { calls.push({ command, args }); return { exitCode: 0, stdout: "", stderr: "" }; },
      intervalMs: 2000,
      maxFrames: 4,
      now: new Date("2026-09-04T00:00:00.000Z"),
    });
    assert.equal(request.items.length, 4);
    assert.equal(calls.length, 4);
    const timeline = importVisionDetections(request, {
      schemaVersion: "1.0", jobId: "cook-001",
      detections: request.items.map(item => ({ itemId: item.id, event: "stir_fry", confidence: 0.9 })),
    }, new Date("2026-09-04T00:00:00.000Z"));
    assert.equal(timeline.source, "vision");
    assert.equal(timeline.events.length, 4);
    assert.equal(timeline.events.every(event => event.endMs <= 4000), true);
    assert.throws(() => importVisionDetections(request, { schemaVersion: "1.0", jobId: "other", detections: [] }), error => error instanceof CookingVideoError && error.code === "VISION_RESPONSE_INVALID");
    assert.throws(() => importVisionDetections(request, { schemaVersion: "1.0", jobId: "cook-001", detections: [] }), error => error instanceof CookingVideoError && /missing/.test(error.message));
    assert.throws(() => importVisionDetections(request, {
      schemaVersion: "1.0", jobId: "cook-001",
      detections: request.items.map(item => ({ itemId: item.id, event: "unknown", confidence: 0.1, problems: [""] })),
    }), error => error instanceof CookingVideoError && /problems/.test(error.message));
    assert.throws(() => importVisionDetections(request, {
      schemaVersion: "1.0", jobId: "cook-001",
      detections: request.items.map(item => ({ itemId: item.id, event: "unknown", confidence: 0.1, explanation: "not allowed" })),
    }), error => error instanceof CookingVideoError && /unsupported fields/.test(error.message));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("selects the best camera per event occurrence with explainable scores", () => {
  const manifest = {
    schemaVersion: "1.0", jobId: "cook-001", generatedAt: "2026-09-04T00:00:00.000Z", warnings: [],
    sources: [
      { cameraId: "top", role: "food_closeup", path: "input/top.mp4", byteSize: 1, sha256: "a", durationMs: 5000, streams: [{ index: 0, codecType: "video", width: 1920, height: 1080 }] },
      { cameraId: "front", role: "machine_full", path: "input/front.mp4", byteSize: 1, sha256: "b", durationMs: 5000, streams: [{ index: 0, codecType: "video", width: 1920, height: 1080 }] },
    ],
  };
  const timeline = {
    schemaVersion: "1.0", jobId: "cook-001", generatedAt: "2026-09-04T00:00:00.000Z", source: "machine_events",
    events: [
      { occurrenceId: "evt-1", cameraId: "top", startMs: 0, endMs: 3000, event: "ingredient_added", confidence: 0.95, evidenceFrames: [] },
      { occurrenceId: "evt-1", cameraId: "front", startMs: 0, endMs: 3000, event: "ingredient_added", confidence: 0.95, evidenceFrames: [] },
      { occurrenceId: "evt-2", cameraId: "top", startMs: 1000, endMs: 4000, event: "cooking_started", confidence: 0.95, evidenceFrames: [] },
      { occurrenceId: "evt-2", cameraId: "front", startMs: 1000, endMs: 4000, event: "cooking_started", confidence: 0.95, evidenceFrames: [] },
    ],
  };
  const result = selectShots(timeline, manifest, new Date("2026-09-04T00:00:00.000Z"));
  assert.equal(result.candidates.find(candidate => candidate.occurrenceId === "evt-1" && candidate.selected).cameraId, "top");
  assert.equal(result.candidates.find(candidate => candidate.occurrenceId === "evt-2" && candidate.selected).cameraId, "front");
  assert.equal(result.candidates.every(candidate => candidate.rank > 0), true);
  const invalidTimeline = { ...timeline, events: [{ ...timeline.events[0], occurrenceId: "" }] };
  assert.throws(() => selectShots(invalidTimeline, manifest), error => error instanceof CookingVideoError && error.code === "EVENT_INPUT_INVALID");
});

test("uses motion and scene continuity to rank otherwise equal camera candidates", () => {
  const manifest = {
    schemaVersion: "1.0", jobId: "cook-001", generatedAt: "2026-09-04T00:00:00.000Z", warnings: [],
    sources: [
      { cameraId: "top", role: "action_side", path: "input/top.mp4", byteSize: 1, sha256: "a", durationMs: 5000, streams: [{ index: 0, codecType: "video", width: 1920, height: 1080 }] },
      { cameraId: "front", role: "action_side", path: "input/front.mp4", byteSize: 1, sha256: "b", durationMs: 5000, streams: [{ index: 0, codecType: "video", width: 1920, height: 1080 }] },
    ],
  };
  const timeline = {
    schemaVersion: "1.0", jobId: manifest.jobId, generatedAt: "2026-09-04T00:00:00.000Z", source: "machine_events",
    events: manifest.sources.map(source => ({ occurrenceId: "evt-0001", cameraId: source.cameraId, startMs: 1000, endMs: 4000, event: "stir_fry", confidence: 0.9, evidenceFrames: [] })),
  };
  const scene = {
    schemaVersion: "1.0", jobId: manifest.jobId, generatedAt: "2026-09-04T00:00:00.000Z",
    sources: [
      { cameraId: "top", cutsMs: [], motionSamples: [{ timeMs: 2000, score: 12 }] },
      { cameraId: "front", cutsMs: [1800, 2600], motionSamples: [{ timeMs: 2000, score: 0 }] },
    ],
  };
  const result = selectShots(timeline, manifest, new Date("2026-09-04T00:00:00.000Z"), new Map(), scene);
  assert.equal(result.candidates.find(candidate => candidate.cameraId === "top").selected, true);
  assert.equal(result.candidates.find(candidate => candidate.cameraId === "top").scores.motion, 1);
  assert.equal(result.candidates.find(candidate => candidate.cameraId === "front").scores.continuity, 0.3);
  assert.ok(result.candidates.find(candidate => candidate.cameraId === "front").problems.includes("multiple_scene_cuts"));
});

test("creates a constrained 15-second EDL and SRT", () => {
  const makeCandidate = (occurrenceId, cameraId, event, startMs, endMs) => ({
    occurrenceId, cameraId, event, startMs, endMs, confidence: 0.95, evidenceFrames: [], problems: [],
    rank: 1, selected: true,
    scores: { eventConfidence: 0.95, roleFit: 1, resolution: 1, durationFit: 1, total: 0.97 },
  });
  const decision = createEditDecision(sampleJob(), {
    schemaVersion: "1.0", jobId: "cook-001", generatedAt: "2026-09-04T00:00:00.000Z",
    candidates: [
      makeCandidate("evt-1", "front", "cooking_started", 0, 3500),
      makeCandidate("evt-2", "top", "ingredient_added", 0, 4000),
      makeCandidate("evt-3", "top", "stir_fry", 0, 4000),
      makeCandidate("evt-4", "top", "dish_completed", 0, 3000),
    ],
  }, "15s");
  assert.equal(decision.durationTargetMs, 15000);
  assert.equal(decision.segments.length, 5);
  assert.equal(decision.segments[0].caption, "成品稳定，出餐更高效");
  assert.match(captionsToSrt(decision.segments), /00:00:00,000 --> 00:00:02,000/);
  assert.equal(sanitizeCaption("卖点{\\an5}\n测试"), "卖点 \\an5 测试");
  assert.match(captionsToSrt(decision.segments, decision.endCard), /\{\\an5\}让每一道菜都稳定出品/);
  assert.throws(
    () => createEditDecision(sampleJob(), {
      schemaVersion: "1.0", jobId: "cook-001", generatedAt: "2026-09-04T00:00:00.000Z",
      candidates: [
        makeCandidate("evt-1", "front", "cooking_started", 0, 3500),
        makeCandidate("evt-2", "top", "ingredient_added", 0, 4000),
        makeCandidate("evt-3", "top", "stir_fry", 0, 4000),
        makeCandidate("evt-4", "top", "dish_completed", 0, 3000),
      ],
    }, "30s"),
    error => error instanceof CookingVideoError && error.code === "EDIT_CONSTRAINT_VIOLATION",
  );
});

test("builds a controlled render command and rejects out-of-bounds clips", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-render-"));
  try {
    const store = new JobStore(root);
    const created = await store.create(sampleJob());
    const manifest = {
      schemaVersion: "1.0", jobId: "cook-001", generatedAt: "2026-09-04T00:00:00.000Z", warnings: [],
      sources: [
        { cameraId: "top", path: "input/top.mp4", proxyPath: "proxy/top.mp4", byteSize: 1, sha256: "a", durationMs: 5000, streams: [{ index: 0, codecType: "video", width: 1920, height: 1080 }] },
        { cameraId: "front", path: "input/front.mp4", proxyPath: "proxy/front.mp4", byteSize: 1, sha256: "b", durationMs: 5000, streams: [{ index: 0, codecType: "video", width: 1920, height: 1080 }] },
      ],
    };
    const decision = {
      schemaVersion: "1.0", jobId: "cook-001", templateId: "fixture", fps: 30, aspectRatio: "9:16", durationTargetMs: 2500,
      segments: [{ id: "seg-1", cameraId: "top", sourceStartMs: 0, sourceEndMs: 1000, timelineStartMs: 0, event: "stir_fry", caption: "测试", transition: "cut", crop: { mode: "cover", focusX: 0.5, focusY: 0.5 } }],
      audio: { retainSourceAudio: true, sourceGainDb: -8, musicGainDb: -14 },
      endCard: { durationMs: 1500, headline: "完成" },
    };
    const built = buildRenderArgs(created.job, created.paths, decision, manifest, { draft: true });
    assert.deepEqual([built.width, built.height], [360, 640]);
    assert.equal(built.args.includes("-filter_complex"), true);
    assert.equal(built.args.at(-1).endsWith("promo-vertical-3s-draft.mp4"), true);
    const invalid = { ...decision, segments: [{ ...decision.segments[0], sourceEndMs: 6000 }], durationTargetMs: 7500 };
    assert.throws(() => buildRenderArgs(created.job, created.paths, invalid, manifest), error => error instanceof CookingVideoError && error.code === "EDIT_CONSTRAINT_VIOLATION");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("produces a structured quality report from deterministic probes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-quality-"));
  try {
    const store = new JobStore(root);
    const created = await store.create(sampleJob());
    await writeFile(path.join(created.paths.edit, "edit-decision.json"), JSON.stringify({
      schemaVersion: "1.0", jobId: "cook-001", templateId: "fixture", fps: 30, aspectRatio: "9:16", durationTargetMs: 2500,
      segments: [
        { id: "seg-1", cameraId: "front", sourceStartMs: 0, sourceEndMs: 500, timelineStartMs: 0, event: "cooking_started", transition: "cut", crop: { mode: "cover", focusX: 0.5, focusY: 0.5 } },
        { id: "seg-2", cameraId: "top", sourceStartMs: 0, sourceEndMs: 500, timelineStartMs: 500, event: "dish_completed", transition: "cut", crop: { mode: "cover", focusX: 0.5, focusY: 0.5 } },
      ],
      audio: { retainSourceAudio: true, sourceGainDb: -8, musicGainDb: -14 }, endCard: { durationMs: 1500, headline: "完成" },
    }));
    const runner = async (command, args) => {
      if (command === "ffprobe") return { exitCode: 0, stdout: JSON.stringify({ format: { duration: "2.500" }, streams: [{ codec_type: "video", codec_name: "h264", width: 360, height: 640 }, { codec_type: "audio", codec_name: "aac" }] }), stderr: "" };
      const filter = args.includes("volumedetect") ? "[Parsed_volumedetect] max_volume: -8.0 dB"
        : args.some(arg => arg.includes("signalstats")) ? "lavfi.signalstats.YAVG=128" : "";
      return { exitCode: 0, stdout: "", stderr: filter };
    };
    const report = await reviewVideo("cook-001", created.paths, "promo.mp4", { runner, now: new Date("2026-09-04T00:00:00.000Z") });
    assert.equal(report.status, "pass");
    assert.equal(report.checks.length, 11);
    assert.equal(JSON.parse(await readFile(path.join(created.paths.output, "quality-report.json"), "utf8")).status, "pass");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ingest writes a deterministic manifest and controlled media commands", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-ingest-"));
  try {
    const store = new JobStore(root);
    const created = await store.create(sampleJob());
    await Promise.all([
      writeFile(path.join(created.paths.input, "top.mp4"), "top-fixture"),
      writeFile(path.join(created.paths.input, "front.mp4"), "front-fixture"),
    ]);
    const calls = [];
    const runner = async (command, args) => {
      calls.push({ command, args: [...args] });
      if (command === "ffprobe") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ format: { duration: "30", format_name: "mp4" }, streams: [{ index: 0, codec_type: "video", codec_name: "h264", width: 1280, height: 720, avg_frame_rate: "30/1" }] }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const manifest = await ingestMedia(created.job, created.paths, { runner });
    assert.equal(manifest.sources.length, 2);
    assert.equal(manifest.warnings.length, 0);
    assert.equal(calls.filter(call => call.command === "ffprobe").length, 2);
    assert.equal(calls.filter(call => call.command === "ffmpeg").length, 8);
    assert.equal(calls.filter(call => call.args.some(arg => arg.includes("format=yuvj420p"))).length, 2);
    for (const call of calls) assert.equal(call.args.some(arg => arg.includes("..")), false);
    const written = JSON.parse(await readFile(path.join(created.paths.analysis, "media-manifest.json"), "utf8"));
    assert.equal(written.jobId, "cook-001");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
