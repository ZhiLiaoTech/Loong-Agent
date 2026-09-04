export type CookingVideoErrorCode =
  | "JOB_INVALID"
  | "JOB_EXISTS"
  | "JOB_NOT_FOUND"
  | "JOB_STATE_INVALID"
  | "PATH_OUTSIDE_JOB"
  | "MEDIA_UNREADABLE"
  | "MEDIA_DURATION_MISMATCH"
  | "MEDIA_TOOL_MISSING"
  | "SYNC_INPUT_INVALID"
  | "SYNC_LOW_CONFIDENCE"
  | "EVENT_INPUT_MISSING"
  | "EVENT_INPUT_INVALID"
  | "VISION_RESPONSE_REQUIRED"
  | "VISION_RESPONSE_INVALID"
  | "NO_USABLE_SHOTS"
  | "EDIT_CONSTRAINT_VIOLATION"
  | "APPROVAL_REQUIRED"
  | "RENDER_FAILED"
  | "QUALITY_GATE_FAILED"
  | "PROCESS_FAILED"
  | "JOB_CANCELLED"
  | "ARTIFACT_INVALID"
  | "INTAKE_INVALID"
  | "INTAKE_NOT_READY"
  | "INTAKE_LOCKED";

export class CookingVideoError extends Error {
  readonly code: CookingVideoErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: CookingVideoErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "CookingVideoError";
    this.code = code;
    this.details = details;
  }
}
