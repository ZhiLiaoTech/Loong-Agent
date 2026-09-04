import path from "node:path";
import { CookingVideoError } from "./errors.js";
import { JOB_SCHEMA_VERSION, type CookingVideoJob } from "./types.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_CAMERA_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ASPECT_RATIOS = new Set(["9:16", "16:9", "1:1"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateInputAssetPath(value: unknown, label: string): void {
  if (value === undefined) return;
  if (typeof value !== "string" || path.isAbsolute(value)) throw new CookingVideoError("JOB_INVALID", `${label} must be relative to the job directory.`);
  const portable = value.replace(/\\/g, "/");
  if (!portable.startsWith("input/") || portable.split("/").includes("..")) throw new CookingVideoError("JOB_INVALID", `${label} must be inside input/.`);
}

export function assertSafeId(value: string, label = "id"): void {
  if (!SAFE_ID.test(value)) {
    throw new CookingVideoError("JOB_INVALID", `${label} contains unsupported characters.`);
  }
}

export function validateJob(value: unknown): CookingVideoJob {
  if (!isObject(value) || value.schemaVersion !== JOB_SCHEMA_VERSION) {
    throw new CookingVideoError("JOB_INVALID", `job.schemaVersion must be ${JOB_SCHEMA_VERSION}.`);
  }
  if (typeof value.jobId !== "string") {
    throw new CookingVideoError("JOB_INVALID", "jobId is required.");
  }
  assertSafeId(value.jobId, "jobId");
  if (!Array.isArray(value.sources) || value.sources.length < 2 || value.sources.length > 4) {
    throw new CookingVideoError("JOB_INVALID", "sources must contain between 2 and 4 cameras.");
  }
  const cameraIds = new Set<string>();
  for (const source of value.sources) {
    if (!isObject(source) || typeof source.cameraId !== "string" || !SAFE_CAMERA_ID.test(source.cameraId)) {
      throw new CookingVideoError("JOB_INVALID", "Every source must have a safe cameraId.");
    }
    if (cameraIds.has(source.cameraId)) {
      throw new CookingVideoError("JOB_INVALID", `Duplicate cameraId: ${source.cameraId}.`);
    }
    cameraIds.add(source.cameraId);
    if (typeof source.path !== "string" || source.path.length === 0 || path.isAbsolute(source.path)) {
      throw new CookingVideoError("JOB_INVALID", `Source ${source.cameraId} path must be relative to the job directory.`);
    }
    const portable = source.path.replace(/\\/g, "/");
    if (!portable.startsWith("input/") || portable.split("/").includes("..")) {
      throw new CookingVideoError("JOB_INVALID", `Source ${source.cameraId} must be inside input/.`);
    }
  }
  if (value.machineEventsPath !== undefined) {
    if (typeof value.machineEventsPath !== "string" || path.isAbsolute(value.machineEventsPath)) {
      throw new CookingVideoError("JOB_INVALID", "machineEventsPath must be relative to the job directory.");
    }
    const portable = value.machineEventsPath.replace(/\\/g, "/");
    if (!portable.startsWith("input/") || portable.split("/").includes("..")) {
      throw new CookingVideoError("JOB_INVALID", "machineEventsPath must be inside input/.");
    }
  }
  if (!isObject(value.brief) || !Array.isArray(value.brief.formats) || value.brief.formats.length === 0) {
    throw new CookingVideoError("JOB_INVALID", "brief.formats must contain at least one output format.");
  }
  if (value.brand !== undefined) {
    if (!isObject(value.brand)) throw new CookingVideoError("JOB_INVALID", "brand must be an object.");
    validateInputAssetPath(value.brand.logo, "brand.logo");
    for (const color of [value.brand.primaryColor, value.brand.accentColor, value.brand.textColor]) {
      if (color !== undefined && (typeof color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(color))) throw new CookingVideoError("JOB_INVALID", "Brand colors must use #RRGGBB format.");
    }
  }
  if (value.audio !== undefined) {
    if (!isObject(value.audio)) throw new CookingVideoError("JOB_INVALID", "audio must be an object.");
    validateInputAssetPath(value.audio.musicPath, "audio.musicPath");
    for (const gain of [value.audio.sourceGainDb, value.audio.musicGainDb]) {
      if (gain !== undefined && (typeof gain !== "number" || !Number.isFinite(gain) || gain < -60 || gain > 12)) throw new CookingVideoError("JOB_INVALID", "Audio gains must be between -60dB and 12dB.");
    }
  }
  for (const format of value.brief.formats) {
    if (!isObject(format) || typeof format.aspectRatio !== "string" || !ASPECT_RATIOS.has(format.aspectRatio)) {
      throw new CookingVideoError("JOB_INVALID", "Every format must use a supported aspectRatio.");
    }
    if (!Number.isInteger(format.durationSec) || (format.durationSec as number) < 5 || (format.durationSec as number) > 180) {
      throw new CookingVideoError("JOB_INVALID", "format.durationSec must be an integer between 5 and 180.");
    }
  }
  return value as unknown as CookingVideoJob;
}
