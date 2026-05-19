import type { DragonAgentRuntime, DragonMessage, DragonThinkingLevel, DragonTurnInput, DragonTurnResult } from "@dragon/core";
import type { ToolDefinition, ToolJsonSchema } from "@dragon/tools";

export interface DragonDelegatedTask {
  id: string;
  title: string;
  prompt: string;
  role?: string;
  dependsOn?: readonly string[];
  metadata?: Record<string, unknown>;
}

export interface DragonDelegationPlan {
  tasks: readonly DragonDelegatedTask[];
}

export type DragonDelegatedTaskStatus = "ok" | "error" | "skipped";

export interface DragonDelegatedTaskResult<TOutput = unknown> {
  taskId: string;
  status: DragonDelegatedTaskStatus;
  output?: TOutput;
  error?: string;
  startedAt?: string;
  completedAt: string;
  skippedBecause?: readonly string[];
}

export interface DragonDelegationRunResult<TOutput = unknown> {
  status: DragonDelegatedTaskStatus;
  results: readonly DragonDelegatedTaskResult<TOutput>[];
}

export interface DragonDelegationRunOptions {
  maxConcurrency?: number;
  signal?: AbortSignal;
}

export type DragonDelegatedTaskExecutor<TOutput = unknown> = (
  task: Readonly<DragonDelegatedTask>,
  context: {
    plan: Readonly<DragonDelegationPlan>;
    completed: ReadonlyMap<string, DragonDelegatedTaskResult<TOutput>>;
    signal?: AbortSignal;
  },
) => Promise<TOutput> | TOutput;

export interface DragonRuntimeDelegatedTaskOutput {
  runId: string;
  status: DragonTurnResult["status"];
  messages: readonly DragonMessage[];
  assistantMessage?: string;
  usage?: DragonTurnResult["usage"];
  error?: string;
}

export interface DragonRuntimeDelegationExecutorOptions {
  runtime: DragonAgentRuntime;
  sessionId: string | ((task: Readonly<DragonDelegatedTask>) => string);
  source?: DragonTurnInput["source"];
  workspace?: string | ((task: Readonly<DragonDelegatedTask>) => string | undefined);
  model?: string | ((task: Readonly<DragonDelegatedTask>) => string | undefined);
  thinking?: DragonThinkingLevel;
  metadata?: Record<string, unknown> | ((task: Readonly<DragonDelegatedTask>) => Record<string, unknown> | undefined);
  includeDependencyResults?: boolean;
  throwOnRuntimeError?: boolean;
}

export interface DragonRuntimeDelegationToolInput {
  tasks: DragonDelegatedTask[];
  maxConcurrency?: number;
  sessionPrefix?: string;
  workspace?: string;
  model?: string;
  includeDependencyResults?: boolean;
  throwOnRuntimeError?: boolean;
}

export interface DragonRuntimeDelegationToolOptions {
  runtime: DragonAgentRuntime | (() => DragonAgentRuntime | undefined);
  defaultSessionPrefix?: string;
  source?: DragonTurnInput["source"];
  defaultWorkspace?: string;
  defaultModel?: string;
  maxTasks?: number;
  maxConcurrency?: number;
}

export type DragonRuntimeDelegationToolOutput = DragonDelegationRunResult<DragonRuntimeDelegatedTaskOutput>;

const MAX_TASKS = 100;
const MAX_CONCURRENCY = 16;
const MAX_DEPENDENCY_OUTPUT_CHARS = 4000;
const DEFAULT_TOOL_MAX_TASKS = 8;
const MAX_DELEGATION_DEPTH = 2;
const ABSOLUTE_TOOL_MAX_TASKS = 32;
const DEFAULT_TOOL_MAX_CONCURRENCY = 3;

const runtimeDelegationToolSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          prompt: { type: "string" },
          role: { type: "string" },
          dependsOn: { type: "array", items: { type: "string" } },
          metadata: { type: "object" },
        },
        required: ["id", "title", "prompt"],
        additionalProperties: false,
      },
    },
    maxConcurrency: { type: "number" },
    sessionPrefix: { type: "string" },
    workspace: { type: "string" },
    model: { type: "string" },
    includeDependencyResults: { type: "boolean" },
    throwOnRuntimeError: { type: "boolean" },
  },
  required: ["tasks"],
  additionalProperties: false,
};

export function createDelegationPlan(tasks: readonly DragonDelegatedTask[]): DragonDelegationPlan {
  if (tasks.length === 0) {
    throw new Error("Delegation plan requires at least one task.");
  }
  if (tasks.length > MAX_TASKS) {
    throw new Error(`Delegation plan can contain at most ${MAX_TASKS} tasks.`);
  }

  const normalized = tasks.map(normalizeTask);
  const ids = new Set<string>();
  for (const task of normalized) {
    if (ids.has(task.id)) {
      throw new Error(`Duplicate delegated task id: ${task.id}`);
    }
    ids.add(task.id);
  }
  for (const task of normalized) {
    for (const dependency of task.dependsOn ?? []) {
      if (!ids.has(dependency)) {
        throw new Error(`Delegated task "${task.id}" depends on unknown task "${dependency}".`);
      }
      if (dependency === task.id) {
        throw new Error(`Delegated task "${task.id}" cannot depend on itself.`);
      }
    }
  }
  assertAcyclic(normalized);
  return Object.freeze({ tasks: Object.freeze(normalized) });
}

export async function runDelegationPlan<TOutput>(
  plan: DragonDelegationPlan,
  executor: DragonDelegatedTaskExecutor<TOutput>,
  options: DragonDelegationRunOptions = {},
): Promise<DragonDelegationRunResult<TOutput>> {
  const normalizedPlan = createDelegationPlan(plan.tasks);
  const maxConcurrency = clampConcurrency(options.maxConcurrency);
  const pending = new Map(normalizedPlan.tasks.map(task => [task.id, task]));
  const running = new Map<string, Promise<void>>();
  const completed = new Map<string, DragonDelegatedTaskResult<TOutput>>();

  while (pending.size > 0 || running.size > 0) {
    throwIfAborted(options.signal);
    let progressed = false;

    for (const task of [...pending.values()]) {
      const failedDependencies = failedDependencyIds(task, completed);
      if (failedDependencies.length > 0) {
        pending.delete(task.id);
        completed.set(task.id, {
          taskId: task.id,
          status: "skipped",
          error: "One or more dependencies did not complete successfully.",
          completedAt: new Date().toISOString(),
          skippedBecause: failedDependencies,
        });
        progressed = true;
        continue;
      }

      if (!dependenciesComplete(task, completed)) {
        continue;
      }
      if (running.size >= maxConcurrency) {
        break;
      }

      pending.delete(task.id);
      const startedAt = new Date().toISOString();
      const promise = Promise.resolve()
        .then(async () => {
          try {
            const output = await executor(Object.freeze({ ...task }), {
              plan: normalizedPlan,
              completed,
              ...(options.signal !== undefined ? { signal: options.signal } : {}),
            });
            completed.set(task.id, {
              taskId: task.id,
              status: "ok",
              output,
              startedAt,
              completedAt: new Date().toISOString(),
            });
          } catch (error) {
            completed.set(task.id, {
              taskId: task.id,
              status: "error",
              error: error instanceof Error ? error.message : String(error),
              startedAt,
              completedAt: new Date().toISOString(),
            });
          } finally {
            running.delete(task.id);
          }
        });
      running.set(task.id, promise);
      progressed = true;
    }

    if (running.size === 0 && !progressed) {
      throw new Error("Delegation plan made no progress.");
    }
    if (running.size > 0) {
      await Promise.race(running.values());
    }
  }

  const orderedResults = normalizedPlan.tasks.map(task => {
    const result = completed.get(task.id);
    if (!result) {
      throw new Error(`Delegated task "${task.id}" did not produce a result.`);
    }
    return result;
  });
  const status = orderedResults.every(result => result.status === "ok")
    ? "ok"
    : orderedResults.some(result => result.status === "error")
      ? "error"
      : "skipped";
  return {
    status,
    results: Object.freeze(orderedResults),
  };
}

export function createRuntimeDelegatedTaskExecutor(
  options: DragonRuntimeDelegationExecutorOptions,
): DragonDelegatedTaskExecutor<DragonRuntimeDelegatedTaskOutput> {
  return async (task, context) => {
    const input = createDelegatedTurnInput(task, context.completed, options, context.signal);
    const result = await options.runtime.runTurn(input);
    if (result.status !== "ok" && options.throwOnRuntimeError !== false) {
      throw new Error(result.error ?? `Delegated runtime task "${task.id}" ended with status ${result.status}.`);
    }
    return toRuntimeDelegatedTaskOutput(result);
  };
}

export function createRuntimeDelegationTool(
  options: DragonRuntimeDelegationToolOptions,
): ToolDefinition<DragonRuntimeDelegationToolInput, DragonRuntimeDelegationToolOutput> {
  const maxTasks = clampToolMaxTasks(options.maxTasks);
  const defaultConcurrency = clampConcurrency(options.maxConcurrency ?? DEFAULT_TOOL_MAX_CONCURRENCY);
  return {
    name: "delegation_run",
    description: "Run a bounded Dragon delegated task plan through the current runtime.",
    inputSchema: runtimeDelegationToolSchema,
    capabilities: ["execute"],
    permission: "allow",
    async invoke(invocation) {
      try {
        const input = parseRuntimeDelegationToolInput(invocation.input);
        if (input.tasks.length > maxTasks) {
          throw new Error(`delegation_run can run at most ${maxTasks} tasks.`);
        }
        const runtime = resolveRuntime(options.runtime);
        if (runtime === undefined) {
          throw new Error("delegation_run runtime is not ready.");
        }
        const parentDepth = readDelegationDepth(invocation.metadata);
        if (parentDepth >= MAX_DELEGATION_DEPTH) {
          throw new Error(`delegation_run cannot nest deeper than ${MAX_DELEGATION_DEPTH} levels.`);
        }
        const plan = createDelegationPlan(input.tasks);
        const sessionPrefix = normalizeText(
          input.sessionPrefix ?? options.defaultSessionPrefix ?? `${invocation.sessionId}:delegate`,
          "runtime delegation sessionPrefix",
          200,
        );
        const workspace = input.workspace ?? options.defaultWorkspace ?? invocation.workspace;
        const model = input.model ?? options.defaultModel;
        const metadata = {
          ...(isRecord(invocation.metadata) ? invocation.metadata : {}),
          parentSessionId: invocation.sessionId,
          parentToolCallId: invocation.id,
          parentToolName: invocation.name,
          ...(typeof invocation.metadata?.runId === "string" ? { parentRunId: invocation.metadata.runId } : {}),
          delegationDepth: parentDepth + 1,
        };
        const executor = createRuntimeDelegatedTaskExecutor({
          runtime,
          sessionId: task => `${sessionPrefix}:${task.id}`,
          source: options.source ?? "api",
          ...(workspace !== undefined ? { workspace } : {}),
          ...(model !== undefined ? { model } : {}),
          metadata,
          ...(input.includeDependencyResults !== undefined ? { includeDependencyResults: input.includeDependencyResults } : {}),
          ...(input.throwOnRuntimeError !== undefined ? { throwOnRuntimeError: input.throwOnRuntimeError } : {}),
        });
        const result = await runDelegationPlan(plan, executor, {
          maxConcurrency: input.maxConcurrency ?? defaultConcurrency,
        });
        return {
          id: invocation.id,
          ok: result.status === "ok",
          output: result,
          ...(result.status !== "ok" ? { error: `Delegation run ended with status ${result.status}.` } : {}),
        };
      } catch (error) {
        return {
          id: invocation.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function normalizeTask(task: DragonDelegatedTask): DragonDelegatedTask {
  const id = normalizeIdentifier(task.id, "task id");
  const title = normalizeText(task.title, "task title", 200);
  const prompt = normalizeText(task.prompt, "task prompt", 16_000);
  const normalized: DragonDelegatedTask = { id, title, prompt };
  if (task.role !== undefined) {
    normalized.role = normalizeText(task.role, "task role", 100);
  }
  if (task.dependsOn !== undefined) {
    normalized.dependsOn = Object.freeze(task.dependsOn.map(value => normalizeIdentifier(value, "dependency id")));
  }
  if (task.metadata !== undefined) {
    if (!isRecord(task.metadata)) {
      throw new Error(`Delegated task "${id}" metadata must be an object.`);
    }
    normalized.metadata = { ...task.metadata };
  }
  return Object.freeze(normalized);
}

function parseRuntimeDelegationToolInput(value: unknown): DragonRuntimeDelegationToolInput {
  if (!isRecord(value)) {
    throw new Error("delegation_run input must be an object.");
  }
  if (!Array.isArray(value.tasks)) {
    throw new Error("delegation_run tasks must be an array.");
  }
  const input: DragonRuntimeDelegationToolInput = {
    tasks: value.tasks.map(readDelegatedTaskInput),
  };
  if (value.maxConcurrency !== undefined) {
    if (typeof value.maxConcurrency !== "number" || !Number.isFinite(value.maxConcurrency)) {
      throw new Error("delegation_run maxConcurrency must be a number.");
    }
    input.maxConcurrency = value.maxConcurrency;
  }
  if (value.sessionPrefix !== undefined) {
    input.sessionPrefix = normalizeText(readString(value.sessionPrefix, "delegation_run sessionPrefix"), "runtime delegation sessionPrefix", 200);
  }
  if (value.workspace !== undefined) {
    input.workspace = normalizeText(readString(value.workspace, "delegation_run workspace"), "runtime delegation workspace", 1000);
  }
  if (value.model !== undefined) {
    input.model = normalizeText(readString(value.model, "delegation_run model"), "runtime delegation model", 200);
  }
  if (value.includeDependencyResults !== undefined) {
    if (typeof value.includeDependencyResults !== "boolean") {
      throw new Error("delegation_run includeDependencyResults must be a boolean.");
    }
    input.includeDependencyResults = value.includeDependencyResults;
  }
  if (value.throwOnRuntimeError !== undefined) {
    if (typeof value.throwOnRuntimeError !== "boolean") {
      throw new Error("delegation_run throwOnRuntimeError must be a boolean.");
    }
    input.throwOnRuntimeError = value.throwOnRuntimeError;
  }
  return input;
}

function readDelegatedTaskInput(value: unknown): DragonDelegatedTask {
  if (!isRecord(value)) {
    throw new Error("delegation_run task entries must be objects.");
  }
  const task: DragonDelegatedTask = {
    id: readString(value.id, "delegation_run task id"),
    title: readString(value.title, "delegation_run task title"),
    prompt: readString(value.prompt, "delegation_run task prompt"),
  };
  if (value.role !== undefined) {
    task.role = readString(value.role, "delegation_run task role");
  }
  if (value.dependsOn !== undefined) {
    if (!Array.isArray(value.dependsOn)) {
      throw new Error("delegation_run task dependsOn must be an array.");
    }
    task.dependsOn = value.dependsOn.map(item => readString(item, "delegation_run task dependency"));
  }
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) {
      throw new Error("delegation_run task metadata must be an object.");
    }
    task.metadata = { ...value.metadata };
  }
  return task;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function readDelegationDepth(metadata: Record<string, unknown> | undefined): number {
  const depth = metadata?.delegationDepth;
  if (typeof depth !== "number" || !Number.isFinite(depth) || depth < 0) {
    return 0;
  }
  return Math.floor(depth);
}

function resolveRuntime(runtime: DragonRuntimeDelegationToolOptions["runtime"]): DragonAgentRuntime | undefined {
  return typeof runtime === "function" ? runtime() : runtime;
}

function clampToolMaxTasks(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_TOOL_MAX_TASKS;
  }
  return Math.min(ABSOLUTE_TOOL_MAX_TASKS, Math.max(1, Math.floor(value)));
}

function createDelegatedTurnInput<TOutput>(
  task: Readonly<DragonDelegatedTask>,
  completed: ReadonlyMap<string, DragonDelegatedTaskResult<TOutput>>,
  options: DragonRuntimeDelegationExecutorOptions,
  signal: AbortSignal | undefined,
): DragonTurnInput {
  const sessionId = typeof options.sessionId === "function" ? options.sessionId(task) : options.sessionId;
  const workspace = typeof options.workspace === "function" ? options.workspace(task) : options.workspace;
  const model = typeof options.model === "function" ? options.model(task) : options.model;
  const metadata = typeof options.metadata === "function" ? options.metadata(task) : options.metadata;
  const input: DragonTurnInput = {
    sessionId: normalizeText(sessionId, "runtime delegation sessionId", 200),
    source: options.source ?? "api",
    message: formatDelegatedTaskPrompt(task, completed, options.includeDependencyResults !== false),
    metadata: {
      ...(metadata ?? {}),
      ...(task.metadata ?? {}),
      delegationTaskId: task.id,
      delegationTaskTitle: task.title,
      ...(task.role !== undefined ? { delegationTaskRole: task.role } : {}),
      ...(task.dependsOn !== undefined ? { delegationDependsOn: [...task.dependsOn] } : {}),
    },
    ...(workspace !== undefined ? { workspace: normalizeText(workspace, "runtime delegation workspace", 1000) } : {}),
    ...(model !== undefined ? { model: normalizeText(model, "runtime delegation model", 200) } : {}),
    ...(options.thinking !== undefined ? { thinking: options.thinking } : {}),
    ...(signal !== undefined ? { signal } : {}),
  };
  return input;
}

function formatDelegatedTaskPrompt<TOutput>(
  task: Readonly<DragonDelegatedTask>,
  completed: ReadonlyMap<string, DragonDelegatedTaskResult<TOutput>>,
  includeDependencyResults: boolean,
): string {
  const sections = [
    `Delegated task: ${task.title}`,
    task.role !== undefined ? `Role: ${task.role}` : undefined,
    task.prompt,
  ];
  if (includeDependencyResults) {
    const dependencyContext = formatDependencyContext(task, completed);
    if (dependencyContext !== undefined) {
      sections.push(dependencyContext);
    }
  }
  return sections.filter((section): section is string => section !== undefined && section.trim().length > 0).join("\n\n");
}

function formatDependencyContext<TOutput>(
  task: Readonly<DragonDelegatedTask>,
  completed: ReadonlyMap<string, DragonDelegatedTaskResult<TOutput>>,
): string | undefined {
  const dependencies = task.dependsOn ?? [];
  if (dependencies.length === 0) {
    return undefined;
  }
  const lines: string[] = ["Dependency results:"];
  for (const dependencyId of dependencies) {
    const result = completed.get(dependencyId);
    if (result === undefined) {
      continue;
    }
    lines.push(`- ${dependencyId}: ${result.status}`);
    if (result.output !== undefined) {
      lines.push(indentLines(boundText(formatOutput(result.output), MAX_DEPENDENCY_OUTPUT_CHARS)));
    }
    if (result.error !== undefined) {
      lines.push(indentLines(boundText(result.error, MAX_DEPENDENCY_OUTPUT_CHARS)));
    }
  }
  return lines.length > 1 ? lines.join("\n") : undefined;
}

function toRuntimeDelegatedTaskOutput(result: DragonTurnResult): DragonRuntimeDelegatedTaskOutput {
  const assistantMessage = [...result.messages].reverse().find(message => message.role === "assistant")?.content;
  return {
    runId: result.runId,
    status: result.status,
    messages: result.messages,
    ...(assistantMessage !== undefined ? { assistantMessage } : {}),
    ...(result.usage !== undefined ? { usage: result.usage } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
}

function formatOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value) && typeof value.assistantMessage === "string") {
    return value.assistantMessage;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function boundText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}... [truncated]` : value;
}

function indentLines(value: string): string {
  return value.split(/\r?\n/).map(line => `  ${line}`).join("\n");
}

function assertAcyclic(tasks: readonly DragonDelegatedTask[]): void {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (taskId: string): void => {
    if (visited.has(taskId)) {
      return;
    }
    if (visiting.has(taskId)) {
      throw new Error(`Delegation plan contains a dependency cycle at "${taskId}".`);
    }
    visiting.add(taskId);
    const task = byId.get(taskId);
    for (const dependency of task?.dependsOn ?? []) {
      visit(dependency);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  };

  for (const task of tasks) {
    visit(task.id);
  }
}

function dependenciesComplete<TOutput>(
  task: DragonDelegatedTask,
  completed: ReadonlyMap<string, DragonDelegatedTaskResult<TOutput>>,
): boolean {
  return (task.dependsOn ?? []).every(dependency => completed.get(dependency)?.status === "ok");
}

function failedDependencyIds<TOutput>(
  task: DragonDelegatedTask,
  completed: ReadonlyMap<string, DragonDelegatedTaskResult<TOutput>>,
): string[] {
  return (task.dependsOn ?? []).filter(dependency => {
    const result = completed.get(dependency);
    return result !== undefined && result.status !== "ok";
  });
}

function clampConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 4;
  }
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(value)));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Delegation run was aborted.");
  }
}

function normalizeIdentifier(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Delegated ${label} cannot be empty.`);
  }
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(trimmed)) {
    throw new Error(`Delegated ${label} contains unsupported characters.`);
  }
  return trimmed;
}

function normalizeText(value: string, label: string, maxChars: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Delegated ${label} cannot be empty.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxChars) {
    throw new Error(`Delegated ${label} must be ${maxChars} characters or fewer.`);
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
