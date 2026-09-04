import { writeFile } from "node:fs/promises";
import path from "node:path";
import { CookingVideoError } from "./errors.js";
import { readJsonFile, writeJsonAtomic } from "./json-files.js";
import type { JobPaths } from "./paths.js";
import type { CookingEvent, CookingVideoJob, EditDecision, EditSegment, ShotCandidate, ShotCandidates } from "./types.js";

interface StorySlot {
  id: string;
  events: CookingEvent[];
  durationMs: number;
  caption: string;
}

interface StoryTemplate {
  id: string;
  durationTargetMs: number;
  endCardMs: number;
  slots: StorySlot[];
}

const TEMPLATES: Record<string, StoryTemplate> = {
  "15s": {
    id: "promo-highlight-15s-v1",
    durationTargetMs: 15_000,
    endCardMs: 1_500,
    slots: [
      { id: "hook", events: ["finished_dish", "plating", "dish_completed"], durationMs: 2_000, caption: "成品稳定，出餐更高效" },
      { id: "start", events: ["machine_intro", "cooking_started", "operator_interaction"], durationMs: 2_500, caption: "一键启动，自动烹饪" },
      { id: "ingredients", events: ["ingredient_added", "seasoning_added"], durationMs: 3_000, caption: "按流程自动投料" },
      { id: "action", events: ["stir_fry", "steam_or_flame", "sauce_coating"], durationMs: 3_500, caption: "稳定翻炒，均匀受热" },
      { id: "result", events: ["dish_completed", "plating", "finished_dish"], durationMs: 2_500, caption: "标准化完成每一道菜" },
    ],
  },
  "30s": {
    id: "promo-process-30s-v1",
    durationTargetMs: 30_000,
    endCardMs: 2_000,
    slots: [
      { id: "hook", events: ["finished_dish", "plating", "dish_completed"], durationMs: 3_000, caption: "稳定出品，从自动烹饪开始" },
      { id: "machine", events: ["machine_intro", "operator_interaction", "cooking_started"], durationMs: 4_000, caption: "简化操作，快速启动" },
      { id: "start", events: ["cooking_started"], durationMs: 3_000, caption: "流程自动执行" },
      { id: "ingredients", events: ["ingredient_added", "seasoning_added"], durationMs: 4_000, caption: "按配方执行投料步骤" },
      { id: "detail", events: ["seasoning_added", "ingredient_added", "sauce_coating"], durationMs: 4_000, caption: "关键步骤清晰可见" },
      { id: "action", events: ["stir_fry", "steam_or_flame", "sauce_coating"], durationMs: 5_000, caption: "自动翻炒，持续稳定" },
      { id: "result", events: ["dish_completed", "plating", "finished_dish"], durationMs: 5_000, caption: "标准流程，稳定完成" },
    ],
  },
};

function selectForSlot(candidates: ShotCandidate[], slot: StorySlot, previousCameraId?: string): ShotCandidate | undefined {
  const eligible = candidates
    .filter(candidate => slot.events.includes(candidate.event) && candidate.event !== "unusable")
    .sort((left, right) => right.scores.total - left.scores.total || left.rank - right.rank || left.startMs - right.startMs);
  const best = eligible[0];
  if (!best || previousCameraId === undefined || best.cameraId !== previousCameraId) return best;
  return eligible.find(candidate => candidate.cameraId !== previousCameraId && candidate.scores.total >= best.scores.total - 0.15) ?? best;
}

function fitClip(candidate: ShotCandidate, desiredMs: number, preferTail: boolean): { startMs: number; endMs: number } {
  const available = candidate.endMs - candidate.startMs;
  const duration = Math.min(desiredMs, available);
  if (duration < 500) {
    throw new CookingVideoError("EDIT_CONSTRAINT_VIOLATION", `Candidate ${candidate.occurrenceId}/${candidate.cameraId} is too short.`);
  }
  const startMs = preferTail ? candidate.endMs - duration : candidate.startMs;
  return { startMs: Math.round(startMs), endMs: Math.round(startMs + duration) };
}

function srtTimestamp(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = Math.floor(milliseconds % 1_000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function sanitizeCaption(value: string): string {
  return value.replace(/[{}\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

export function captionsToSrt(segments: EditSegment[], endCard?: EditDecision["endCard"]): string {
  const cues = segments.filter(segment => Boolean(segment.caption)).map(segment => {
    const end = segment.timelineStartMs + (segment.sourceEndMs - segment.sourceStartMs);
    return { start: segment.timelineStartMs, end, text: sanitizeCaption(segment.caption ?? "") };
  });
  if (endCard !== undefined && endCard.durationMs > 0) {
    const start = segments.length === 0 ? 0 : segments.at(-1)!.timelineStartMs + (segments.at(-1)!.sourceEndMs - segments.at(-1)!.sourceStartMs);
    cues.push({ start, end: start + endCard.durationMs, text: `{\\an5}${sanitizeCaption(endCard.headline)}` });
  }
  return cues.map((cue, index) => `${index + 1}\n${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}\n${cue.text}\n`).join("\n");
}

export function createEditDecision(
  job: CookingVideoJob,
  shotCandidates: ShotCandidates,
  templateKey?: "15s" | "30s",
): EditDecision {
  if (job.jobId !== shotCandidates.jobId) {
    throw new CookingVideoError("EDIT_CONSTRAINT_VIOLATION", "Shot candidates belong to a different job.");
  }
  const requestedDuration = job.brief.formats[0]?.durationSec ?? 15;
  const key = templateKey ?? (requestedDuration <= 15 ? "15s" : "30s");
  const template = TEMPLATES[key];
  if (!template) throw new CookingVideoError("EDIT_CONSTRAINT_VIOLATION", `Unknown story template: ${key}.`);
  const segments: EditSegment[] = [];
  let timelineStartMs = 0;
  for (const slot of template.slots) {
    const candidate = selectForSlot(shotCandidates.candidates, slot, segments.at(-1)?.cameraId);
    if (!candidate) {
      throw new CookingVideoError("NO_USABLE_SHOTS", `No selected shot can fill required slot ${slot.id}.`);
    }
    const clip = fitClip(candidate, slot.durationMs, slot.id === "hook" || slot.id === "result");
    const sellingPointIndex = slot.id === "ingredients" ? 0 : slot.id === "action" ? 1 : undefined;
    const sellingPoint = sellingPointIndex === undefined ? undefined : job.brief.sellingPoints?.[sellingPointIndex];
    const caption = sellingPoint && sellingPoint.length <= 20 ? sellingPoint : slot.caption;
    segments.push({
      id: `seg-${String(segments.length + 1).padStart(3, "0")}`,
      cameraId: candidate.cameraId,
      sourceStartMs: clip.startMs,
      sourceEndMs: clip.endMs,
      timelineStartMs,
      event: candidate.event,
      caption: sanitizeCaption(caption),
      transition: "cut",
      crop: { mode: "cover", focusX: 0.5, focusY: 0.5 },
    });
    timelineStartMs += clip.endMs - clip.startMs;
  }
  const contentTarget = template.durationTargetMs - template.endCardMs;
  if (timelineStartMs !== contentTarget) {
    throw new CookingVideoError(
      "EDIT_CONSTRAINT_VIOLATION",
      `Content duration ${timelineStartMs}ms does not satisfy template budget ${contentTarget}ms; add longer candidates or use another template.`,
    );
  }
  return {
    schemaVersion: "1.0",
    jobId: job.jobId,
    templateId: template.id,
    fps: 30,
    aspectRatio: job.brief.formats[0]?.aspectRatio ?? "9:16",
    durationTargetMs: timelineStartMs + template.endCardMs,
    segments,
    audio: { retainSourceAudio: true, sourceGainDb: -8, musicGainDb: -14 },
    endCard: {
      durationMs: template.endCardMs,
      headline: sanitizeCaption(job.brand?.endCardText ?? "让每一道菜都稳定出品"),
    },
  };
}

export async function createJobEdit(paths: JobPaths, job: CookingVideoJob, templateKey?: "15s" | "30s"): Promise<EditDecision> {
  const candidates = await readJsonFile<ShotCandidates>(path.join(paths.analysis, "shot-candidates.json"));
  const decision = createEditDecision(job, candidates, templateKey);
  await writeJsonAtomic(path.join(paths.edit, "edit-decision.json"), decision);
  await writeJsonAtomic(path.join(paths.edit, "render-props.json"), { schemaVersion: "1.0", editDecision: decision });
  await writeFile(path.join(paths.edit, "captions.srt"), captionsToSrt(decision.segments, decision.endCard), "utf8");
  return decision;
}
