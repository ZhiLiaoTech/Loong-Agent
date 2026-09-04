import { stat } from "node:fs/promises";
import path from "node:path";
import { CookingVideoError } from "./errors.js";
import { readJsonFile, writeJsonAtomic } from "./json-files.js";
import { resolveWithin, type JobPaths } from "./paths.js";
import { runChecked, runProcess, type ProcessRunner } from "./process-runner.js";
import type { CookingVideoJob, EditDecision, MediaManifest } from "./types.js";

export interface RenderOptions {
  runner?: ProcessRunner;
  ffmpegCommand?: string;
  signal?: AbortSignal;
  draft?: boolean;
  approved?: boolean;
}

export interface RenderResult {
  outputPath: string;
  relativeOutputPath: string;
  width: number;
  height: number;
  durationMs: number;
}

function dimensions(aspectRatio: EditDecision["aspectRatio"], draft: boolean): [number, number] {
  if (aspectRatio === "9:16") return draft ? [360, 640] : [1080, 1920];
  if (aspectRatio === "16:9") return draft ? [640, 360] : [1920, 1080];
  return draft ? [480, 480] : [1080, 1080];
}

function escapeFilterFilename(file: string): string {
  return file.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function brandColor(value: string | undefined): string {
  return value && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : "#E75B2A";
}

export function validateEditDecision(decision: EditDecision, manifest: MediaManifest): void {
  if (decision.jobId !== manifest.jobId || decision.segments.length === 0) {
    throw new CookingVideoError("EDIT_CONSTRAINT_VIOLATION", "EDL is empty or belongs to a different job.");
  }
  let expectedTimelineMs = 0;
  for (const segment of decision.segments) {
    const source = manifest.sources.find(item => item.cameraId === segment.cameraId);
    if (!source) throw new CookingVideoError("EDIT_CONSTRAINT_VIOLATION", `Unknown EDL camera ${segment.cameraId}.`);
    if (segment.sourceStartMs < 0 || segment.sourceEndMs <= segment.sourceStartMs || segment.sourceEndMs > source.durationMs) {
      throw new CookingVideoError("EDIT_CONSTRAINT_VIOLATION", `EDL segment ${segment.id} is outside source bounds.`);
    }
    if (segment.timelineStartMs !== expectedTimelineMs) {
      throw new CookingVideoError("EDIT_CONSTRAINT_VIOLATION", `EDL segment ${segment.id} is not contiguous.`);
    }
    expectedTimelineMs += segment.sourceEndMs - segment.sourceStartMs;
  }
  if (expectedTimelineMs + decision.endCard.durationMs !== decision.durationTargetMs) {
    throw new CookingVideoError("EDIT_CONSTRAINT_VIOLATION", "EDL duration does not equal content plus end card duration.");
  }
}

export function buildRenderArgs(
  job: CookingVideoJob,
  paths: JobPaths,
  decision: EditDecision,
  manifest: MediaManifest,
  options: Pick<RenderOptions, "draft"> = {},
): { args: string[]; outputFile: string; width: number; height: number } {
  validateEditDecision(decision, manifest);
  const [width, height] = dimensions(decision.aspectRatio, options.draft === true);
  const args: string[] = ["-y"];
  const filters: string[] = [];
  const concatInputs: string[] = [];
  decision.segments.forEach((segment, index) => {
    const source = manifest.sources.find(item => item.cameraId === segment.cameraId)!;
    const input = resolveWithin(paths.root, source.proxyPath ?? source.path);
    const durationSec = ((segment.sourceEndMs - segment.sourceStartMs) / 1000).toFixed(3);
    args.push("-ss", (segment.sourceStartMs / 1000).toFixed(3), "-t", durationSec, "-i", input);
    filters.push(`[${index}:v:0]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${decision.fps},format=yuv420p[v${index}]`);
    if (source.streams.some(stream => stream.codecType === "audio")) {
      filters.push(`[${index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${decision.audio.sourceGainDb}dB[a${index}]`);
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${durationSec}[a${index}]`);
    }
    concatInputs.push(`[v${index}][a${index}]`);
  });
  const endDuration = (decision.endCard.durationMs / 1000).toFixed(3);
  filters.push(`color=c=${brandColor(job.brand?.primaryColor)}:s=${width}x${height}:r=${decision.fps}:d=${endDuration}[endv]`);
  filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${endDuration}[enda]`);
  filters.push(`${concatInputs.join("")}[endv][enda]concat=n=${decision.segments.length + 1}:v=1:a=1[basev][outa]`);
  const subtitleFile = path.join(paths.edit, "captions.srt");
  filters.push(`[basev]subtitles=filename='${escapeFilterFilename(subtitleFile)}':force_style='FontName=Microsoft YaHei,FontSize=${options.draft ? 18 : 42},PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=${options.draft ? 48 : 140}'[outv]`);
  const orientation = decision.aspectRatio === "9:16" ? "vertical" : decision.aspectRatio === "16:9" ? "landscape" : "square";
  const outputFile = path.join(paths.output, `promo-${orientation}-${Math.round(decision.durationTargetMs / 1000)}s${options.draft ? "-draft" : ""}.mp4`);
  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-preset", options.draft ? "veryfast" : "medium", "-crf", options.draft ? "28" : "20",
    "-c:a", "aac", "-b:a", "160k", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-shortest", outputFile,
  );
  return { args, outputFile, width, height };
}

export async function renderJob(job: CookingVideoJob, paths: JobPaths, options: RenderOptions = {}): Promise<RenderResult> {
  if (job.brief.requireHumanApproval === true && options.approved !== true) {
    throw new CookingVideoError("APPROVAL_REQUIRED", "This job requires explicit --approved before rendering.");
  }
  const [decision, manifest] = await Promise.all([
    readJsonFile<EditDecision>(path.join(paths.edit, "edit-decision.json")),
    readJsonFile<MediaManifest>(path.join(paths.analysis, "media-manifest.json")),
  ]);
  const built = buildRenderArgs(job, paths, decision, manifest, options);
  try {
    await runChecked(options.runner ?? runProcess, options.ffmpegCommand ?? "ffmpeg", built.args, { signal: options.signal });
    const outputStat = await stat(built.outputFile);
    if (!outputStat.isFile() || outputStat.size === 0) throw new Error("output is empty");
  } catch (error) {
    if (error instanceof CookingVideoError && error.code === "MEDIA_TOOL_MISSING") throw error;
    throw new CookingVideoError("RENDER_FAILED", `Video render failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result: RenderResult = {
    outputPath: built.outputFile,
    relativeOutputPath: path.relative(paths.root, built.outputFile).replace(/\\/g, "/"),
    width: built.width,
    height: built.height,
    durationMs: decision.durationTargetMs,
  };
  await writeJsonAtomic(path.join(paths.output, "render-result.json"), {
    ...result,
    outputPath: undefined,
    generatedAt: new Date().toISOString(),
  });
  return result;
}
