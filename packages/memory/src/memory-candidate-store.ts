import { createHash, randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, open, opendir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LoongLifecycleHookRequest } from "@loong/core";
import type { ToolInvocation } from "@loong/tools";
import { isLoongSource } from "./file-session-store.js";
import { normalizeTrajectoryDate } from "./file-trajectory-store.js";
import { withMemoryFileLock } from "./memory-file-lock.js";
import { MemoryToolError } from "./memory-tool-error.js";
import { normalizeOptionalText, summarizeText } from "./memory-text.js";
import {
  ABSOLUTE_MAX_MEMORY_RECORD_BYTES,
  isMemoryScope,
  type MemoryRecord,
} from "./memory-record-types.js";
import {
  clampPositiveInteger,
  isNodeError,
  isObject,
  isPathInside,
  sameFileStat,
  stringifyJson,
} from "./memory-util.js";
import type {
  MemoryCandidateListInput,
  MemoryCandidateListOutput,
  MemoryCandidatePromoteInput,
  MemoryCandidateRecord,
  MemoryCandidateRejectInput,
  MemoryCandidateStatus,
} from "./memory-candidate-types.js";

export const DEFAULT_MEMORY_CANDIDATE_CHARS = 1200;
export const ABSOLUTE_MEMORY_CANDIDATE_CHARS = 4000;
export const DEFAULT_MEMORY_CANDIDATE_BYTES = 12_000;
export const ABSOLUTE_MEMORY_CANDIDATE_BYTES = 64_000;
export const DEFAULT_MEMORY_CANDIDATE_FILE_BYTES = 4 * 1024 * 1024;
export const ABSOLUTE_MEMORY_CANDIDATE_FILE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MEMORY_CANDIDATE_FILES = 366;
export const ABSOLUTE_MEMORY_CANDIDATE_FILES = 5000;
export const DEFAULT_MEMORY_CANDIDATE_LIST_LIMIT = 20;
export const ABSOLUTE_MEMORY_CANDIDATE_LIST_LIMIT = 100;

const memoryCandidateReviewLocks = new Set<string>();

export function buildMemoryCandidate(
  request: Readonly<LoongLifecycleHookRequest>,
  maxContentChars: number,
): MemoryCandidateRecord | undefined {
  if (request.phase !== "end" || request.status !== "ok") {
    return undefined;
  }
  const userMessage = request.userMessage?.replace(/\s+/g, " ").trim();
  if (!userMessage || !isExplicitMemoryIntent(userMessage)) {
    return undefined;
  }
  const content = summarizeText(normalizeMemoryCandidateContent(userMessage), maxContentChars);
  if (!content.trim()) {
    return undefined;
  }
  const scope = inferMemoryCandidateScope(userMessage, request.workspace);
  const candidate: MemoryCandidateRecord = {
    id: createMemoryCandidateId(request, scope, content),
    sessionId: request.sessionId,
    runId: request.runId,
    source: request.source,
    scope,
    content,
    reason: "User message matched an explicit remember/note intent. Review before promoting to durable memory.",
    status: "pending",
    createdAt: request.completedAt ?? new Date().toISOString(),
    metadata: {
      capturedBy: "memory_candidate_capture",
    },
  };
  if (request.workspace !== undefined) {
    candidate.workspace = request.workspace;
  }
  if (request.assistantMessage !== undefined) {
    candidate.assistantPreview = summarizeText(request.assistantMessage.replace(/\s+/g, " ").trim(), 500);
  }
  return candidate;
}

function isExplicitMemoryIntent(value: string): boolean {
  return /(^|\b)(remember|note that|keep in mind|save this|please remember)\b/i.test(value)
    || /记住|请记住|帮我记住|记下来|留意一下|以后记得/.test(value);
}

function normalizeMemoryCandidateContent(value: string): string {
  return value
    .replace(/^\s*(please\s+)?remember\s+(that\s+)?/i, "")
    .replace(/^\s*note\s+that\s+/i, "")
    .replace(/^\s*keep\s+in\s+mind\s+(that\s+)?/i, "")
    .replace(/^\s*save\s+this\s*[:：-]?\s*/i, "")
    .replace(/^\s*(请)?(帮我)?记住\s*[:：-]?\s*/u, "")
    .replace(/^\s*记下来\s*[:：-]?\s*/u, "")
    .trim();
}

function inferMemoryCandidateScope(value: string, workspace: string | undefined): MemoryRecord["scope"] {
  if (workspace !== undefined || /project|repo|repository|codebase|workspace|项目|仓库|代码库/i.test(value)) {
    return "project";
  }
  return "user";
}

function createMemoryCandidateId(
  request: Readonly<LoongLifecycleHookRequest>,
  scope: MemoryRecord["scope"],
  content: string,
): string {
  return createHash("sha256")
    .update(request.sessionId, "utf8")
    .update("\0")
    .update(request.runId, "utf8")
    .update("\0")
    .update(scope, "utf8")
    .update("\0")
    .update(content, "utf8")
    .digest("hex");
}

export function stringifyMemoryCandidate(candidate: MemoryCandidateRecord, maxCandidateBytes: number): string {
  const json = stringifyJson(candidate);
  if (Buffer.byteLength(`${json}\n`, "utf8") > maxCandidateBytes) {
    throw new MemoryToolError(`Memory candidate is larger than ${maxCandidateBytes} bytes.`);
  }
  return json;
}

export function memoryCandidatePath(rootDir: string, createdAt: string): string {
  return path.join(rootDir, "candidates", `${normalizeCandidateDate(createdAt)}.jsonl`);
}

function normalizeCandidateDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsed.toISOString().slice(0, 10);
}

export async function withMemoryCandidateReviewLock<T>(candidateId: string, task: () => Promise<T>): Promise<T> {
  if (memoryCandidateReviewLocks.has(candidateId)) {
    throw new MemoryToolError(`Memory candidate is already being reviewed: ${summarizeText(candidateId, 80)}`);
  }
  memoryCandidateReviewLocks.add(candidateId);
  try {
    return await task();
  } finally {
    memoryCandidateReviewLocks.delete(candidateId);
  }
}

interface MemoryCandidateEntry {
  record: MemoryCandidateRecord;
  filePath: string;
  lineNumber: number;
}

export async function listMemoryCandidates(
  rootDir: string,
  input: MemoryCandidateListInput,
  maxFiles: number,
  maxFileBytes: number,
): Promise<MemoryCandidateListOutput> {
  const limit = clampPositiveInteger(input.limit, DEFAULT_MEMORY_CANDIDATE_LIST_LIMIT, ABSOLUTE_MEMORY_CANDIDATE_LIST_LIMIT);
  const entries = await readMemoryCandidateEntries(rootDir, input, maxFiles, maxFileBytes, limit + 1);
  const candidates = entries
    .map(entry => entry.record)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    candidates: candidates.slice(0, limit),
    truncated: candidates.length > limit,
  };
}

export async function findMemoryCandidate(
  rootDir: string,
  id: string,
  maxFiles: number,
  maxFileBytes: number,
): Promise<MemoryCandidateEntry> {
  const normalizedId = normalizeCandidateId(id);
  const entries = await readMemoryCandidateEntries(rootDir, { status: "all" }, maxFiles, maxFileBytes);
  const entry = entries.find(item => item.record.id === normalizedId);
  if (!entry) {
    throw new MemoryToolError(`Memory candidate not found: ${summarizeText(normalizedId, 80)}`);
  }
  return entry;
}

async function readMemoryCandidateEntries(
  rootDir: string,
  input: MemoryCandidateListInput,
  maxFiles: number,
  maxFileBytes: number,
  maxEntries = Number.POSITIVE_INFINITY,
): Promise<MemoryCandidateEntry[]> {
  const candidateDir = await resolveSafeMemoryCandidateDirectory(path.join(rootDir, "candidates"));
  if (candidateDir === undefined) {
    return [];
  }
  const fileNames = await listMemoryCandidateFileNames(candidateDir, input, maxFiles);
  // Collect all entries first, then dedupe by id (keep latest mutation per id)
  // so a JSONL file with multiple lines for the same candidate (append +
  // rewrite) does not show duplicates in the review list.
  const allEntries: MemoryCandidateEntry[] = [];
  for (const fileName of fileNames) {
    const filePath = path.join(candidateDir.path, fileName);
    const fileEntries = await readMemoryCandidateFile(filePath, candidateDir, maxFileBytes);
    for (const entry of fileEntries) {
      allEntries.push(entry);
    }
  }
  const byId = new Map<string, MemoryCandidateEntry>();
  for (const entry of allEntries) {
    const existing = byId.get(entry.record.id);
    if (!existing || compareCandidateRecency(entry.record, existing.record) > 0) {
      byId.set(entry.record.id, entry);
    }
  }
  const entries: MemoryCandidateEntry[] = [];
  for (const entry of byId.values()) {
    if (!memoryCandidateMatches(entry.record, input)) {
      continue;
    }
    entries.push(entry);
    if (entries.length >= maxEntries) {
      break;
    }
  }
  return entries;
}

function compareCandidateRecency(a: MemoryCandidateRecord, b: MemoryCandidateRecord): number {
  const aTs = Date.parse(a.reviewedAt ?? a.reservationAt ?? a.createdAt);
  const bTs = Date.parse(b.reviewedAt ?? b.reservationAt ?? b.createdAt);
  if (Number.isNaN(aTs) || Number.isNaN(bTs)) {
    return 0;
  }
  return aTs - bTs;
}

interface SafeMemoryCandidateDirectory {
  path: string;
  stat: Awaited<ReturnType<typeof lstat>>;
}

async function resolveSafeMemoryCandidateDirectory(directoryPath: string): Promise<SafeMemoryCandidateDirectory | undefined> {
  const resolvedPath = path.resolve(directoryPath);
  let directoryStat: Awaited<ReturnType<typeof lstat>>;
  try {
    directoryStat = await lstat(resolvedPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw new MemoryToolError("Memory candidate directory is unavailable.");
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new MemoryToolError("Memory candidate directory must be a regular directory.");
  }
  return { path: resolvedPath, stat: directoryStat };
}

async function sameMemoryCandidateDirectoryRef(directory: SafeMemoryCandidateDirectory): Promise<boolean> {
  try {
    const current = await lstat(directory.path);
    return current.isDirectory() && !current.isSymbolicLink() && sameFileStat(directory.stat, current);
  } catch {
    return false;
  }
}

async function listMemoryCandidateFileNames(
  candidateDir: SafeMemoryCandidateDirectory,
  input: MemoryCandidateListInput,
  maxFiles: number,
): Promise<string[]> {
  if (!await sameMemoryCandidateDirectoryRef(candidateDir)) {
    return [];
  }
  let directory: Awaited<ReturnType<typeof opendir>>;
  try {
    directory = await opendir(candidateDir.path);
  } catch {
    return [];
  }
  const names: string[] = [];
  let scanned = 0;
  for await (const entry of directory) {
    scanned += 1;
    if (scanned > ABSOLUTE_MEMORY_CANDIDATE_FILES) {
      break;
    }
    if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.jsonl$/i.test(entry.name)) {
      continue;
    }
    const date = entry.name.slice(0, 10);
    if (!isRealCalendarDate(date)) {
      continue;
    }
    if (input.dateFrom !== undefined && date < input.dateFrom) {
      continue;
    }
    if (input.dateTo !== undefined && date > input.dateTo) {
      continue;
    }
    names.push(entry.name);
  }
  return names.sort((left, right) => right.localeCompare(left)).slice(0, maxFiles);
}

async function readMemoryCandidateFile(
  filePath: string,
  candidateDir: SafeMemoryCandidateDirectory,
  maxFileBytes: number,
): Promise<MemoryCandidateEntry[]> {
  const content = await readSafeMemoryCandidateFile(filePath, candidateDir, maxFileBytes);
  const entries: MemoryCandidateEntry[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    entries.push({
      record: parseMemoryCandidateRecord(trimmed, index + 1, filePath),
      filePath,
      lineNumber: index + 1,
    });
  }
  return entries;
}

async function readSafeMemoryCandidateFile(
  filePath: string,
  candidateDir: SafeMemoryCandidateDirectory,
  maxFileBytes: number,
): Promise<string> {
  if (!isPathInside(filePath, candidateDir.path) || !await sameMemoryCandidateDirectoryRef(candidateDir)) {
    return "";
  }
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }
    throw new MemoryToolError("Memory candidate file is unavailable.");
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new MemoryToolError("Memory candidate file must be a regular file.");
  }
  if (before.size > maxFileBytes) {
    throw new MemoryToolError(`Memory candidate file is larger than ${maxFileBytes} bytes.`);
  }
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, "r");
  } catch {
    throw new MemoryToolError("Memory candidate file is unavailable.");
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileStat(before, opened)) {
      throw new MemoryToolError("Memory candidate file changed while reading.");
    }
    const after = await lstat(filePath);
    if (!after.isFile() || after.isSymbolicLink() || !sameFileStat(opened, after)) {
      throw new MemoryToolError("Memory candidate file changed while reading.");
    }
    if (!await sameMemoryCandidateDirectoryRef(candidateDir)) {
      throw new MemoryToolError("Memory candidate directory changed while reading.");
    }
    const buffer = Buffer.alloc(maxFileBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxFileBytes) {
      throw new MemoryToolError(`Memory candidate file is larger than ${maxFileBytes} bytes.`);
    }
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

export async function rewriteMemoryCandidate(
  rootDir: string,
  filePath: string,
  candidateId: string,
  maxFileBytes: number,
  maxCandidateBytes: number,
  update: (candidate: MemoryCandidateRecord) => MemoryCandidateRecord,
  options: { allowedStatuses?: readonly MemoryCandidateStatus[] } = {},
): Promise<MemoryCandidateRecord> {
  const candidateDir = await resolveSafeMemoryCandidateDirectory(path.join(rootDir, "candidates"));
  if (candidateDir === undefined || !isPathInside(filePath, candidateDir.path)) {
    throw new MemoryToolError("Memory candidate file is unavailable.");
  }
  const allowedStatuses = options.allowedStatuses ?? (["pending"] as const);
  const content = await readSafeMemoryCandidateFile(filePath, candidateDir, maxFileBytes);
  const lines = content.split(/\r?\n/);
  let updated: MemoryCandidateRecord | undefined;
  const nextLines = lines.map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return "";
    }
    const record = parseMemoryCandidateRecord(trimmed, index + 1, filePath);
    if (record.id !== candidateId) {
      return stringifyMemoryCandidate(record, maxCandidateBytes);
    }
    if (!allowedStatuses.includes(record.status)) {
      throw new MemoryToolError(`Memory candidate is already ${record.status}.`);
    }
    updated = update(record);
    validateMemoryCandidateRecord(updated, `${filePath}:${index + 1}`);
    return stringifyMemoryCandidate(updated, maxCandidateBytes);
  });
  if (!updated) {
    throw new MemoryToolError(`Memory candidate not found: ${summarizeText(candidateId, 80)}`);
  }
  const nextContent = `${nextLines.filter(line => line.trim()).join("\n")}\n`;
  if (Buffer.byteLength(nextContent, "utf8") > maxFileBytes) {
    throw new MemoryToolError(`Memory candidate file would exceed ${maxFileBytes} bytes.`);
  }
  const tempPath = path.join(candidateDir.path, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, nextContent, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort cleanup for failed atomic rewrite.
    }
    throw error instanceof MemoryToolError
      ? error
      : new MemoryToolError(`Memory candidate file could not be updated: ${error instanceof Error ? error.message : String(error)}`);
  }
  return updated;
}

function memoryCandidateMatches(candidate: MemoryCandidateRecord, input: MemoryCandidateListInput): boolean {
  if (input.status !== undefined && input.status !== "all" && candidate.status !== input.status) {
    return false;
  }
  const date = candidate.createdAt.slice(0, 10);
  if (input.dateFrom !== undefined && date < input.dateFrom) {
    return false;
  }
  if (input.dateTo !== undefined && date > input.dateTo) {
    return false;
  }
  return true;
}

function parseMemoryCandidateRecord(line: string, lineNumber: number, filePath: string): MemoryCandidateRecord {
  if (Buffer.byteLength(line, "utf8") > ABSOLUTE_MEMORY_CANDIDATE_BYTES) {
    throw new MemoryToolError(`Memory candidate in ${filePath} at line ${lineNumber} is too large.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new MemoryToolError(
      `Invalid memory candidate JSON in ${filePath} at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  validateMemoryCandidateRecord(value, `${filePath}:${lineNumber}`);
  return value;
}

function validateMemoryCandidateRecord(value: unknown, source: string): asserts value is MemoryCandidateRecord {
  if (!isObject(value)) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: expected object.`);
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: missing id.`);
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: missing sessionId.`);
  }
  if (typeof value.runId !== "string" || !value.runId.trim()) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: missing runId.`);
  }
  if (!isLoongSource(value.source)) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid source.`);
  }
  if (!isMemoryScope(value.scope)) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid scope.`);
  }
  if (typeof value.content !== "string" || !value.content.trim()) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid content.`);
  }
  if (typeof value.reason !== "string" || !value.reason.trim()) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid reason.`);
  }
  if (!isMemoryCandidateStatus(value.status)) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid status.`);
  }
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid createdAt.`);
  }
  if (value.reviewedAt !== undefined && (typeof value.reviewedAt !== "string" || Number.isNaN(Date.parse(value.reviewedAt)))) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid reviewedAt.`);
  }
  if (value.reviewedByRunId !== undefined && typeof value.reviewedByRunId !== "string") {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid reviewedByRunId.`);
  }
  if (value.promotedMemoryId !== undefined && typeof value.promotedMemoryId !== "string") {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid promotedMemoryId.`);
  }
  if (value.rejectionReason !== undefined && typeof value.rejectionReason !== "string") {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid rejectionReason.`);
  }
  if (value.workspace !== undefined && typeof value.workspace !== "string") {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid workspace.`);
  }
  if (value.assistantPreview !== undefined && typeof value.assistantPreview !== "string") {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid assistantPreview.`);
  }
  if (value.metadata !== undefined && !isObject(value.metadata)) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid metadata.`);
  }
  if (value.reservationId !== undefined && typeof value.reservationId !== "string") {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid reservationId.`);
  }
  if (value.reservationAt !== undefined && (typeof value.reservationAt !== "string" || Number.isNaN(Date.parse(value.reservationAt)))) {
    throw new MemoryToolError(`Invalid memory candidate at ${source}: invalid reservationAt.`);
  }
}

function isMemoryCandidateStatus(value: unknown): value is MemoryCandidateStatus {
  return value === "pending" || value === "promoting" || value === "promoted" || value === "rejected";
}

export function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function normalizeCandidateId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new MemoryToolError("Memory candidate id cannot be empty.");
  }
  if (trimmed.length > 128) {
    throw new MemoryToolError("Memory candidate id is too long.");
  }
  return trimmed;
}

export function memoryDraftFromCandidate(
  candidate: MemoryCandidateRecord,
  input: MemoryCandidatePromoteInput,
  invocation: ToolInvocation,
): Omit<MemoryRecord, "id" | "createdAt"> {
  const scope = input.scope ?? candidate.scope;
  const content = input.content ?? candidate.content;
  const metadata: Record<string, unknown> = {
    candidateId: candidate.id,
    candidateRunId: candidate.runId,
    candidateSessionId: candidate.sessionId,
  };
  if (candidate.workspace !== undefined) {
    metadata.workspace = candidate.workspace;
  }
  if (input.metadata !== undefined) {
    Object.assign(metadata, input.metadata);
  }
  const draft: Omit<MemoryRecord, "id" | "createdAt"> = {
    scope,
    content,
    source: input.source ?? "memory_candidate_promote",
    metadata,
  };
  const runId = readInvocationRunId(invocation);
  if (runId !== undefined) {
    draft.metadata = { ...metadata, promotedByRunId: runId };
  }
  return draft;
}

export function readInvocationRunId(invocation: ToolInvocation): string | undefined {
  const runId = invocation.metadata?.runId;
  return typeof runId === "string" && runId.trim() ? runId : undefined;
}

export function parseMemoryCandidateListInput(input: unknown): MemoryCandidateListInput {
  if (input === undefined || input === null) {
    return { status: "pending" };
  }
  if (!isObject(input)) {
    throw new MemoryToolError("memory_candidates_list input must be an object.");
  }
  const parsed: MemoryCandidateListInput = {
    status: "pending",
  };
  if (input.status !== undefined) {
    if (input.status !== "all" && !isMemoryCandidateStatus(input.status)) {
      throw new MemoryToolError("memory_candidates_list status is invalid.");
    }
    parsed.status = input.status;
  }
  if (typeof input.dateFrom === "string" && input.dateFrom.trim()) {
    parsed.dateFrom = normalizeTrajectoryDate(input.dateFrom, "dateFrom");
  }
  if (typeof input.dateTo === "string" && input.dateTo.trim()) {
    parsed.dateTo = normalizeTrajectoryDate(input.dateTo, "dateTo");
  }
  if (parsed.dateFrom !== undefined && parsed.dateTo !== undefined && parsed.dateFrom > parsed.dateTo) {
    throw new MemoryToolError("memory_candidates_list dateFrom must be before or equal to dateTo.");
  }
  if (typeof input.limit === "number") {
    parsed.limit = Math.max(1, Math.floor(input.limit));
  }
  return parsed;
}

export function parseMemoryCandidatePromoteInput(input: unknown): MemoryCandidatePromoteInput {
  if (!isObject(input)) {
    throw new MemoryToolError("memory_candidate_promote input must be an object.");
  }
  if (typeof input.id !== "string" || !input.id.trim()) {
    throw new MemoryToolError("memory_candidate_promote requires a candidate id.");
  }
  const parsed: MemoryCandidatePromoteInput = {
    id: normalizeCandidateId(input.id),
  };
  if (input.scope !== undefined) {
    if (!isMemoryScope(input.scope)) {
      throw new MemoryToolError("memory_candidate_promote scope is invalid.");
    }
    parsed.scope = input.scope;
  }
  if (typeof input.content === "string" && input.content.trim()) {
    const content = input.content.trim();
    if (Buffer.byteLength(content, "utf8") > ABSOLUTE_MAX_MEMORY_RECORD_BYTES) {
      throw new MemoryToolError(`memory_candidate_promote content must be ${ABSOLUTE_MAX_MEMORY_RECORD_BYTES} bytes or fewer.`);
    }
    parsed.content = content;
  } else if (input.content !== undefined) {
    throw new MemoryToolError("memory_candidate_promote content must be non-empty when provided.");
  }
  if (typeof input.source === "string" && input.source.trim()) {
    parsed.source = normalizeOptionalText(input.source, "source", 200);
  }
  if (input.metadata !== undefined) {
    if (!isObject(input.metadata)) {
      throw new MemoryToolError("memory_candidate_promote metadata must be an object.");
    }
    parsed.metadata = input.metadata;
  }
  return parsed;
}

export function parseMemoryCandidateRejectInput(input: unknown): MemoryCandidateRejectInput {
  if (!isObject(input)) {
    throw new MemoryToolError("memory_candidate_reject input must be an object.");
  }
  if (typeof input.id !== "string" || !input.id.trim()) {
    throw new MemoryToolError("memory_candidate_reject requires a candidate id.");
  }
  const parsed: MemoryCandidateRejectInput = {
    id: normalizeCandidateId(input.id),
  };
  if (typeof input.reason === "string" && input.reason.trim()) {
    parsed.reason = normalizeOptionalText(input.reason, "reason", 500);
  }
  return parsed;
}


export async function assertSafeMemoryCandidateDirectory(directoryPath: string): Promise<void> {
  try {
    const directoryStat = await lstat(directoryPath);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new MemoryToolError("Memory candidate directory must be a regular directory.");
    }
  } catch (error) {
    if (error instanceof MemoryToolError) {
      throw error;
    }
    throw new MemoryToolError("Memory candidate directory is unavailable.");
  }
}

