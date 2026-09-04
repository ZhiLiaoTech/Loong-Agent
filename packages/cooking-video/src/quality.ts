import path from "node:path";
import { CookingVideoError } from "./errors.js";
import { readJsonFile, writeJsonAtomic } from "./json-files.js";
import { resolveWithin, type JobPaths } from "./paths.js";
import { runChecked, runProcess, type ProcessRunner } from "./process-runner.js";
import type { EditDecision, QualityCheck, QualityReport } from "./types.js";

export interface QualityOptions {
  runner?: ProcessRunner;
  ffprobeCommand?: string;
  ffmpegCommand?: string;
  signal?: AbortSignal;
  durationToleranceMs?: number;
  now?: Date;
}

interface ProbePayload {
  format?: { duration?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
}

function parseProbe(raw: string): ProbePayload {
  try {
    return JSON.parse(raw) as ProbePayload;
  } catch {
    throw new CookingVideoError("QUALITY_GATE_FAILED", "Rendered video probe returned invalid JSON.");
  }
}

function reportStatus(checks: QualityCheck[]): QualityReport["status"] {
  if (checks.some(check => check.status === "fail")) return "fail";
  if (checks.some(check => check.status === "warn")) return "warn";
  return "pass";
}

function expectedDimensions(aspectRatio: EditDecision["aspectRatio"], actualWidth: number | undefined): [number, number] {
  const draft = actualWidth !== undefined && actualWidth < 1000;
  if (aspectRatio === "9:16") return draft ? [360, 640] : [1080, 1920];
  if (aspectRatio === "16:9") return draft ? [640, 360] : [1920, 1080];
  return draft ? [480, 480] : [1080, 1080];
}

export async function reviewVideo(
  jobId: string,
  paths: JobPaths,
  relativeVideoPath: string,
  options: QualityOptions = {},
): Promise<QualityReport> {
  if (path.basename(relativeVideoPath) !== relativeVideoPath && !relativeVideoPath.replace(/\\/g, "/").startsWith("output/")) {
    throw new CookingVideoError("PATH_OUTSIDE_JOB", "Quality review video must be inside output/.");
  }
  const videoFile = resolveWithin(paths.output, path.basename(relativeVideoPath));
  const decision = await readJsonFile<EditDecision>(path.join(paths.edit, "edit-decision.json"));
  if (decision.jobId !== jobId) throw new CookingVideoError("QUALITY_GATE_FAILED", "EDL belongs to a different job.");
  const runner = options.runner ?? runProcess;
  const probeResult = await runChecked(runner, options.ffprobeCommand ?? "ffprobe", [
    "-v", "error", "-show_format", "-show_streams", "-of", "json", videoFile,
  ], { signal: options.signal });
  const probe = parseProbe(probeResult.stdout);
  const video = probe.streams?.find(stream => stream.codec_type === "video");
  const audio = probe.streams?.find(stream => stream.codec_type === "audio");
  const durationMs = Math.round(Number(probe.format?.duration) * 1000);
  const checks: QualityCheck[] = [];
  checks.push(video
    ? { id: "video-decodable", status: "pass", message: `Video stream uses ${video.codec_name ?? "unknown codec"}.` }
    : { id: "video-decodable", status: "fail", message: "No decodable video stream.", remediation: "Rerender the job." });
  const [expectedWidth, expectedHeight] = expectedDimensions(decision.aspectRatio, video?.width);
  checks.push(video?.width === expectedWidth && video.height === expectedHeight
    ? { id: "dimensions", status: "pass", message: `Dimensions are ${expectedWidth}x${expectedHeight}.` }
    : { id: "dimensions", status: "fail", message: `Expected ${expectedWidth}x${expectedHeight}, got ${video?.width ?? 0}x${video?.height ?? 0}.`, remediation: "Use the matching render preset." });
  const durationDelta = Math.abs(durationMs - decision.durationTargetMs);
  checks.push(Number.isFinite(durationMs) && durationDelta <= (options.durationToleranceMs ?? 100)
    ? { id: "duration", status: "pass", message: `Duration is ${durationMs}ms.` }
    : { id: "duration", status: "fail", message: `Duration differs from EDL by ${durationDelta}ms.`, remediation: "Check concat inputs and end-card duration." });
  checks.push(audio
    ? { id: "audio-stream", status: "pass", message: `Audio stream uses ${audio.codec_name ?? "unknown codec"}.` }
    : { id: "audio-stream", status: "fail", message: "No audio stream.", remediation: "Rerender with source audio or a silent fallback track." });

  const ffmpeg = options.ffmpegCommand ?? "ffmpeg";
  const [black, freeze, exposure, volume, silence] = await Promise.all([
    runChecked(runner, ffmpeg, ["-hide_banner", "-v", "info", "-i", videoFile, "-vf", "blackdetect=d=0.5:pix_th=0.10", "-an", "-f", "null", "-"], { signal: options.signal }),
    runChecked(runner, ffmpeg, ["-hide_banner", "-v", "info", "-i", videoFile, "-vf", "freezedetect=n=-50dB:d=2", "-an", "-f", "null", "-"], { signal: options.signal }),
    runChecked(runner, ffmpeg, ["-hide_banner", "-v", "info", "-i", videoFile, "-vf", "fps=2,signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-an", "-f", "null", "-"], { signal: options.signal }),
    audio
      ? runChecked(runner, ffmpeg, ["-hide_banner", "-v", "info", "-i", videoFile, "-af", "volumedetect", "-vn", "-f", "null", "-"], { signal: options.signal })
      : Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
    audio
      ? runChecked(runner, ffmpeg, ["-hide_banner", "-v", "info", "-i", videoFile, "-af", "silencedetect=n=-50dB:d=2", "-vn", "-f", "null", "-"], { signal: options.signal })
      : Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
  ]);
  const blackMatch = /black_start:([\d.]+)/.exec(black.stderr);
  checks.push(blackMatch
    ? { id: "black-frame", status: "fail", message: "Detected a black interval longer than 0.5s.", evidenceTimeMs: Math.round(Number(blackMatch[1]) * 1000), remediation: "Replace or trim the affected segment." }
    : { id: "black-frame", status: "pass", message: "No sustained black interval detected." });
  const freezeMatch = /freeze_start:\s*([\d.]+)/.exec(freeze.stderr);
  checks.push(freezeMatch
    ? { id: "freeze", status: "warn", message: "Detected a frozen interval longer than 2s.", evidenceTimeMs: Math.round(Number(freezeMatch[1]) * 1000), remediation: "Review whether the still frame is intentional." }
    : { id: "freeze", status: "pass", message: "No unexpected long freeze detected." });
  const lumaSamples = [...`${exposure.stdout}\n${exposure.stderr}`.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map(match => Number(match[1])).filter(Number.isFinite);
  const overexposedRatio = lumaSamples.length === 0 ? Number.NaN : lumaSamples.filter(value => value >= 235).length / lumaSamples.length;
  checks.push(!Number.isFinite(overexposedRatio)
    ? { id: "overexposure", status: "warn", message: "Could not measure exposure.", remediation: "Inspect highlights manually." }
    : overexposedRatio > 0.5
      ? { id: "overexposure", status: "fail", message: `${Math.round(overexposedRatio * 100)}% of sampled frames are overexposed.`, remediation: "Replace the affected shots or correct exposure." }
      : overexposedRatio > 0.1
        ? { id: "overexposure", status: "warn", message: `${Math.round(overexposedRatio * 100)}% of sampled frames are overexposed.`, remediation: "Review highlight detail." }
        : { id: "overexposure", status: "pass", message: "No sustained overexposure detected." });
  const peakMatch = /max_volume:\s*(-?[\d.]+) dB/.exec(volume.stderr);
  const peakDb = peakMatch ? Number(peakMatch[1]) : Number.NaN;
  checks.push(Number.isFinite(peakDb)
    ? peakDb > -0.1
      ? { id: "audio-peak", status: "warn", message: `Audio peak is ${peakDb}dB, close to clipping.`, remediation: "Lower source or music gain." }
      : { id: "audio-peak", status: "pass", message: `Audio peak is ${peakDb}dB.` }
    : { id: "audio-peak", status: "warn", message: "Could not determine audio peak.", remediation: "Inspect the audio track manually." });
  const silenceDurations = [...silence.stderr.matchAll(/silence_duration:\s*([\d.]+)/g)].map(match => Number(match[1])).filter(Number.isFinite);
  const longestSilence = silenceDurations.length === 0 ? 0 : Math.max(...silenceDurations);
  checks.push(!audio
    ? { id: "audio-content", status: "fail", message: "No audio stream to inspect.", remediation: "Rerender with source audio or a silent fallback track." }
    : longestSilence >= Math.max(1, durationMs / 1000 - 0.2)
      ? { id: "audio-content", status: "fail", message: "The audio track is effectively silent.", remediation: "Restore source sound or add licensed music." }
      : { id: "audio-content", status: "pass", message: "Audio contains non-silent content." });

  const events = new Set(decision.segments.map(segment => segment.event));
  const hasProcess = [...events].some(event => ["cooking_started", "ingredient_added", "stir_fry"].includes(event));
  const hasResult = [...events].some(event => ["dish_completed", "plating", "finished_dish"].includes(event));
  checks.push(hasProcess
    ? { id: "process-coverage", status: "pass", message: "The EDL includes a cooking process event." }
    : { id: "process-coverage", status: "fail", message: "The EDL has no cooking process event.", remediation: "Add a start, ingredient, or stir-fry shot." });
  checks.push(hasResult
    ? { id: "result-coverage", status: "pass", message: "The EDL includes a completed-dish event." }
    : { id: "result-coverage", status: "fail", message: "The EDL has no completed-dish event.", remediation: "Add a plating or completed-dish shot." });

  const report: QualityReport = {
    schemaVersion: "1.0",
    jobId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    status: reportStatus(checks),
    videoPath: path.relative(paths.root, videoFile).replace(/\\/g, "/"),
    checks,
  };
  await writeJsonAtomic(path.join(paths.output, "quality-report.json"), report);
  return report;
}
