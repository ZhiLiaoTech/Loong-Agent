import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { CookingVideoError } from "./errors.js";
import { readJsonFile, writeJsonAtomic } from "./json-files.js";
import type { JobPaths } from "./paths.js";
import type { MediaManifest, SyncMap } from "./types.js";
import { resolveWithin } from "./paths.js";
import { runChecked, runProcess, type ProcessRunner } from "./process-runner.js";

export interface SyncOptions {
  referenceCameraId?: string;
  manualOffsets?: Record<string, number>;
  minimumConfidence?: number;
  now?: Date;
  runner?: ProcessRunner;
  ffmpegCommand?: string;
  signal?: AbortSignal;
  audioSampleRate?: number;
  audioMaxSeconds?: number;
  audioMaxLagMs?: number;
}

export interface AudioOffsetEstimate {
  offsetMs: number;
  confidence: number;
}

export function estimateEnvelopeOffset(
  reference: readonly number[],
  target: readonly number[],
  samplesPerSecond: number,
  maxLagMs: number,
): AudioOffsetEstimate {
  if (reference.length < 3 || target.length < 3 || samplesPerSecond <= 0) {
    throw new CookingVideoError("SYNC_INPUT_INVALID", "Audio envelopes are too short for correlation.");
  }
  const maxLag = Math.min(Math.floor(maxLagMs * samplesPerSecond / 1000), Math.floor(Math.min(reference.length, target.length) / 2));
  let bestLag = 0;
  let bestCorrelation = -1;
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumYY = 0;
    let sumXY = 0;
    for (let index = 0; index < reference.length; index += 1) {
      const targetIndex = index - lag;
      if (targetIndex < 0 || targetIndex >= target.length) continue;
      const x = reference[index] ?? 0;
      const y = target[targetIndex] ?? 0;
      count += 1;
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumYY += y * y;
      sumXY += x * y;
    }
    if (count < Math.min(reference.length, target.length) / 2) continue;
    const covariance = sumXY - sumX * sumY / count;
    const varianceX = sumXX - sumX * sumX / count;
    const varianceY = sumYY - sumY * sumY / count;
    const denominator = Math.sqrt(Math.max(0, varianceX * varianceY));
    const correlation = denominator === 0 ? -1 : covariance / denominator;
    if (correlation > bestCorrelation || (correlation === bestCorrelation && Math.abs(lag) < Math.abs(bestLag))) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }
  return {
    offsetMs: Math.round(bestLag * 1000 / samplesPerSecond),
    confidence: Math.round(Math.max(0, Math.min(1, bestCorrelation)) * 10_000) / 10_000,
  };
}

function pcmEnvelope(buffer: Buffer, sampleRate: number, windowMs = 20): number[] {
  const samplesPerWindow = Math.max(1, Math.round(sampleRate * windowMs / 1000));
  const sampleCount = Math.floor(buffer.length / 2);
  const envelope: number[] = [];
  for (let start = 0; start < sampleCount; start += samplesPerWindow) {
    const end = Math.min(sampleCount, start + samplesPerWindow);
    let sumSquares = 0;
    for (let index = start; index < end; index += 1) {
      const sample = buffer.readInt16LE(index * 2) / 32768;
      sumSquares += sample * sample;
    }
    envelope.push(Math.sqrt(sumSquares / Math.max(1, end - start)));
  }
  return envelope;
}

async function audioSync(manifest: MediaManifest, paths: JobPaths, referenceCameraId: string, options: SyncOptions, now: Date): Promise<SyncMap> {
  const runner = options.runner ?? runProcess;
  const ffmpeg = options.ffmpegCommand ?? "ffmpeg";
  const sampleRate = options.audioSampleRate ?? 8_000;
  const maxSeconds = options.audioMaxSeconds ?? 120;
  const audioDir = path.join(paths.state, "sync-audio");
  await mkdir(audioDir, { recursive: true });
  try {
    const envelopes = new Map<string, number[]>();
    for (const source of manifest.sources) {
      if (!source.streams.some(stream => stream.codecType === "audio")) {
        throw new CookingVideoError("SYNC_INPUT_INVALID", `Camera ${source.cameraId} has no audio track for fallback synchronization.`);
      }
      const input = resolveWithin(paths.root, source.proxyPath ?? source.path);
      const pcmFile = path.join(audioDir, `${source.cameraId}.s16le`);
      await runChecked(runner, ffmpeg, [
        "-y", "-i", input, "-t", String(maxSeconds), "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "s16le", pcmFile,
      ], { signal: options.signal });
      envelopes.set(source.cameraId, pcmEnvelope(await readFile(pcmFile), sampleRate));
    }
    const reference = envelopes.get(referenceCameraId);
    if (!reference) throw new CookingVideoError("SYNC_INPUT_INVALID", `Reference camera ${referenceCameraId} audio is missing.`);
    const cameras: SyncMap["cameras"] = { [referenceCameraId]: { offsetMs: 0 } };
    let confidence = 1;
    for (const source of manifest.sources) {
      if (source.cameraId === referenceCameraId) continue;
      const target = envelopes.get(source.cameraId)!;
      const estimate = estimateEnvelopeOffset(reference, target, 1000 / 20, options.audioMaxLagMs ?? 5_000);
      cameras[source.cameraId] = { offsetMs: estimate.offsetMs };
      confidence = Math.min(confidence, estimate.confidence);
    }
    return { schemaVersion: "1.0", jobId: manifest.jobId, referenceCameraId, method: "audio_cross_correlation", confidence, cameras, generatedAt: now.toISOString() };
  } finally {
    await rm(audioDir, { recursive: true, force: true });
  }
}

function selectReference(manifest: MediaManifest, requested?: string): string {
  const reference = requested ?? manifest.sources.find(source => source.role === "machine_full")?.cameraId ?? manifest.sources[0]?.cameraId;
  if (!reference || !manifest.sources.some(source => source.cameraId === reference)) {
    throw new CookingVideoError("SYNC_INPUT_INVALID", `Unknown reference camera: ${requested ?? "<none>"}.`);
  }
  return reference;
}

function manualSync(manifest: MediaManifest, referenceCameraId: string, offsets: Record<string, number>, now: Date): SyncMap {
  for (const source of manifest.sources) {
    const value = offsets[source.cameraId];
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new CookingVideoError("SYNC_INPUT_INVALID", `Manual offset missing or invalid for camera ${source.cameraId}.`);
    }
  }
  const referenceOffset = offsets[referenceCameraId] ?? 0;
  return {
    schemaVersion: "1.0",
    jobId: manifest.jobId,
    referenceCameraId,
    method: "manual",
    confidence: 1,
    cameras: Object.fromEntries(manifest.sources.map(source => [source.cameraId, { offsetMs: (offsets[source.cameraId] ?? 0) - referenceOffset }])),
    generatedAt: now.toISOString(),
  };
}

function timecodeSync(manifest: MediaManifest, referenceCameraId: string, now: Date): SyncMap {
  const starts = new Map<string, number>();
  for (const source of manifest.sources) {
    const timestamp = source.creationTime === undefined ? Number.NaN : Date.parse(source.creationTime);
    if (!Number.isFinite(timestamp)) {
      throw new CookingVideoError("SYNC_INPUT_INVALID", `Camera ${source.cameraId} has no valid creation time; provide manual offsets.`);
    }
    starts.set(source.cameraId, timestamp);
  }
  const referenceStart = starts.get(referenceCameraId);
  if (referenceStart === undefined) {
    throw new CookingVideoError("SYNC_INPUT_INVALID", `Reference camera ${referenceCameraId} has no start time.`);
  }
  return {
    schemaVersion: "1.0",
    jobId: manifest.jobId,
    referenceCameraId,
    method: "timecode",
    confidence: 0.98,
    cameras: Object.fromEntries([...starts].map(([cameraId, start]) => [cameraId, { offsetMs: Math.round(start - referenceStart) }])),
    generatedAt: now.toISOString(),
  };
}

export function buildSyncMap(manifest: MediaManifest, options: SyncOptions = {}): SyncMap {
  if (manifest.sources.length < 2) {
    throw new CookingVideoError("SYNC_INPUT_INVALID", "At least two media sources are required for synchronization.");
  }
  const now = options.now ?? new Date();
  const reference = selectReference(manifest, options.referenceCameraId);
  const result = options.manualOffsets === undefined
    ? timecodeSync(manifest, reference, now)
    : manualSync(manifest, reference, options.manualOffsets, now);
  const minimum = options.minimumConfidence ?? 0.70;
  if (result.confidence < minimum) {
    throw new CookingVideoError("SYNC_LOW_CONFIDENCE", `Synchronization confidence ${result.confidence} is below ${minimum}.`);
  }
  return result;
}

export async function synchronizeJob(paths: JobPaths, options: SyncOptions = {}): Promise<SyncMap> {
  let manifest: MediaManifest;
  try {
    manifest = await readJsonFile<MediaManifest>(path.join(paths.analysis, "media-manifest.json"));
  } catch (error) {
    throw new CookingVideoError("SYNC_INPUT_INVALID", "media-manifest.json is missing or invalid.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  let syncMap: SyncMap;
  if (options.manualOffsets !== undefined) {
    syncMap = buildSyncMap(manifest, options);
  } else {
    try {
      syncMap = buildSyncMap(manifest, options);
    } catch (error) {
      if (!(error instanceof CookingVideoError) || error.code !== "SYNC_INPUT_INVALID") throw error;
      const reference = selectReference(manifest, options.referenceCameraId);
      syncMap = await audioSync(manifest, paths, reference, options, options.now ?? new Date());
      const minimum = options.minimumConfidence ?? 0.70;
      if (syncMap.confidence < minimum) {
        throw new CookingVideoError("SYNC_LOW_CONFIDENCE", `Audio synchronization confidence ${syncMap.confidence} is below ${minimum}.`);
      }
    }
  }
  await writeJsonAtomic(path.join(paths.analysis, "sync-map.json"), syncMap);
  return syncMap;
}
