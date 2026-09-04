import path from "node:path";
import { writeJsonAtomic } from "./json-files.js";
import { resolveWithin, type JobPaths } from "./paths.js";
import { runChecked, type ProcessRunner } from "./process-runner.js";
import type { MediaManifest, MotionSample, SceneAnalysis } from "./types.js";

export function parseSceneCutTimes(text: string): number[] {
  const times: number[] = [];
  const pattern = /pts_time:([\d.]+)/g;
  for (const match of text.matchAll(pattern)) {
    const milliseconds = Math.round(Number(match[1]) * 1000);
    if (Number.isFinite(milliseconds) && !times.includes(milliseconds)) times.push(milliseconds);
  }
  return times.sort((left, right) => left - right);
}

export function parseMotionSamples(text: string): MotionSample[] {
  const samples: MotionSample[] = [];
  const pattern = /pts_time:([\d.]+)[\s\S]*?lavfi\.signalstats\.YDIF=([\d.]+)/g;
  for (const match of text.matchAll(pattern)) {
    const timeMs = Math.round(Number(match[1]) * 1000);
    const score = Math.round(Number(match[2]) * 10_000) / 10_000;
    if (Number.isFinite(timeMs) && Number.isFinite(score)) samples.push({ timeMs, score });
  }
  return samples;
}

export async function analyzeMediaDynamics(
  manifest: MediaManifest,
  paths: JobPaths,
  runner: ProcessRunner,
  ffmpegCommand: string,
  signal?: AbortSignal,
): Promise<SceneAnalysis> {
  const sources: SceneAnalysis["sources"] = [];
  for (const source of manifest.sources) {
    const mediaFile = resolveWithin(paths.root, source.proxyPath ?? source.path);
    const scene = await runChecked(runner, ffmpegCommand, [
      "-hide_banner", "-v", "info", "-i", mediaFile,
      "-vf", "select=gt(scene\\,0.25),showinfo", "-an", "-f", "null", "-",
    ], { signal });
    const motion = await runChecked(runner, ffmpegCommand, [
      "-hide_banner", "-v", "info", "-i", mediaFile,
      "-vf", "fps=2,signalstats,metadata=print:key=lavfi.signalstats.YDIF", "-an", "-f", "null", "-",
    ], { signal });
    sources.push({
      cameraId: source.cameraId,
      cutsMs: parseSceneCutTimes(`${scene.stdout}\n${scene.stderr}`),
      motionSamples: parseMotionSamples(`${motion.stdout}\n${motion.stderr}`),
    });
  }
  const result: SceneAnalysis = {
    schemaVersion: "1.0",
    jobId: manifest.jobId,
    generatedAt: new Date().toISOString(),
    sources,
  };
  await writeJsonAtomic(path.join(paths.analysis, "scene-cuts.json"), result);
  return result;
}
