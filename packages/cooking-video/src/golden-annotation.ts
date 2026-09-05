import { CookingVideoError } from "./errors.js";
import { COOKING_EVENTS, type GoldenAnnotation } from "./types.js";

const EVENT_NAMES = COOKING_EVENTS.filter(event => event !== "unusable" && event !== "unknown");
const EXCLUSION_REASONS = ["blur", "shake", "occlusion", "exposure", "dirty_lens", "unsafe_crop", "duplicate", "irrelevant", "other"] as const;
const FORBIDDEN_REASONS = ["privacy", "safety", "brand", "food_quality", "obstruction", "technical", "irrelevant", "other"] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  if (extra.length > 0) throw new CookingVideoError("ARTIFACT_INVALID", `${label} contains unsupported field ${extra[0]}.`);
}

function timestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new CookingVideoError("ARTIFACT_INVALID", `${label} must be an ISO date-time.`);
}

function identifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) throw new CookingVideoError("ARTIFACT_INVALID", `${label} must be a safe identifier.`);
}

function interval(start: unknown, end: unknown, maximum: number, label: string): asserts start is number {
  if (!Number.isInteger(start) || !Number.isInteger(end) || Number(start) < 0 || Number(end) <= Number(start) || Number(end) > maximum) {
    throw new CookingVideoError("ARTIFACT_INVALID", `${label} must be an integer millisecond interval inside its source.`);
  }
}

function stringEnumArray(value: unknown, allowed: readonly string[], label: string, requireOne: boolean): asserts value is string[] {
  if (!Array.isArray(value) || (requireOne && value.length === 0) || value.some(item => typeof item !== "string" || !allowed.includes(item)) || new Set(value).size !== value.length) {
    throw new CookingVideoError("ARTIFACT_INVALID", `${label} contains invalid or duplicate values.`);
  }
}

function overlaps(left: { startMs: number; endMs: number }, right: { startMs: number; endMs: number }): boolean {
  return Math.max(left.startMs, right.startMs) < Math.min(left.endMs, right.endMs);
}

export function validateGoldenAnnotation(value: unknown, expectedJobId?: string): GoldenAnnotation {
  if (!record(value)) throw new CookingVideoError("ARTIFACT_INVALID", "Golden annotation must be an object.");
  exactKeys(value, ["schemaVersion", "sampleId", "jobId", "status", "annotatedAt", "annotatorId", "sources", "events", "candidates", "bestShots", "forbiddenRanges", "review"], "goldenAnnotation");
  if (value.schemaVersion !== "1.0" || !["draft", "reviewed", "adjudicated"].includes(String(value.status))) throw new CookingVideoError("ARTIFACT_INVALID", "Golden annotation schemaVersion or status is invalid.");
  identifier(value.sampleId, "sampleId"); identifier(value.jobId, "jobId"); identifier(value.annotatorId, "annotatorId");
  if (expectedJobId !== undefined && value.jobId !== expectedJobId) throw new CookingVideoError("ARTIFACT_INVALID", "Golden annotation belongs to a different job.");
  timestamp(value.annotatedAt, "annotatedAt");
  if (!Array.isArray(value.sources) || value.sources.length < 2 || value.sources.length > 4) throw new CookingVideoError("ARTIFACT_INVALID", "Golden annotation requires 2-4 sources.");
  const sourceDurations = new Map<string, number>();
  for (const [index, source] of value.sources.entries()) {
    if (!record(source)) throw new CookingVideoError("ARTIFACT_INVALID", `sources[${index}] is invalid.`);
    exactKeys(source, ["cameraId", "durationMs"], `sources[${index}]`);
    identifier(source.cameraId, `sources[${index}].cameraId`);
    if (!Number.isInteger(source.durationMs) || Number(source.durationMs) < 1) throw new CookingVideoError("ARTIFACT_INVALID", `sources[${index}].durationMs is invalid.`);
    if (sourceDurations.has(source.cameraId)) throw new CookingVideoError("ARTIFACT_INVALID", `Duplicate source cameraId ${source.cameraId}.`);
    sourceDurations.set(source.cameraId, Number(source.durationMs));
  }
  const timelineDuration = Math.max(...sourceDurations.values());
  if (!Array.isArray(value.events) || value.events.length === 0) throw new CookingVideoError("ARTIFACT_INVALID", "Golden annotation requires at least one event.");
  const events = new Map<string, Record<string, unknown>>();
  for (const [index, event] of value.events.entries()) {
    if (!record(event)) throw new CookingVideoError("ARTIFACT_INVALID", `events[${index}] is invalid.`);
    exactKeys(event, ["id", "event", "startMs", "endMs", "required", "visibility"], `events[${index}]`);
    identifier(event.id, `events[${index}].id`);
    if (events.has(event.id)) throw new CookingVideoError("ARTIFACT_INVALID", `Duplicate event id ${event.id}.`);
    if (!EVENT_NAMES.includes(event.event as never) || typeof event.required !== "boolean" || !["clear", "partial", "hidden"].includes(String(event.visibility))) throw new CookingVideoError("ARTIFACT_INVALID", `events[${index}] has invalid labels.`);
    if (event.required === true && event.visibility === "hidden") throw new CookingVideoError("ARTIFACT_INVALID", `Required event ${event.id} cannot be hidden.`);
    interval(event.startMs, event.endMs, timelineDuration, `events[${index}]`);
    events.set(event.id, event);
  }
  if (!Array.isArray(value.forbiddenRanges)) throw new CookingVideoError("ARTIFACT_INVALID", "forbiddenRanges must be an array.");
  const forbiddenIds = new Set<string>();
  const forbidden = value.forbiddenRanges.map((range, index) => {
    if (!record(range)) throw new CookingVideoError("ARTIFACT_INVALID", `forbiddenRanges[${index}] is invalid.`);
    exactKeys(range, ["id", "cameraId", "startMs", "endMs", "severity", "reasons"], `forbiddenRanges[${index}]`);
    identifier(range.id, `forbiddenRanges[${index}].id`); identifier(range.cameraId, `forbiddenRanges[${index}].cameraId`);
    if (forbiddenIds.has(range.id)) throw new CookingVideoError("ARTIFACT_INVALID", `Duplicate forbidden range id ${range.id}.`);
    forbiddenIds.add(range.id);
    const duration = sourceDurations.get(range.cameraId);
    if (duration === undefined) throw new CookingVideoError("ARTIFACT_INVALID", `Forbidden range ${range.id} references an unknown camera.`);
    interval(range.startMs, range.endMs, duration, `forbiddenRanges[${index}]`);
    if (!(["exclude", "warn"] as const).includes(range.severity as never)) throw new CookingVideoError("ARTIFACT_INVALID", `forbiddenRanges[${index}].severity is invalid.`);
    stringEnumArray(range.reasons, FORBIDDEN_REASONS, `forbiddenRanges[${index}].reasons`, true);
    return range as unknown as GoldenAnnotation["forbiddenRanges"][number];
  });
  if (!Array.isArray(value.candidates)) throw new CookingVideoError("ARTIFACT_INVALID", "candidates must be an array.");
  const candidates = new Map<string, GoldenAnnotation["candidates"][number]>();
  for (const [index, candidate] of value.candidates.entries()) {
    if (!record(candidate)) throw new CookingVideoError("ARTIFACT_INVALID", `candidates[${index}] is invalid.`);
    exactKeys(candidate, ["id", "eventId", "cameraId", "startMs", "endMs", "usable", "exclusionReasons"], `candidates[${index}]`);
    identifier(candidate.id, `candidates[${index}].id`); identifier(candidate.eventId, `candidates[${index}].eventId`); identifier(candidate.cameraId, `candidates[${index}].cameraId`);
    if (candidates.has(candidate.id)) throw new CookingVideoError("ARTIFACT_INVALID", `Duplicate candidate id ${candidate.id}.`);
    if (!events.has(candidate.eventId)) throw new CookingVideoError("ARTIFACT_INVALID", `Candidate ${candidate.id} references an unknown event.`);
    const duration = sourceDurations.get(candidate.cameraId);
    if (duration === undefined) throw new CookingVideoError("ARTIFACT_INVALID", `Candidate ${candidate.id} references an unknown camera.`);
    interval(candidate.startMs, candidate.endMs, duration, `candidates[${index}]`);
    if (typeof candidate.usable !== "boolean") throw new CookingVideoError("ARTIFACT_INVALID", `candidates[${index}].usable is invalid.`);
    stringEnumArray(candidate.exclusionReasons, EXCLUSION_REASONS, `candidates[${index}].exclusionReasons`, !candidate.usable);
    if (candidate.usable && candidate.exclusionReasons.length > 0) throw new CookingVideoError("ARTIFACT_INVALID", `Usable candidate ${candidate.id} cannot have exclusion reasons.`);
    const normalized = candidate as unknown as GoldenAnnotation["candidates"][number];
    if (normalized.usable && forbidden.some(range => range.cameraId === normalized.cameraId && range.severity === "exclude" && overlaps(normalized, range))) {
      throw new CookingVideoError("ARTIFACT_INVALID", `Usable candidate ${normalized.id} overlaps an excluded range.`);
    }
    candidates.set(normalized.id, normalized);
  }
  if (!Array.isArray(value.bestShots)) throw new CookingVideoError("ARTIFACT_INVALID", "bestShots must be an array.");
  const selectedEvents = new Set<string>();
  for (const [index, selection] of value.bestShots.entries()) {
    if (!record(selection)) throw new CookingVideoError("ARTIFACT_INVALID", `bestShots[${index}] is invalid.`);
    exactKeys(selection, ["eventId", "primaryCandidateId", "alternateCandidateIds"], `bestShots[${index}]`);
    identifier(selection.eventId, `bestShots[${index}].eventId`); identifier(selection.primaryCandidateId, `bestShots[${index}].primaryCandidateId`);
    if (!events.has(selection.eventId) || selectedEvents.has(selection.eventId)) throw new CookingVideoError("ARTIFACT_INVALID", `Best-shot event ${selection.eventId} is unknown or duplicated.`);
    selectedEvents.add(selection.eventId);
    if (!Array.isArray(selection.alternateCandidateIds) || selection.alternateCandidateIds.some(id => typeof id !== "string") || new Set(selection.alternateCandidateIds).size !== selection.alternateCandidateIds.length || selection.alternateCandidateIds.includes(selection.primaryCandidateId)) {
      throw new CookingVideoError("ARTIFACT_INVALID", `bestShots[${index}].alternateCandidateIds is invalid.`);
    }
    for (const candidateId of [selection.primaryCandidateId, ...selection.alternateCandidateIds]) {
      const candidate = candidates.get(candidateId);
      if (!candidate || !candidate.usable || candidate.eventId !== selection.eventId) throw new CookingVideoError("ARTIFACT_INVALID", `Best-shot candidate ${candidateId} must be usable and belong to event ${selection.eventId}.`);
    }
  }
  const finalized = value.status === "reviewed" || value.status === "adjudicated";
  if (finalized) {
    for (const event of events.values()) {
      if (event.required === true && !selectedEvents.has(event.id as string)) throw new CookingVideoError("ARTIFACT_INVALID", `Required event ${event.id} has no best shot.`);
    }
    if (!record(value.review)) throw new CookingVideoError("ARTIFACT_INVALID", "Reviewed annotations require review metadata.");
  }
  if (value.review !== undefined) {
    if (!record(value.review)) throw new CookingVideoError("ARTIFACT_INVALID", "review is invalid.");
    exactKeys(value.review, ["reviewerId", "reviewedAt", "verdict", "issueCodes"], "review");
    identifier(value.review.reviewerId, "review.reviewerId"); timestamp(value.review.reviewedAt, "review.reviewedAt");
    if (!(["approved", "changes_required"] as const).includes(value.review.verdict as never) || !Array.isArray(value.review.issueCodes) || new Set(value.review.issueCodes).size !== value.review.issueCodes.length || value.review.issueCodes.some(code => typeof code !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(code))) {
      throw new CookingVideoError("ARTIFACT_INVALID", "review verdict or issueCodes are invalid.");
    }
    if (value.review.reviewerId === value.annotatorId) throw new CookingVideoError("ARTIFACT_INVALID", "Reviewer must differ from annotator.");
    if (finalized && value.review.verdict !== "approved") throw new CookingVideoError("ARTIFACT_INVALID", "Reviewed or adjudicated annotations require an approved review verdict.");
  }
  return structuredClone(value) as unknown as GoldenAnnotation;
}
