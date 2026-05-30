import type { LoongTrajectoryRecord, LoongTrajectoryStore } from "@loong/core";

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
  status?: LoongTrajectoryRecord["status"];
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface TrajectoryRecordSummary {
  runId: string;
  sessionId: string;
  source: LoongTrajectoryRecord["source"];
  createdAt: string;
  completedAt: string;
  status: LoongTrajectoryRecord["status"];
  userPreview: string;
  assistantPreview?: string;
  errorPreview?: string;
  eventCount: number;
}

export interface TrajectoryListResult {
  trajectories: TrajectoryRecordSummary[];
  truncated: boolean;
}

export interface TrajectoryStore extends LoongTrajectoryStore {
  list(filter?: TrajectoryListFilter): Promise<TrajectoryListResult>;
  get(runId: string, filter?: Pick<TrajectoryListFilter, "sessionId" | "dateFrom" | "dateTo">): Promise<LoongTrajectoryRecord | undefined>;
}

export interface TrajectoryListInput extends TrajectoryListFilter {}

export interface TrajectoryListOutput extends TrajectoryListResult {}

export interface TrajectoryGetInput {
  runId: string;
  maxEvents?: number;
}

export interface TrajectoryGetOutput {
  record: LoongTrajectoryRecord;
  eventsTruncated: boolean;
}
