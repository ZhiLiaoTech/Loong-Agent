import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CookingVideoError,
  CookingVideoQueue,
  CookingVideoMetricsStore,
  CookingVideoFeedbackStore,
  MultipartUploadCoordinator,
  PersistentCookingVideoQueue,
  StorageAuditLog,
  TenantObjectStorageService,
  buildTenantObjectKey,
  classifyReviewFailureModes,
  cleanupJobTemporaryFiles,
  computeJobInputDigest,
  consumeInbox,
  JobStore,
  buildSyncMap,
  buildRenderArgs,
  captionsToSrt,
  createEditDecision,
  deduplicateEvidenceFiles,
  detectHeuristicEvents,
  detectJobEvents,
  detectMachineEvents,
  enforceJobRetention,
  evaluateProductionHealth,
  estimateEnvelopeOffset,
  executeCookingVideoWorkerTask,
  ingestMedia,
  importVisionDetections,
  parseMachineEvents,
  parseMotionSamples,
  parseSceneCutTimes,
  listReviewJobs,
  loadReviewWorkspace,
  prepareReviewRerender,
  prepareVisionEvidence,
  planNextWorkerTask,
  parseFfprobePayload,
  resolveWithin,
  reviewVideo,
  renderPrometheusMetrics,
  runPersistentWorkerOnce,
  remotionCompositionId,
  runCopyAdapter,
  runVisionAdapter,
  runShotQualityAdapter,
  saveReviewEdit,
  submitReview,
  runProcess,
  sanitizeCaption,
  scanInbox,
  selectShots,
  synchronizeJob,
  validateMediaManifest,
  validatePromotionalCopy,
  validateShotCandidates,
  validateJob,
  validateGoldenAnnotation,
  workerRoleForAction,
} from "../dist/index.js";

function fakeMultipartProvider() {
  const uploaded = new Map();
  let completedSha256;
  return {
    uploaded,
    setCompletedSha256(value) { completedSha256 = value; },
    async createMultipartUpload() { return { providerUploadId: "provider-upload-1" }; },
    async signPartUpload(input) {
      return { url: `https://storage.example.test/${input.objectKey}?part=${input.partNumber}`, method: "PUT", headers: { "x-content-sha256": input.sha256 }, expiresAt: new Date(Date.now() + 900_000).toISOString() };
    },
    async inspectUploadedPart(input) {
      const part = uploaded.get(input.partNumber);
      if (!part) throw new Error("part missing");
      return { partNumber: input.partNumber, ...part };
    },
    async completeMultipartUpload(input) {
      return { objectKey: input.objectKey, byteSize: input.byteSize, sha256: completedSha256 ?? input.sha256, etag: "complete-etag" };
    },
    async abortMultipartUpload() {},
  };
}

test("coordinates resumable direct multipart uploads and verifies every checksum", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "cooking-upload-"));
  try {
    const provider = fakeMultipartProvider();
    const coordinator = new MultipartUploadCoordinator(stateRoot, provider);
    const fullDigest = "a".repeat(64);
    const firstDigest = "b".repeat(64);
    const secondDigest = "c".repeat(64);
    const session = await coordinator.create({ tenantId: "tenant-a", jobId: "job-1", assetId: "camera-top", fileName: "source.mp4", contentType: "video/mp4", byteSize: 1_500_000, sha256: fullDigest, partSize: 1_048_576 });
    assert.equal(session.objectKey, "tenant-a/job-1/camera-top/source.mp4");
    assert.equal(session.partCount, 2);

    const signed = await coordinator.signPart(session.uploadId, 1, firstDigest);
    assert.equal(signed.method, "PUT");
    assert.match(signed.url, /^https:\/\//);
    provider.uploaded.set(1, { byteSize: 1_048_576, sha256: firstDigest, etag: "part-1" });
    await coordinator.confirmPart(session.uploadId, 1);
    await coordinator.signPart(session.uploadId, 2, secondDigest);
    provider.uploaded.set(2, { byteSize: 451_424, sha256: secondDigest, etag: "part-2" });
    await coordinator.confirmPart(session.uploadId, 2);

    const resumed = new MultipartUploadCoordinator(stateRoot, provider);
    const restored = await resumed.get(session.uploadId);
    assert.equal(restored.parts.filter(part => part.status === "verified").length, 2);
    const completed = await resumed.complete(session.uploadId);
    assert.equal(completed.sha256, fullDigest);
    assert.equal((await resumed.get(session.uploadId)).status, "completed");
    assert.deepEqual(await resumed.complete(session.uploadId), completed);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("rejects unsafe multipart keys, wrong parts, incomplete uploads, and final digest mismatches", async () => {
  assert.throws(() => buildTenantObjectKey({ tenantId: "tenant-a", jobId: "job-1", assetId: "source", fileName: "../escape.mp4" }), error => error instanceof CookingVideoError && error.code === "UPLOAD_INVALID");
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "cooking-upload-invalid-"));
  try {
    const provider = fakeMultipartProvider();
    const coordinator = new MultipartUploadCoordinator(stateRoot, provider);
    const session = await coordinator.create({ tenantId: "tenant-a", jobId: "job-1", assetId: "source", fileName: "input.mp4", contentType: "video/mp4", byteSize: 1_048_576, sha256: "d".repeat(64) });
    await assert.rejects(() => coordinator.complete(session.uploadId), error => error instanceof CookingVideoError && /Every expected part/.test(error.message));
    await coordinator.signPart(session.uploadId, 1, "e".repeat(64));
    provider.uploaded.set(1, { byteSize: 1_048_575, sha256: "e".repeat(64), etag: "bad-size" });
    await assert.rejects(() => coordinator.confirmPart(session.uploadId, 1), error => error instanceof CookingVideoError && error.code === "UPLOAD_INTEGRITY_FAILED");
    provider.uploaded.set(1, { byteSize: 1_048_576, sha256: "e".repeat(64), etag: "part-1" });
    await coordinator.confirmPart(session.uploadId, 1);
    provider.setCompletedSha256("f".repeat(64));
    await assert.rejects(() => coordinator.complete(session.uploadId), error => error instanceof CookingVideoError && error.code === "UPLOAD_INTEGRITY_FAILED");
    assert.equal((await coordinator.get(session.uploadId)).status, "failed");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("enforces tenant and owner isolation while auditing signed storage access", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "cooking-storage-access-"));
  const now = new Date("2026-09-05T08:00:00.000Z");
  try {
    const provider = fakeMultipartProvider();
    const uploads = new MultipartUploadCoordinator(path.join(stateRoot, "state"), provider, { now: () => now });
    const audit = new StorageAuditLog(path.join(stateRoot, "audit"));
    const downloads = {
      async signObjectDownload(input) {
        return { url: `https://storage.example.test/download?key=${encodeURIComponent(input.objectKey)}`, method: "GET", headers: {}, expiresAt: new Date(now.getTime() + input.expiresInSeconds * 1000).toISOString() };
      },
    };
    const service = new TenantObjectStorageService(uploads, downloads, audit, { now: () => now });
    const owner = { tenantId: "tenant-a", userId: "camera.agent", roles: ["uploader"] };
    const session = await service.createUpload(owner, { jobId: "job-1", assetId: "top-camera", fileName: "clip.mp4", contentType: "video/mp4", byteSize: 1_048_576, sha256: "1".repeat(64) }, "request-create");
    assert.equal(session.ownerUserId, owner.userId);

    const intruder = { tenantId: "tenant-b", userId: "other", roles: ["operator"] };
    let crossTenantMessage = "";
    await assert.rejects(() => service.getUpload(intruder, session.uploadId, "request-cross-tenant"), error => {
      crossTenantMessage = error.message;
      return error instanceof CookingVideoError && error.code === "ACCESS_DENIED";
    });
    await assert.rejects(() => service.getUpload(intruder, "00000000-0000-0000-0000-000000000000"), error => error instanceof CookingVideoError && error.code === "ACCESS_DENIED" && error.message === crossTenantMessage);
    const otherUploader = { tenantId: "tenant-a", userId: "other", roles: ["uploader"] };
    await assert.rejects(() => service.signUploadPart(otherUploader, session.uploadId, 1, "2".repeat(64)), error => error instanceof CookingVideoError && error.code === "ACCESS_DENIED");

    await service.signUploadPart(owner, session.uploadId, 1, "2".repeat(64));
    provider.uploaded.set(1, { byteSize: 1_048_576, sha256: "2".repeat(64), etag: "part-1" });
    await service.confirmUploadPart(owner, session.uploadId, 1);
    await service.completeUpload(owner, session.uploadId);
    const reviewer = { tenantId: "tenant-a", userId: "reviewer-1", roles: ["reviewer"] };
    const download = await service.signDownload(reviewer, session.uploadId, 300, "request-download");
    assert.equal(download.method, "GET");
    assert.match(download.url, /^https:\/\//);
    await assert.rejects(() => service.abortUpload(reviewer, session.uploadId), error => error instanceof CookingVideoError && error.code === "ACCESS_DENIED");

    const tenantAAudit = await audit.list("tenant-a", "2026-09-05");
    assert(tenantAAudit.some(record => record.action === "download.sign" && record.outcome === "allowed" && record.requestId === "request-download"));
    assert(tenantAAudit.some(record => record.action === "upload.part.sign" && record.outcome === "denied"));
    const tenantBAudit = await audit.list("tenant-b", "2026-09-05");
    assert(tenantBAudit.some(record => record.action === "upload.status" && record.outcome === "denied" && record.requestId === "request-cross-tenant"));
    assert(!JSON.stringify([...tenantAAudit, ...tenantBAudit]).includes("https://storage.example.test"));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("rejects invalid download expiry and provider URLs without leaking them to audit", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "cooking-storage-signing-"));
  const now = new Date("2026-09-05T08:00:00.000Z");
  try {
    const provider = fakeMultipartProvider();
    const uploads = new MultipartUploadCoordinator(path.join(stateRoot, "state"), provider, { now: () => now });
    const audit = new StorageAuditLog(path.join(stateRoot, "audit"));
    const service = new TenantObjectStorageService(uploads, { async signObjectDownload() { return { url: "http://insecure.example.test/file", method: "GET", headers: {}, expiresAt: "2099-01-01T00:00:00.000Z" }; } }, audit, { now: () => now });
    const principal = { tenantId: "tenant-a", userId: "admin", roles: ["admin"] };
    const session = await service.createUpload(principal, { jobId: "job-2", assetId: "output", fileName: "promo.mp4", contentType: "video/mp4", byteSize: 1_048_576, sha256: "3".repeat(64) });
    await service.signUploadPart(principal, session.uploadId, 1, "4".repeat(64));
    provider.uploaded.set(1, { byteSize: 1_048_576, sha256: "4".repeat(64), etag: "part-1" });
    await service.confirmUploadPart(principal, session.uploadId, 1);
    await service.completeUpload(principal, session.uploadId);
    await assert.rejects(() => service.signDownload(principal, session.uploadId, 30), error => error instanceof CookingVideoError && error.code === "UPLOAD_INVALID");
    await assert.rejects(() => service.signDownload(principal, session.uploadId, 300), error => error instanceof CookingVideoError && error.code === "UPLOAD_PROVIDER_FAILED");
    const records = await audit.list("tenant-a", "2026-09-05");
    assert.equal(records.filter(record => record.action === "download.sign" && record.outcome === "failed").length, 2);
    assert(!JSON.stringify(records).includes("insecure.example.test"));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("plans and explicitly applies independent artifact retention windows", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cooking-retention-"));
  try {
    const store = new JobStore(root);
    const created = await store.create(sampleJob("retention-job"));
    const old = new Date("2026-08-01T00:00:00.000Z");
    const recent = new Date("2026-09-04T12:00:00.000Z");
    const files = [
      [path.join(created.paths.input, "top.mp4"), old],
      [path.join(created.paths.proxy, "top.mp4"), old],
      [path.join(created.paths.frames, "top-001.jpg"), old],
      [path.join(created.paths.output, "promo-old.mp4"), old],
      [path.join(created.paths.output, "promo-new.mp4"), recent],
    ];
    for (const [file, modified] of files) {
      await writeFile(file, "artifact");
      await utimes(file, modified, modified);
    }
    const state = JSON.parse(await readFile(created.paths.stateFile, "utf8"));
    await writeFile(created.paths.stateFile, JSON.stringify({ ...state, status: "completed", updatedAt: "2026-09-05T00:00:00.000Z" }));
    const policy = { schemaVersion: "1.0", originalDays: 30, proxyDays: 7, frameDays: 1, outputDays: 14 };
    const now = new Date("2026-09-05T00:00:00.000Z");
    const planned = await enforceJobRetention(store, "retention-job", policy, { now });
    assert.equal(planned.mode, "dry_run");
    assert.equal(planned.candidates.length, 4);
    assert.equal((await stat(path.join(created.paths.input, "top.mp4"))).isFile(), true);
    await assert.rejects(() => enforceJobRetention(store, "retention-job", policy, { now, dryRun: false }), error => error instanceof CookingVideoError && error.code === "RETENTION_BLOCKED");
    const applied = await enforceJobRetention(store, "retention-job", policy, { now, dryRun: false, confirmation: "DELETE_EXPIRED_ARTIFACTS" });
    assert.equal(applied.status, "applied");
    assert.equal(applied.deleted.length, 4);
    await assert.rejects(() => stat(path.join(created.paths.frames, "top-001.jpg")), error => error.code === "ENOENT");
    assert.equal((await stat(path.join(created.paths.output, "promo-new.mp4"))).isFile(), true);
    assert.equal((await stat(created.paths.jobFile)).isFile(), true);
    const audit = await readFile(path.join(created.paths.state, "retention-events.jsonl"), "utf8");
    assert.match(audit, /"mode":"dry_run"/);
    assert.match(audit, /"status":"planned"/);
    assert.match(audit, /"status":"applied"/);
    assert.match(audit, /"deletedCount":4/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retention preserves active and legal-hold jobs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cooking-retention-hold-"));
  try {
    const store = new JobStore(root);
    const active = await store.create(sampleJob("active-job"));
    await writeFile(path.join(active.paths.frames, "old.jpg"), "frame");
    const old = new Date("2020-01-01T00:00:00.000Z");
    await utimes(path.join(active.paths.frames, "old.jpg"), old, old);
    const policy = { schemaVersion: "1.0", originalDays: 0, proxyDays: 0, frameDays: 0, outputDays: null };
    const activeResult = await enforceJobRetention(store, "active-job", policy, { now: new Date("2026-09-05T00:00:00.000Z"), dryRun: false, confirmation: "DELETE_EXPIRED_ARTIFACTS" });
    assert.equal(activeResult.skippedReason, "job_status:created");
    assert.equal((await stat(path.join(active.paths.frames, "old.jpg"))).isFile(), true);
    const state = JSON.parse(await readFile(active.paths.stateFile, "utf8"));
    await writeFile(active.paths.stateFile, JSON.stringify({ ...state, status: "failed" }));
    const held = await enforceJobRetention(store, "active-job", { ...policy, legalHoldJobIds: ["active-job"] }, { now: new Date("2026-09-05T00:00:00.000Z"), dryRun: false, confirmation: "DELETE_EXPIRED_ARTIFACTS" });
    assert.equal(held.skippedReason, "legal_hold");
    assert.equal((await stat(path.join(active.paths.frames, "old.jpg"))).isFile(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("routes each pipeline boundary to an isolated worker role", () => {
  const expected = [
    ["created", "media", "ingest"],
    ["ingested", "media", "sync"],
    ["synced", "model", "detect"],
    ["analyzed", "model", "select"],
    ["selected", "model", "edit"],
    ["awaiting_review", "render", "render"],
    ["validating", "render", "validate"],
  ];
  for (const [status, role, action] of expected) {
    const task = planNextWorkerTask("job-1", status, `task-${action}`);
    assert.equal(task.role, role);
    assert.equal(task.action, action);
    assert.equal(task.expectedStatus, status);
    assert.equal(workerRoleForAction(action), role);
  }
  assert.equal(planNextWorkerTask("job-1", "completed", "task-done"), undefined);
  assert.throws(() => workerRoleForAction("publish"), error => error instanceof CookingVideoError && error.code === "JOB_STATE_INVALID");
});

test("worker runtime rejects cross-role tasks before accessing job data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cooking-worker-role-"));
  try {
    const task = planNextWorkerTask("not-present", "created", "task-1");
    await assert.rejects(() => executeCookingVideoWorkerTask(new JobStore(root), "model", task), error => error instanceof CookingVideoError && /configured role/.test(error.message));
    await assert.rejects(() => executeCookingVideoWorkerTask(new JobStore(root), "media", { ...task, expectedStatus: "ingested" }), error => error instanceof CookingVideoError && /expected state/.test(error.message));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production media image pins its base, package snapshot, browser, fonts, and render dependencies", async () => {
  const dockerfile = await readFile(path.join("..", "..", "deploy", "cooking-video", "Dockerfile"), "utf8");
  const verifier = await readFile(path.join("..", "..", "deploy", "cooking-video", "verify-runtime.mjs"), "utf8");
  assert.match(dockerfile, /^FROM node:24\.8\.0-bookworm-slim@sha256:[a-f0-9]{64} AS build/m);
  assert.match(dockerfile, /ARG DEBIAN_SNAPSHOT=\d{8}T\d{6}Z/);
  assert.match(dockerfile, /! grep -Eq 'URIs: https\?\:\/\//);
  assert.match(dockerfile, /chromium ffmpeg fonts-dejavu-core fonts-noto-cjk tini/);
  assert.match(dockerfile, /USER 10001:10001/);
  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.match(verifier, /remotion: "4\.0\.520"/);
  assert.match(verifier, /command\("ffmpeg", \["-version"\]\)/);
  assert.match(verifier, /command\("chromium", \["--version"\]\)/);
});

test("persistent queue retries, leases, takes over expired work, and deduplicates completion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cooking-persistent-queue-"));
  try {
    const queue = new PersistentCookingVideoQueue(root, { leaseMs: 1000, retryBaseMs: 100, retryMaxMs: 1000, maxAttempts: 3 });
    const task = planNextWorkerTask("job-1", "created", "stage-task-1");
    const enqueued = await queue.enqueue(task, "tenant-a/job-1/ingest/v1", new Date("2026-09-05T00:00:00.000Z"));
    assert.equal((await queue.enqueue(task, "tenant-a/job-1/ingest/v1")).queueTaskId, enqueued.queueTaskId);
    assert.equal(await queue.claim("model", "model-1", new Date("2026-09-05T00:00:00.000Z")), undefined);
    const first = await queue.claim("media", "media-1", new Date("2026-09-05T00:00:00.000Z"));
    assert.equal(first.attempts, 1);
    await assert.rejects(() => queue.renew(first.queueTaskId, "media-2", first.leaseToken, new Date("2026-09-05T00:00:00.100Z")), error => error instanceof CookingVideoError && error.code === "QUEUE_LEASE_LOST");
    const retry = await queue.fail(first.queueTaskId, "media-1", first.leaseToken, "TRANSIENT", true, new Date("2026-09-05T00:00:00.200Z"));
    assert.equal(retry.status, "retry_wait");
    assert.equal(await queue.claim("media", "media-2", new Date("2026-09-05T00:00:00.250Z")), undefined);
    const second = await queue.claim("media", "media-2", new Date("2026-09-05T00:00:00.300Z"));
    assert.equal(second.attempts, 2);
    const takeover = await queue.claim("media", "media-3", new Date("2026-09-05T00:00:01.301Z"));
    assert.equal(takeover.attempts, 3);
    assert.notEqual(takeover.leaseToken, second.leaseToken);
    await assert.rejects(() => queue.complete(second.queueTaskId, "media-2", second.leaseToken, "a".repeat(64), new Date("2026-09-05T00:00:01.400Z")), error => error instanceof CookingVideoError && error.code === "QUEUE_LEASE_LOST");
    const complete = await queue.complete(takeover.queueTaskId, "media-3", takeover.leaseToken, "a".repeat(64), new Date("2026-09-05T00:00:01.500Z"));
    assert.equal(complete.status, "completed");
    assert.equal((await queue.complete(takeover.queueTaskId, "media-3", takeover.leaseToken, "a".repeat(64))).status, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persistent queue dead-letters exhausted and permanent failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cooking-persistent-dead-"));
  try {
    const queue = new PersistentCookingVideoQueue(root, { leaseMs: 1000, retryBaseMs: 100, maxAttempts: 2 });
    const task = planNextWorkerTask("job-2", "synced", "stage-task-2");
    const item = await queue.enqueue(task, "job-2/detect/v1", new Date("2026-09-05T00:00:00.000Z"));
    const claimed = await queue.claim("model", "model-1", new Date("2026-09-05T00:00:00.000Z"));
    const dead = await queue.fail(item.queueTaskId, "model-1", claimed.leaseToken, "INVALID_MEDIA", false, new Date("2026-09-05T00:00:00.100Z"));
    assert.equal(dead.status, "dead_letter");
    const requeued = await queue.requeueDeadLetter(item.queueTaskId, new Date("2026-09-05T00:01:00.000Z"));
    assert.equal(requeued.status, "queued");
    assert.equal(requeued.attempts, 0);
    assert.equal((await queue.list("queued")).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persistent queue recovers a stale mutation lock after a crashed process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cooking-persistent-lock-"));
  try {
    const key = "job-3/ingest/v1";
    const queueTaskId = (await import("node:crypto")).createHash("sha256").update(key).digest("hex");
    const tasks = path.join(root, "tasks");
    await mkdir(tasks, { recursive: true });
    const lock = path.join(tasks, `${queueTaskId}.lock`);
    await writeFile(lock, "orphan");
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    const queue = new PersistentCookingVideoQueue(root);
    const item = await queue.enqueue(planNextWorkerTask("job-3", "created", "stage-task-3"), key);
    assert.equal(item.queueTaskId, queueTaskId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persistent worker claims, executes, and commits an idempotent result digest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cooking-persistent-worker-"));
  try {
    const queue = new PersistentCookingVideoQueue(path.join(root, "queue"));
    const task = planNextWorkerTask("job-worker", "created", "stage-worker");
    await queue.enqueue(task, "job-worker/ingest/v1");
    const fakeState = { schemaVersion: "1.0", jobId: "job-worker", status: "ingested", createdAt: "", updatedAt: "", stages: [] };
    const consumed = await runPersistentWorkerOnce(queue, new JobStore(path.join(root, "jobs")), "media", "media-1", {
      executor: async (_store, role, claimedTask) => ({ taskId: claimedTask.taskId, jobId: claimedTask.jobId, role, action: claimedTask.action, state: fakeState }),
    });
    assert.equal(consumed.queueItem.status, "completed");
    assert.match(consumed.queueItem.resultDigest, /^[a-f0-9]{64}$/);
    assert.equal(await runPersistentWorkerOnce(queue, new JobStore(path.join(root, "jobs")), "media", "media-1", { executor: async () => { throw new Error("must not run"); } }), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production health evaluates healthy SLO windows and exports Prometheus metrics", () => {
  const metrics = { windowStartedAt: "2026-09-05T00:00:00.000Z", windowEndedAt: "2026-09-05T01:00:00.000Z", apiRequests: 1000, apiErrors: 1, jobsCompleted: 99, jobsFailed: 1, jobDurationP95Ms: 600_000, queueDepth: 2, queueOldestAgeMs: 30_000, deadLetterDepth: 0, modelCalls: 100, modelFailures: 2, workerHeartbeatAgeMs: { media: 10_000, render: 20_000 } };
  const health = evaluateProductionHealth(metrics, undefined, new Date("2026-09-05T01:00:01.000Z"));
  assert.equal(health.status, "healthy");
  assert.equal(health.alerts.length, 0);
  const prometheus = renderPrometheusMetrics(health);
  assert.match(prometheus, /cooking_video_api_availability 0\.999/);
  assert.match(prometheus, /worker="render"/);
});

test("production health raises critical backlog, dead-letter, and stale-worker alerts", () => {
  const metrics = { windowStartedAt: "2026-09-05T00:00:00.000Z", windowEndedAt: "2026-09-05T01:00:00.000Z", apiRequests: 100, apiErrors: 5, jobsCompleted: 70, jobsFailed: 30, jobDurationP95Ms: 2_000_000, queueDepth: 50, queueOldestAgeMs: 2_000_000, deadLetterDepth: 3, modelCalls: 10, modelFailures: 2, workerHeartbeatAgeMs: { render: 500_000 } };
  const health = evaluateProductionHealth(metrics);
  assert.equal(health.status, "unhealthy");
  assert.deepEqual(new Set(health.alerts.filter(alert => alert.severity === "critical").map(alert => alert.code)), new Set(["API_AVAILABILITY", "JOB_SUCCESS_RATE", "QUEUE_BACKLOG", "DEAD_LETTER", "WORKER_HEARTBEAT"]));
  assert(health.alerts.every(alert => alert.runbook.startsWith("COOKING_PROMO_VIDEO_RUNBOOK.md#")));
});

test("production health rejects corrupt metric windows and treats no traffic as neutral", () => {
  const empty = { windowStartedAt: "2026-09-05T00:00:00.000Z", windowEndedAt: "2026-09-05T01:00:00.000Z", apiRequests: 0, apiErrors: 0, jobsCompleted: 0, jobsFailed: 0, jobDurationP95Ms: 0, queueDepth: 0, queueOldestAgeMs: 0, deadLetterDepth: 0, modelCalls: 0, modelFailures: 0, workerHeartbeatAgeMs: {} };
  assert.equal(evaluateProductionHealth(empty).status, "healthy");
  assert.throws(() => evaluateProductionHealth({ ...empty, apiErrors: -1 }), error => error instanceof CookingVideoError && error.code === "JOB_INVALID");
  assert.throws(() => evaluateProductionHealth({ ...empty, apiErrors: 1 }), error => error instanceof CookingVideoError && error.code === "JOB_INVALID");
});

test("production, customer, and upgrade manuals contain required operational gates", async () => {
  const docsRoot = path.join("..", "..", "docs");
  const deployment = await readFile(path.join(docsRoot, "COOKING_PROMO_VIDEO_PRODUCTION_DEPLOYMENT.md"), "utf8");
  const customer = await readFile(path.join(docsRoot, "COOKING_PROMO_VIDEO_CUSTOMER_OPERATIONS.md"), "utf8");
  const upgrade = await readFile(path.join(docsRoot, "COOKING_PROMO_VIDEO_UPGRADE.md"), "utf8");
  assert.match(deployment, /镜像按 digest 发布/);
  assert.match(deployment, /备份与恢复/);
  assert.match(customer, /_READY/);
  assert.match(customer, /quality report/);
  assert.match(upgrade, /租约安全到期/);
  assert.match(upgrade, /不可逆迁移/);
});

test("validates reviewed golden annotations and cross-field labeling rules", async () => {
  const fixture = JSON.parse(await readFile(path.join("tests", "fixtures", "golden-annotation.json"), "utf8"));
  const annotation = validateGoldenAnnotation(fixture, "cook-001");
  assert.equal(annotation.events.length, 2);
  assert.equal(annotation.bestShots.length, 2);
  assert.throws(() => validateGoldenAnnotation({ ...fixture, jobId: "other" }, "cook-001"), error => error instanceof CookingVideoError && /different job/.test(error.message));
  assert.throws(() => validateGoldenAnnotation({ ...fixture, bestShots: fixture.bestShots.slice(0, 1) }), error => error instanceof CookingVideoError && /has no best shot/.test(error.message));
  const overlapping = structuredClone(fixture);
  overlapping.candidates[1].usable = true;
  overlapping.candidates[1].exclusionReasons = [];
  assert.throws(() => validateGoldenAnnotation(overlapping), error => error instanceof CookingVideoError && /overlaps an excluded range/.test(error.message));
  assert.throws(() => validateGoldenAnnotation({ ...fixture, review: { ...fixture.review, reviewerId: fixture.annotatorId } }), error => error instanceof CookingVideoError && /differ from annotator/.test(error.message));
  assert.throws(() => validateGoldenAnnotation({ ...fixture, events: [{ ...fixture.events[0], visibility: "hidden" }, fixture.events[1]] }), error => error instanceof CookingVideoError && /cannot be hidden/.test(error.message));
  const draft = structuredClone(fixture);
  draft.status = "draft";
  draft.bestShots = [];
  delete draft.review;
  assert.equal(validateGoldenAnnotation(draft).status, "draft");
  const schema = JSON.parse(await readFile(path.join("..", "suite", "presets", "cooking-promo-video", "schemas", "golden-annotation.schema.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "1.0");
});

test("cooking video queue enforces concurrency, deduplicates, cancels queued work, and emits progress", async () => {
  assert.throws(() => new CookingVideoQueue({ concurrency: 0 }), /integer from 1 to 8/);
  let active = 0;
  let maximumActive = 0;
  const releases = [];
  const events = [];
  const runner = async (_store, jobId) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => releases.push(resolve));
    active -= 1;
    return { state: { schemaVersion: "1.0", jobId, status: "completed", createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:01.000Z", stages: [] }, stoppedForApproval: false };
  };
  const queue = new CookingVideoQueue({ concurrency: 2, runner, onEvent: event => events.push(event) });
  const one = queue.enqueue({ jobsRoot: "queue-fixture", jobId: "job-1" });
  const duplicate = queue.enqueue({ jobsRoot: "queue-fixture", jobId: "job-1" });
  const two = queue.enqueue({ jobsRoot: "queue-fixture", jobId: "job-2" });
  const three = queue.enqueue({ jobsRoot: "queue-fixture", jobId: "job-3" });
  const four = queue.enqueue({ jobsRoot: "queue-fixture", jobId: "job-4" });
  assert.equal(duplicate.queueId, one.queueId);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(maximumActive, 2);
  assert.equal(queue.list().find(item => item.queueId === three.queueId).position, 1);
  assert.equal(queue.cancel(four.queueId).status, "cancelled");
  releases.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(active, 2);
  for (const release of releases.splice(0)) release();
  await new Promise(resolve => setImmediate(resolve));
  for (const release of releases.splice(0)) release();
  await queue.waitForIdle();
  assert.equal(maximumActive, 2);
  assert.equal(queue.list().filter(item => item.status === "completed").length, 3);
  assert.equal(events.some(event => event.phase === "queued"), true);
  assert.equal(events.some(event => event.phase === "started"), true);
  assert.equal(events.some(event => event.phase === "completed"), true);
  assert.equal(events.some(event => event.phase === "cancelled"), true);
  assert.equal(two.jobId, "job-2");
});

test("cooking video queue forwards stage transitions and aborts running work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-queue-"));
  try {
    const events = [];
    const stageQueue = new CookingVideoQueue({ concurrency: 1, onEvent: event => events.push(event), runner: async (store, jobId) => {
      const created = await store.create(sampleJob(jobId));
      const state = await store.transition(jobId, "ingesting");
      return { state, stoppedForApproval: false };
    }});
    stageQueue.enqueue({ jobsRoot: root, jobId: "queue-stage" });
    await stageQueue.waitForIdle();
    assert.equal(events.some(event => event.phase === "stage" && event.transition?.to === "ingesting"), true);

    const abortQueue = new CookingVideoQueue({ concurrency: 1, runner: async (_store, jobId, options) => {
      await new Promise((resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      return { state: { schemaVersion: "1.0", jobId, status: "completed", createdAt: "", updatedAt: "", stages: [] }, stoppedForApproval: false };
    }});
    const running = abortQueue.enqueue({ jobsRoot: root, jobId: "queue-abort" });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(abortQueue.cancel(running.queueId).status, "cancelling");
    await abortQueue.waitForIdle();
    assert.equal(abortQueue.list().find(item => item.queueId === running.queueId).status, "cancelled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persists optimistic EDL revisions and review decisions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-review-"));
  try {
    const store = new JobStore(root);
    const created = await store.create(sampleJob());
    const manifest = {
      schemaVersion: "1.0", jobId: "cook-001", generatedAt: "2026-09-05T00:00:00.000Z", warnings: [],
      sources: [
        { cameraId: "top", path: "input/top.mp4", byteSize: 1, sha256: "a", durationMs: 5000, streams: [] },
        { cameraId: "front", path: "input/front.mp4", byteSize: 1, sha256: "b", durationMs: 5000, streams: [] },
      ],
    };
    const decision = {
      schemaVersion: "1.0", jobId: "cook-001", templateId: "fixture", fps: 30, aspectRatio: "9:16", durationTargetMs: 2500,
      segments: [{ id: "seg-1", cameraId: "top", sourceStartMs: 0, sourceEndMs: 1000, timelineStartMs: 0, event: "stir_fry", caption: "翻炒", transition: "cut", crop: { mode: "cover", focusX: 0.5, focusY: 0.5 } }],
      audio: { retainSourceAudio: true, sourceGainDb: -8, musicGainDb: -14 }, endCard: { durationMs: 1500, headline: "让每一道菜都稳定出品" },
    };
    await mkdir(created.paths.analysis, { recursive: true });
    await writeFile(path.join(created.paths.analysis, "media-manifest.json"), JSON.stringify(manifest));
    await writeFile(path.join(created.paths.edit, "edit-decision.json"), JSON.stringify(decision));
    let workspace = await loadReviewWorkspace(store, "cook-001");
    assert.equal(workspace.review.revision, 1);
    workspace = await saveReviewEdit(store, "cook-001", 1, { ...decision, segments: [{ ...decision.segments[0], cameraId: "front", caption: "均匀翻炒" }] });
    assert.equal(workspace.review.revision, 2);
    assert.equal(workspace.decision.segments[0].cameraId, "front");
    await assert.rejects(() => saveReviewEdit(store, "cook-001", 1, decision), error => error instanceof CookingVideoError && error.code === "EDIT_REVISION_CONFLICT");
    await assert.rejects(() => submitReview(store, "cook-001", 2, "changes_requested"), error => error instanceof CookingVideoError && error.code === "REVIEW_ACTION_INVALID");
    const review = await submitReview(store, "cook-001", 2, "changes_requested", { note: "请缩短开场", reviewer: "operator" });
    assert.equal(review.history.length, 1);
    const feedbackStore = new CookingVideoFeedbackStore(root);
    const feedback = await feedbackStore.summary("cook-001", new Date("2026-09-05T00:01:00.000Z"));
    assert.equal(feedback.editSessions, 1);
    assert.equal(feedback.cameraChanges, 1);
    assert.equal(feedback.cameraChangeRate, 1);
    assert.equal(feedback.captionChanges, 1);
    assert.equal(feedback.failureModes.pacing, 1);
    assert.deepEqual(classifyReviewFailureModes("镜头模糊且需要修改字幕"), ["camera_choice", "image_quality", "copy"]);
    const feedbackLog = await readFile(created.paths.feedbackMetricsFile, "utf8");
    assert.equal(feedbackLog.includes("请缩短开场"), false);
    assert.equal(feedbackLog.includes("均匀翻炒"), false);
    assert.equal((await listReviewJobs(store)).length, 1);
    await store.transition("cook-001", "ingesting");
    await store.transition("cook-001", "failed");
    await prepareReviewRerender(store, "cook-001");
    assert.equal((await store.load("cook-001")).state.status, "awaiting_review");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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

test("validates media manifests and shot candidates against job boundaries", () => {
  const manifest = {
    schemaVersion: "1.0", jobId: "cook-001", generatedAt: "2026-09-04T00:00:00.000Z", warnings: [],
    sources: [
      { cameraId: "top", path: "input/top.mp4", byteSize: 1, sha256: "a", durationMs: 5000, streams: [{ index: 0, codecType: "video" }] },
      { cameraId: "front", path: "input/front.mp4", byteSize: 1, sha256: "b", durationMs: 5000, streams: [{ index: 0, codecType: "video" }] },
    ],
  };
  assert.equal(validateMediaManifest(manifest, "cook-001").sources.length, 2);
  assert.throws(() => validateMediaManifest({ ...manifest, jobId: "other" }, "cook-001"), error => error instanceof CookingVideoError && error.code === "ARTIFACT_INVALID");
  assert.throws(() => validateMediaManifest({ ...manifest, sources: [{ ...manifest.sources[0], path: "../other/input.mp4" }, manifest.sources[1]] }), error => error instanceof CookingVideoError && error.code === "ARTIFACT_INVALID");
  assert.throws(() => validateMediaManifest({ ...manifest, sources: [{ ...manifest.sources[0], path: "analysis/top.mp4" }, manifest.sources[1]] }), error => error instanceof CookingVideoError && error.code === "ARTIFACT_INVALID");

  const candidate = {
    occurrenceId: "evt-1", cameraId: "top", startMs: 0, endMs: 1000, event: "stir_fry", confidence: 0.9,
    evidenceFrames: [], rank: 1, selected: true, problems: [],
    scores: { eventConfidence: 0.9, roleFit: 1, resolution: 1, durationFit: 1, exposure: 1, dynamicRange: 1, saturation: 1, sharpness: 1, motion: 1, stability: 1, continuity: 1, verticalCrop: 1, occlusionPenalty: 0, repetitionPenalty: 0, total: 0.99 },
  };
  const candidates = { schemaVersion: "1.0", jobId: "cook-001", generatedAt: "2026-09-04T00:00:00.000Z", candidates: [candidate] };
  assert.equal(validateShotCandidates(candidates, manifest).candidates.length, 1);
  assert.throws(() => validateShotCandidates({ ...candidates, candidates: [{ ...candidate, endMs: 6000 }] }, manifest), error => error instanceof CookingVideoError && error.code === "ARTIFACT_INVALID");
  assert.throws(() => validateShotCandidates({ ...candidates, candidates: [candidate, { ...candidate, cameraId: "front" }] }, manifest), error => error instanceof CookingVideoError && error.code === "ARTIFACT_INVALID");
  assert.throws(() => validateShotCandidates({ ...candidates, candidates: [candidate, { ...candidate, cameraId: "front", selected: false }] }, manifest), error => error instanceof CookingVideoError && error.code === "ARTIFACT_INVALID");
});

test("cleans only temporary artifacts and preserves inputs and completed outputs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-cleanup-"));
  try {
    const created = await new JobStore(root).create(sampleJob());
    await Promise.all([
      writeFile(path.join(created.paths.input, "camera.part.mp4"), "recording-input"),
      writeFile(path.join(created.paths.proxy, "top.part.mp4"), "partial"),
      writeFile(path.join(created.paths.analysis, "manifest.abc.tmp"), "partial"),
      writeFile(path.join(created.paths.output, "promo.mp4"), "complete"),
    ]);
    assert.deepEqual(await cleanupJobTemporaryFiles(created.paths), ["analysis/manifest.abc.tmp", "proxy/top.part.mp4"]);
    assert.equal(await readFile(path.join(created.paths.input, "camera.part.mp4"), "utf8"), "recording-input");
    assert.equal(await readFile(path.join(created.paths.output, "promo.mp4"), "utf8"), "complete");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps identical job ids isolated across tenant roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-tenants-"));
  try {
    const tenantA = new JobStore(path.join(root, "tenant-a"));
    const tenantB = new JobStore(path.join(root, "tenant-b"));
    const [jobA, jobB] = await Promise.all([tenantA.create(sampleJob()), tenantB.create(sampleJob())]);
    await Promise.all([writeFile(path.join(jobA.paths.input, "top.mp4"), "tenant-a"), writeFile(path.join(jobB.paths.input, "top.mp4"), "tenant-b")]);
    assert.notEqual(jobA.paths.root, jobB.paths.root);
    assert.equal(await readFile(path.join((await tenantA.load("cook-001")).paths.input, "top.mp4"), "utf8"), "tenant-a");
    assert.equal(await readFile(path.join((await tenantB.load("cook-001")).paths.input, "top.mp4"), "utf8"), "tenant-b");
    assert.throws(() => resolveWithin(jobA.paths.root, jobB.paths.root), error => error instanceof CookingVideoError && error.code === "PATH_OUTSIDE_JOB");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

test("scans stable camera folders and consumes each batch exactly once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-intake-"));
  const inbox = path.join(root, "inbox");
  const jobs = path.join(root, "jobs");
  try {
    const readyBatch = path.join(inbox, "cook-20260904-001");
    const waitingBatch = path.join(inbox, "cook-20260904-002");
    await Promise.all([mkdir(readyBatch, { recursive: true }), mkdir(waitingBatch, { recursive: true }), mkdir(jobs, { recursive: true })]);
    await Promise.all([
      writeFile(path.join(readyBatch, "top.mp4"), "top-video"),
      writeFile(path.join(readyBatch, "front.mp4"), "front-video"),
      writeFile(path.join(readyBatch, "_READY"), ""),
      writeFile(path.join(waitingBatch, "top.mp4"), "top-video"),
      writeFile(path.join(waitingBatch, "front.mp4"), "front-video"),
    ]);
    const scanned = await scanInbox(inbox, jobs, { stableSeconds: 86_400 });
    assert.equal(scanned.find(batch => batch.batchId.endsWith("001")).status, "ready");
    assert.equal(scanned.find(batch => batch.batchId.endsWith("002")).status, "waiting");

    const consumed = await consumeInbox(inbox, jobs, { stableSeconds: 86_400, batchId: "cook-20260904-001", now: new Date("2026-09-04T00:00:00.000Z") });
    assert.equal(consumed.consumed.length, 1);
    const loaded = await new JobStore(jobs).load("cook-20260904-001");
    assert.equal(loaded.job.brief.requireHumanApproval, true);
    assert.equal(await readFile(path.join(loaded.paths.input, "top.mp4"), "utf8"), "top-video");
    assert.equal((await scanInbox(inbox, jobs, { batchId: "cook-20260904-001" }))[0].status, "consumed");
    const repeated = await consumeInbox(inbox, jobs, { batchId: "cook-20260904-001" });
    assert.deepEqual(repeated.consumed, []);
    assert.equal(repeated.skipped[0].status, "consumed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not adopt an unrelated existing job with the same inbox batch id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-intake-collision-"));
  const inbox = path.join(root, "inbox");
  const jobs = path.join(root, "jobs");
  try {
    const batch = path.join(inbox, "cook-001");
    await mkdir(batch, { recursive: true });
    await Promise.all([writeFile(path.join(batch, "top.mp4"), "top"), writeFile(path.join(batch, "front.mp4"), "front"), writeFile(path.join(batch, "_READY"), "")]);
    await new JobStore(jobs).create(sampleJob());
    const scanned = await scanInbox(inbox, jobs, { batchId: "cook-001" });
    assert.equal(scanned[0].status, "invalid");
    assert.match(scanned[0].reason, /was not created by inbox consumption/);
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

test("uses explicit low-confidence aligned-start fallback for silent camera files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-aligned-start-"));
  try {
    const created = await new JobStore(root).create(sampleJob());
    await writeFile(path.join(created.paths.analysis, "media-manifest.json"), JSON.stringify({
      schemaVersion: "1.0", jobId: "cook-001", generatedAt: "2026-09-04T00:00:00.000Z", warnings: [],
      sources: [
        { cameraId: "top", path: "input/top.mp4", byteSize: 1, sha256: "a", durationMs: 5000, streams: [{ index: 0, codecType: "video" }] },
        { cameraId: "front", role: "machine_full", path: "input/front.mp4", byteSize: 1, sha256: "b", durationMs: 5000, streams: [{ index: 0, codecType: "video" }] },
      ],
    }));
    await assert.rejects(() => synchronizeJob(created.paths), error => error instanceof CookingVideoError && error.code === "SYNC_INPUT_INVALID");
    const sync = await synchronizeJob(created.paths, { allowAlignedStart: true, now: new Date("2026-09-04T00:00:00.000Z") });
    assert.equal(sync.method, "aligned_start");
    assert.equal(sync.confidence, 0.25);
    assert.deepEqual(sync.cameras, { top: { offsetMs: 0 }, front: { offsetMs: 0 } });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

test("creates explicitly unverified offline events when machine logs and cloud vision are unavailable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-heuristic-"));
  try {
    const job = sampleJob();
    delete job.machineEventsPath;
    const created = await new JobStore(root).create(job);
    await writeFile(path.join(created.paths.analysis, "media-manifest.json"), JSON.stringify({
      schemaVersion: "1.0", jobId: job.jobId, generatedAt: "2026-09-04T00:00:00.000Z", warnings: [],
      sources: [
        { cameraId: "top", path: "input/top.mp4", proxyPath: "proxy/top.mp4", byteSize: 1, sha256: "a", durationMs: 10_000, streams: [] },
        { cameraId: "front", path: "input/front.mp4", proxyPath: "proxy/front.mp4", byteSize: 1, sha256: "b", durationMs: 10_000, streams: [] },
      ],
    }));
    await writeFile(path.join(created.paths.analysis, "scene-cuts.json"), JSON.stringify({
      schemaVersion: "1.0", jobId: job.jobId, generatedAt: "2026-09-04T00:00:00.000Z",
      sources: [
        { cameraId: "top", cutsMs: [], motionSamples: [{ timeMs: 2600, score: 3 }, { timeMs: 6200, score: 12 }] },
        { cameraId: "front", cutsMs: [], motionSamples: [{ timeMs: 5000, score: 8 }] },
      ],
    }));
    const calls = [];
    const timeline = await detectJobEvents(job, created.paths, {
      runner: async (command, args) => { calls.push({ command, args }); return { exitCode: 0, stdout: "", stderr: "" }; },
      now: new Date("2026-09-04T00:00:00.000Z"),
    });
    assert.equal(timeline.source, "heuristic");
    assert.equal(timeline.events.length, 12);
    assert.equal(timeline.events.every(event => event.confidence === 0.35 && event.problems.includes("human_review_required")), true);
    assert.equal(calls.some(call => call.args.includes("6.200")), true, "stir-fry window should use the strongest motion sample");
    await assert.rejects(
      () => detectHeuristicEvents({ ...job, brief: { ...job.brief, requireHumanApproval: false } }, created.paths),
      error => error instanceof CookingVideoError && error.code === "APPROVAL_REQUIRED",
    );
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

test("vision adapter batches requests and retries invalid JSON within limits", async () => {
  const items = Array.from({ length: 3 }, (_, index) => ({ id: `frame-${index}`, cameraId: "top", sourceTimeMs: index * 1000, sourceDurationMs: 5000, timelineTimeMs: index * 1000, imagePath: `frames/vision/frame-${index}.jpg` }));
  const request = { schemaVersion: "1.0", jobId: "cook-001", generatedAt: "2026-09-04T00:00:00.000Z", intervalMs: 1000, allowedEvents: ["stir_fry", "unknown"], items };
  const calls = [];
  const metrics = [];
  const result = await runVisionAdapter(request, async (batch, context) => {
    calls.push({ ids: batch.items.map(item => item.id), ...context });
    if (context.batchIndex === 0 && context.attempt === 1) return "not-json";
    return JSON.stringify({ schemaVersion: "1.0", jobId: batch.jobId, detections: batch.items.map(item => ({ itemId: item.id, event: "stir_fry", confidence: 0.9 })) });
  }, { allowFrameTransfer: true, maxItemsPerCall: 2, maxAttempts: 2, estimatedCostPerItemUsd: 0.01, maxBudgetUsd: 0.05, onMetric: metric => metrics.push(metric) });
  assert.equal(result.response.detections.length, 3);
  assert.equal(result.metrics.attempts, 3);
  assert.equal(result.metrics.estimatedCostUsd, 0.05);
  assert.equal(result.metrics.failedCalls, 1);
  assert.deepEqual(metrics.map(metric => metric.status), ["failed", "succeeded", "succeeded"]);
  assert.deepEqual(calls.map(call => call.ids.length), [2, 2, 1]);
});

test("vision adapter enforces authorization, budget, timeout, and invalid-response failure", async () => {
  const request = {
    schemaVersion: "1.0", jobId: "cook-001", generatedAt: "2026-09-04T00:00:00.000Z", intervalMs: 1000,
    allowedEvents: ["unknown"], items: [{ id: "frame-0", cameraId: "top", sourceTimeMs: 0, sourceDurationMs: 1000, timelineTimeMs: 0, imagePath: "frames/vision/frame-0.jpg" }],
  };
  const unused = async () => { throw new Error("must not run"); };
  await assert.rejects(() => runVisionAdapter(request, unused, { allowFrameTransfer: false }), error => error instanceof CookingVideoError && error.code === "VISION_RESPONSE_REQUIRED");
  await assert.rejects(() => runVisionAdapter(request, unused, { allowFrameTransfer: true, estimatedCostPerItemUsd: 1, maxBudgetUsd: 0.5 }), error => error instanceof CookingVideoError && error.code === "MODEL_BUDGET_EXCEEDED");
  await assert.rejects(() => runVisionAdapter(request, async () => await new Promise(() => {}), { allowFrameTransfer: true, timeoutMs: 10, maxAttempts: 1 }), error => error instanceof CookingVideoError && error.code === "MODEL_TIMEOUT");
  let attempts = 0;
  await assert.rejects(() => runVisionAdapter(request, async () => { attempts += 1; return "invalid"; }, { allowFrameTransfer: true, maxAttempts: 2 }), error => error instanceof CookingVideoError && error.code === "VISION_RESPONSE_INVALID");
  assert.equal(attempts, 2);
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
  assert.equal(result.candidates.every(candidate => ["foodAppeal", "actionSalience", "productVisibility", "composition"].every(key => candidate.scores[key] >= 0 && candidate.scores[key] <= 1)), true);
  const invalidTimeline = { ...timeline, events: [{ ...timeline.events[0], occurrenceId: "" }] };
  assert.throws(() => selectShots(invalidTimeline, manifest), error => error instanceof CookingVideoError && error.code === "EVENT_INPUT_INVALID");
});

test("validates bounded shot-quality model scores and retries malformed output", async () => {
  const request = { schemaVersion: "1.0", jobId: "cook-001", items: [{ candidateId: "evt-1/top", imagePath: "frames/top.jpg", event: "stir_fry", cameraRole: "food_closeup" }] };
  let calls = 0;
  const result = await runShotQualityAdapter(request, async () => {
    calls += 1;
    if (calls === 1) return "invalid";
    return { schemaVersion: "1.0", jobId: "cook-001", scores: [{ candidateId: "evt-1/top", foodAppeal: 0.9, actionSalience: 0.8, productVisibility: 0.6, composition: 0.85 }] };
  }, { allowFrameTransfer: true, maxAttempts: 2 });
  assert.equal(result.attempts, 2);
  assert.equal(result.response.scores[0].foodAppeal, 0.9);
  await assert.rejects(() => runShotQualityAdapter(request, async () => ({ schemaVersion: "1.0", jobId: "cook-001", scores: [] }), { allowFrameTransfer: true, maxAttempts: 1 }), error => error instanceof CookingVideoError && /every requested candidate/.test(error.message));
  await assert.rejects(() => runShotQualityAdapter(request, async () => ({}), { allowFrameTransfer: false }), error => error instanceof CookingVideoError && error.code === "VISION_RESPONSE_REQUIRED");
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

test("penalizes shaky, occluded, repetitive, and unsafe vertical candidates", () => {
  const manifest = {
    schemaVersion: "1.0", jobId: "cook-001", generatedAt: "2026-09-04T00:00:00.000Z", warnings: [],
    sources: [
      { cameraId: "wide", role: "machine_full", path: "input/wide.mp4", byteSize: 1, sha256: "a", durationMs: 8000, streams: [{ index: 0, codecType: "video", width: 3840, height: 1080 }] },
      { cameraId: "close", role: "food_closeup", path: "input/close.mp4", byteSize: 1, sha256: "b", durationMs: 8000, streams: [{ index: 0, codecType: "video", width: 1080, height: 1920 }] },
    ],
  };
  const events = ["ingredient_added", "stir_fry"].flatMap((event, occurrence) => manifest.sources.map(source => ({
    occurrenceId: `evt-${occurrence}`, cameraId: source.cameraId, startMs: occurrence * 3000, endMs: occurrence * 3000 + 2500,
    event, confidence: 0.9, evidenceFrames: [], problems: source.cameraId === "wide" ? ["occluded"] : [],
  })));
  const scene = {
    schemaVersion: "1.0", jobId: manifest.jobId, generatedAt: manifest.generatedAt,
    sources: [
      { cameraId: "wide", cutsMs: [], motionSamples: [{ timeMs: 0, score: 0 }, { timeMs: 1000, score: 12 }, { timeMs: 3000, score: 0 }, { timeMs: 4000, score: 12 }] },
      { cameraId: "close", cutsMs: [], motionSamples: [{ timeMs: 0, score: 6 }, { timeMs: 1000, score: 7 }, { timeMs: 3000, score: 6 }, { timeMs: 4000, score: 7 }] },
    ],
  };
  const result = selectShots({ schemaVersion: "1.0", jobId: manifest.jobId, generatedAt: manifest.generatedAt, source: "vision", events }, manifest, new Date(manifest.generatedAt), new Map(), scene);
  const wide = result.candidates.find(candidate => candidate.cameraId === "wide");
  const secondClose = result.candidates.find(candidate => candidate.cameraId === "close" && candidate.occurrenceId === "evt-1");
  assert.equal(wide.problems.includes("shaky"), true);
  assert.equal(wide.scores.occlusionPenalty, 0.25);
  assert.ok(wide.scores.verticalCrop < 0.5);
  assert.ok(secondClose.scores.repetitionPenalty > 0);
  assert.equal(result.candidates.filter(candidate => candidate.selected).every(candidate => candidate.cameraId === "close"), true);
});

test("rejects prohibited promotional claims and unsupported event captions", () => {
  const decision = {
    schemaVersion: "1.0", jobId: "cook-001", templateId: "fixture", fps: 30, aspectRatio: "9:16", durationTargetMs: 2500,
    segments: [{ id: "seg-1", cameraId: "top", sourceStartMs: 0, sourceEndMs: 1000, timelineStartMs: 0, event: "stir_fry", caption: "自动翻炒", transition: "cut", crop: { mode: "cover", focusX: 0.5, focusY: 0.5 } }],
    audio: { retainSourceAudio: true, sourceGainDb: -8, musicGainDb: -14 }, endCard: { durationMs: 1500, headline: "品牌展示" },
  };
  assert.doesNotThrow(() => validatePromotionalCopy(sampleJob(), decision));
  assert.throws(() => validatePromotionalCopy(sampleJob(), { ...decision, segments: [{ ...decision.segments[0], caption: "效率提升100%" }] }), error => error instanceof CookingVideoError && error.code === "EDIT_CONSTRAINT_VIOLATION");
  assert.throws(() => validatePromotionalCopy(sampleJob(), { ...decision, segments: [{ ...decision.segments[0], event: "machine_intro", caption: "自动投料" }] }), error => error instanceof CookingVideoError && error.code === "EDIT_CONSTRAINT_VIOLATION");
});

test("copy adapter retries structured output and enforces evidence-backed claims", async () => {
  const request = {
    schemaVersion: "1.0", jobId: "cook-001", language: "zh-CN", dishName: "宫保鸡丁",
    verifiedSellingPoints: ["自动翻炒"], evidenceEvents: ["stir_fry", "finished_dish"],
  };
  let calls = 0;
  const metrics = [];
  const result = await runCopyAdapter(request, async () => {
    calls += 1;
    if (calls === 1) return "invalid";
    return { schemaVersion: "1.0", jobId: "cook-001", title: "宫保鸡丁制作过程", captions: [{ event: "stir_fry", text: "自动翻炒，过程可见" }], cta: "了解设备详情" };
  }, { allowModelCall: true, maxAttempts: 2, estimatedCostPerCallUsd: 0.002, maxBudgetUsd: 0.004, onMetric: metric => metrics.push(metric) });
  assert.equal(result.attempts, 2);
  assert.equal(result.metrics.failedCalls, 1);
  assert.equal(result.metrics.estimatedCostUsd, 0.004);
  assert.deepEqual(metrics.map(metric => metric.status), ["failed", "succeeded"]);
  assert.equal(result.copy.captions[0].event, "stir_fry");
  await assert.rejects(() => runCopyAdapter(request, async () => ({ schemaVersion: "1.0", jobId: "cook-001", title: "行业第一", captions: [{ event: "stir_fry", text: "自动翻炒" }], cta: "了解详情" }), { allowModelCall: true, maxAttempts: 1 }), error => error instanceof CookingVideoError && error.code === "EDIT_CONSTRAINT_VIOLATION");
  await assert.rejects(() => runCopyAdapter(request, async () => ({ schemaVersion: "1.0", jobId: "cook-001", title: "设备展示", captions: [{ event: "ingredient_added", text: "自动投料" }], cta: "了解详情" }), { allowModelCall: true, maxAttempts: 1 }), error => error instanceof CookingVideoError && error.code === "MODEL_CALL_FAILED");
  await assert.rejects(() => runCopyAdapter(request, async () => ({ schemaVersion: "1.0", jobId: "cook-001", title: "超级节能设备", captions: [{ event: "stir_fry", text: "自动翻炒" }], cta: "了解详情" }), { allowModelCall: true, maxAttempts: 1 }), error => error instanceof CookingVideoError && error.code === "EDIT_CONSTRAINT_VIOLATION");
});

test("persists and summarizes model-call cost, latency, and failures per job", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-metrics-"));
  try {
    const store = new JobStore(root);
    await store.create(sampleJob());
    const metrics = new CookingVideoMetricsStore(root);
    await Promise.all([
      metrics.record({ schemaVersion: "1.0", jobId: "cook-001", operation: "vision", status: "succeeded", attempt: 1, batchIndex: 0, startedAt: "2026-09-04T00:00:00.000Z", durationMs: 100, inputUnits: 3, outputUnits: 3, estimatedCostUsd: 0.03 }),
      metrics.record({ schemaVersion: "1.0", jobId: "cook-001", operation: "vision", status: "timeout", attempt: 2, batchIndex: 0, startedAt: "2026-09-04T00:00:01.000Z", durationMs: 300, inputUnits: 3, outputUnits: 0, estimatedCostUsd: 0.03, errorCode: "MODEL_TIMEOUT" }),
      metrics.record({ schemaVersion: "1.0", jobId: "cook-001", operation: "copy", status: "failed", attempt: 1, startedAt: "2026-09-04T00:00:02.000Z", durationMs: 200, inputUnits: 120, outputUnits: 0, estimatedCostUsd: 0.002, errorCode: "MODEL_CALL_FAILED" }),
    ]);
    const summary = await metrics.summary("cook-001", new Date("2026-09-04T00:01:00.000Z"));
    assert.equal(summary.model.calls, 3);
    assert.equal(summary.model.succeeded, 1);
    assert.equal(summary.model.failed, 1);
    assert.equal(summary.model.timedOut, 1);
    assert.equal(summary.model.estimatedCostUsd, 0.062);
    assert.equal(summary.model.averageDurationMs, 200);
    assert.equal(summary.model.p95DurationMs, 300);
    assert.equal(summary.model.byOperation.vision.calls, 2);
    assert.equal((await metrics.list("cook-001")).length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
  assert.equal(decision.segments[0].caption, "成品出锅，过程清晰");
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
    assert.equal(built.outputFile.endsWith("promo-vertical-3s-draft.mp4"), true);
    assert.equal(built.args.at(-1).endsWith("promo-vertical-3s-draft.part.mp4"), true);
    const invalid = { ...decision, segments: [{ ...decision.segments[0], sourceEndMs: 6000 }], durationTargetMs: 7500 };
    assert.throws(() => buildRenderArgs(created.job, created.paths, invalid, manifest), error => error instanceof CookingVideoError && error.code === "EDIT_CONSTRAINT_VIOLATION");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("routes supported aspect ratios to fixed Remotion compositions", () => {
  const base = { aspectRatio: "9:16", durationTargetMs: 15000 };
  assert.equal(remotionCompositionId(base), "CookingPromo15");
  assert.equal(remotionCompositionId({ ...base, aspectRatio: "16:9", durationTargetMs: 30000 }), "CookingPromoLandscape30");
  assert.equal(remotionCompositionId({ ...base, aspectRatio: "1:1" }), "CookingPromoSquare15");
  assert.equal(remotionCompositionId({ ...base, aspectRatio: "1:1", durationTargetMs: 30000 }), "CookingPromoSquare30");
  assert.throws(() => remotionCompositionId({ ...base, aspectRatio: "16:9" }), error => error instanceof CookingVideoError && error.code === "EDIT_CONSTRAINT_VIOLATION");
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
    assert.equal(report.checks.length, 14);
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
      const output = args.at(-1);
      if (typeof output === "string" && output !== "-" && /\.(?:mp4|jpg)$/i.test(output)) await writeFile(output, "generated-fixture");
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

test("ingest reports duration mismatch and preserves cameras without audio", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-cooking-ingest-edge-"));
  try {
    const created = await new JobStore(root).create(sampleJob());
    await Promise.all([writeFile(path.join(created.paths.input, "top.mp4"), "top"), writeFile(path.join(created.paths.input, "front.mp4"), "front")]);
    const runner = async (command, args) => {
      if (command === "ffprobe") {
        const isTop = args.at(-1).endsWith("top.mp4");
        return { exitCode: 0, stdout: JSON.stringify({ format: { duration: isTop ? "30" : "12" }, streams: [{ index: 0, codec_type: "video", codec_name: "h264", width: 1280, height: 720, avg_frame_rate: "30/1" }] }), stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const manifest = await ingestMedia(created.job, created.paths, { runner, generateProxy: false, generateContactSheet: false });
    assert.equal(manifest.warnings.length, 1);
    assert.equal(manifest.sources.every(source => source.streams.every(stream => stream.codecType !== "audio")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
