import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OrgTicket, TicketDocument, TicketStore } from "../types.js";

const EMPTY: TicketDocument = { tickets: [] };

export function createFileTicketStore(filePath: string): TicketStore {
  return {
    async load() {
      const document = await readJsonFile(filePath, EMPTY);
      return normalizeTicketDocument(document, filePath);
    },
    async save(document) {
      const normalized = normalizeTicketDocument(document, filePath);
      await writeJsonAtomic(filePath, { tickets: normalized.tickets });
      return { ...normalized, configPath: filePath };
    },
  };
}

function normalizeTicketDocument(value: unknown, configPath: string): TicketDocument {
  if (!value || typeof value !== "object") {
    return { ...EMPTY, configPath };
  }
  const raw = value as Record<string, unknown>;
  const tickets = Array.isArray(raw.tickets)
    ? raw.tickets
        .map((entry, index) => normalizeTicket(entry, index))
        .filter((entry): entry is OrgTicket => entry !== undefined)
    : [];
  return { tickets, configPath };
}

function normalizeTicket(value: unknown, index: number): OrgTicket | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const status = raw.status;
  if (
    status !== "open"
    && status !== "in_progress"
    && status !== "blocked"
    && status !== "done"
    && status !== "cancelled"
  ) {
    return undefined;
  }
  const ticket: OrgTicket = {
    id: readString(raw.id, `Ticket ${index + 1} id`),
    title: readString(raw.title, `Ticket ${index + 1} title`),
    status,
    createdAt: readString(raw.createdAt, `Ticket ${index + 1} createdAt`),
    updatedAt: readString(raw.updatedAt, `Ticket ${index + 1} updatedAt`),
  };
  if (typeof raw.assigneeEmployeeId === "string" && raw.assigneeEmployeeId.trim()) {
    ticket.assigneeEmployeeId = raw.assigneeEmployeeId.trim();
  }
  if (typeof raw.createdByEmployeeId === "string" && raw.createdByEmployeeId.trim()) {
    ticket.createdByEmployeeId = raw.createdByEmployeeId.trim();
  }
  if (typeof raw.runId === "string" && raw.runId.trim()) {
    ticket.runId = raw.runId.trim();
  }
  if (typeof raw.toolName === "string" && raw.toolName.trim()) {
    ticket.toolName = raw.toolName.trim();
  }
  if (typeof raw.description === "string" && raw.description.trim()) {
    ticket.description = raw.description.trim();
  }
  if (Array.isArray(raw.tags)) {
    ticket.tags = raw.tags
      .filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim()))
      .map(tag => tag.trim());
  }
  return ticket;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}
