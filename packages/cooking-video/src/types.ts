export const JOB_SCHEMA_VERSION = "1.0" as const;

export type AspectRatio = "9:16" | "16:9" | "1:1";

export interface CookingVideoSource {
  cameraId: string;
  path: string;
  role?: string;
}

export interface CookingVideoFormat {
  aspectRatio: AspectRatio;
  durationSec: number;
}

export interface CookingVideoJob {
  schemaVersion: typeof JOB_SCHEMA_VERSION;
  jobId: string;
  dish?: { name?: string; ingredients?: string[] };
  machine?: { model?: string; serialNumber?: string };
  machineEventsPath?: string;
  sources: CookingVideoSource[];
  brief: {
    audience?: string;
    objective?: string;
    sellingPoints?: string[];
    formats: CookingVideoFormat[];
    language?: string;
    requireHumanApproval?: boolean;
  };
  brand?: {
    logo?: string;
    primaryColor?: string;
    accentColor?: string;
    textColor?: string;
    fontFamily?: string;
    endCardText?: string;
  };
  audio?: {
    musicPath?: string;
    sourceGainDb?: number;
    musicGainDb?: number;
  };
}

export const JOB_STAGES = [
  "created",
  "ingesting",
  "ingested",
  "syncing",
  "synced",
  "analyzing",
  "analyzed",
  "selecting",
  "selected",
  "editing",
  "awaiting_review",
  "rendering",
  "validating",
  "completed",
  "failed",
  "cancelled",
] as const;

export type JobStage = (typeof JOB_STAGES)[number];

export interface StageRecord {
  stage: JobStage;
  status: "running" | "completed" | "failed" | "cancelled";
  attempt: number;
  startedAt: string;
  completedAt?: string;
  inputDigest?: string;
  outputFiles?: string[];
  errorCode?: string;
  errorMessage?: string;
}

export interface JobState {
  schemaVersion: "1.0";
  jobId: string;
  status: JobStage;
  createdAt: string;
  updatedAt: string;
  inputDigest?: string;
  stages: StageRecord[];
}

export interface MediaStreamInfo {
  index: number;
  codecType: string;
  codecName?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  durationMs?: number;
  rotation?: number;
}

export interface MediaSourceManifest {
  cameraId: string;
  role?: string;
  path: string;
  byteSize: number;
  sha256: string;
  durationMs: number;
  creationTime?: string;
  formatName?: string;
  streams: MediaStreamInfo[];
  proxyPath?: string;
  contactSheetPath?: string;
}

export interface MediaManifest {
  schemaVersion: "1.0";
  jobId: string;
  generatedAt: string;
  sources: MediaSourceManifest[];
  warnings: string[];
}

export interface MotionSample {
  timeMs: number;
  score: number;
}

export interface CameraSceneAnalysis {
  cameraId: string;
  cutsMs: number[];
  motionSamples: MotionSample[];
}

export interface SceneAnalysis {
  schemaVersion: "1.0";
  jobId: string;
  generatedAt: string;
  sources: CameraSceneAnalysis[];
}

export type SyncMethod = "timecode" | "machine_event" | "audio_cross_correlation" | "manual" | "aligned_start";

export interface CameraSync {
  offsetMs: number;
}

export interface SyncMap {
  schemaVersion: "1.0";
  jobId: string;
  referenceCameraId: string;
  method: SyncMethod;
  confidence: number;
  cameras: Record<string, CameraSync>;
  generatedAt: string;
}

export const COOKING_EVENTS = [
  "machine_intro",
  "cooking_started",
  "ingredient_added",
  "seasoning_added",
  "stir_fry",
  "steam_or_flame",
  "sauce_coating",
  "dish_completed",
  "plating",
  "finished_dish",
  "operator_interaction",
  "unusable",
  "unknown",
] as const;

export type CookingEvent = (typeof COOKING_EVENTS)[number];

export interface DetectedEvent {
  occurrenceId: string;
  cameraId: string;
  startMs: number;
  endMs: number;
  event: CookingEvent;
  confidence: number;
  evidenceFrames: string[];
  problems?: string[];
}

export interface EventTimeline {
  schemaVersion: "1.0";
  jobId: string;
  generatedAt: string;
  source: "machine_events" | "vision" | "hybrid" | "heuristic";
  events: DetectedEvent[];
}

export interface VisionEvidenceItem {
  id: string;
  cameraId: string;
  sourceTimeMs: number;
  sourceDurationMs: number;
  timelineTimeMs: number;
  imagePath: string;
}

export interface VisionEvidenceRequest {
  schemaVersion: "1.0";
  jobId: string;
  generatedAt: string;
  intervalMs: number;
  allowedEvents: readonly CookingEvent[];
  items: VisionEvidenceItem[];
}

export interface VisionDetection {
  itemId: string;
  event: CookingEvent;
  confidence: number;
  problems?: string[];
}

export interface VisionEvidenceResponse {
  schemaVersion: "1.0";
  jobId: string;
  detections: VisionDetection[];
}

export interface ShotScores {
  eventConfidence: number;
  roleFit: number;
  resolution: number;
  durationFit: number;
  exposure: number;
  dynamicRange: number;
  saturation: number;
  sharpness: number;
  motion: number;
  stability: number;
  continuity: number;
  verticalCrop: number;
  occlusionPenalty: number;
  repetitionPenalty: number;
  total: number;
}

export interface ShotCandidate extends DetectedEvent {
  rank: number;
  selected: boolean;
  scores: ShotScores;
}

export interface ShotCandidates {
  schemaVersion: "1.0";
  jobId: string;
  generatedAt: string;
  candidates: ShotCandidate[];
}

export interface EditSegment {
  id: string;
  cameraId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  timelineStartMs: number;
  event: CookingEvent;
  caption?: string;
  transition: "cut" | "fade" | "slide";
  crop: { mode: "cover"; focusX: number; focusY: number };
}

export interface EditDecision {
  schemaVersion: "1.0";
  jobId: string;
  templateId: string;
  fps: number;
  aspectRatio: AspectRatio;
  durationTargetMs: number;
  segments: EditSegment[];
  audio: {
    retainSourceAudio: boolean;
    sourceGainDb: number;
    musicGainDb: number;
  };
  endCard: {
    durationMs: number;
    headline: string;
  };
}

export type ReviewVerdict = "pending" | "approved" | "changes_requested" | "rejected";

export interface ReviewRecord {
  id: string;
  revision: number;
  verdict: Exclude<ReviewVerdict, "pending">;
  note?: string;
  reviewer?: string;
  createdAt: string;
}

export interface EditReviewState {
  schemaVersion: "1.0";
  jobId: string;
  revision: number;
  verdict: ReviewVerdict;
  updatedAt: string;
  history: ReviewRecord[];
}

export interface CookingVideoReviewWorkspace {
  job: CookingVideoJob;
  state: JobState;
  review: EditReviewState;
  manifest: MediaManifest;
  sync?: SyncMap;
  timeline?: EventTimeline;
  decision: EditDecision;
  quality?: QualityReport;
  previewPath?: string;
}

export interface QualityCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
  evidenceTimeMs?: number;
  remediation?: string;
}

export interface QualityReport {
  schemaVersion: "1.0";
  jobId: string;
  generatedAt: string;
  status: "pass" | "warn" | "fail";
  videoPath: string;
  checks: QualityCheck[];
}

export type ModelOperation = "vision" | "copy";
export type ModelCallStatus = "succeeded" | "failed" | "timeout" | "cancelled";

export interface ModelCallMetric {
  schemaVersion: "1.0";
  jobId: string;
  operation: ModelOperation;
  status: ModelCallStatus;
  attempt: number;
  batchIndex?: number;
  startedAt: string;
  durationMs: number;
  inputUnits: number;
  outputUnits: number;
  estimatedCostUsd: number;
  errorCode?: string;
}

export interface CookingVideoMetricsSummary {
  schemaVersion: "1.0";
  jobId: string;
  generatedAt: string;
  model: {
    calls: number;
    succeeded: number;
    failed: number;
    timedOut: number;
    cancelled: number;
    inputUnits: number;
    outputUnits: number;
    estimatedCostUsd: number;
    totalDurationMs: number;
    averageDurationMs: number;
    p95DurationMs: number;
    byOperation: Record<ModelOperation, { calls: number; failed: number; estimatedCostUsd: number; totalDurationMs: number }>;
  };
  pipeline: {
    stageAttempts: number;
    failedStages: number;
    totalDurationMs: number;
  };
}

export type FeedbackFailureMode = "pacing" | "camera_choice" | "image_quality" | "copy" | "brand" | "audio" | "compliance" | "sync" | "other";

export interface EditFeedbackMetric {
  schemaVersion: "1.0";
  type: "edit_saved";
  jobId: string;
  recordedAt: string;
  fromRevision: number;
  toRevision: number;
  beforeSegments: number;
  afterSegments: number;
  comparableSegments: number;
  cameraChanges: number;
  timingChanges: number;
  captionChanges: number;
  cropChanges: number;
  transitionChanges: number;
  addedSegments: number;
  deletedSegments: number;
  reorderedSegments: number;
  audioChanged: boolean;
  endCardChanged: boolean;
}

export interface ReviewFeedbackMetric {
  schemaVersion: "1.0";
  type: "review_submitted";
  jobId: string;
  recordedAt: string;
  revision: number;
  verdict: Exclude<ReviewVerdict, "pending">;
  failureModes: FeedbackFailureMode[];
}

export type CookingVideoFeedbackMetric = EditFeedbackMetric | ReviewFeedbackMetric;

export interface CookingVideoFeedbackSummary {
  schemaVersion: "1.0";
  generatedAt: string;
  jobId?: string;
  jobsAnalyzed: number;
  jobsWithFeedback: number;
  editSessions: number;
  comparableSegments: number;
  cameraChanges: number;
  cameraChangeRate: number;
  timingChanges: number;
  captionChanges: number;
  addedSegments: number;
  deletedSegments: number;
  reviewOutcomes: Record<Exclude<ReviewVerdict, "pending">, number>;
  failureModes: Record<FeedbackFailureMode, number>;
  qualityFailures: Record<string, number>;
}

export type GoldenAnnotationStatus = "draft" | "reviewed" | "adjudicated";
export type GoldenCandidateExclusionReason = "blur" | "shake" | "occlusion" | "exposure" | "dirty_lens" | "unsafe_crop" | "duplicate" | "irrelevant" | "other";
export type GoldenForbiddenReason = "privacy" | "safety" | "brand" | "food_quality" | "obstruction" | "technical" | "irrelevant" | "other";

export interface GoldenAnnotation {
  schemaVersion: "1.0";
  sampleId: string;
  jobId: string;
  status: GoldenAnnotationStatus;
  annotatedAt: string;
  annotatorId: string;
  sources: Array<{ cameraId: string; durationMs: number }>;
  events: Array<{
    id: string;
    event: Exclude<CookingEvent, "unusable" | "unknown">;
    startMs: number;
    endMs: number;
    required: boolean;
    visibility: "clear" | "partial" | "hidden";
  }>;
  candidates: Array<{
    id: string;
    eventId: string;
    cameraId: string;
    startMs: number;
    endMs: number;
    usable: boolean;
    exclusionReasons: GoldenCandidateExclusionReason[];
  }>;
  bestShots: Array<{ eventId: string; primaryCandidateId: string; alternateCandidateIds: string[] }>;
  forbiddenRanges: Array<{
    id: string;
    cameraId: string;
    startMs: number;
    endMs: number;
    severity: "exclude" | "warn";
    reasons: GoldenForbiddenReason[];
  }>;
  review?: {
    reviewerId: string;
    reviewedAt: string;
    verdict: "approved" | "changes_required";
    issueCodes: string[];
  };
}
