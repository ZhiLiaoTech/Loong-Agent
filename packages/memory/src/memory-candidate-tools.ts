import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { DragonLifecycleHook } from "@dragon/core";
import type { ToolDefinition, ToolInvocation, ToolJsonSchema } from "@dragon/tools";
import { safelyInvokeMemoryTool } from "./memory-tool-invoke.js";
import { assertCanAppendRegularFile } from "./memory-file-io.js";
import { withMemoryFileLock } from "./memory-file-lock.js";
import { MemoryToolError } from "./memory-tool-error.js";
import type { MemoryStore } from "./memory-record-types.js";
import {
  ABSOLUTE_MEMORY_CANDIDATE_BYTES,
  ABSOLUTE_MEMORY_CANDIDATE_FILE_BYTES,
  ABSOLUTE_MEMORY_CANDIDATE_FILES,
  assertSafeMemoryCandidateDirectory,
  buildMemoryCandidate,
  DEFAULT_MEMORY_CANDIDATE_BYTES,
  ABSOLUTE_MEMORY_CANDIDATE_CHARS,
  DEFAULT_MEMORY_CANDIDATE_CHARS,
  DEFAULT_MEMORY_CANDIDATE_FILE_BYTES,
  DEFAULT_MEMORY_CANDIDATE_FILES,
  findMemoryCandidate,
  listMemoryCandidates,
  memoryCandidatePath,
  memoryDraftFromCandidate,
  parseMemoryCandidateListInput,
  parseMemoryCandidatePromoteInput,
  parseMemoryCandidateRejectInput,
  readInvocationRunId,
  rewriteMemoryCandidate,
  stringifyMemoryCandidate,
  withMemoryCandidateReviewLock,
} from "./memory-candidate-store.js";
import type {
  MemoryCandidateLifecycleHookOptions,
  MemoryCandidateListInput,
  MemoryCandidateListOutput,
  MemoryCandidatePromoteInput,
  MemoryCandidatePromoteOutput,
  MemoryCandidateRecord,
  MemoryCandidateRejectInput,
  MemoryCandidateRejectOutput,
  MemoryCandidateToolsOptions,
} from "./memory-candidate-types.js";
import { clampPositiveInteger } from "./memory-util.js";
import { randomUUID } from "node:crypto";

const memoryCandidateListSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["pending", "promoting", "promoted", "rejected", "all"] },
    dateFrom: { type: "string" },
    dateTo: { type: "string" },
    limit: { type: "number" },
  },
  additionalProperties: false,
};

const memoryCandidatePromoteSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    scope: { type: "string", enum: ["user", "project", "session", "skill"] },
    content: { type: "string" },
    source: { type: "string" },
    metadata: { type: "object" },
  },
  required: ["id"],
  additionalProperties: false,
};

const memoryCandidateRejectSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    reason: { type: "string" },
  },
  required: ["id"],
  additionalProperties: false,
};

export function createMemoryCandidateTools(options: MemoryCandidateToolsOptions): ToolDefinition[] {
  return [
    createMemoryCandidateListTool(options),
    createMemoryCandidatePromoteTool(options),
    createMemoryCandidateRejectTool(options),
  ];
}

export function createMemoryCandidateLifecycleHook(
  options: MemoryCandidateLifecycleHookOptions = {},
): DragonLifecycleHook {
  const rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "memory"));
  const maxContentChars = clampPositiveInteger(
    options.maxContentChars,
    DEFAULT_MEMORY_CANDIDATE_CHARS,
    ABSOLUTE_MEMORY_CANDIDATE_CHARS,
  );
  const maxCandidateBytes = clampPositiveInteger(
    options.maxCandidateBytes,
    DEFAULT_MEMORY_CANDIDATE_BYTES,
    ABSOLUTE_MEMORY_CANDIDATE_BYTES,
  );
  const maxFileBytes = clampPositiveInteger(
    options.maxFileBytes,
    DEFAULT_MEMORY_CANDIDATE_FILE_BYTES,
    ABSOLUTE_MEMORY_CANDIDATE_FILE_BYTES,
  );

  return {
    name: "memory_candidate_capture",
    async onLifecycle(request) {
      const candidate = buildMemoryCandidate(request, maxContentChars);
      if (!candidate) {
        return;
      }
      const serialized = stringifyMemoryCandidate(candidate, maxCandidateBytes);
      const filePath = memoryCandidatePath(rootDir, candidate.createdAt);
      await mkdir(path.dirname(filePath), { recursive: true });
      await assertSafeMemoryCandidateDirectory(path.dirname(filePath));
      await withMemoryFileLock(filePath, async () => {
        await assertCanAppendRegularFile(
          filePath,
          Buffer.byteLength(`${serialized}\n`, "utf8"),
          maxFileBytes,
          "Memory candidate file",
        );
        await appendFile(filePath, `${serialized}\n`, "utf8");
      });
    },
  };
}

export function createMemoryCandidateListTool(
  options: MemoryCandidateToolsOptions,
): ToolDefinition<MemoryCandidateListInput, MemoryCandidateListOutput> {
  const rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "memory"));
  const maxFiles = clampPositiveInteger(options.maxFiles, DEFAULT_MEMORY_CANDIDATE_FILES, ABSOLUTE_MEMORY_CANDIDATE_FILES);
  const maxFileBytes = clampPositiveInteger(
    options.maxFileBytes,
    DEFAULT_MEMORY_CANDIDATE_FILE_BYTES,
    ABSOLUTE_MEMORY_CANDIDATE_FILE_BYTES,
  );
  return {
    name: "memory_candidates_list",
    description: "List reviewable Dragon memory candidates without promoting them into durable memory.",
    inputSchema: memoryCandidateListSchema,
    capabilities: ["read", "memory"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const input = parseMemoryCandidateListInput(invocation.input);
        return await listMemoryCandidates(rootDir, input, maxFiles, maxFileBytes);
      });
    },
  };
}

export function createMemoryCandidatePromoteTool(
  options: MemoryCandidateToolsOptions,
): ToolDefinition<MemoryCandidatePromoteInput, MemoryCandidatePromoteOutput> {
  const rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "memory"));
  const maxFiles = clampPositiveInteger(options.maxFiles, DEFAULT_MEMORY_CANDIDATE_FILES, ABSOLUTE_MEMORY_CANDIDATE_FILES);
  const maxFileBytes = clampPositiveInteger(
    options.maxFileBytes,
    DEFAULT_MEMORY_CANDIDATE_FILE_BYTES,
    ABSOLUTE_MEMORY_CANDIDATE_FILE_BYTES,
  );
  const maxCandidateBytes = clampPositiveInteger(
    options.maxCandidateBytes,
    DEFAULT_MEMORY_CANDIDATE_BYTES,
    ABSOLUTE_MEMORY_CANDIDATE_BYTES,
  );
  return {
    name: "memory_candidate_promote",
    description: "Promote one pending memory candidate into durable memory after user review.",
    inputSchema: memoryCandidatePromoteSchema,
    capabilities: ["write", "memory"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const input = parseMemoryCandidatePromoteInput(invocation.input);
        return await withMemoryCandidateReviewLock(input.id, async () => {
          const initial = await findMemoryCandidate(rootDir, input.id, maxFiles, maxFileBytes);
          return await withMemoryFileLock(initial.filePath, async () => {
            const current = await findMemoryCandidate(rootDir, input.id, maxFiles, maxFileBytes);
            if (current.record.status === "promoting") {
              throw new MemoryToolError(
                `Memory candidate ${input.id} is in transient "promoting" state from a prior incomplete promote (reservation ${current.record.reservationId ?? "unknown"} at ${current.record.reservationAt ?? "unknown"}). Inspect ${path.basename(current.filePath)} before retrying.`,
              );
            }
            if (current.record.status !== "pending") {
              throw new MemoryToolError(`Memory candidate is already ${current.record.status}.`);
            }
            const draft = memoryDraftFromCandidate(current.record, input, invocation);
            const reservationId = randomUUID();
            const reservedAt = new Date().toISOString();
            await rewriteMemoryCandidate(
              rootDir,
              current.filePath,
              input.id,
              maxFileBytes,
              maxCandidateBytes,
              candidate => ({
                ...candidate,
                status: "promoting",
                reservationId,
                reservationAt: reservedAt,
              }),
              { allowedStatuses: ["pending"] },
            );
            let memoryRecord;
            try {
              memoryRecord = await options.store.remember(draft);
            } catch (storeError) {
              try {
                await rewriteMemoryCandidate(
                  rootDir,
                  current.filePath,
                  input.id,
                  maxFileBytes,
                  maxCandidateBytes,
                  candidate => {
                    const reverted: MemoryCandidateRecord = { ...candidate, status: "pending" };
                    delete reverted.reservationId;
                    delete reverted.reservationAt;
                    return reverted;
                  },
                  { allowedStatuses: ["promoting"] },
                );
              } catch {
                // rollback best-effort
              }
              throw storeError;
            }
            const promoted = await rewriteMemoryCandidate(
              rootDir,
              current.filePath,
              input.id,
              maxFileBytes,
              maxCandidateBytes,
              candidate => {
                const updated: MemoryCandidateRecord = {
                  ...candidate,
                  status: "promoted",
                  reviewedAt: new Date().toISOString(),
                  promotedMemoryId: memoryRecord.id,
                };
                const runId = readInvocationRunId(invocation);
                if (runId !== undefined) {
                  updated.reviewedByRunId = runId;
                }
                delete updated.reservationId;
                delete updated.reservationAt;
                return updated;
              },
              { allowedStatuses: ["promoting"] },
            );
            return {
              candidate: promoted,
              record: memoryRecord,
            };
          });
        });
      });
    },
  };
}

export function createMemoryCandidateRejectTool(
  options: MemoryCandidateToolsOptions,
): ToolDefinition<MemoryCandidateRejectInput, MemoryCandidateRejectOutput> {
  const rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "memory"));
  const maxFiles = clampPositiveInteger(options.maxFiles, DEFAULT_MEMORY_CANDIDATE_FILES, ABSOLUTE_MEMORY_CANDIDATE_FILES);
  const maxFileBytes = clampPositiveInteger(
    options.maxFileBytes,
    DEFAULT_MEMORY_CANDIDATE_FILE_BYTES,
    ABSOLUTE_MEMORY_CANDIDATE_FILE_BYTES,
  );
  const maxCandidateBytes = clampPositiveInteger(
    options.maxCandidateBytes,
    DEFAULT_MEMORY_CANDIDATE_BYTES,
    ABSOLUTE_MEMORY_CANDIDATE_BYTES,
  );
  return {
    name: "memory_candidate_reject",
    description: "Mark one pending memory candidate as rejected after review without storing durable memory.",
    inputSchema: memoryCandidateRejectSchema,
    capabilities: ["write", "memory"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const input = parseMemoryCandidateRejectInput(invocation.input);
        return await withMemoryCandidateReviewLock(input.id, async () => {
          const initial = await findMemoryCandidate(rootDir, input.id, maxFiles, maxFileBytes);
          return await withMemoryFileLock(initial.filePath, async () => {
            const current = await findMemoryCandidate(rootDir, input.id, maxFiles, maxFileBytes);
            if (current.record.status !== "pending" && current.record.status !== "promoting") {
              throw new MemoryToolError(`Memory candidate is already ${current.record.status}.`);
            }
            const rejected = await rewriteMemoryCandidate(
              rootDir,
              current.filePath,
              input.id,
              maxFileBytes,
              maxCandidateBytes,
              candidate => {
                const updated: MemoryCandidateRecord = {
                  ...candidate,
                  status: "rejected",
                  reviewedAt: new Date().toISOString(),
                };
                const runId = readInvocationRunId(invocation);
                if (runId !== undefined) {
                  updated.reviewedByRunId = runId;
                }
                if (input.reason !== undefined) {
                  updated.rejectionReason = input.reason;
                }
                delete updated.reservationId;
                delete updated.reservationAt;
                return updated;
              },
              { allowedStatuses: ["pending", "promoting"] },
            );
            return { candidate: rejected };
          });
        });
      });
    },
  };
}
