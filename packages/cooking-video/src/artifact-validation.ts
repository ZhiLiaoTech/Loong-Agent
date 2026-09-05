import path from "node:path";
import { CookingVideoError } from "./errors.js";
import { resolveWithin } from "./paths.js";
import { COOKING_EVENTS, type MediaManifest, type ShotCandidates } from "./types.js";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown, label: string, minimum = Number.NEGATIVE_INFINITY): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new CookingVideoError("ARTIFACT_INVALID", `${label} must be a finite number >= ${minimum}.`);
  }
}

function relativeJobPath(value: unknown, label: string, prefix?: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) {
    throw new CookingVideoError("ARTIFACT_INVALID", `${label} must be a relative job path.`);
  }
  try {
    resolveWithin("artifact-root", value);
  } catch {
    throw new CookingVideoError("ARTIFACT_INVALID", `${label} escapes the job root.`);
  }
  if (prefix !== undefined && !value.replace(/\\/g, "/").startsWith(`${prefix}/`)) {
    throw new CookingVideoError("ARTIFACT_INVALID", `${label} must be inside ${prefix}/.`);
  }
}

function timestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new CookingVideoError("ARTIFACT_INVALID", `${label} must be an ISO date-time.`);
  }
}

export function validateMediaManifest(value: unknown, expectedJobId?: string): MediaManifest {
  if (!object(value) || value.schemaVersion !== "1.0" || typeof value.jobId !== "string" || !Array.isArray(value.sources)
    || value.sources.length < 2 || value.sources.length > 4 || !Array.isArray(value.warnings)
    || value.warnings.some(item => typeof item !== "string")) {
    throw new CookingVideoError("ARTIFACT_INVALID", "media-manifest.json has an invalid top-level structure.");
  }
  if (expectedJobId !== undefined && value.jobId !== expectedJobId) {
    throw new CookingVideoError("ARTIFACT_INVALID", "Media manifest belongs to a different job.");
  }
  timestamp(value.generatedAt, "mediaManifest.generatedAt");
  const cameraIds = new Set<string>();
  for (const [index, rawSource] of value.sources.entries()) {
    if (!object(rawSource) || typeof rawSource.cameraId !== "string" || rawSource.cameraId.length === 0
      || typeof rawSource.sha256 !== "string" || rawSource.sha256.length === 0
      || !Array.isArray(rawSource.streams)) {
      throw new CookingVideoError("ARTIFACT_INVALID", `mediaManifest.sources[${index}] is invalid.`);
    }
    if (cameraIds.has(rawSource.cameraId)) throw new CookingVideoError("ARTIFACT_INVALID", `Duplicate manifest cameraId: ${rawSource.cameraId}.`);
    cameraIds.add(rawSource.cameraId);
    relativeJobPath(rawSource.path, `mediaManifest.sources[${index}].path`, "input");
    if (rawSource.proxyPath !== undefined) relativeJobPath(rawSource.proxyPath, `mediaManifest.sources[${index}].proxyPath`, "proxy");
    if (rawSource.contactSheetPath !== undefined) relativeJobPath(rawSource.contactSheetPath, `mediaManifest.sources[${index}].contactSheetPath`, "frames");
    finite(rawSource.byteSize, `mediaManifest.sources[${index}].byteSize`, 1);
    finite(rawSource.durationMs, `mediaManifest.sources[${index}].durationMs`, 1);
    if (!rawSource.streams.some(stream => object(stream) && stream.codecType === "video")) {
      throw new CookingVideoError("ARTIFACT_INVALID", `Manifest camera ${rawSource.cameraId} has no video stream.`);
    }
  }
  return value as unknown as MediaManifest;
}

export function validateShotCandidates(value: unknown, manifest?: MediaManifest): ShotCandidates {
  if (!object(value) || value.schemaVersion !== "1.0" || typeof value.jobId !== "string" || !Array.isArray(value.candidates)) {
    throw new CookingVideoError("ARTIFACT_INVALID", "shot-candidates.json has an invalid top-level structure.");
  }
  timestamp(value.generatedAt, "shotCandidates.generatedAt");
  if (manifest !== undefined && value.jobId !== manifest.jobId) {
    throw new CookingVideoError("ARTIFACT_INVALID", "Shot candidates belong to a different job.");
  }
  const selectedByOccurrence = new Map<string, number>();
  const ranksByOccurrence = new Map<string, Set<number>>();
  for (const [index, rawCandidate] of value.candidates.entries()) {
    if (!object(rawCandidate) || typeof rawCandidate.occurrenceId !== "string" || rawCandidate.occurrenceId.length === 0
      || typeof rawCandidate.cameraId !== "string" || !COOKING_EVENTS.includes(rawCandidate.event as never)
      || !Number.isInteger(rawCandidate.rank) || (rawCandidate.rank as number) < 1 || typeof rawCandidate.selected !== "boolean"
      || !object(rawCandidate.scores) || !Array.isArray(rawCandidate.evidenceFrames)) {
      throw new CookingVideoError("ARTIFACT_INVALID", `shotCandidates.candidates[${index}] is invalid.`);
    }
    if (rawCandidate.evidenceFrames.some(frame => {
      try { relativeJobPath(frame, `candidate[${index}].evidenceFrames`, "frames"); return false; } catch { return true; }
    })) throw new CookingVideoError("ARTIFACT_INVALID", `Candidate ${index} contains an invalid evidence frame path.`);
    const ranks = ranksByOccurrence.get(rawCandidate.occurrenceId) ?? new Set<number>();
    if (ranks.has(rawCandidate.rank as number)) throw new CookingVideoError("ARTIFACT_INVALID", `Duplicate rank in occurrence ${rawCandidate.occurrenceId}.`);
    ranks.add(rawCandidate.rank as number);
    ranksByOccurrence.set(rawCandidate.occurrenceId, ranks);
    finite(rawCandidate.startMs, `candidate[${index}].startMs`, 0);
    finite(rawCandidate.endMs, `candidate[${index}].endMs`, 0);
    if (rawCandidate.endMs <= rawCandidate.startMs) throw new CookingVideoError("ARTIFACT_INVALID", `Candidate ${index} has an invalid interval.`);
    for (const key of ["eventConfidence", "roleFit", "resolution", "durationFit", "exposure", "dynamicRange", "saturation", "sharpness", "motion", "stability", "continuity", "verticalCrop", "occlusionPenalty", "repetitionPenalty", "total"] as const) {
      finite(rawCandidate.scores[key], `candidate[${index}].scores.${key}`, 0);
      if ((rawCandidate.scores[key] as number) > 1) throw new CookingVideoError("ARTIFACT_INVALID", `candidate[${index}].scores.${key} must be <= 1.`);
    }
    for (const key of ["foodAppeal", "actionSalience", "productVisibility", "composition"] as const) {
      if (rawCandidate.scores[key] === undefined) continue;
      finite(rawCandidate.scores[key], `candidate[${index}].scores.${key}`, 0);
      if ((rawCandidate.scores[key] as number) > 1) throw new CookingVideoError("ARTIFACT_INVALID", `candidate[${index}].scores.${key} must be <= 1.`);
    }
    const source = manifest?.sources.find(item => item.cameraId === rawCandidate.cameraId);
    if (manifest !== undefined && (!source || rawCandidate.endMs > source.durationMs)) {
      throw new CookingVideoError("ARTIFACT_INVALID", `Candidate ${index} references an unknown camera or exceeds source duration.`);
    }
    if (rawCandidate.selected) selectedByOccurrence.set(rawCandidate.occurrenceId, (selectedByOccurrence.get(rawCandidate.occurrenceId) ?? 0) + 1);
  }
  if ([...selectedByOccurrence.values()].some(count => count > 1)) {
    throw new CookingVideoError("ARTIFACT_INVALID", "Only one camera may be selected per event occurrence.");
  }
  return value as unknown as ShotCandidates;
}
