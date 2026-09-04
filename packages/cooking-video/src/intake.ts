import { copyFile, mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { CookingVideoError } from "./errors.js";
import { JobStore } from "./job-store.js";
import { runJobPipeline, type RunJobOptions } from "./job-runner.js";
import { readJsonFile, writeJsonAtomic } from "./json-files.js";
import { resolveExistingWithin, resolveWithin } from "./paths.js";
import type { CookingVideoJob, CookingVideoSource } from "./types.js";
import { assertSafeId } from "./validation.js";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".avi", ".m4v"]);
const READY_MARKER = "_READY";
const INTAKE_MANIFEST = "intake.json";
const INTAKE_RECEIPT = "intake-receipt.json";
const INTAKE_CLAIM = "intake-claim.json";

interface IntakeSourceConfig {
  cameraId: string;
  file: string;
  role?: string;
}

interface IntakeManifest {
  schemaVersion: "1.0";
  batchId?: string;
  sources?: IntakeSourceConfig[];
  machineEventsFile?: string;
  dish?: CookingVideoJob["dish"];
  machine?: CookingVideoJob["machine"];
  brief?: Partial<CookingVideoJob["brief"]>;
  brand?: CookingVideoJob["brand"];
}

export interface IntakeSource {
  cameraId: string;
  file: string;
  role?: string;
  byteSize: number;
  modifiedAt: string;
}

export type IntakeBatchStatus = "ready" | "waiting" | "consumed" | "incomplete" | "invalid";

export interface IntakeBatch {
  batchId: string;
  directory: string;
  status: IntakeBatchStatus;
  markerPresent: boolean;
  sources: IntakeSource[];
  machineEventsFile?: string;
  machineEventsByteSize?: number;
  machineEventsModifiedAt?: string;
  reason?: string;
}

export interface ScanInboxOptions {
  stableSeconds?: number;
  now?: Date;
  batchId?: string;
}

export interface IntakeReceipt {
  schemaVersion: "1.0";
  batchId: string;
  jobId: string;
  consumedAt: string;
  sourceDirectory: string;
  sources: Array<{ cameraId: string; sourceFile: string; jobPath: string; byteSize: number; modifiedAt: string }>;
  machineEventsPath?: string;
}

export interface ConsumeInboxResult {
  consumed: IntakeReceipt[];
  skipped: Array<{ batchId: string; status: IntakeBatchStatus; reason?: string }>;
}

export interface ProcessInboxOptions extends ScanInboxOptions, RunJobOptions {}

export interface ProcessInboxResult extends ConsumeInboxResult {
  processed: Array<{ jobId: string; status: string; stoppedForApproval: boolean }>;
  failed: Array<{ jobId: string; errorCode: string; message: string }>;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function validateStableSeconds(value: number | undefined): number {
  const stableSeconds = value ?? 60;
  if (!Number.isInteger(stableSeconds) || stableSeconds < 0 || stableSeconds > 86_400) {
    throw new CookingVideoError("INTAKE_INVALID", "stableSeconds must be an integer between 0 and 86400.");
  }
  return stableSeconds;
}

function inferCameraId(file: string): string {
  const id = path.basename(file, path.extname(file)).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) throw new CookingVideoError("INTAKE_INVALID", `Cannot infer a safe cameraId from ${file}; add intake.json.`);
  assertSafeId(id, "cameraId");
  return id;
}

function inferRole(cameraId: string): string | undefined {
  const id = cameraId.toLowerCase();
  if (id.includes("top") || id.includes("overhead") || id.includes("pot")) return "food_closeup";
  if (id.includes("front") || id.includes("wide") || id.includes("full")) return "machine_full";
  if (id.includes("side") || id.includes("left") || id.includes("right")) return "action_side";
  return undefined;
}

async function batchFile(batchDirectory: string, file: string, label: string): Promise<string> {
  if (file !== path.basename(file)) throw new CookingVideoError("INTAKE_INVALID", `${label} must be a filename in the batch root.`);
  try {
    return await resolveExistingWithin(batchDirectory, file);
  } catch (error) {
    throw new CookingVideoError("INTAKE_INVALID", `${label} must resolve inside the batch directory.`, { cause: error instanceof Error ? error.message : String(error) });
  }
}

async function loadManifest(batchDirectory: string): Promise<IntakeManifest | undefined> {
  const file = path.join(batchDirectory, INTAKE_MANIFEST);
  if (!(await exists(file))) return undefined;
  let manifest: IntakeManifest;
  try {
    manifest = await readJsonFile<IntakeManifest>(await batchFile(batchDirectory, INTAKE_MANIFEST, "intake.json"));
  } catch (error) {
    throw new CookingVideoError("INTAKE_INVALID", "intake.json is not valid JSON.", { cause: error instanceof Error ? error.message : String(error) });
  }
  if (!manifest || manifest.schemaVersion !== "1.0") throw new CookingVideoError("INTAKE_INVALID", "intake.schemaVersion must be 1.0.");
  return manifest;
}

async function inspectBatch(batchDirectory: string, batchId: string, jobsRoot: string, stableSeconds: number, now: Date): Promise<IntakeBatch> {
  const markerPresent = await exists(path.join(batchDirectory, READY_MARKER));
  try {
    assertSafeId(batchId, "batchId");
    const manifest = await loadManifest(batchDirectory);
    if (manifest?.batchId !== undefined && manifest.batchId !== batchId) {
      throw new CookingVideoError("INTAKE_INVALID", `intake.json batchId ${manifest.batchId} does not match directory ${batchId}.`);
    }
    const entries = await readdir(batchDirectory, { withFileTypes: true });
    const inferredFiles = entries
      .filter(entry => entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right));
    const configured = manifest?.sources ?? inferredFiles.map(file => ({ cameraId: inferCameraId(file), file, role: inferRole(inferCameraId(file)) }));
    if (configured.length < 2 || configured.length > 4) throw new CookingVideoError("INTAKE_INVALID", "Each batch must contain between 2 and 4 camera videos.");
    const cameraIds = new Set<string>();
    const sources: IntakeSource[] = [];
    for (const source of configured) {
      assertSafeId(source.cameraId, "cameraId");
      if (cameraIds.has(source.cameraId)) throw new CookingVideoError("INTAKE_INVALID", `Duplicate cameraId: ${source.cameraId}.`);
      cameraIds.add(source.cameraId);
      if (!VIDEO_EXTENSIONS.has(path.extname(source.file).toLowerCase())) throw new CookingVideoError("INTAKE_INVALID", `Unsupported video extension: ${source.file}.`);
      const file = await batchFile(batchDirectory, source.file, "source.file");
      const metadata = await stat(file);
      if (!metadata.isFile() || metadata.size === 0) throw new CookingVideoError("INTAKE_INVALID", `Video is missing or empty: ${source.file}.`);
      sources.push({ cameraId: source.cameraId, file: source.file, role: source.role ?? inferRole(source.cameraId), byteSize: metadata.size, modifiedAt: metadata.mtime.toISOString() });
    }
    const machineEventsFile = manifest?.machineEventsFile ?? (await exists(path.join(batchDirectory, "machine-events.jsonl")) ? "machine-events.jsonl" : undefined);
    let machineEventsByteSize: number | undefined;
    let machineEventsModifiedAt: string | undefined;
    if (machineEventsFile !== undefined) {
      const metadata = await stat(await batchFile(batchDirectory, machineEventsFile, "machineEventsFile"));
      if (!metadata.isFile() || metadata.size === 0) throw new CookingVideoError("INTAKE_INVALID", `Machine event file is missing or empty: ${machineEventsFile}.`);
      machineEventsByteSize = metadata.size;
      machineEventsModifiedAt = metadata.mtime.toISOString();
    }
    const jobRoot = resolveWithin(jobsRoot, batchId);
    const receiptFile = path.join(jobRoot, "state", INTAKE_RECEIPT);
    const stableBefore = now.getTime() - stableSeconds * 1000;
    const stable = sources.every(source => Date.parse(source.modifiedAt) <= stableBefore)
      && (machineEventsModifiedAt === undefined || Date.parse(machineEventsModifiedAt) <= stableBefore);
    if (await exists(receiptFile)) return { batchId, directory: batchDirectory, status: "consumed", markerPresent, sources, ...(machineEventsFile ? { machineEventsFile } : {}) };
    const jobRootExists = await exists(jobRoot);
    if (jobRootExists) {
      const claimFile = path.join(jobRoot, "state", INTAKE_CLAIM);
      if (!(await exists(claimFile))) throw new CookingVideoError("INTAKE_INVALID", `Job id ${batchId} already exists and was not created by inbox consumption.`);
      const claim = await readJsonFile<{ batchId?: string; sourceDirectory?: string }>(claimFile);
      if (claim.batchId !== batchId || path.resolve(claim.sourceDirectory ?? "") !== path.resolve(batchDirectory)) {
        throw new CookingVideoError("INTAKE_INVALID", `Intake claim for ${batchId} belongs to another source directory.`);
      }
      if (!markerPresent && !stable) {
        return { batchId, directory: batchDirectory, status: "waiting", markerPresent, sources, ...(machineEventsFile ? { machineEventsFile, machineEventsByteSize, machineEventsModifiedAt } : {}), reason: `Claimed job is incomplete, but source files must be unchanged for ${stableSeconds}s before retry.` };
      }
      return { batchId, directory: batchDirectory, status: "incomplete", markerPresent, sources, ...(machineEventsFile ? { machineEventsFile, machineEventsByteSize, machineEventsModifiedAt } : {}), reason: "A claimed intake job exists without a completed receipt; consumption can resume." };
    }
    return {
      batchId,
      directory: batchDirectory,
      status: markerPresent || stable ? "ready" : "waiting",
      markerPresent,
      sources,
      ...(machineEventsFile ? { machineEventsFile, machineEventsByteSize, machineEventsModifiedAt } : {}),
      ...(!markerPresent && !stable ? { reason: `Videos must be unchanged for ${stableSeconds}s or the batch must contain ${READY_MARKER}.` } : {}),
    };
  } catch (error) {
    return { batchId, directory: batchDirectory, status: "invalid", markerPresent, sources: [], reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function scanInbox(inboxRoot: string, jobsRoot: string, options: ScanInboxOptions = {}): Promise<IntakeBatch[]> {
  const inbox = path.resolve(inboxRoot);
  const jobs = path.resolve(jobsRoot);
  const stableSeconds = validateStableSeconds(options.stableSeconds);
  let entries;
  try {
    entries = await readdir(inbox, { withFileTypes: true });
  } catch (error) {
    throw new CookingVideoError("INTAKE_INVALID", `Cannot read inbox: ${inbox}.`, { cause: error instanceof Error ? error.message : String(error) });
  }
  return await Promise.all(entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && (options.batchId === undefined || entry.name === options.batchId))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(entry => inspectBatch(path.join(inbox, entry.name), entry.name, jobs, stableSeconds, options.now ?? new Date())));
}

function buildJob(batch: IntakeBatch, manifest: IntakeManifest | undefined): CookingVideoJob {
  const sources: CookingVideoSource[] = batch.sources.map(source => ({
    cameraId: source.cameraId,
    path: `input/${source.cameraId}${path.extname(source.file).toLowerCase()}`,
    ...(source.role ? { role: source.role } : {}),
  }));
  return {
    schemaVersion: "1.0",
    jobId: batch.batchId,
    ...(manifest?.dish ? { dish: manifest.dish } : {}),
    ...(manifest?.machine ? { machine: manifest.machine } : {}),
    ...(batch.machineEventsFile ? { machineEventsPath: `input/${path.basename(batch.machineEventsFile)}` } : {}),
    sources,
    brief: {
      audience: manifest?.brief?.audience,
      objective: manifest?.brief?.objective ?? "自动生成炒菜过程宣传视频",
      sellingPoints: manifest?.brief?.sellingPoints ?? ["自动烹饪", "稳定出品"],
      formats: manifest?.brief?.formats ?? [{ aspectRatio: "9:16", durationSec: 15 }],
      language: manifest?.brief?.language ?? "zh-CN",
      requireHumanApproval: true,
    },
    ...(manifest?.brand ? { brand: manifest.brand } : {}),
  };
}

async function consumeBatch(batch: IntakeBatch, jobsRoot: string, now: Date): Promise<IntakeReceipt> {
  const store = new JobStore(jobsRoot);
  const lockDirectory = path.join(path.resolve(jobsRoot), ".intake-locks");
  await mkdir(lockDirectory, { recursive: true });
  const lockFile = path.join(lockDirectory, `${batch.batchId}.lock`);
  let lock;
  try {
    lock = await open(lockFile, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new CookingVideoError("INTAKE_LOCKED", `Batch is already being consumed: ${batch.batchId}.`);
    throw error;
  }
  try {
    const manifest = await loadManifest(batch.directory);
    let loaded;
    try {
      loaded = await store.load(batch.batchId);
      if (loaded.state.status !== "created") throw new CookingVideoError("INTAKE_INVALID", `Existing incomplete job ${batch.batchId} is already ${loaded.state.status}.`);
      const claim = await readJsonFile<{ batchId: string; sourceDirectory: string }>(path.join(loaded.paths.state, INTAKE_CLAIM));
      if (claim.batchId !== batch.batchId || path.resolve(claim.sourceDirectory) !== path.resolve(batch.directory)) {
        throw new CookingVideoError("INTAKE_INVALID", `Existing job ${batch.batchId} has an invalid intake claim.`);
      }
    } catch (error) {
      if (!(error instanceof CookingVideoError) || error.code !== "JOB_NOT_FOUND") throw error;
      loaded = await store.create(buildJob(batch, manifest), now);
      await writeJsonAtomic(path.join(loaded.paths.state, INTAKE_CLAIM), {
        schemaVersion: "1.0",
        batchId: batch.batchId,
        sourceDirectory: batch.directory,
        createdAt: now.toISOString(),
      });
    }
    const copied: IntakeReceipt["sources"] = [];
    for (const source of batch.sources) {
      const sourceFile = await batchFile(batch.directory, source.file, "source.file");
      const jobSource = loaded.job.sources.find(item => item.cameraId === source.cameraId);
      if (!jobSource) throw new CookingVideoError("INTAKE_INVALID", `Existing job is missing camera ${source.cameraId}.`);
      const destination = resolveWithin(loaded.paths.root, jobSource.path);
      await copyFile(sourceFile, destination);
      const [afterSource, destinationMetadata] = await Promise.all([stat(sourceFile), stat(destination)]);
      if (afterSource.size !== source.byteSize || afterSource.mtime.toISOString() !== source.modifiedAt || destinationMetadata.size !== source.byteSize) {
        throw new CookingVideoError("INTAKE_NOT_READY", `Source changed while copying: ${source.file}. Retry after recording completes.`);
      }
      copied.push({ cameraId: source.cameraId, sourceFile, jobPath: jobSource.path, byteSize: source.byteSize, modifiedAt: source.modifiedAt });
    }
    if (batch.machineEventsFile && loaded.job.machineEventsPath) {
      const sourceFile = await batchFile(batch.directory, batch.machineEventsFile, "machineEventsFile");
      const destination = resolveWithin(loaded.paths.root, loaded.job.machineEventsPath);
      await copyFile(sourceFile, destination);
      const [afterSource, destinationMetadata] = await Promise.all([stat(sourceFile), stat(destination)]);
      if (afterSource.size !== batch.machineEventsByteSize || afterSource.mtime.toISOString() !== batch.machineEventsModifiedAt || destinationMetadata.size !== batch.machineEventsByteSize) {
        throw new CookingVideoError("INTAKE_NOT_READY", `Machine event file changed while copying: ${batch.machineEventsFile}.`);
      }
    }
    const receipt: IntakeReceipt = {
      schemaVersion: "1.0",
      batchId: batch.batchId,
      jobId: loaded.job.jobId,
      consumedAt: now.toISOString(),
      sourceDirectory: batch.directory,
      sources: copied,
      ...(loaded.job.machineEventsPath ? { machineEventsPath: loaded.job.machineEventsPath } : {}),
    };
    await writeJsonAtomic(path.join(loaded.paths.state, INTAKE_RECEIPT), receipt);
    return receipt;
  } finally {
    await lock?.close();
    await rm(lockFile, { force: true });
  }
}

export async function consumeInbox(inboxRoot: string, jobsRoot: string, options: ScanInboxOptions = {}): Promise<ConsumeInboxResult> {
  const now = options.now ?? new Date();
  const batches = await scanInbox(inboxRoot, jobsRoot, { ...options, now });
  const result: ConsumeInboxResult = { consumed: [], skipped: [] };
  for (const batch of batches) {
    if (batch.status !== "ready" && batch.status !== "incomplete") {
      result.skipped.push({ batchId: batch.batchId, status: batch.status, ...(batch.reason ? { reason: batch.reason } : {}) });
      continue;
    }
    result.consumed.push(await consumeBatch(batch, jobsRoot, now));
  }
  return result;
}

export async function processInbox(inboxRoot: string, jobsRoot: string, options: ProcessInboxOptions = {}): Promise<ProcessInboxResult> {
  const intake = await consumeInbox(inboxRoot, jobsRoot, options);
  const jobIds = new Set([
    ...intake.consumed.map(receipt => receipt.jobId),
    ...intake.skipped.filter(item => item.status === "consumed").map(item => item.batchId),
  ]);
  const result: ProcessInboxResult = { ...intake, processed: [], failed: [] };
  const store = new JobStore(jobsRoot);
  for (const jobId of jobIds) {
    try {
      const run = await runJobPipeline(store, jobId, options);
      result.processed.push({ jobId, status: run.state.status, stoppedForApproval: run.stoppedForApproval });
    } catch (error) {
      result.failed.push({
        jobId,
        errorCode: error instanceof CookingVideoError ? error.code : "PROCESS_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
