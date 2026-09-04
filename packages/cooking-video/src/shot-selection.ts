import path from "node:path";
import { CookingVideoError } from "./errors.js";
import { readJsonFile, writeJsonAtomic } from "./json-files.js";
import type { JobPaths } from "./paths.js";
import { resolveWithin } from "./paths.js";
import { runChecked, runProcess, type ProcessRunner } from "./process-runner.js";
import type { CookingEvent, EventTimeline, MediaManifest, MediaSourceManifest, SceneAnalysis, ShotCandidate, ShotCandidates } from "./types.js";

const FOOD_EVENTS = new Set<CookingEvent>([
  "ingredient_added", "seasoning_added", "stir_fry", "steam_or_flame", "sauce_coating", "dish_completed", "plating", "finished_dish",
]);
const MACHINE_EVENTS = new Set<CookingEvent>(["machine_intro", "cooking_started", "operator_interaction"]);

export interface FrameMetrics {
  lumaAverage: number;
  lumaLow: number;
  lumaHigh: number;
  saturationAverage: number;
  blurMean: number;
}

export interface ShotSelectionOptions {
  runner?: ProcessRunner;
  ffmpegCommand?: string;
  signal?: AbortSignal;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function videoPixels(source: MediaSourceManifest): number {
  const video = source.streams.find(stream => stream.codecType === "video");
  return (video?.width ?? 0) * (video?.height ?? 0);
}

function roleFit(role: string | undefined, event: CookingEvent): number {
  if (FOOD_EVENTS.has(event)) {
    if (role === "food_closeup") return 1;
    if (role === "action_side") return 0.85;
    if (role === "machine_full") return 0.55;
  }
  if (MACHINE_EVENTS.has(event)) {
    if (role === "machine_full") return 1;
    if (role === "action_side") return 0.75;
    if (role === "food_closeup") return 0.5;
  }
  return 0.7;
}

function metricValue(text: string, key: string): number {
  const match = new RegExp(`${key}=(-?[\\d.]+)`).exec(text);
  return match ? Number(match[1]) : Number.NaN;
}

export function parseFrameMetrics(text: string): FrameMetrics {
  const metrics: FrameMetrics = {
    lumaAverage: metricValue(text, "lavfi\\.signalstats\\.YAVG"),
    lumaLow: metricValue(text, "lavfi\\.signalstats\\.YLOW"),
    lumaHigh: metricValue(text, "lavfi\\.signalstats\\.YHIGH"),
    saturationAverage: metricValue(text, "lavfi\\.signalstats\\.SATAVG"),
    blurMean: Number(/blur mean:\s*(-?[\d.]+)/.exec(text)?.[1]),
  };
  if (Object.values(metrics).some(value => !Number.isFinite(value))) {
    throw new CookingVideoError("PROCESS_FAILED", "FFmpeg did not return complete frame quality metrics.");
  }
  return metrics;
}

function metricScores(metrics: FrameMetrics | undefined): { scores: Pick<ShotCandidate["scores"], "exposure" | "dynamicRange" | "saturation" | "sharpness">; problems: string[] } {
  if (!metrics) return { scores: { exposure: 1, dynamicRange: 1, saturation: 1, sharpness: 1 }, problems: [] };
  const exposure = clamp01(1 - Math.abs(metrics.lumaAverage - 128) / 128);
  const dynamicRange = clamp01((metrics.lumaHigh - metrics.lumaLow) / 128);
  const saturation = clamp01(1 - Math.abs(metrics.saturationAverage - 110) / 145);
  const sharpness = clamp01(1 - metrics.blurMean / 20);
  const problems = [
    ...(metrics.lumaAverage < 25 ? ["underexposed"] : []),
    ...(metrics.lumaAverage > 225 ? ["overexposed"] : []),
    ...(metrics.lumaHigh - metrics.lumaLow < 20 ? ["low_dynamic_range"] : []),
    ...(metrics.blurMean > 12 ? ["blurry"] : []),
  ];
  return {
    scores: {
      exposure: roundScore(exposure),
      dynamicRange: roundScore(dynamicRange),
      saturation: roundScore(saturation),
      sharpness: roundScore(sharpness),
    },
    problems,
  };
}

function dynamicsScores(scene: SceneAnalysis | undefined, cameraId: string, startMs: number, endMs: number): {
  scores: Pick<ShotCandidate["scores"], "motion" | "continuity">;
  problems: string[];
} {
  const camera = scene?.sources.find(source => source.cameraId === cameraId);
  if (!camera) return { scores: { motion: 0.5, continuity: 1 }, problems: ["scene_analysis_missing"] };
  const samples = camera.motionSamples.filter(sample => sample.timeMs >= startMs && sample.timeMs <= endMs);
  const averageMotion = samples.length === 0 ? 0 : samples.reduce((sum, sample) => sum + sample.score, 0) / samples.length;
  const interiorCuts = camera.cutsMs.filter(timeMs => timeMs > startMs + 250 && timeMs < endMs - 250).length;
  const motion = clamp01(averageMotion / 12);
  const continuity = clamp01(1 - interiorCuts * 0.35);
  return {
    scores: { motion: roundScore(motion), continuity: roundScore(continuity) },
    problems: [
      ...(samples.length === 0 ? ["motion_samples_missing"] : []),
      ...(averageMotion < 0.5 ? ["low_motion"] : []),
      ...(interiorCuts > 1 ? ["multiple_scene_cuts"] : []),
    ],
  };
}

export function selectShots(
  timeline: EventTimeline,
  manifest: MediaManifest,
  now = new Date(),
  frameMetrics: ReadonlyMap<string, FrameMetrics> = new Map(),
  sceneAnalysis?: SceneAnalysis,
): ShotCandidates {
  if (timeline.jobId !== manifest.jobId) {
    throw new CookingVideoError("EVENT_INPUT_INVALID", "Event timeline and media manifest belong to different jobs.");
  }
  const maxPixels = Math.max(1, ...manifest.sources.map(videoPixels));
  const groups = new Map<string, ShotCandidate[]>();
  for (const event of timeline.events) {
    if (typeof event.occurrenceId !== "string" || event.occurrenceId.trim() === "") {
      throw new CookingVideoError("EVENT_INPUT_INVALID", "Every detected event must include a non-empty occurrenceId; rerun event detection.");
    }
    const source = manifest.sources.find(item => item.cameraId === event.cameraId);
    if (!source) throw new CookingVideoError("EVENT_INPUT_INVALID", `Event references unknown camera ${event.cameraId}.`);
    const eventConfidence = clamp01(event.confidence);
    const eventRoleFit = roleFit(source.role, event.event);
    const resolution = clamp01(videoPixels(source) / maxPixels);
    const duration = event.endMs - event.startMs;
    const durationFit = clamp01(duration < 1_500 ? duration / 1_500 : duration > 5_000 ? 5_000 / duration : 1);
    const technical = metricScores(frameMetrics.get(`${event.occurrenceId}/${event.cameraId}`));
    const dynamics = dynamicsScores(sceneAnalysis, event.cameraId, event.startMs, event.endMs);
    const total = roundScore(
      eventConfidence * 0.25 + eventRoleFit * 0.18 + resolution * 0.08 + durationFit * 0.08
      + technical.scores.exposure * 0.08 + technical.scores.dynamicRange * 0.04
      + technical.scores.saturation * 0.04 + technical.scores.sharpness * 0.10
      + dynamics.scores.motion * 0.10 + dynamics.scores.continuity * 0.05,
    );
    const candidate: ShotCandidate = {
      ...event,
      problems: [
        ...(event.problems ?? []),
        ...(duration < 1_500 ? ["too_short"] : []),
        ...(videoPixels(source) === 0 ? ["resolution_unknown"] : []),
        ...technical.problems,
        ...dynamics.problems,
      ],
      rank: 0,
      selected: false,
      scores: {
        eventConfidence: roundScore(eventConfidence),
        roleFit: roundScore(eventRoleFit),
        resolution: roundScore(resolution),
        durationFit: roundScore(durationFit),
        ...technical.scores,
        ...dynamics.scores,
        total,
      },
    };
    const group = groups.get(event.occurrenceId) ?? [];
    group.push(candidate);
    groups.set(event.occurrenceId, group);
  }
  const candidates: ShotCandidate[] = [];
  for (const group of groups.values()) {
    group.sort((left, right) => right.scores.total - left.scores.total || left.cameraId.localeCompare(right.cameraId));
    group.forEach((candidate, index) => {
      candidate.rank = index + 1;
      candidate.selected = index === 0 && candidate.event !== "unusable";
      candidates.push(candidate);
    });
  }
  return {
    schemaVersion: "1.0",
    jobId: timeline.jobId,
    generatedAt: now.toISOString(),
    candidates,
  };
}

export async function selectJobShots(paths: JobPaths, now = new Date(), options: ShotSelectionOptions = {}): Promise<ShotCandidates> {
  const [timeline, manifest, sceneAnalysis] = await Promise.all([
    readJsonFile<EventTimeline>(path.join(paths.analysis, "event-timeline.json")),
    readJsonFile<MediaManifest>(path.join(paths.analysis, "media-manifest.json")),
    readJsonFile<SceneAnalysis>(path.join(paths.analysis, "scene-cuts.json")),
  ]);
  const runner = options.runner ?? runProcess;
  const ffmpeg = options.ffmpegCommand ?? "ffmpeg";
  const metrics = new Map<string, FrameMetrics>();
  for (const event of timeline.events) {
    const evidence = event.evidenceFrames[0];
    if (!evidence) continue;
    const frame = resolveWithin(paths.root, evidence);
    const measured = await runChecked(runner, ffmpeg, [
      "-hide_banner", "-v", "info", "-i", frame,
      "-vf", "signalstats,metadata=print,blurdetect=block_width=32:block_height=32:block_pct=80",
      "-frames:v", "1", "-f", "null", "-",
    ], { signal: options.signal });
    metrics.set(`${event.occurrenceId}/${event.cameraId}`, parseFrameMetrics(`${measured.stdout}\n${measured.stderr}`));
  }
  if (sceneAnalysis.jobId !== timeline.jobId) {
    throw new CookingVideoError("EVENT_INPUT_INVALID", "Scene analysis and event timeline belong to different jobs.");
  }
  const result = selectShots(timeline, manifest, now, metrics, sceneAnalysis);
  await writeJsonAtomic(path.join(paths.analysis, "shot-candidates.json"), result);
  return result;
}
