import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ApprovalRegistry, ApprovalRequest, ApprovalStatus, ApprovalStore } from "../types.js";

const EMPTY_REGISTRY: ApprovalRegistry = {
  requests: [],
};

const MAX_RECORDS = 500;

export function createFileApprovalStore(filePath: string): ApprovalStore {
  return {
    async load() {
      const registry = await readJsonFile(filePath, EMPTY_REGISTRY);
      return normalizeApprovalRegistry(registry, filePath);
    },
    async save(registry) {
      const normalized = normalizeApprovalRegistry(registry, filePath);
      await writeJsonAtomic(filePath, {
        requests: normalized.requests.slice(-MAX_RECORDS),
      });
      return { ...normalized, configPath: filePath };
    },
  };
}

function normalizeApprovalRegistry(value: unknown, configPath: string): ApprovalRegistry {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_REGISTRY, configPath };
  }
  const raw = value as Record<string, unknown>;
  const requests = Array.isArray(raw.requests)
    ? raw.requests
        .map((entry, index) => normalizeApprovalRequest(entry, index))
        .filter((entry): entry is ApprovalRequest => entry !== undefined)
    : [];
  return { requests, configPath };
}

function normalizeApprovalRequest(value: unknown, index: number): ApprovalRequest | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const id = readString(raw.id, `Approval ${index + 1} id`);
  const status = raw.status;
  if (status !== "pending" && status !== "approved" && status !== "rejected" && status !== "expired") {
    return undefined;
  }
  const request: ApprovalRequest = {
    id,
    status,
    chainId: readString(raw.chainId, `Approval ${id} chainId`),
    runId: readString(raw.runId, `Approval ${id} runId`),
    toolCallId: readString(raw.toolCallId, `Approval ${id} toolCallId`),
    toolName: readString(raw.toolName, `Approval ${id} toolName`),
    sessionId: readString(raw.sessionId, `Approval ${id} sessionId`),
    reason: readString(raw.reason, `Approval ${id} reason`),
    createdAt: readString(raw.createdAt, `Approval ${id} createdAt`),
    updatedAt: readString(raw.updatedAt, `Approval ${id} updatedAt`),
  };
  if (typeof raw.employeeId === "string" && raw.employeeId.trim()) {
    request.employeeId = raw.employeeId.trim();
  }
  if (typeof raw.employeeDisplayName === "string" && raw.employeeDisplayName.trim()) {
    request.employeeDisplayName = raw.employeeDisplayName.trim();
  }
  if (typeof raw.assignedApproverId === "string" && raw.assignedApproverId.trim()) {
    request.assignedApproverId = raw.assignedApproverId.trim();
  }
  if (typeof raw.assignedApproverDisplayName === "string" && raw.assignedApproverDisplayName.trim()) {
    request.assignedApproverDisplayName = raw.assignedApproverDisplayName.trim();
  }
  if (typeof raw.chainName === "string" && raw.chainName.trim()) {
    request.chainName = raw.chainName.trim();
  }
  if (typeof raw.inputSummary === "string" && raw.inputSummary.trim()) {
    request.inputSummary = raw.inputSummary.trim();
  }
  if (typeof raw.resolvedAt === "string" && raw.resolvedAt.trim()) {
    request.resolvedAt = raw.resolvedAt.trim();
  }
  if (typeof raw.resolvedBy === "string" && raw.resolvedBy.trim()) {
    request.resolvedBy = raw.resolvedBy.trim();
  }
  if (typeof raw.resolutionNote === "string" && raw.resolutionNote.trim()) {
    request.resolutionNote = raw.resolutionNote.trim();
  }
  return request;
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
