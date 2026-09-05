import { appendFile, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { CookingVideoError } from "./errors.js";
import { JobStore } from "./job-store.js";
import { readJsonFile } from "./json-files.js";
import type {
  CookingVideoFeedbackMetric,
  CookingVideoFeedbackSummary,
  EditDecision,
  EditFeedbackMetric,
  FeedbackFailureMode,
  QualityReport,
  ReviewFeedbackMetric,
  ReviewVerdict,
} from "./types.js";

const MAX_FEEDBACK_BYTES = 8 * 1024 * 1024;
const MAX_ANALYZED_JOBS = 500;
const FAILURE_MODES: readonly FeedbackFailureMode[] = ["pacing", "camera_choice", "image_quality", "copy", "brand", "audio", "compliance", "sync", "other"];

function roundedRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round(numerator / denominator * 10_000) / 10_000;
}

export function compareEditDecisions(previous: EditDecision, next: EditDecision, fromRevision: number, now = new Date()): EditFeedbackMetric {
  if (previous.jobId !== next.jobId || !Number.isInteger(fromRevision) || fromRevision < 1) {
    throw new CookingVideoError("JOB_INVALID", "Edit feedback inputs are invalid.");
  }
  const previousById = new Map(previous.segments.map((segment, index) => [segment.id, { segment, index }]));
  const nextById = new Map(next.segments.map((segment, index) => [segment.id, { segment, index }]));
  const shared = [...previousById.keys()].filter(id => nextById.has(id));
  let cameraChanges = 0;
  let timingChanges = 0;
  let captionChanges = 0;
  let cropChanges = 0;
  let transitionChanges = 0;
  for (const id of shared) {
    const before = previousById.get(id)!;
    const after = nextById.get(id)!;
    if (before.segment.cameraId !== after.segment.cameraId) cameraChanges += 1;
    if (before.segment.sourceStartMs !== after.segment.sourceStartMs || before.segment.sourceEndMs !== after.segment.sourceEndMs) timingChanges += 1;
    if ((before.segment.caption ?? "") !== (after.segment.caption ?? "")) captionChanges += 1;
    if (before.segment.crop.focusX !== after.segment.crop.focusX || before.segment.crop.focusY !== after.segment.crop.focusY) cropChanges += 1;
    if (before.segment.transition !== after.segment.transition) transitionChanges += 1;
  }
  const previousSharedOrder = previous.segments.filter(segment => nextById.has(segment.id)).map(segment => segment.id);
  const nextSharedOrder = next.segments.filter(segment => previousById.has(segment.id)).map(segment => segment.id);
  const reorderedSegments = previousSharedOrder.filter((id, index) => nextSharedOrder[index] !== id).length;
  return {
    schemaVersion: "1.0", type: "edit_saved", jobId: previous.jobId, recordedAt: now.toISOString(),
    fromRevision, toRevision: fromRevision + 1, beforeSegments: previous.segments.length, afterSegments: next.segments.length,
    comparableSegments: shared.length, cameraChanges, timingChanges, captionChanges, cropChanges, transitionChanges,
    addedSegments: next.segments.filter(segment => !previousById.has(segment.id)).length,
    deletedSegments: previous.segments.filter(segment => !nextById.has(segment.id)).length,
    reorderedSegments,
    audioChanged: JSON.stringify(previous.audio) !== JSON.stringify(next.audio),
    endCardChanged: JSON.stringify(previous.endCard) !== JSON.stringify(next.endCard),
  };
}

export function classifyReviewFailureModes(note: string | undefined): FeedbackFailureMode[] {
  const text = note?.trim().toLowerCase() ?? "";
  if (!text) return [];
  const matches: FeedbackFailureMode[] = [];
  const patterns: Array<[FeedbackFailureMode, RegExp]> = [
    ["pacing", /节奏|时长|太快|太慢|开场|结尾|pacing|duration|shorter|longer/],
    ["camera_choice", /机位|镜头|角度|换镜|camera|angle|shot/],
    ["image_quality", /模糊|抖动|曝光|遮挡|黑屏|画质|blur|shake|exposure|occlusion|quality/],
    ["copy", /字幕|文案|卖点|标题|caption|copy|headline|claim/],
    ["brand", /品牌|logo|字体|颜色|brand|font|color/],
    ["audio", /音频|声音|音乐|音量|audio|music|volume/],
    ["compliance", /合规|夸大|版权|隐私|禁用|compliance|copyright|privacy/],
    ["sync", /同步|对齐|时间码|sync|offset|timecode/],
  ];
  for (const [mode, pattern] of patterns) if (pattern.test(text)) matches.push(mode);
  return matches.length > 0 ? matches : ["other"];
}

export function createReviewFeedback(jobId: string, revision: number, verdict: Exclude<ReviewVerdict, "pending">, note: string | undefined, now = new Date()): ReviewFeedbackMetric {
  return {
    schemaVersion: "1.0", type: "review_submitted", jobId, recordedAt: now.toISOString(), revision, verdict,
    failureModes: verdict === "approved" ? [] : classifyReviewFailureModes(note),
  };
}

function validateFeedback(metric: CookingVideoFeedbackMetric, expectedJobId: string): CookingVideoFeedbackMetric {
  if (!metric || metric.schemaVersion !== "1.0" || metric.jobId !== expectedJobId || !Number.isFinite(Date.parse(metric.recordedAt))) {
    throw new CookingVideoError("JOB_INVALID", "Human feedback metric is invalid.");
  }
  if (metric.type === "review_submitted") {
    if (!(["approved", "changes_requested", "rejected"] as const).includes(metric.verdict) || metric.failureModes.some(mode => !FAILURE_MODES.includes(mode))) {
      throw new CookingVideoError("JOB_INVALID", "Review feedback metric is invalid.");
    }
  } else if (metric.type !== "edit_saved" || !Number.isInteger(metric.comparableSegments) || metric.comparableSegments < 0 || !Number.isInteger(metric.cameraChanges) || metric.cameraChanges < 0) {
    throw new CookingVideoError("JOB_INVALID", "Edit feedback metric is invalid.");
  }
  return structuredClone(metric);
}

async function optionalQuality(file: string): Promise<QualityReport | undefined> {
  try { return await readJsonFile<QualityReport>(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export class CookingVideoFeedbackStore {
  readonly #store: JobStore;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(jobsRoot: string) { this.#store = new JobStore(jobsRoot); }

  record = async (rawMetric: CookingVideoFeedbackMetric): Promise<void> => {
    const loaded = await this.#store.load(rawMetric.jobId);
    const metric = validateFeedback(rawMetric, loaded.job.jobId);
    this.#writeChain = this.#writeChain.catch(() => undefined).then(() => appendFile(loaded.paths.feedbackMetricsFile, `${JSON.stringify(metric)}\n`, "utf8"));
    await this.#writeChain;
  };

  async list(jobId: string): Promise<CookingVideoFeedbackMetric[]> {
    const loaded = await this.#store.load(jobId);
    try {
      const info = await stat(loaded.paths.feedbackMetricsFile);
      if (info.size > MAX_FEEDBACK_BYTES) throw new CookingVideoError("JOB_INVALID", "Human feedback file exceeds the 8 MB read limit.");
      const contents = await readFile(loaded.paths.feedbackMetricsFile, "utf8");
      return contents.split(/\r?\n/).filter(Boolean).map((line, index) => {
        try { return validateFeedback(JSON.parse(line) as CookingVideoFeedbackMetric, jobId); }
        catch (error) { throw new CookingVideoError("JOB_INVALID", `Invalid human feedback at line ${index + 1}.`, { cause: error instanceof Error ? error.message : String(error) }); }
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async summary(jobId?: string, now = new Date()): Promise<CookingVideoFeedbackSummary> {
    let jobIds: string[];
    if (jobId) {
      await this.#store.load(jobId);
      jobIds = [jobId];
    } else {
      const entries = await readdir(this.#store.jobsRoot, { withFileTypes: true }).catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      });
      jobIds = entries.filter(entry => entry.isDirectory()).slice(0, MAX_ANALYZED_JOBS).map(entry => entry.name);
    }
    const collect = async (id: string) => {
      const [feedback, quality] = await Promise.all([this.list(id), optionalQuality(path.join(this.#store.paths(id).output, "quality-report.json"))]);
      return { feedback, quality };
    };
    const collected = jobId
      ? [await collect(jobId)]
      : (await Promise.all(jobIds.map(id => collect(id).catch(() => undefined)))).filter((value): value is Awaited<ReturnType<typeof collect>> => value !== undefined);
    const feedback = collected.flatMap(item => item.feedback);
    const edits = feedback.filter((metric): metric is EditFeedbackMetric => metric.type === "edit_saved");
    const reviews = feedback.filter((metric): metric is ReviewFeedbackMetric => metric.type === "review_submitted");
    const reviewOutcomes: CookingVideoFeedbackSummary["reviewOutcomes"] = { approved: 0, changes_requested: 0, rejected: 0 };
    const failureModes = Object.fromEntries(FAILURE_MODES.map(mode => [mode, 0])) as CookingVideoFeedbackSummary["failureModes"];
    for (const review of reviews) {
      reviewOutcomes[review.verdict] += 1;
      for (const mode of review.failureModes) failureModes[mode] += 1;
    }
    const qualityFailures: Record<string, number> = {};
    for (const report of collected.map(item => item.quality).filter((value): value is QualityReport => value !== undefined)) {
      for (const check of report.checks.filter(check => check.status === "fail")) qualityFailures[check.id] = (qualityFailures[check.id] ?? 0) + 1;
    }
    const comparableSegments = edits.reduce((sum, edit) => sum + edit.comparableSegments, 0);
    const cameraChanges = edits.reduce((sum, edit) => sum + edit.cameraChanges, 0);
    return {
      schemaVersion: "1.0", generatedAt: now.toISOString(), ...(jobId ? { jobId } : {}), jobsAnalyzed: collected.length,
      jobsWithFeedback: new Set(feedback.map(metric => metric.jobId)).size, editSessions: edits.length, comparableSegments, cameraChanges,
      cameraChangeRate: roundedRate(cameraChanges, comparableSegments),
      timingChanges: edits.reduce((sum, edit) => sum + edit.timingChanges, 0),
      captionChanges: edits.reduce((sum, edit) => sum + edit.captionChanges, 0),
      addedSegments: edits.reduce((sum, edit) => sum + edit.addedSegments, 0),
      deletedSegments: edits.reduce((sum, edit) => sum + edit.deletedSegments, 0),
      reviewOutcomes, failureModes, qualityFailures,
    };
  }
}
