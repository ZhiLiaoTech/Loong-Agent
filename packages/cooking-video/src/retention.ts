import { randomUUID } from "node:crypto";
import { appendFile, lstat, readdir, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { CookingVideoError } from "./errors.js";
import type { JobStore } from "./job-store.js";
import { resolveWithin } from "./paths.js";
import type { JobStage } from "./types.js";

export type RetentionArtifactClass = "original" | "proxy" | "frame" | "output";

export interface ArtifactRetentionPolicy {
  schemaVersion: "1.0";
  originalDays: number | null;
  proxyDays: number | null;
  frameDays: number | null;
  outputDays: number | null;
  legalHoldJobIds?: string[];
}

export interface RetentionCandidate {
  artifactClass: RetentionArtifactClass;
  path: string;
  byteSize: number;
  modifiedAt: string;
  expiresAt: string;
}

export interface RetentionRunResult {
  schemaVersion: "1.0";
  runId: string;
  jobId: string;
  evaluatedAt: string;
  mode: "dry_run" | "delete";
  status: "planned" | "applied" | "skipped";
  candidates: RetentionCandidate[];
  deleted: RetentionCandidate[];
  skippedReason?: string;
}

export interface EnforceRetentionOptions {
  now?: Date;
  dryRun?: boolean;
  confirmation?: "DELETE_EXPIRED_ARTIFACTS";
}

const TERMINAL: ReadonlySet<JobStage> = new Set(["completed", "failed", "cancelled"]);
const DAY_MS = 86_400_000;

function retentionDays(policy: ArtifactRetentionPolicy, artifactClass: RetentionArtifactClass): number | null {
  if (artifactClass === "original") return policy.originalDays;
  if (artifactClass === "proxy") return policy.proxyDays;
  if (artifactClass === "frame") return policy.frameDays;
  return policy.outputDays;
}

function validatePolicy(policy: ArtifactRetentionPolicy): void {
  if (policy.schemaVersion !== "1.0") throw new CookingVideoError("RETENTION_INVALID", "Retention policy schemaVersion must be 1.0.");
  for (const [name, value] of Object.entries({ originalDays: policy.originalDays, proxyDays: policy.proxyDays, frameDays: policy.frameDays, outputDays: policy.outputDays })) {
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 3650)) {
      throw new CookingVideoError("RETENTION_INVALID", `${name} must be null or an integer from 0 to 3650.`);
    }
  }
  const holds = policy.legalHoldJobIds ?? [];
  if (new Set(holds).size !== holds.length) throw new CookingVideoError("RETENTION_INVALID", "legalHoldJobIds must not contain duplicates.");
}

async function collectExpired(root: string, directory: string, artifactClass: RetentionArtifactClass, days: number, now: Date, result: RetentionCandidate[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const candidate = resolveWithin(root, path.join(directory, entry.name));
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await collectExpired(root, candidate, artifactClass, days, now, result);
      continue;
    }
    if (!entry.isFile()) continue;
    const metadata = await stat(candidate);
    const expiresAtMs = metadata.mtimeMs + days * DAY_MS;
    if (expiresAtMs > now.getTime()) continue;
    result.push({
      artifactClass,
      path: path.relative(root, candidate).replace(/\\/g, "/"),
      byteSize: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
  }
}

async function deleteVerifiedFile(root: string, relative: string): Promise<void> {
  const lexical = resolveWithin(root, relative);
  const metadata = await lstat(lexical);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new CookingVideoError("RETENTION_BLOCKED", `Retention target changed before deletion: ${relative}.`);
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(lexical)]);
  const verified = resolveWithin(realRoot, realFile);
  if (verified !== realFile) throw new CookingVideoError("RETENTION_BLOCKED", `Retention target escaped the job root: ${relative}.`);
  await rm(realFile, { force: true });
}

async function appendRetentionAudit(file: string, result: RetentionRunResult): Promise<void> {
  await appendFile(file, `${JSON.stringify({
    schemaVersion: result.schemaVersion,
    runId: result.runId,
    jobId: result.jobId,
    evaluatedAt: result.evaluatedAt,
    mode: result.mode,
    status: result.status,
    candidateCount: result.candidates.length,
    deletedCount: result.deleted.length,
    deletedBytes: result.deleted.reduce((sum, item) => sum + item.byteSize, 0),
    ...(result.skippedReason ? { skippedReason: result.skippedReason } : {}),
  })}\n`, "utf8");
}

export async function enforceJobRetention(store: JobStore, jobId: string, policy: ArtifactRetentionPolicy, options: EnforceRetentionOptions = {}): Promise<RetentionRunResult> {
  validatePolicy(policy);
  const loaded = await store.load(jobId);
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new CookingVideoError("RETENTION_INVALID", "Retention evaluation time is invalid.");
  const dryRun = options.dryRun ?? true;
  if (!dryRun && options.confirmation !== "DELETE_EXPIRED_ARTIFACTS") {
    throw new CookingVideoError("RETENTION_BLOCKED", "Physical retention deletion requires the exact confirmation token.");
  }
  const base: RetentionRunResult = {
    schemaVersion: "1.0",
    runId: randomUUID(),
    jobId,
    evaluatedAt: now.toISOString(),
    mode: dryRun ? "dry_run" : "delete",
    status: "planned",
    candidates: [],
    deleted: [],
  };
  if (!TERMINAL.has(loaded.state.status)) {
    const result = { ...base, status: "skipped", skippedReason: `job_status:${loaded.state.status}` } satisfies RetentionRunResult;
    await appendRetentionAudit(path.join(loaded.paths.state, "retention-events.jsonl"), result);
    return result;
  }
  if (policy.legalHoldJobIds?.includes(jobId)) {
    const result = { ...base, status: "skipped", skippedReason: "legal_hold" } satisfies RetentionRunResult;
    await appendRetentionAudit(path.join(loaded.paths.state, "retention-events.jsonl"), result);
    return result;
  }
  const roots: Array<{ artifactClass: RetentionArtifactClass; directory: string }> = [
    { artifactClass: "original", directory: loaded.paths.input },
    { artifactClass: "proxy", directory: loaded.paths.proxy },
    { artifactClass: "frame", directory: loaded.paths.frames },
    { artifactClass: "output", directory: loaded.paths.output },
  ];
  for (const item of roots) {
    const days = retentionDays(policy, item.artifactClass);
    if (days !== null) await collectExpired(loaded.paths.root, item.directory, item.artifactClass, days, now, base.candidates);
  }
  base.candidates.sort((left, right) => left.path.localeCompare(right.path));
  if (!dryRun) {
    await appendRetentionAudit(path.join(loaded.paths.state, "retention-events.jsonl"), base);
    for (const candidate of base.candidates) {
      try {
        await deleteVerifiedFile(loaded.paths.root, candidate.path);
        base.deleted.push(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    base.status = "applied";
  }
  await appendRetentionAudit(path.join(loaded.paths.state, "retention-events.jsonl"), base);
  return base;
}
