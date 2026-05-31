import { promises as fs } from "node:fs";
import path from "node:path";
import type { SuiteManifest } from "./suite-manifest.js";
import { nextCronRun } from "./cron-schedule.js";

/** A cron entry as declared in a suite's `crons.json`. */
export interface SuiteCronInput {
  id: string;
  schedule: string;
  message?: string;
  skill?: string;
  action?: string;
  description?: string;
  channel?: string;
  requiresBrowser?: boolean;
  cardTemplate?: string;
}

/**
 * A persisted Loong cron job record. Shape matches `@loong/cron`
 * `LoongCronJobRecord` so `<dataRoot>/cron/jobs.json` stays readable by the
 * existing FileCronJobStore.
 */
export interface LoongCronJobRecord {
  id: string;
  sessionId: string;
  message: string;
  schedule: string;
  profileId?: string;
  metadata?: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string;
}

export interface ImportCronsResult {
  imported: number;
  jobsFile: string;
  /** true when written to a sidecar because jobs.json was not a JSON array. */
  usedSidecar: boolean;
}

function readSuiteCrons(raw: unknown): SuiteCronInput[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const list = (raw as { crons?: unknown }).crons;
  if (!Array.isArray(list)) {
    return [];
  }
  const out: SuiteCronInput[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    if (typeof obj.id !== "string" || typeof obj.schedule !== "string") {
      continue;
    }
    out.push({
      id: obj.id,
      schedule: obj.schedule,
      ...(typeof obj.message === "string" ? { message: obj.message } : {}),
      ...(typeof obj.skill === "string" ? { skill: obj.skill } : {}),
      ...(typeof obj.action === "string" ? { action: obj.action } : {}),
      ...(typeof obj.description === "string" ? { description: obj.description } : {}),
      ...(typeof obj.channel === "string" ? { channel: obj.channel } : {}),
      ...(typeof obj.requires_browser === "boolean" ? { requiresBrowser: obj.requires_browser } : {}),
      ...(typeof obj.card_template === "string" ? { cardTemplate: obj.card_template } : {}),
    });
  }
  return out;
}

/** Cron job id prefix used to namespace (and later clean up) a suite's jobs. */
export function suiteCronPrefix(suiteId: string): string {
  return `suite:${suiteId}:`;
}

export function buildCronJobRecords(
  manifest: SuiteManifest,
  crons: SuiteCronInput[],
  now: Date,
): LoongCronJobRecord[] {
  const nowIso = now.toISOString();
  return crons.map((cron) => ({
    id: `${suiteCronPrefix(manifest.id)}${cron.id}`,
    sessionId: `suite:${manifest.id}`,
    message: cron.message ?? cron.description ?? `Run ${cron.skill ?? cron.id}`,
    schedule: cron.schedule,
    profileId: manifest.id,
    metadata: {
      suiteId: manifest.id,
      ...(cron.skill ? { skill: cron.skill } : {}),
      ...(cron.action ? { action: cron.action } : {}),
      ...(cron.channel ? { channel: cron.channel } : {}),
      ...(cron.requiresBrowser !== undefined ? { requiresBrowser: cron.requiresBrowser } : {}),
      ...(cron.cardTemplate ? { cardTemplate: cron.cardTemplate } : {}),
    },
    enabled: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    nextRunAt: nextCronRun(cron.schedule, now).toISOString(),
  }));
}

/**
 * Import a suite's `crons.json` into `<dataRoot>/cron/jobs.json`.
 *
 * Existing jobs from the same suite (matched by id prefix) are replaced. If
 * `jobs.json` exists but is not a JSON array, it is NOT clobbered — records are
 * written to a sidecar file instead and `usedSidecar` is set.
 */
export async function importSuiteCrons(
  manifest: SuiteManifest,
  workspaceDir: string,
  dataRoot: string,
  now: Date = new Date(),
): Promise<ImportCronsResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(path.join(workspaceDir, "crons.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { imported: 0, jobsFile: "", usedSidecar: false };
    }
    throw error;
  }

  const crons = readSuiteCrons(raw);
  if (crons.length === 0) {
    return { imported: 0, jobsFile: "", usedSidecar: false };
  }

  const records = buildCronJobRecords(manifest, crons, now);
  const jobsFile = path.join(dataRoot, "cron", "jobs.json");
  await fs.mkdir(path.dirname(jobsFile), { recursive: true });

  let existing: unknown;
  try {
    existing = JSON.parse(await fs.readFile(jobsFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      existing = [];
    } else {
      existing = undefined;
    }
  }

  const prefix = suiteCronPrefix(manifest.id);

  if (Array.isArray(existing)) {
    const kept = existing.filter((job) => {
      const id = job && typeof job === "object" ? (job as { id?: unknown }).id : undefined;
      return !(typeof id === "string" && id.startsWith(prefix));
    });
    const merged = [...kept, ...records];
    await fs.writeFile(jobsFile, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    return { imported: records.length, jobsFile, usedSidecar: false };
  }

  const sidecar = path.join(dataRoot, "cron", `suite-${manifest.id}.jobs.json`);
  await fs.writeFile(sidecar, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  return { imported: records.length, jobsFile: sidecar, usedSidecar: true };
}
