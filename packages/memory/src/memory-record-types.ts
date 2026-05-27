export interface MemoryRecord {
  id: string;
  scope: "user" | "project" | "session" | "skill";
  content: string;
  source?: string;
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number;
  reason?: string;
}

export interface MemoryStore {
  remember(record: Omit<MemoryRecord, "id" | "createdAt">): Promise<MemoryRecord>;
  get(id: string): Promise<MemoryRecord | undefined>;
  search(query: string, limit?: number): Promise<MemorySearchResult[]>;
}

export interface FileMemoryStoreOptions {
  rootDir?: string;
  maxRecords?: number;
  maxRecordBytes?: number;
  maxFileBytes?: number;
}

export interface SqliteMemoryStoreOptions {
  rootDir?: string;
  databasePath?: string;
  maxRecords?: number;
  maxRecordBytes?: number;
  maxDatabaseBytes?: number;
}

export interface MemorySearchInput {
  query: string;
  limit?: number;
}

export interface MemorySearchOutput {
  query: string;
  results: MemorySearchResult[];
}

export interface MemoryRememberInput {
  scope: MemoryRecord["scope"];
  content: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryRememberOutput {
  record: MemoryRecord;
}

export const ABSOLUTE_MAX_MEMORY_RECORD_BYTES = 128_000;

export function isMemoryScope(value: unknown): value is MemoryRecord["scope"] {
  return value === "user" || value === "project" || value === "session" || value === "skill";
}
