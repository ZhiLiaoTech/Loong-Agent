import type { SessionSource } from "./memory-types.js";
import type { MemoryRecord, MemoryStore } from "./memory-record-types.js";

export interface MemoryCandidateLifecycleHookOptions {
  rootDir?: string;
  maxContentChars?: number;
  maxCandidateBytes?: number;
  maxFileBytes?: number;
}

export interface MemoryCandidateToolsOptions {
  rootDir?: string;
  store: MemoryStore;
  maxFiles?: number;
  maxFileBytes?: number;
  maxCandidateBytes?: number;
}

export type MemoryCandidateStatus = "pending" | "promoting" | "promoted" | "rejected";

export interface MemoryCandidateRecord {
  id: string;
  sessionId: string;
  runId: string;
  source: SessionSource;
  scope: MemoryRecord["scope"];
  content: string;
  reason: string;
  status: MemoryCandidateStatus;
  createdAt: string;
  reviewedAt?: string;
  reviewedByRunId?: string;
  promotedMemoryId?: string;
  rejectionReason?: string;
  workspace?: string;
  assistantPreview?: string;
  metadata?: Record<string, unknown>;
  reservationId?: string;
  reservationAt?: string;
}

export interface MemoryCandidateListInput {
  status?: MemoryCandidateStatus | "all";
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface MemoryCandidateListOutput {
  candidates: MemoryCandidateRecord[];
  truncated: boolean;
}

export interface MemoryCandidatePromoteInput {
  id: string;
  scope?: MemoryRecord["scope"];
  content?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryCandidatePromoteOutput {
  candidate: MemoryCandidateRecord;
  record: MemoryRecord;
}

export interface MemoryCandidateRejectInput {
  id: string;
  reason?: string;
}

export interface MemoryCandidateRejectOutput {
  candidate: MemoryCandidateRecord;
}
