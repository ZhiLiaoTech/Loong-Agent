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
  | "MODEL_TIMEOUT"
  | "MODEL_BUDGET_EXCEEDED"
  | "MODEL_CALL_FAILED"
  | "NO_USABLE_SHOTS"
  | "EDIT_CONSTRAINT_VIOLATION"
  | "EDIT_REVISION_CONFLICT"
  | "REVIEW_ACTION_INVALID"
  | "APPROVAL_REQUIRED"
  | "RENDER_FAILED"
  | "QUALITY_GATE_FAILED"
  | "PROCESS_FAILED"
  | "JOB_CANCELLED"
  | "ARTIFACT_INVALID"
  | "INTAKE_INVALID"
  | "INTAKE_NOT_READY"
  | "INTAKE_LOCKED"
  | "UPLOAD_INVALID"
  | "UPLOAD_INTEGRITY_FAILED"
  | "UPLOAD_PROVIDER_FAILED"
  | "ACCESS_DENIED"
  | "AUDIT_FAILED"
  | "RETENTION_INVALID"
  | "RETENTION_BLOCKED";

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
