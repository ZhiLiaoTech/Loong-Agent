import type { GatewayRunRecord } from "../run/types.js";

export interface TrajectorySummary {
  runId: string;
  status?: string;
  userPreview?: string;
  createdAt?: string;
}

export interface MemoryCandidate {
  id: string;
  content?: string;
  scope?: string;
  sessionId?: string;
  createdAt?: string;
  reason?: string;
}

export interface MemoryReviewState {
  canPromote: boolean;
  canReject: boolean;
}

export type { GatewayRunRecord };
