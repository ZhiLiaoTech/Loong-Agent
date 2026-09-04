import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { CookingVideoError } from "./errors.js";
import { validateMediaManifest } from "./artifact-validation.js";
import { writeJsonAtomic } from "./json-files.js";
import { resolveExistingWithin, type JobPaths } from "./paths.js";
import { runChecked, runProcess, type ProcessRunner } from "./process-runner.js";
import type { CookingVideoJob, MediaManifest, MediaSourceManifest, MediaStreamInfo } from "./types.js";
import { analyzeMediaDynamics } from "./scene-analysis.js";

interface FfprobeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
}

interface FfprobePayload {
  format?: { duration?: string; format_name?: string; tags?: { creation_time?: string } };
  streams?: FfprobeStream[];
}

export interface IngestOptions {
  runner?: ProcessRunner;
  signal?: AbortSignal;
  ffprobeCommand?: string;
  ffmpegCommand?: string;
  generateProxy?: boolean;
  generateContactSheet?: boolean;
  durationMismatchMs?: number;
}

function parseRate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [numeratorText, denominatorText = "1"] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined;
  return numerator / denominator;
}

function secondsToMs(value: string | undefined): number | undefined {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

export function parseFfprobePayload(raw: string): { durationMs: number; formatName?: string; creationTime?: string; streams: MediaStreamInfo[] } {
  let payload: FfprobePayload;
  try {
    payload = JSON.parse(raw) as FfprobePayload;
  } catch {
    throw new CookingVideoError("MEDIA_UNREADABLE", "ffprobe returned invalid JSON.");
  }
  const durationMs = secondsToMs(payload.format?.duration);
  const streams = (payload.streams ?? []).map((stream, fallbackIndex): MediaStreamInfo => {
    const rotation = stream.side_data_list?.find(item => typeof item.rotation === "number")?.rotation
      ?? (stream.tags?.rotate === undefined ? undefined : Number(stream.tags.rotate));
    return {
      index: stream.index ?? fallbackIndex,
      codecType: stream.codec_type ?? "unknown",
      codecName: stream.codec_name,
      width: stream.width,
      height: stream.height,
      frameRate: parseRate(stream.avg_frame_rate),
      durationMs: secondsToMs(stream.duration),
      rotation: Number.isFinite(rotation) ? rotation : undefined,
    };
  });
  if (durationMs === undefined || durationMs <= 0 || !streams.some(stream => stream.codecType === "video")) {
    throw new CookingVideoError("MEDIA_UNREADABLE", "Media has no readable video stream or duration.");
  }
  const rawCreationTime = payload.format?.tags?.creation_time;
  const parsedCreationTime = rawCreationTime === undefined ? Number.NaN : Date.parse(rawCreationTime);
  return {
    durationMs,
    formatName: payload.format?.format_name,
    creationTime: Number.isFinite(parsedCreationTime) ? new Date(parsedCreationTime).toISOString() : undefined,
    streams,
  };
}

async function sha256File(file: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function ingestMedia(job: CookingVideoJob, paths: JobPaths, options: IngestOptions = {}): Promise<MediaManifest> {
  const runner = options.runner ?? runProcess;
  const ffprobe = options.ffprobeCommand ?? "ffprobe";
  const ffmpeg = options.ffmpegCommand ?? "ffmpeg";
  const sources: MediaSourceManifest[] = [];
  await Promise.all([mkdir(paths.proxy, { recursive: true }), mkdir(paths.frames, { recursive: true }), mkdir(paths.analysis, { recursive: true })]);

  for (const source of job.sources) {
    let sourceFile: string;
    let fileStat;
    try {
      sourceFile = await resolveExistingWithin(paths.root, source.path);
      fileStat = await stat(sourceFile);
    } catch (error) {
      throw new CookingVideoError("MEDIA_UNREADABLE", `Cannot read media for camera ${source.cameraId}.`, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if (!fileStat.isFile() || fileStat.size === 0) {
      throw new CookingVideoError("MEDIA_UNREADABLE", `Media for camera ${source.cameraId} is empty or not a file.`);
    }
    const probeResult = await runChecked(runner, ffprobe, [
      "-v", "error", "-show_format", "-show_streams", "-of", "json", sourceFile,
    ], { signal: options.signal });
    const metadata = parseFfprobePayload(probeResult.stdout);
    const proxyFile = path.join(paths.proxy, `${source.cameraId}.mp4`);
    const contactFile = path.join(paths.frames, `${source.cameraId}-contact.jpg`);
    const proxyTemp = path.join(paths.proxy, `${source.cameraId}.part.mp4`);
    const contactTemp = path.join(paths.frames, `${source.cameraId}-contact.part.jpg`);
    if (options.generateProxy !== false) {
      try {
        await runChecked(runner, ffmpeg, [
          "-y", "-i", sourceFile, "-map", "0:v:0", "-map", "0:a?", "-vf", "scale=-2:720",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k",
          "-movflags", "+faststart", proxyTemp,
        ], { signal: options.signal });
        await rename(proxyTemp, proxyFile);
      } finally {
        await rm(proxyTemp, { force: true });
      }
    }
    if (options.generateContactSheet !== false) {
      const contactSheetFps = Math.max(0.01, 12_000 / metadata.durationMs).toFixed(6);
      try {
        await runChecked(runner, ffmpeg, [
          "-y", "-i", sourceFile,
          "-vf", `fps=${contactSheetFps},scale=320:-2,tile=4x3:nb_frames=12:padding=4:margin=4,format=yuvj420p`,
          "-frames:v", "1", "-update", "1", contactTemp,
        ], { signal: options.signal });
        await rename(contactTemp, contactFile);
      } finally {
        await rm(contactTemp, { force: true });
      }
    }
    sources.push({
      cameraId: source.cameraId,
      role: source.role,
      path: source.path.replace(/\\/g, "/"),
      byteSize: fileStat.size,
      sha256: await sha256File(sourceFile),
      durationMs: metadata.durationMs,
      creationTime: metadata.creationTime,
      formatName: metadata.formatName,
      streams: metadata.streams,
      proxyPath: options.generateProxy === false ? undefined : path.relative(paths.root, proxyFile).replace(/\\/g, "/"),
      contactSheetPath: options.generateContactSheet === false ? undefined : path.relative(paths.root, contactFile).replace(/\\/g, "/"),
    });
  }

  const warnings: string[] = [];
  const durations = sources.map(source => source.durationMs);
  const spread = Math.max(...durations) - Math.min(...durations);
  if (spread > (options.durationMismatchMs ?? 10_000)) {
    warnings.push(`Camera duration spread is ${spread}ms; verify synchronization and recording completeness.`);
  }
  const manifest: MediaManifest = {
    schemaVersion: "1.0",
    jobId: job.jobId,
    generatedAt: new Date().toISOString(),
    sources,
    warnings,
  };
  validateMediaManifest(manifest, job.jobId);
  await writeJsonAtomic(path.join(paths.analysis, "media-manifest.json"), manifest);
  await analyzeMediaDynamics(manifest, paths, runner, ffmpeg, options.signal);
  return manifest;
}
