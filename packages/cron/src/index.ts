import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { postGatewayWebhook } from "@loong/channels";

export interface LoongCronSchedule {
  expression: string;
  minutes: readonly number[];
  hours: readonly number[];
  daysOfMonth: readonly number[];
  months: readonly number[];
  daysOfWeek: readonly number[];
  dayOfMonthWildcard: boolean;
  dayOfWeekWildcard: boolean;
}

export type LoongCronThinkingLevel = "none" | "low" | "medium" | "high";

export interface LoongCronJob {
  id: string;
  sessionId: string;
  message: string;
  schedule: string;
  workspace?: string;
  model?: string;
  profileId?: string;
  thinking?: LoongCronThinkingLevel;
  toolsEnabled?: boolean;
  memoryEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

export type LoongCronJobStatus = "ok" | "error";

export interface LoongCronJobRecord extends LoongCronJob {
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string;
  lastScheduledAt?: string;
  lastDeliveredAt?: string;
  lastStatus?: LoongCronJobStatus;
  lastError?: string;
}

export interface LoongCronOccurrence {
  jobId: string;
  scheduledAt: string;
  deliveredAt?: string;
}

export interface LoongCronDeliveryRecord {
  jobId: string;
  scheduledAt: string;
  deliveredAt: string;
  status: LoongCronJobStatus;
  result: LoongCronDeliveryResult;
}

export interface LoongCronRunnerTickResult {
  checkedAt: string;
  delivered: readonly LoongCronDeliveryRecord[];
}

export interface LoongCronDeliveryResult {
  ok: boolean;
  status: number;
  payload?: unknown;
  error?: string;
}

export interface LoongCronDeliveryTarget {
  deliver(job: LoongCronJob, occurrence: LoongCronOccurrence): Promise<LoongCronDeliveryResult>;
}

export interface LoongCronJobStore {
  list(): Promise<LoongCronJobRecord[]>;
  get(id: string): Promise<LoongCronJobRecord | undefined>;
  upsert(job: LoongCronJob | LoongCronJobRecord, options?: { now?: Date }): Promise<LoongCronJobRecord>;
  remove(id: string): Promise<boolean>;
}

export interface GatewayWebhookCronTargetOptions {
  gatewayUrl: string;
  sharedSecret?: string;
  fetchImpl?: typeof fetch;
}

export interface FileCronJobStoreOptions {
  filePath: string;
}

export interface LoongCronRunnerOptions {
  store: LoongCronJobStore;
  target: LoongCronDeliveryTarget;
  now?: () => Date;
}

export interface LoongCronRunnerStartOptions {
  intervalMs?: number;
}

export interface LoongCronRunner {
  tick(): Promise<LoongCronRunnerTickResult>;
  start(options?: LoongCronRunnerStartOptions): void;
  stop(): void;
}

const CRON_FIELD_COUNT = 5;
// Search up to ~5 years ahead so Feb-29-only schedules can find the next leap
// year (gap is up to 4 years). 366 days was too tight for "0 0 29 2 *".
const MAX_NEXT_RUN_MINUTES = 5 * 366 * 24 * 60;
const DEFAULT_CRON_RUNNER_INTERVAL_MS = 30_000;

export function parseCronSchedule(expression: string): LoongCronSchedule {
  const normalized = normalizeCronExpression(expression);
  const fields = normalized.split(/\s+/);
  if (fields.length !== CRON_FIELD_COUNT) {
    throw new Error("Cron expression must contain five fields: minute hour day-of-month month day-of-week.");
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string];
  const daysOfWeek = parseCronField(dayOfWeek, 0, 7, "day-of-week").map(value => value === 7 ? 0 : value);
  return {
    expression: normalized,
    minutes: parseCronField(minute, 0, 59, "minute"),
    hours: parseCronField(hour, 0, 23, "hour"),
    daysOfMonth: parseCronField(dayOfMonth, 1, 31, "day-of-month"),
    months: parseCronField(month, 1, 12, "month"),
    daysOfWeek: uniqueSorted(daysOfWeek),
    dayOfMonthWildcard: dayOfMonth === "*",
    dayOfWeekWildcard: dayOfWeek === "*",
  };
}

export function nextCronRun(expressionOrSchedule: string | LoongCronSchedule, from = new Date()): Date {
  const schedule = typeof expressionOrSchedule === "string"
    ? parseCronSchedule(expressionOrSchedule)
    : expressionOrSchedule;
  const candidate = new Date(from.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  for (let index = 0; index < MAX_NEXT_RUN_MINUTES; index += 1) {
    if (cronDateMatches(schedule, candidate)) {
      return new Date(candidate.getTime());
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw new Error("Cron expression has no matching run within five years.");
}

export function createGatewayWebhookCronTarget(options: GatewayWebhookCronTargetOptions): LoongCronDeliveryTarget {
  const gatewayUrl = normalizeGatewayUrl(options.gatewayUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async deliver(job, occurrence) {
      const deliveredAt = occurrence.deliveredAt ?? new Date().toISOString();
      return await postGatewayWebhook({
        gatewayUrl,
        ...(options.sharedSecret !== undefined ? { sharedSecret: options.sharedSecret } : {}),
        body: toGatewayWebhookCronPayload(job, { ...occurrence, deliveredAt }),
        fetchImpl,
      });
    },
  };
}

export function createFileCronJobStore(options: FileCronJobStoreOptions): LoongCronJobStore {
  const filePath = path.resolve(options.filePath);
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const current = queue.then(operation, operation);
    queue = current.catch(() => undefined);
    return current;
  }

  async function readRecords(): Promise<LoongCronJobRecord[]> {
    let text: string;
    try {
      text = await readFile(filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    if (!text.trim()) {
      return [];
    }
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("Cron job store file must contain a JSON array.");
    }
    return parsed.map(readCronJobRecord);
  }

  async function writeRecords(records: readonly LoongCronJobRecord[]): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
      await rename(tempPath, filePath);
    } catch (error) {
      // Best-effort cleanup so a failed write does not leave a stray .tmp
      // file that future scans of the cron directory have to skip.
      try { await unlink(tempPath); } catch { /* ignore secondary failure */ }
      throw error;
    }
  }

  return {
    list() {
      return enqueue(async () => readRecords());
    },
    get(id) {
      return enqueue(async () => {
        const records = await readRecords();
        return records.find(record => record.id === id);
      });
    },
    upsert(job, options = {}) {
      return enqueue(async () => {
        const records = await readRecords();
        const now = (options.now ?? new Date()).toISOString();
        const previous = records.find(record => record.id === job.id);
        const record = normalizeCronJobRecord(job, previous, now);
        const nextRecords = previous === undefined
          ? [...records, record]
          : records.map(existing => existing.id === record.id ? record : existing);
        await writeRecords(nextRecords);
        return record;
      });
    },
    remove(id) {
      return enqueue(async () => {
        const records = await readRecords();
        const nextRecords = records.filter(record => record.id !== id);
        if (nextRecords.length === records.length) {
          return false;
        }
        await writeRecords(nextRecords);
        return true;
      });
    },
  };
}

export function createCronRunner(options: LoongCronRunnerOptions): LoongCronRunner {
  const now = options.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | undefined;
  let runningTick: Promise<LoongCronRunnerTickResult> | undefined;

  async function tick(): Promise<LoongCronRunnerTickResult> {
    if (runningTick !== undefined) {
      return runningTick;
    }
    runningTick = runCronTick(options.store, options.target, now()).finally(() => {
      runningTick = undefined;
    });
    return runningTick;
  }

  return {
    tick,
    start(startOptions = {}) {
      if (timer !== undefined) {
        return;
      }
      const intervalMs = normalizeIntervalMs(startOptions.intervalMs);
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      if (typeof timer.unref === "function") {
        timer.unref();
      }
    },
    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}

export function toGatewayWebhookCronPayload(
  job: LoongCronJob,
  occurrence: LoongCronOccurrence,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...(job.metadata ?? {}),
    cronJobId: job.id,
    cronSchedule: job.schedule,
    cronScheduledAt: occurrence.scheduledAt,
    ...(occurrence.deliveredAt !== undefined ? { cronDeliveredAt: occurrence.deliveredAt } : {}),
  };
  return {
    sessionId: job.sessionId,
    message: job.message,
    channel: "cron",
    metadata,
    ...(job.workspace !== undefined ? { workspace: job.workspace } : {}),
    ...(job.model !== undefined ? { model: job.model } : {}),
    ...(job.profileId !== undefined ? { profileId: job.profileId } : {}),
    ...(job.thinking !== undefined ? { thinking: job.thinking } : {}),
    ...(job.toolsEnabled !== undefined ? { toolsEnabled: job.toolsEnabled } : {}),
    ...(job.memoryEnabled !== undefined ? { memoryEnabled: job.memoryEnabled } : {}),
  };
}

async function runCronTick(
  store: LoongCronJobStore,
  target: LoongCronDeliveryTarget,
  checkedAt: Date,
): Promise<LoongCronRunnerTickResult> {
  const checkedAtIso = checkedAt.toISOString();
  const records = await store.list();
  const delivered: LoongCronDeliveryRecord[] = [];
  for (const record of records) {
    if (!record.enabled || new Date(record.nextRunAt).getTime() > checkedAt.getTime()) {
      continue;
    }
    const occurrence: LoongCronOccurrence = {
      jobId: record.id,
      scheduledAt: record.nextRunAt,
      deliveredAt: checkedAtIso,
    };
    const result = await target.deliver(record, occurrence);
    const delivery: LoongCronDeliveryRecord = {
      jobId: record.id,
      scheduledAt: occurrence.scheduledAt,
      deliveredAt: checkedAtIso,
      status: result.ok ? "ok" : "error",
      result,
    };
    delivered.push(delivery);
    await store.upsert({
      ...record,
      nextRunAt: nextCronRun(record.schedule, checkedAt).toISOString(),
      lastScheduledAt: occurrence.scheduledAt,
      lastDeliveredAt: checkedAtIso,
      lastStatus: delivery.status,
      ...(result.ok ? { lastError: undefined } : { lastError: result.error ?? `HTTP ${result.status}` }),
    }, { now: checkedAt });
  }
  return { checkedAt: checkedAtIso, delivered };
}

function normalizeCronJobRecord(
  job: LoongCronJob | LoongCronJobRecord,
  previous: LoongCronJobRecord | undefined,
  now: string,
): LoongCronJobRecord {
  const schedule = parseCronSchedule(job.schedule);
  const candidate = job as Partial<LoongCronJobRecord>;
  const scheduleChanged = previous !== undefined && previous.schedule !== schedule.expression;
  const base = {
    id: normalizeNonEmptyString(job.id, "Cron job id"),
    sessionId: normalizeNonEmptyString(job.sessionId, "Cron job sessionId"),
    message: normalizeNonEmptyString(job.message, "Cron job message"),
    schedule: schedule.expression,
    ...(job.workspace !== undefined ? { workspace: normalizeNonEmptyString(job.workspace, "Cron job workspace") } : {}),
    ...(job.model !== undefined ? { model: normalizeNonEmptyString(job.model, "Cron job model") } : {}),
    ...(job.metadata !== undefined ? { metadata: readMetadata(job.metadata) } : {}),
  };
  const enabled = typeof candidate.enabled === "boolean"
    ? candidate.enabled
    : previous?.enabled ?? true;
  const nextRunAt = hasOwn(candidate, "nextRunAt")
    ? candidate.nextRunAt === undefined
      ? nextCronRun(schedule, new Date(now)).toISOString()
      : normalizeIsoDate(candidate.nextRunAt, "Cron job nextRunAt")
    : scheduleChanged || previous === undefined
      ? nextCronRun(schedule, new Date(now)).toISOString()
      : previous.nextRunAt;
  const record: LoongCronJobRecord = {
    ...base,
    enabled,
    createdAt: typeof candidate.createdAt === "string"
      ? normalizeIsoDate(candidate.createdAt, "Cron job createdAt")
      : previous?.createdAt ?? now,
    updatedAt: now,
    nextRunAt,
  };
  const lastScheduledAt = hasOwn(candidate, "lastScheduledAt")
    ? candidate.lastScheduledAt === undefined ? undefined : normalizeIsoDate(candidate.lastScheduledAt, "Cron job lastScheduledAt")
    : previous?.lastScheduledAt;
  const lastDeliveredAt = hasOwn(candidate, "lastDeliveredAt")
    ? candidate.lastDeliveredAt === undefined ? undefined : normalizeIsoDate(candidate.lastDeliveredAt, "Cron job lastDeliveredAt")
    : previous?.lastDeliveredAt;
  const lastStatus = hasOwn(candidate, "lastStatus")
    ? candidate.lastStatus === undefined ? undefined : readCronStatus(candidate.lastStatus)
    : previous?.lastStatus;
  const lastError = hasOwn(candidate, "lastError")
    ? candidate.lastError === undefined ? undefined : String(candidate.lastError)
    : previous?.lastError;
  if (lastScheduledAt !== undefined) {
    record.lastScheduledAt = lastScheduledAt;
  }
  if (lastDeliveredAt !== undefined) {
    record.lastDeliveredAt = lastDeliveredAt;
  }
  if (lastStatus !== undefined) {
    record.lastStatus = lastStatus;
  }
  if (lastError !== undefined) {
    record.lastError = lastError;
  }
  return record;
}

function readCronJobRecord(value: unknown): LoongCronJobRecord {
  if (!isRecord(value)) {
    throw new Error("Cron job record must be an object.");
  }
  const job: LoongCronJobRecord = {
    id: normalizeNonEmptyString(value.id, "Cron job id"),
    sessionId: normalizeNonEmptyString(value.sessionId, "Cron job sessionId"),
    message: normalizeNonEmptyString(value.message, "Cron job message"),
    schedule: parseCronSchedule(normalizeNonEmptyString(value.schedule, "Cron job schedule")).expression,
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    createdAt: normalizeIsoDate(value.createdAt, "Cron job createdAt"),
    updatedAt: normalizeIsoDate(value.updatedAt, "Cron job updatedAt"),
    nextRunAt: normalizeIsoDate(value.nextRunAt, "Cron job nextRunAt"),
    ...(value.workspace !== undefined ? { workspace: normalizeNonEmptyString(value.workspace, "Cron job workspace") } : {}),
    ...(value.model !== undefined ? { model: normalizeNonEmptyString(value.model, "Cron job model") } : {}),
    ...(value.metadata !== undefined ? { metadata: readMetadata(value.metadata) } : {}),
    ...(value.lastScheduledAt !== undefined ? { lastScheduledAt: normalizeIsoDate(value.lastScheduledAt, "Cron job lastScheduledAt") } : {}),
    ...(value.lastDeliveredAt !== undefined ? { lastDeliveredAt: normalizeIsoDate(value.lastDeliveredAt, "Cron job lastDeliveredAt") } : {}),
    ...(value.lastStatus !== undefined ? { lastStatus: readCronStatus(value.lastStatus) } : {}),
    ...(value.lastError !== undefined ? { lastError: String(value.lastError) } : {}),
  };
  return job;
}

function parseCronField(field: string, min: number, max: number, label: string): number[] {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) {
      throw new Error(`Cron ${label} field contains an empty list item.`);
    }
    addCronPart(values, trimmed, min, max, label);
  }
  return uniqueSorted([...values]);
}

function addCronPart(values: Set<number>, part: string, min: number, max: number, label: string): void {
  const [rangePart, stepPart] = part.split("/") as [string, string | undefined];
  if (part.split("/").length > 2) {
    throw new Error(`Cron ${label} field has an invalid step.`);
  }
  const step = stepPart === undefined ? 1 : parseInteger(stepPart, min, max, `${label} step`);
  if (step < 1) {
    throw new Error(`Cron ${label} step must be positive.`);
  }

  const [start, end] = parseCronRange(rangePart, min, max, label);
  for (let value = start; value <= end; value += step) {
    values.add(value);
  }
}

function parseCronRange(value: string, min: number, max: number, label: string): [number, number] {
  if (value === "*") {
    return [min, max];
  }
  const separator = value.indexOf("-");
  if (separator === -1) {
    const parsed = parseInteger(value, min, max, label);
    return [parsed, parsed];
  }
  const start = parseInteger(value.slice(0, separator), min, max, `${label} range start`);
  const end = parseInteger(value.slice(separator + 1), min, max, `${label} range end`);
  if (start > end) {
    throw new Error(`Cron ${label} range start must be before or equal to end.`);
  }
  return [start, end];
}

function parseInteger(value: string, min: number, max: number, label: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Cron ${label} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Cron ${label} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function cronDateMatches(schedule: LoongCronSchedule, date: Date): boolean {
  if (!schedule.minutes.includes(date.getUTCMinutes())) {
    return false;
  }
  if (!schedule.hours.includes(date.getUTCHours())) {
    return false;
  }
  if (!schedule.months.includes(date.getUTCMonth() + 1)) {
    return false;
  }
  const dayOfMonthMatches = schedule.daysOfMonth.includes(date.getUTCDate());
  const dayOfWeekMatches = schedule.daysOfWeek.includes(date.getUTCDay());
  if (schedule.dayOfMonthWildcard && schedule.dayOfWeekWildcard) {
    return true;
  }
  if (schedule.dayOfMonthWildcard) {
    return dayOfWeekMatches;
  }
  if (schedule.dayOfWeekWildcard) {
    return dayOfMonthMatches;
  }
  return dayOfMonthMatches || dayOfWeekMatches;
}

function normalizeCronExpression(expression: string): string {
  const trimmed = expression.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    throw new Error("Cron expression cannot be empty.");
  }
  if (trimmed === "@hourly") {
    return "0 * * * *";
  }
  if (trimmed === "@daily" || trimmed === "@midnight") {
    return "0 0 * * *";
  }
  if (trimmed === "@weekly") {
    return "0 0 * * 0";
  }
  return trimmed;
}

function normalizeGatewayUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Gateway URL cannot be empty.");
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Gateway URL must use http or https.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeIntervalMs(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_CRON_RUNNER_INTERVAL_MS;
  }
  if (!Number.isInteger(value) || value < 1000 || value > 24 * 60 * 60 * 1000) {
    throw new Error("Cron runner intervalMs must be an integer between 1000 and 86400000.");
  }
  return value;
}

function normalizeIsoDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty ISO date string.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be a valid ISO date string.`);
  }
  return date.toISOString();
}

function normalizeNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function readCronStatus(value: unknown): LoongCronJobStatus {
  if (value === "ok" || value === "error") {
    return value;
  }
  throw new Error("Cron job lastStatus must be ok or error.");
}

function readMetadata(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Cron job metadata must be an object.");
  }
  return { ...value };
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function readResponseError(payload: unknown): string | undefined {
  if (typeof payload === "string") {
    return payload;
  }
  if (isRecord(payload) && typeof payload.error === "string") {
    return payload.error;
  }
  return undefined;
}

function uniqueSorted(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
