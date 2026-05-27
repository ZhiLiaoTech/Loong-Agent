import type { ToolDefinition, ToolJsonSchema } from "@dragon/tools";
import { FileTrajectoryStore } from "./file-trajectory-store.js";
import { isTurnStatus } from "./file-session-store.js";
import { MemoryToolError } from "./memory-tool-error.js";
import { safelyInvokeMemoryTool } from "./memory-tool-invoke.js";
import { normalizeOptionalText, normalizeRunId, shiftDate, summarizeText } from "./memory-text.js";
import { clampPositiveInteger, isObject } from "./memory-util.js";
import { normalizeTrajectoryListFilter } from "./file-trajectory-store.js";
import type {
  TrajectoryGetInput,
  TrajectoryGetOutput,
  TrajectoryListFilter,
  TrajectoryListInput,
  TrajectoryListOutput,
  TrajectoryStore,
} from "./trajectory-types.js";

const DEFAULT_TRAJECTORY_GET_MAX_EVENTS = 200;
const ABSOLUTE_TRAJECTORY_GET_MAX_EVENTS = 2000;
const DEFAULT_TRAJECTORY_TOOL_DATE_WINDOW_DAYS = 30;

const trajectoryListSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ok", "error", "cancelled", "timeout"] },
    dateFrom: { type: "string" },
    dateTo: { type: "string" },
    limit: { type: "number" },
  },
  additionalProperties: false,
};

const trajectoryGetSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    runId: { type: "string" },
    maxEvents: { type: "number" },
  },
  required: ["runId"],
  additionalProperties: false,
};

export function createTrajectoryTools(store: TrajectoryStore): ToolDefinition[] {
  const toolStore = limitTrajectoryStoreForTools(store);
  return [
    createTrajectoryListTool(toolStore),
    createTrajectoryGetTool(toolStore),
  ];
}

export function createTrajectoryListTool(store: TrajectoryStore): ToolDefinition<TrajectoryListInput, TrajectoryListOutput> {
  return {
    name: "trajectory_list",
    description: "List recent Dragon trajectory records as bounded summaries for review or debugging.",
    inputSchema: trajectoryListSchema,
    capabilities: ["read", "memory"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const input = withInvocationSession(parseTrajectoryListInput(invocation.input), invocation.sessionId);
        return await store.list(input);
      });
    },
  };
}

export function createTrajectoryGetTool(store: TrajectoryStore): ToolDefinition<TrajectoryGetInput, TrajectoryGetOutput> {
  return {
    name: "trajectory_get",
    description: "Load one Dragon trajectory record by runId, optionally limiting returned events.",
    inputSchema: trajectoryGetSchema,
    capabilities: ["read", "memory"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const input = parseTrajectoryGetInput(invocation.input);
        const sessionId = normalizeOptionalText(invocation.sessionId, "sessionId", 200);
        const record = await store.get(input.runId, { sessionId });
        if (!record) {
          throw new MemoryToolError(`Trajectory not found: ${summarizeText(input.runId, 80)}`);
        }
        const maxEvents = clampPositiveInteger(
          input.maxEvents,
          DEFAULT_TRAJECTORY_GET_MAX_EVENTS,
          ABSOLUTE_TRAJECTORY_GET_MAX_EVENTS,
        );
        const eventsTruncated = record.events.length > maxEvents;
        return {
          record: eventsTruncated
            ? { ...record, events: record.events.slice(-maxEvents) }
            : record,
          eventsTruncated,
        };
      });
    },
  };
}

function limitTrajectoryStoreForTools(store: TrajectoryStore): TrajectoryStore {
  if (store instanceof FileTrajectoryStore) {
    return store.forToolQueries();
  }
  return store;
}

function parseTrajectoryListInput(input: unknown): TrajectoryListInput {
  if (input === undefined || input === null) {
    return {};
  }
  if (!isObject(input)) {
    throw new MemoryToolError("trajectory_list input must be an object.");
  }
  const filter: TrajectoryListFilter = {};
  if (typeof input.sessionId === "string" && input.sessionId.trim()) {
    throw new MemoryToolError("trajectory_list cannot override the current session.");
  }
  if (input.status !== undefined) {
    if (!isTurnStatus(input.status)) {
      throw new MemoryToolError("trajectory_list status is invalid.");
    }
    filter.status = input.status;
  }
  if (typeof input.dateFrom === "string" && input.dateFrom.trim()) {
    filter.dateFrom = input.dateFrom.trim();
  }
  if (typeof input.dateTo === "string" && input.dateTo.trim()) {
    filter.dateTo = input.dateTo.trim();
  }
  if (typeof input.limit === "number") {
    filter.limit = Math.max(1, Math.floor(input.limit));
  }
  return normalizeTrajectoryListFilter(filter);
}

function withInvocationSession(
  filter: TrajectoryListFilter,
  sessionId: string,
): TrajectoryListFilter {
  const normalizedSessionId = normalizeOptionalText(sessionId, "sessionId", 200);
  const today = new Date().toISOString().slice(0, 10);
  const defaultDateFrom = shiftDate(today, -DEFAULT_TRAJECTORY_TOOL_DATE_WINDOW_DAYS);
  return normalizeTrajectoryListFilter({
    ...filter,
    sessionId: normalizedSessionId,
    dateFrom: filter.dateFrom ?? defaultDateFrom,
    dateTo: filter.dateTo ?? today,
  });
}

function parseTrajectoryGetInput(input: unknown): TrajectoryGetInput {
  if (!isObject(input) || typeof input.runId !== "string" || !input.runId.trim()) {
    throw new MemoryToolError("trajectory_get requires a non-empty runId.");
  }
  return {
    runId: normalizeRunId(input.runId),
    ...(typeof input.maxEvents === "number" ? { maxEvents: Math.max(1, Math.floor(input.maxEvents)) } : {}),
  };
}
