import type { DragonTrajectoryRecord, DragonTrajectoryStore } from "@dragon/core";

export interface FileTrajectoryStoreOptions {
  rootDir?: string;
  maxEvents?: number;
  maxFiles?: number;
  maxRecordBytes?: number;
  maxFileBytes?: number;
}

export interface TrajectoryListFilter {
  runId?: string;
  sessionId?: string;
  status?: DragonTrajectoryRecord["status"];
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface TrajectoryRecordSummary {
  runId: string;
  sessionId: string;
  source: DragonTrajectoryRecord["source"];
  createdAt: string;
  completedAt: string;
  status: DragonTrajectoryRecord["status"];
  userPreview: string;
  assistantPreview?: string;
  errorPreview?: string;
  eventCount: number;
}

export interface TrajectoryListResult {
  trajectories: TrajectoryRecordSummary[];
  truncated: boolean;
}

export interface TrajectoryStore extends DragonTrajectoryStore {
  list(filter?: TrajectoryListFilter): Promise<TrajectoryListResult>;
  get(runId: string, filter?: Pick<TrajectoryListFilter, "sessionId" | "dateFrom" | "dateTo">): Promise<DragonTrajectoryRecord | undefined>;
}

export interface TrajectoryListInput extends TrajectoryListFilter {}

export interface TrajectoryListOutput extends TrajectoryListResult {}

export interface TrajectoryGetInput {
  runId: string;
  maxEvents?: number;
}

export interface TrajectoryGetOutput {
  record: DragonTrajectoryRecord;
  eventsTruncated: boolean;
}
