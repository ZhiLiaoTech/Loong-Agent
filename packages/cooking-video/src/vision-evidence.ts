import { mkdir } from "node:fs/promises";
import path from "node:path";
import { CookingVideoError } from "./errors.js";
import { readJsonFile, writeJsonAtomic } from "./json-files.js";
import { resolveWithin, type JobPaths } from "./paths.js";
import { runChecked, runProcess, type ProcessRunner } from "./process-runner.js";
import {
  COOKING_EVENTS,
  type CookingEvent,
  type EventTimeline,
  type MediaManifest,
  type SyncMap,
  type VisionDetection,
  type VisionEvidenceRequest,
  type VisionEvidenceResponse,
} from "./types.js";

export interface PrepareVisionOptions {
  runner?: ProcessRunner;
  ffmpegCommand?: string;
  intervalMs?: number;
  maxFrames?: number;
  signal?: AbortSignal;
  now?: Date;
}

function evidenceInterval(manifest: MediaManifest, requested: number, maxFrames: number): number {
  const totalDuration = manifest.sources.reduce((sum, source) => sum + source.durationMs, 0);
  return Math.max(requested, Math.ceil(totalDuration / maxFrames / 1000) * 1000);
}

export async function prepareVisionEvidence(paths: JobPaths, options: PrepareVisionOptions = {}): Promise<VisionEvidenceRequest> {
  const [manifest, syncMap] = await Promise.all([
    readJsonFile<MediaManifest>(path.join(paths.analysis, "media-manifest.json")),
    readJsonFile<SyncMap>(path.join(paths.analysis, "sync-map.json")),
  ]);
  if (manifest.jobId !== syncMap.jobId) throw new CookingVideoError("EVENT_INPUT_INVALID", "Media manifest and sync map belong to different jobs.");
  const maxFrames = options.maxFrames ?? 120;
  if (!Number.isInteger(maxFrames) || maxFrames < 2 || maxFrames > 500) throw new CookingVideoError("EVENT_INPUT_INVALID", "maxFrames must be between 2 and 500.");
  const intervalMs = evidenceInterval(manifest, options.intervalMs ?? 2_000, maxFrames);
  const runner = options.runner ?? runProcess;
  const ffmpeg = options.ffmpegCommand ?? "ffmpeg";
  const directory = path.join(paths.frames, "vision");
  await mkdir(directory, { recursive: true });
  const items: VisionEvidenceRequest["items"] = [];

  for (const source of manifest.sources) {
    const sync = syncMap.cameras[source.cameraId];
    if (!sync) throw new CookingVideoError("EVENT_INPUT_INVALID", `Sync map has no camera ${source.cameraId}.`);
    const mediaFile = resolveWithin(paths.root, source.proxyPath ?? source.path);
    for (let sourceTimeMs = Math.min(500, Math.floor(source.durationMs / 2)); sourceTimeMs < source.durationMs; sourceTimeMs += intervalMs) {
      if (items.length >= maxFrames) break;
      const id = `${source.cameraId}-${String(sourceTimeMs).padStart(8, "0")}`;
      const frameFile = path.join(directory, `${id}.jpg`);
      await runChecked(runner, ffmpeg, [
        "-y", "-ss", (sourceTimeMs / 1000).toFixed(3), "-i", mediaFile,
        "-frames:v", "1", "-vf", "scale=640:-2,format=yuvj420p", "-update", "1", frameFile,
      ], { signal: options.signal });
      items.push({
        id,
        cameraId: source.cameraId,
        sourceTimeMs,
        sourceDurationMs: source.durationMs,
        timelineTimeMs: sourceTimeMs + sync.offsetMs,
        imagePath: path.relative(paths.root, frameFile).replace(/\\/g, "/"),
      });
    }
  }
  if (items.length === 0) throw new CookingVideoError("EVENT_INPUT_INVALID", "No visual evidence frames could be scheduled.");
  const request: VisionEvidenceRequest = {
    schemaVersion: "1.0",
    jobId: manifest.jobId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    intervalMs,
    allowedEvents: COOKING_EVENTS,
    items,
  };
  await writeJsonAtomic(path.join(paths.analysis, "vision-request.json"), request);
  return request;
}

function validateDetection(raw: VisionDetection, items: Map<string, VisionEvidenceRequest["items"][number]>): VisionDetection {
  if (!raw || typeof raw !== "object" || typeof raw.itemId !== "string" || !items.has(raw.itemId)) {
    throw new CookingVideoError("VISION_RESPONSE_INVALID", `Vision response references unknown item ${raw?.itemId ?? "<missing>"}.`);
  }
  const extraKeys = Object.keys(raw).filter(key => !["itemId", "event", "confidence", "problems"].includes(key));
  if (extraKeys.length > 0) {
    throw new CookingVideoError("VISION_RESPONSE_INVALID", `Vision detection ${raw.itemId} contains unsupported fields: ${extraKeys.join(", ")}.`);
  }
  if (!COOKING_EVENTS.includes(raw.event)) throw new CookingVideoError("VISION_RESPONSE_INVALID", `Unsupported vision event: ${raw.event}.`);
  if (!Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) {
    throw new CookingVideoError("VISION_RESPONSE_INVALID", `Invalid confidence for ${raw.itemId}.`);
  }
  if (raw.problems !== undefined && (!Array.isArray(raw.problems) || raw.problems.length > 10 || raw.problems.some(problem => typeof problem !== "string" || problem.length === 0 || problem.length > 64))) {
    throw new CookingVideoError("VISION_RESPONSE_INVALID", `Invalid problems for ${raw.itemId}.`);
  }
  return { itemId: raw.itemId, event: raw.event, confidence: raw.confidence, ...(raw.problems ? { problems: [...raw.problems] } : {}) };
}

export function importVisionDetections(request: VisionEvidenceRequest, response: VisionEvidenceResponse, now = new Date()): EventTimeline {
  const validated = validateVisionResponse(request, response);
  const items = new Map(request.items.map(item => [item.id, item]));
  const events = validated.detections.map(detection => {
    const item = items.get(detection.itemId)!;
    const bucket = Math.round(item.timelineTimeMs / request.intervalMs);
    const startMs = Math.max(0, item.sourceTimeMs - 2_000);
    return {
      occurrenceId: `vision-${String(bucket).padStart(5, "0")}-${detection.event}`,
      cameraId: item.cameraId,
      startMs,
      endMs: Math.min(item.sourceDurationMs, item.sourceTimeMs + 3_000),
      event: detection.event,
      confidence: detection.confidence,
      evidenceFrames: [item.imagePath],
      problems: detection.problems ?? [],
    };
  }).filter(event => event.confidence >= 0.5 && event.event !== "unknown");
  if (events.length === 0) throw new CookingVideoError("VISION_RESPONSE_INVALID", "Vision response contains no usable detections.");
  return {
    schemaVersion: "1.0",
    jobId: request.jobId,
    generatedAt: now.toISOString(),
    source: "vision",
    events,
  };
}

export function validateVisionResponse(request: VisionEvidenceRequest, response: VisionEvidenceResponse): VisionEvidenceResponse {
  if (!response || typeof response !== "object" || Object.keys(response).some(key => !["schemaVersion", "jobId", "detections"].includes(key))
    || response.schemaVersion !== "1.0" || response.jobId !== request.jobId || !Array.isArray(response.detections)) {
    throw new CookingVideoError("VISION_RESPONSE_INVALID", "Vision response schema or jobId is invalid.");
  }
  const items = new Map(request.items.map(item => [item.id, item]));
  const seen = new Set<string>();
  const detections = response.detections.map(raw => {
    const detection = validateDetection(raw, items);
    if (seen.has(detection.itemId)) throw new CookingVideoError("VISION_RESPONSE_INVALID", `Duplicate vision item: ${detection.itemId}.`);
    seen.add(detection.itemId);
    return detection;
  });
  if (seen.size !== request.items.length) {
    const missing = request.items.filter(item => !seen.has(item.id)).map(item => item.id);
    throw new CookingVideoError("VISION_RESPONSE_INVALID", `Vision response is missing ${missing.length} item(s): ${missing.slice(0, 5).join(", ")}.`);
  }
  return {
    schemaVersion: "1.0",
    jobId: request.jobId,
    detections,
  };
}

export async function importJobVisionResponse(paths: JobPaths, responseFile: string, now = new Date()): Promise<EventTimeline> {
  const [request, response] = await Promise.all([
    readJsonFile<VisionEvidenceRequest>(path.join(paths.analysis, "vision-request.json")),
    readJsonFile<VisionEvidenceResponse>(resolveWithin(paths.root, responseFile)),
  ]);
  const timeline = importVisionDetections(request, response, now);
  await writeJsonAtomic(path.join(paths.analysis, "event-timeline.json"), timeline);
  return timeline;
}
