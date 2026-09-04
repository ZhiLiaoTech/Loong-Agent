import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { CookingVideoError } from "./errors.js";
import { readJsonFile, writeJsonAtomic } from "./json-files.js";
import { resolveWithin, type JobPaths } from "./paths.js";
import { runChecked, runProcess, type ProcessRunner } from "./process-runner.js";
import { COOKING_EVENTS, type CookingEvent, type CookingVideoJob, type EventTimeline, type MediaManifest, type SceneAnalysis, type SyncMap } from "./types.js";

interface MachineEventRecord {
  timeMs: number;
  event: CookingEvent;
}

export interface EventDetectionOptions {
  runner?: ProcessRunner;
  ffmpegCommand?: string;
  signal?: AbortSignal;
  preRollMs?: number;
  postRollMs?: number;
  maxEvents?: number;
  evidenceSpacingMs?: number;
  evidenceFramesPerEvent?: number;
  now?: Date;
}

const HEURISTIC_PHASES: ReadonlyArray<{ event: CookingEvent; position: number }> = [
  { event: "machine_intro", position: 0.08 },
  { event: "cooking_started", position: 0.18 },
  { event: "ingredient_added", position: 0.35 },
  { event: "stir_fry", position: 0.55 },
  { event: "dish_completed", position: 0.84 },
  { event: "finished_dish", position: 0.94 },
];

const EVENT_ALIASES: Record<string, CookingEvent> = {
  machine_intro: "machine_intro",
  cooking_started: "cooking_started",
  ingredient_added: "ingredient_added",
  seasoning_added: "seasoning_added",
  stir_fry_started: "stir_fry",
  stir_fry: "stir_fry",
  steam_detected: "steam_or_flame",
  flame_detected: "steam_or_flame",
  sauce_coating: "sauce_coating",
  cooking_completed: "dish_completed",
  dish_completed: "dish_completed",
  plating: "plating",
  finished_dish: "finished_dish",
  operator_interaction: "operator_interaction",
};

function parseMachineEventLine(line: string, lineNumber: number): MachineEventRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new CookingVideoError("EVENT_INPUT_INVALID", `Machine event line ${lineNumber} is not valid JSON.`);
  }
  if (typeof raw !== "object" || raw === null) {
    throw new CookingVideoError("EVENT_INPUT_INVALID", `Machine event line ${lineNumber} must be an object.`);
  }
  const record = raw as Record<string, unknown>;
  if (!Number.isInteger(record.timeMs) || (record.timeMs as number) < 0 || typeof record.event !== "string") {
    throw new CookingVideoError("EVENT_INPUT_INVALID", `Machine event line ${lineNumber} requires a non-negative integer timeMs and event.`);
  }
  const event = EVENT_ALIASES[record.event];
  if (!event || !COOKING_EVENTS.includes(event)) {
    throw new CookingVideoError("EVENT_INPUT_INVALID", `Unsupported machine event on line ${lineNumber}: ${record.event}.`);
  }
  return { timeMs: record.timeMs as number, event };
}

export function parseMachineEvents(text: string, maxEvents = 500): MachineEventRecord[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new CookingVideoError("EVENT_INPUT_MISSING", "Machine event log is empty.");
  if (lines.length > maxEvents) throw new CookingVideoError("EVENT_INPUT_INVALID", `Machine event log exceeds ${maxEvents} events.`);
  const events = lines.map((line, index) => parseMachineEventLine(line, index + 1));
  return events.sort((left, right) => left.timeMs - right.timeMs);
}

export async function deduplicateEvidenceFiles(files: readonly string[]): Promise<string[]> {
  const unique: string[] = [];
  const digests = new Set<string>();
  for (const file of files) {
    let digest: string;
    try {
      digest = createHash("sha256").update(await readFile(file)).digest("hex");
    } catch {
      unique.push(file);
      continue;
    }
    if (digests.has(digest)) {
      await rm(file, { force: true });
      continue;
    }
    digests.add(digest);
    unique.push(file);
  }
  return unique;
}

function sourceByCamera(manifest: MediaManifest, cameraId: string) {
  const source = manifest.sources.find(item => item.cameraId === cameraId);
  if (!source) throw new CookingVideoError("EVENT_INPUT_INVALID", `Sync map references unknown camera ${cameraId}.`);
  return source;
}

export async function detectMachineEvents(
  job: CookingVideoJob,
  paths: JobPaths,
  options: EventDetectionOptions = {},
): Promise<EventTimeline> {
  if (!job.machineEventsPath) {
    throw new CookingVideoError("EVENT_INPUT_MISSING", "job.machineEventsPath is required until a vision detector is configured.");
  }
  const [manifest, syncMap, eventText] = await Promise.all([
    readJsonFile<MediaManifest>(path.join(paths.analysis, "media-manifest.json")),
    readJsonFile<SyncMap>(path.join(paths.analysis, "sync-map.json")),
    readFile(resolveWithin(paths.root, job.machineEventsPath), "utf8"),
  ]);
  if (manifest.jobId !== job.jobId || syncMap.jobId !== job.jobId) {
    throw new CookingVideoError("EVENT_INPUT_INVALID", "Analysis artifacts belong to a different job.");
  }
  const machineEvents = parseMachineEvents(eventText, options.maxEvents);
  const runner = options.runner ?? runProcess;
  const ffmpeg = options.ffmpegCommand ?? "ffmpeg";
  const preRollMs = options.preRollMs ?? 2_000;
  const postRollMs = options.postRollMs ?? 3_000;
  const evidenceSpacingMs = options.evidenceSpacingMs ?? 750;
  const evidenceFramesPerEvent = options.evidenceFramesPerEvent ?? 3;
  if (!Number.isInteger(evidenceSpacingMs) || evidenceSpacingMs < 100 || evidenceSpacingMs > 5_000) {
    throw new CookingVideoError("EVENT_INPUT_INVALID", "evidenceSpacingMs must be between 100 and 5000.");
  }
  if (!Number.isInteger(evidenceFramesPerEvent) || evidenceFramesPerEvent < 1 || evidenceFramesPerEvent > 5) {
    throw new CookingVideoError("EVENT_INPUT_INVALID", "evidenceFramesPerEvent must be between 1 and 5.");
  }
  const detected: EventTimeline["events"] = [];

  for (const [cameraId, sync] of Object.entries(syncMap.cameras)) {
    const source = sourceByCamera(manifest, cameraId);
    const mediaFile = resolveWithin(paths.root, source.proxyPath ?? source.path);
    for (let index = 0; index < machineEvents.length; index += 1) {
      const machineEvent = machineEvents[index];
      const sourceTimeMs = machineEvent.timeMs - sync.offsetMs;
      if (sourceTimeMs < 0 || sourceTimeMs > source.durationMs) continue;
      const startMs = Math.max(0, sourceTimeMs - preRollMs);
      const endMs = Math.min(source.durationMs, sourceTimeMs + postRollMs);
      if (endMs <= startMs) continue;
      const offsets = Array.from({ length: evidenceFramesPerEvent }, (_, frameIndex) => {
        if (frameIndex === 0) return 0;
        const distance = Math.ceil(frameIndex / 2) * evidenceSpacingMs;
        return frameIndex % 2 === 1 ? -distance : distance;
      });
      const evidenceFiles: string[] = [];
      for (const [frameIndex, offset] of offsets.entries()) {
        const evidenceTimeMs = Math.max(startMs, Math.min(endMs, sourceTimeMs + offset));
        const frameName = `${String(index + 1).padStart(4, "0")}-${machineEvent.event}-${cameraId}-${String(frameIndex + 1).padStart(2, "0")}.jpg`;
        const frameFile = path.join(paths.frames, frameName);
        await runChecked(runner, ffmpeg, [
          "-y", "-ss", (evidenceTimeMs / 1000).toFixed(3), "-i", mediaFile,
          "-frames:v", "1", "-vf", "scale=640:-2,format=yuvj420p", "-update", "1", frameFile,
        ], { signal: options.signal });
        evidenceFiles.push(frameFile);
      }
      const uniqueEvidence = await deduplicateEvidenceFiles(evidenceFiles);
      detected.push({
        occurrenceId: `evt-${String(index + 1).padStart(4, "0")}`,
        cameraId,
        startMs: Math.round(startMs),
        endMs: Math.round(endMs),
        event: machineEvent.event,
        confidence: 0.95,
        evidenceFrames: uniqueEvidence.map(frameFile => path.relative(paths.root, frameFile).replace(/\\/g, "/")),
      });
    }
  }
  if (detected.length === 0) {
    throw new CookingVideoError("EVENT_INPUT_INVALID", "No machine events overlap the synchronized camera timelines.");
  }
  const timeline: EventTimeline = {
    schemaVersion: "1.0",
    jobId: job.jobId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    source: "machine_events",
    events: detected.sort((left, right) => left.startMs - right.startMs || left.cameraId.localeCompare(right.cameraId)),
  };
  await writeJsonAtomic(path.join(paths.analysis, "event-timeline.json"), timeline);
  return timeline;
}

function strongestMotionTime(scene: SceneAnalysis, cameraId: string, durationMs: number): number | undefined {
  const samples = scene.sources.find(source => source.cameraId === cameraId)?.motionSamples
    .filter(sample => sample.timeMs >= durationMs * 0.2 && sample.timeMs <= durationMs * 0.8)
    .sort((left, right) => right.score - left.score || left.timeMs - right.timeMs);
  return samples?.[0]?.timeMs;
}

export async function detectHeuristicEvents(
  job: CookingVideoJob,
  paths: JobPaths,
  options: EventDetectionOptions = {},
): Promise<EventTimeline> {
  if (job.brief.requireHumanApproval !== true) {
    throw new CookingVideoError("APPROVAL_REQUIRED", "Offline heuristic detection requires brief.requireHumanApproval=true because event labels are unverified.");
  }
  const [manifest, scene] = await Promise.all([
    readJsonFile<MediaManifest>(path.join(paths.analysis, "media-manifest.json")),
    readJsonFile<SceneAnalysis>(path.join(paths.analysis, "scene-cuts.json")),
  ]);
  if (manifest.jobId !== job.jobId || scene.jobId !== job.jobId) throw new CookingVideoError("EVENT_INPUT_INVALID", "Heuristic inputs belong to a different job.");
  const runner = options.runner ?? runProcess;
  const ffmpeg = options.ffmpegCommand ?? "ffmpeg";
  const detected: EventTimeline["events"] = [];
  for (const source of manifest.sources) {
    const mediaFile = resolveWithin(paths.root, source.proxyPath ?? source.path);
    const motionTime = strongestMotionTime(scene, source.cameraId, source.durationMs);
    for (const [index, phase] of HEURISTIC_PHASES.entries()) {
      const centerMs = Math.round(phase.event === "stir_fry" && motionTime !== undefined ? motionTime : source.durationMs * phase.position);
      const windowMs = Math.min(5_000, source.durationMs);
      const startMs = phase.position <= 0.2
        ? 0
        : phase.position >= 0.8
          ? source.durationMs - windowMs
          : Math.max(0, Math.min(source.durationMs - windowMs, centerMs - Math.floor(windowMs / 2)));
      const endMs = startMs + windowMs;
      if (endMs - startMs < 500) continue;
      const frameName = `heuristic-${String(index + 1).padStart(2, "0")}-${phase.event}-${source.cameraId}.jpg`;
      const frameFile = path.join(paths.frames, frameName);
      await runChecked(runner, ffmpeg, [
        "-y", "-ss", (centerMs / 1000).toFixed(3), "-i", mediaFile,
        "-frames:v", "1", "-vf", "scale=640:-2,format=yuvj420p", "-update", "1", frameFile,
      ], { signal: options.signal });
      detected.push({
        occurrenceId: `heuristic-${String(index + 1).padStart(2, "0")}-${phase.event}`,
        cameraId: source.cameraId,
        startMs,
        endMs,
        event: phase.event,
        confidence: 0.35,
        evidenceFrames: [path.relative(paths.root, frameFile).replace(/\\/g, "/")],
        problems: ["heuristic_unverified", "human_review_required"],
      });
    }
  }
  if (detected.length === 0) throw new CookingVideoError("EVENT_INPUT_INVALID", "No usable heuristic event windows could be created.");
  const timeline: EventTimeline = {
    schemaVersion: "1.0",
    jobId: job.jobId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    source: "heuristic",
    events: detected.sort((left, right) => left.startMs - right.startMs || left.cameraId.localeCompare(right.cameraId)),
  };
  await writeJsonAtomic(path.join(paths.analysis, "event-timeline.json"), timeline);
  return timeline;
}

export async function detectJobEvents(job: CookingVideoJob, paths: JobPaths, options: EventDetectionOptions = {}): Promise<EventTimeline> {
  return job.machineEventsPath ? await detectMachineEvents(job, paths, options) : await detectHeuristicEvents(job, paths, options);
}
