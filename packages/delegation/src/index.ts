import type { LoongAgentRuntime, LoongMessage, LoongThinkingLevel, LoongTurnInput, LoongTurnResult } from "@loong/core";
import type { ToolDefinition, ToolJsonSchema } from "@loong/tools";

export interface LoongDelegatedTask {
  id: string;
  title: string;
  prompt: string;
  role?: string;
  dependsOn?: readonly string[];
  type?: string;
  requiredRole?: string;
  requiredCapabilities?: readonly string[];
  risk?: LoongDelegatedTaskRisk;
  priority?: number;
  expectedDurationMs?: number;
  estimatedCostUsd?: number;
  uncertainty?: number;
  deadline?: string;
  approvalRequired?: boolean;
  artifact?: LoongDelegatedTaskArtifact;
  metadata?: Record<string, unknown>;
}

export interface LoongDelegationPlan {
  tasks: readonly LoongDelegatedTask[];
}

export type LoongDelegatedTaskRisk = "low" | "medium" | "high" | "critical";

export interface LoongDelegatedTaskArtifact {
  type: string;
  id?: string;
  path?: string;
}

export type LoongDelegatedTaskStatus = "ok" | "error" | "skipped";

export interface LoongDelegationTaskSchedule {
  priority: number;
  reason: string;
  readyAt: string;
}

export interface LoongDelegatedTaskResult<TOutput = unknown> {
  taskId: string;
  status: LoongDelegatedTaskStatus;
  output?: TOutput;
  error?: string;
  startedAt?: string;
  completedAt: string;
  schedule?: LoongDelegationTaskSchedule;
  skippedBecause?: readonly string[];
}

export interface LoongDelegationRunResult<TOutput = unknown> {
  status: LoongDelegatedTaskStatus;
  results: readonly LoongDelegatedTaskResult<TOutput>[];
}

export interface LoongDelegationRunOptions {
  maxConcurrency?: number;
  signal?: AbortSignal;
  scheduler?: LoongDelegationSchedulerMode | LoongDelegationScheduler;
  priorityWeights?: Partial<LoongDelegationPriorityWeights>;
  /**
   * Per-task timeout in milliseconds. When exceeded, the task's signal is
   * aborted and the task is recorded as an error (not a hang).
   */
  taskTimeoutMs?: number;
}

export type LoongDelegationSchedulerMode = "fifo" | "governance-aware";

export interface LoongDelegationPriorityWeights {
  explicitPriority: number;
  criticalPathMs: number;
  downstreamImpact: number;
  risk: number;
  uncertainty: number;
  approvalRequired: number;
  deadlineUrgency: number;
  estimatedCostUsd: number;
}

export type LoongDelegationScheduler = (
  readyTasks: readonly LoongDelegatedTask[],
  context: LoongDelegationSchedulerContext,
) => readonly LoongDelegatedTask[];

export interface LoongDelegationSchedulerContext {
  plan: Readonly<LoongDelegationPlan>;
  completed: ReadonlyMap<string, LoongDelegatedTaskResult<unknown>>;
  runningTaskIds: ReadonlySet<string>;
  nowMs: number;
  priorityWeights: LoongDelegationPriorityWeights;
}

export type LoongDelegatedTaskExecutor<TOutput = unknown> = (
  task: Readonly<LoongDelegatedTask>,
  context: {
    plan: Readonly<LoongDelegationPlan>;
    completed: ReadonlyMap<string, LoongDelegatedTaskResult<TOutput>>;
    signal?: AbortSignal;
  },
) => Promise<TOutput> | TOutput;

export interface LoongRuntimeDelegatedTaskOutput {
  runId: string;
  status: LoongTurnResult["status"];
  messages: readonly LoongMessage[];
  assistantMessage?: string;
  usage?: LoongTurnResult["usage"];
  error?: string;
}

export interface LoongRuntimeDelegationExecutorOptions {
  runtime: LoongAgentRuntime;
  sessionId: string | ((task: Readonly<LoongDelegatedTask>) => string);
  source?: LoongTurnInput["source"];
  workspace?: string | ((task: Readonly<LoongDelegatedTask>) => string | undefined);
  model?: string | ((task: Readonly<LoongDelegatedTask>) => string | undefined);
  thinking?: LoongThinkingLevel;
  metadata?: Record<string, unknown> | ((task: Readonly<LoongDelegatedTask>) => Record<string, unknown> | undefined);
  includeDependencyResults?: boolean;
  throwOnRuntimeError?: boolean;
}

export interface LoongRuntimeDelegationToolInput {
  tasks: LoongDelegatedTask[];
  maxConcurrency?: number;
  scheduler?: LoongDelegationSchedulerMode;
  sessionPrefix?: string;
  workspace?: string;
  model?: string;
  includeDependencyResults?: boolean;
  throwOnRuntimeError?: boolean;
}

export interface LoongRuntimeDelegationToolOptions {
  runtime: LoongAgentRuntime | (() => LoongAgentRuntime | undefined);
  defaultSessionPrefix?: string;
  source?: LoongTurnInput["source"];
  defaultWorkspace?: string;
  defaultModel?: string;
  maxTasks?: number;
  maxConcurrency?: number;
  /** Per-task timeout for delegation_run. Default 5 minutes. */
  taskTimeoutMs?: number;
}

export type LoongRuntimeDelegationToolOutput = LoongDelegationRunResult<LoongRuntimeDelegatedTaskOutput>;

const MAX_TASKS = 100;
const MAX_CONCURRENCY = 16;
const MAX_DEPENDENCY_OUTPUT_CHARS = 4000;
const DEFAULT_TOOL_MAX_TASKS = 8;
const MAX_DELEGATION_DEPTH = 2;
const DEFAULT_RUNTIME_TASK_TIMEOUT_MS = 5 * 60 * 1000;
const ABSOLUTE_TOOL_MAX_TASKS = 32;
const DEFAULT_TOOL_MAX_CONCURRENCY = 3;

const DEFAULT_PRIORITY_WEIGHTS: LoongDelegationPriorityWeights = {
  explicitPriority: 100,
  criticalPathMs: 1 / 1000,
  downstreamImpact: 4,
  risk: 8,
  uncertainty: 6,
  approvalRequired: 5,
  deadlineUrgency: 10,
  estimatedCostUsd: -2,
};

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
          type: { type: "string" },
          requiredRole: { type: "string" },
          requiredCapabilities: { type: "array", items: { type: "string" } },
          risk: { type: "string" },
          priority: { type: "number" },
          expectedDurationMs: { type: "number" },
          estimatedCostUsd: { type: "number" },
          uncertainty: { type: "number" },
          deadline: { type: "string" },
          approvalRequired: { type: "boolean" },
          artifact: {
            type: "object",
            properties: {
              type: { type: "string" },
              id: { type: "string" },
              path: { type: "string" },
            },
            required: ["type"],
            additionalProperties: false,
          },
          dependsOn: { type: "array", items: { type: "string" } },
          metadata: { type: "object" },
        },
        required: ["id", "title", "prompt"],
        additionalProperties: false,
      },
    },
    maxConcurrency: { type: "number" },
    scheduler: { type: "string" },
    sessionPrefix: { type: "string" },
    workspace: { type: "string" },
    model: { type: "string" },
    includeDependencyResults: { type: "boolean" },
    throwOnRuntimeError: { type: "boolean" },
  },
  required: ["tasks"],
  additionalProperties: false,
};

export function createDelegationPlan(tasks: readonly LoongDelegatedTask[]): LoongDelegationPlan {
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
  plan: LoongDelegationPlan,
  executor: LoongDelegatedTaskExecutor<TOutput>,
  options: LoongDelegationRunOptions = {},
): Promise<LoongDelegationRunResult<TOutput>> {
  const normalizedPlan = createDelegationPlan(plan.tasks);
  const maxConcurrency = clampConcurrency(options.maxConcurrency);
  const priorityWeights = normalizePriorityWeights(options.priorityWeights);
  const scheduler = resolveDelegationScheduler(options.scheduler);
  const pending = new Map(normalizedPlan.tasks.map(task => [task.id, task]));
  const running = new Map<string, Promise<void>>();
  const completed = new Map<string, LoongDelegatedTaskResult<TOutput>>();

  while (pending.size > 0 || running.size > 0) {
    throwIfAborted(options.signal);
    let progressed = false;

    const ready: LoongDelegatedTask[] = [];
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
      ready.push(task);
    }

    const sortedReady = scheduler(ready, {
      plan: normalizedPlan,
      completed: completed as ReadonlyMap<string, LoongDelegatedTaskResult<unknown>>,
      runningTaskIds: new Set(running.keys()),
      nowMs: Date.now(),
      priorityWeights,
    });

    for (const task of sortedReady) {
      if (running.size >= maxConcurrency) {
        break;
      }

      pending.delete(task.id);
      const startedAt = new Date().toISOString();
      const schedule = scoreDelegatedTask(task, normalizedPlan, priorityWeights, Date.now());
      const promise = Promise.resolve()
        .then(async () => {
          // Per-task abort controller wired into the parent signal AND a
          // timeout so a stuck task cannot starve the rest of the plan.
          const controller = new AbortController();
          const parentAbort = (): void => controller.abort(options.signal?.reason);
          if (options.signal !== undefined) {
            if (options.signal.aborted) {
              controller.abort(options.signal.reason);
            } else {
              options.signal.addEventListener("abort", parentAbort, { once: true });
            }
          }
          let timeoutHandle: NodeJS.Timeout | undefined;
          let timedOut = false;
          if (typeof options.taskTimeoutMs === "number" && options.taskTimeoutMs > 0) {
            timeoutHandle = setTimeout(() => {
              timedOut = true;
              controller.abort(new Error(`Delegated task "${task.id}" timed out after ${options.taskTimeoutMs}ms.`));
            }, options.taskTimeoutMs);
          }
          try {
            const output = await executor(Object.freeze({ ...task }), {
              plan: normalizedPlan,
              completed,
              signal: controller.signal,
            });
            completed.set(task.id, {
              taskId: task.id,
              status: "ok",
              output,
              startedAt,
              completedAt: new Date().toISOString(),
              schedule,
            });
          } catch (error) {
            const message = timedOut
              ? `Delegated task "${task.id}" timed out after ${options.taskTimeoutMs}ms.`
              : error instanceof Error ? error.message : String(error);
            completed.set(task.id, {
              taskId: task.id,
              status: "error",
              error: message,
              startedAt,
              completedAt: new Date().toISOString(),
              schedule,
            });
          } finally {
            if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
            if (options.signal !== undefined) {
              options.signal.removeEventListener("abort", parentAbort);
            }
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
  options: LoongRuntimeDelegationExecutorOptions,
): LoongDelegatedTaskExecutor<LoongRuntimeDelegatedTaskOutput> {
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
  options: LoongRuntimeDelegationToolOptions,
): ToolDefinition<LoongRuntimeDelegationToolInput, LoongRuntimeDelegationToolOutput> {
  const maxTasks = clampToolMaxTasks(options.maxTasks);
  const defaultConcurrency = clampConcurrency(options.maxConcurrency ?? DEFAULT_TOOL_MAX_CONCURRENCY);
  return {
    name: "delegation_run",
    description: "Run a bounded Loong delegated task plan through the current runtime.",
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
        const runOptions: LoongDelegationRunOptions = {
          maxConcurrency: input.maxConcurrency ?? defaultConcurrency,
          taskTimeoutMs: options.taskTimeoutMs ?? DEFAULT_RUNTIME_TASK_TIMEOUT_MS,
          ...(input.scheduler !== undefined ? { scheduler: input.scheduler } : {}),
        };
        const result = await runDelegationPlan(plan, executor, runOptions);
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

function normalizeTask(task: LoongDelegatedTask): LoongDelegatedTask {
  const id = normalizeIdentifier(task.id, "task id");
  const title = normalizeText(task.title, "task title", 200);
  const prompt = normalizeText(task.prompt, "task prompt", 16_000);
  const normalized: LoongDelegatedTask = { id, title, prompt };
  if (task.role !== undefined) {
    normalized.role = normalizeText(task.role, "task role", 100);
  }
  if (task.type !== undefined) {
    normalized.type = normalizeText(task.type, "task type", 100);
  }
  if (task.requiredRole !== undefined) {
    normalized.requiredRole = normalizeText(task.requiredRole, "task requiredRole", 100);
  }
  if (task.requiredCapabilities !== undefined) {
    normalized.requiredCapabilities = Object.freeze(task.requiredCapabilities.map(value => normalizeText(value, "task required capability", 100)));
  }
  if (task.risk !== undefined) {
    normalized.risk = normalizeRisk(task.risk, id);
  }
  if (task.priority !== undefined) {
    normalized.priority = normalizeFiniteNumber(task.priority, "task priority");
  }
  if (task.expectedDurationMs !== undefined) {
    normalized.expectedDurationMs = Math.max(0, Math.floor(normalizeFiniteNumber(task.expectedDurationMs, "task expectedDurationMs")));
  }
  if (task.estimatedCostUsd !== undefined) {
    normalized.estimatedCostUsd = Math.max(0, normalizeFiniteNumber(task.estimatedCostUsd, "task estimatedCostUsd"));
  }
  if (task.uncertainty !== undefined) {
    normalized.uncertainty = clamp01(normalizeFiniteNumber(task.uncertainty, "task uncertainty"));
  }
  if (task.deadline !== undefined) {
    normalized.deadline = normalizeText(task.deadline, "task deadline", 100);
  }
  if (task.approvalRequired !== undefined) {
    normalized.approvalRequired = Boolean(task.approvalRequired);
  }
  if (task.artifact !== undefined) {
    normalized.artifact = normalizeArtifact(task.artifact, id);
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

function parseRuntimeDelegationToolInput(value: unknown): LoongRuntimeDelegationToolInput {
  if (!isRecord(value)) {
    throw new Error("delegation_run input must be an object.");
  }
  if (!Array.isArray(value.tasks)) {
    throw new Error("delegation_run tasks must be an array.");
  }
  const input: LoongRuntimeDelegationToolInput = {
    tasks: value.tasks.map(readDelegatedTaskInput),
  };
  if (value.maxConcurrency !== undefined) {
    if (typeof value.maxConcurrency !== "number" || !Number.isFinite(value.maxConcurrency)) {
      throw new Error("delegation_run maxConcurrency must be a number.");
    }
    input.maxConcurrency = value.maxConcurrency;
  }
  if (value.scheduler !== undefined) {
    if (value.scheduler !== "fifo" && value.scheduler !== "governance-aware") {
      throw new Error("delegation_run scheduler must be fifo or governance-aware.");
    }
    input.scheduler = value.scheduler;
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

function readDelegatedTaskInput(value: unknown): LoongDelegatedTask {
  if (!isRecord(value)) {
    throw new Error("delegation_run task entries must be objects.");
  }
  const task: LoongDelegatedTask = {
    id: readString(value.id, "delegation_run task id"),
    title: readString(value.title, "delegation_run task title"),
    prompt: readString(value.prompt, "delegation_run task prompt"),
  };
  if (value.role !== undefined) {
    task.role = readString(value.role, "delegation_run task role");
  }
  if (value.type !== undefined) task.type = readString(value.type, "delegation_run task type");
  if (value.requiredRole !== undefined) task.requiredRole = readString(value.requiredRole, "delegation_run task requiredRole");
  if (value.requiredCapabilities !== undefined) {
    if (!Array.isArray(value.requiredCapabilities)) {
      throw new Error("delegation_run task requiredCapabilities must be an array.");
    }
    task.requiredCapabilities = value.requiredCapabilities.map(item => readString(item, "delegation_run task required capability"));
  }
  if (value.risk !== undefined) task.risk = readString(value.risk, "delegation_run task risk") as LoongDelegatedTaskRisk;
  if (value.priority !== undefined) task.priority = readNumber(value.priority, "delegation_run task priority");
  if (value.expectedDurationMs !== undefined) task.expectedDurationMs = readNumber(value.expectedDurationMs, "delegation_run task expectedDurationMs");
  if (value.estimatedCostUsd !== undefined) task.estimatedCostUsd = readNumber(value.estimatedCostUsd, "delegation_run task estimatedCostUsd");
  if (value.uncertainty !== undefined) task.uncertainty = readNumber(value.uncertainty, "delegation_run task uncertainty");
  if (value.deadline !== undefined) task.deadline = readString(value.deadline, "delegation_run task deadline");
  if (value.approvalRequired !== undefined) {
    if (typeof value.approvalRequired !== "boolean") {
      throw new Error("delegation_run task approvalRequired must be a boolean.");
    }
    task.approvalRequired = value.approvalRequired;
  }
  if (value.artifact !== undefined) {
    if (!isRecord(value.artifact)) {
      throw new Error("delegation_run task artifact must be an object.");
    }
    task.artifact = readArtifactInput(value.artifact);
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

export function scoreDelegatedTask(
  task: Readonly<LoongDelegatedTask>,
  plan: Readonly<LoongDelegationPlan>,
  weights: Partial<LoongDelegationPriorityWeights> = {},
  nowMs = Date.now(),
): LoongDelegationTaskSchedule {
  const merged = normalizePriorityWeights(weights);
  const criticalPathMs = computeCriticalPathMs(task.id, plan);
  const descendants = countDescendants(task.id, plan);
  const risk = riskRank(task.risk);
  const uncertainty = task.uncertainty ?? 0;
  const deadlineUrgency = computeDeadlineUrgency(task.deadline, nowMs);
  const priority =
    (task.priority ?? 0) * merged.explicitPriority
    + criticalPathMs * merged.criticalPathMs
    + descendants * merged.downstreamImpact
    + risk * merged.risk
    + uncertainty * merged.uncertainty
    + (task.approvalRequired ? merged.approvalRequired : 0)
    + deadlineUrgency * merged.deadlineUrgency
    + (task.estimatedCostUsd ?? 0) * merged.estimatedCostUsd;
  const reason = [
    `criticalPathMs=${criticalPathMs}`,
    `downstream=${descendants}`,
    `risk=${task.risk ?? "low"}`,
    `uncertainty=${uncertainty}`,
    task.approvalRequired ? "approvalRequired" : undefined,
    deadlineUrgency > 0 ? `deadlineUrgency=${deadlineUrgency.toFixed(3)}` : undefined,
    task.priority !== undefined ? `explicitPriority=${task.priority}` : undefined,
  ].filter((entry): entry is string => entry !== undefined).join("; ");
  return { priority, reason, readyAt: new Date(nowMs).toISOString() };
}

export function governanceAwareScheduler(
  readyTasks: readonly LoongDelegatedTask[],
  context: LoongDelegationSchedulerContext,
): readonly LoongDelegatedTask[] {
  return [...readyTasks].sort((left, right) => {
    const leftScore = scoreDelegatedTask(left, context.plan, context.priorityWeights, context.nowMs).priority;
    const rightScore = scoreDelegatedTask(right, context.plan, context.priorityWeights, context.nowMs).priority;
    if (rightScore !== leftScore) return rightScore - leftScore;
    return context.plan.tasks.findIndex(task => task.id === left.id)
      - context.plan.tasks.findIndex(task => task.id === right.id);
  });
}

export function computeCriticalPathMs(taskId: string, plan: Readonly<LoongDelegationPlan>): number {
  const byId = new Map(plan.tasks.map(task => [task.id, task]));
  const memo = new Map<string, number>();
  function visit(id: string): number {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const task = byId.get(id);
    if (!task) return 0;
    const children = plan.tasks.filter(candidate => (candidate.dependsOn ?? []).includes(id));
    const own = task.expectedDurationMs ?? 1000;
    const childPath = children.length > 0 ? Math.max(...children.map(child => visit(child.id))) : 0;
    const value = own + childPath;
    memo.set(id, value);
    return value;
  }
  return visit(taskId);
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function readNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number.`);
  }
  return value;
}

function readArtifactInput(value: Record<string, unknown>): LoongDelegatedTaskArtifact {
  return {
    type: readString(value.type, "delegation_run task artifact type"),
    ...(value.id !== undefined ? { id: readString(value.id, "delegation_run task artifact id") } : {}),
    ...(value.path !== undefined ? { path: readString(value.path, "delegation_run task artifact path") } : {}),
  };
}

function readDelegationDepth(metadata: Record<string, unknown> | undefined): number {
  const depth = metadata?.delegationDepth;
  if (typeof depth !== "number" || !Number.isFinite(depth) || depth < 0) {
    return 0;
  }
  return Math.floor(depth);
}

function resolveRuntime(runtime: LoongRuntimeDelegationToolOptions["runtime"]): LoongAgentRuntime | undefined {
  return typeof runtime === "function" ? runtime() : runtime;
}

function clampToolMaxTasks(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_TOOL_MAX_TASKS;
  }
  return Math.min(ABSOLUTE_TOOL_MAX_TASKS, Math.max(1, Math.floor(value)));
}

function createDelegatedTurnInput<TOutput>(
  task: Readonly<LoongDelegatedTask>,
  completed: ReadonlyMap<string, LoongDelegatedTaskResult<TOutput>>,
  options: LoongRuntimeDelegationExecutorOptions,
  signal: AbortSignal | undefined,
): LoongTurnInput {
  const sessionId = typeof options.sessionId === "function" ? options.sessionId(task) : options.sessionId;
  const workspace = typeof options.workspace === "function" ? options.workspace(task) : options.workspace;
  const model = typeof options.model === "function" ? options.model(task) : options.model;
  const metadata = typeof options.metadata === "function" ? options.metadata(task) : options.metadata;
  const input: LoongTurnInput = {
    sessionId: normalizeText(sessionId, "runtime delegation sessionId", 200),
    source: options.source ?? "api",
    message: formatDelegatedTaskPrompt(task, completed, options.includeDependencyResults !== false),
    metadata: {
      ...(metadata ?? {}),
      ...(task.metadata ?? {}),
      delegationTaskId: task.id,
      delegationTaskTitle: task.title,
      ...(task.role !== undefined ? { delegationTaskRole: task.role } : {}),
      ...(task.type !== undefined ? { delegationTaskType: task.type } : {}),
      ...(task.requiredRole !== undefined ? { delegationRequiredRole: task.requiredRole } : {}),
      ...(task.requiredCapabilities !== undefined ? { delegationRequiredCapabilities: [...task.requiredCapabilities] } : {}),
      ...(task.risk !== undefined ? { delegationTaskRisk: task.risk } : {}),
      ...(task.priority !== undefined ? { delegationTaskPriority: task.priority } : {}),
      ...(task.expectedDurationMs !== undefined ? { delegationExpectedDurationMs: task.expectedDurationMs } : {}),
      ...(task.estimatedCostUsd !== undefined ? { delegationEstimatedCostUsd: task.estimatedCostUsd } : {}),
      ...(task.uncertainty !== undefined ? { delegationTaskUncertainty: task.uncertainty } : {}),
      ...(task.deadline !== undefined ? { delegationTaskDeadline: task.deadline } : {}),
      ...(task.approvalRequired !== undefined ? { delegationApprovalRequired: task.approvalRequired } : {}),
      ...(task.artifact !== undefined ? { delegationArtifact: task.artifact } : {}),
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
  task: Readonly<LoongDelegatedTask>,
  completed: ReadonlyMap<string, LoongDelegatedTaskResult<TOutput>>,
  includeDependencyResults: boolean,
): string {
  const sections = [
    `Delegated task: ${task.title}`,
    task.role !== undefined ? `Role: ${task.role}` : undefined,
    task.type !== undefined ? `Task type: ${task.type}` : undefined,
    task.requiredCapabilities?.length ? `Required capabilities: ${task.requiredCapabilities.join(", ")}` : undefined,
    task.risk !== undefined ? `Risk: ${task.risk}` : undefined,
    task.artifact !== undefined ? `Artifact: ${formatOutput(task.artifact)}` : undefined,
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

function resolveDelegationScheduler(value: LoongDelegationRunOptions["scheduler"]): LoongDelegationScheduler {
  if (typeof value === "function") return value;
  if (value === "fifo") {
    return readyTasks => readyTasks;
  }
  return governanceAwareScheduler;
}

function normalizePriorityWeights(value: Partial<LoongDelegationPriorityWeights> = {}): LoongDelegationPriorityWeights {
  return {
    explicitPriority: normalizeWeight(value.explicitPriority, DEFAULT_PRIORITY_WEIGHTS.explicitPriority),
    criticalPathMs: normalizeWeight(value.criticalPathMs, DEFAULT_PRIORITY_WEIGHTS.criticalPathMs),
    downstreamImpact: normalizeWeight(value.downstreamImpact, DEFAULT_PRIORITY_WEIGHTS.downstreamImpact),
    risk: normalizeWeight(value.risk, DEFAULT_PRIORITY_WEIGHTS.risk),
    uncertainty: normalizeWeight(value.uncertainty, DEFAULT_PRIORITY_WEIGHTS.uncertainty),
    approvalRequired: normalizeWeight(value.approvalRequired, DEFAULT_PRIORITY_WEIGHTS.approvalRequired),
    deadlineUrgency: normalizeWeight(value.deadlineUrgency, DEFAULT_PRIORITY_WEIGHTS.deadlineUrgency),
    estimatedCostUsd: normalizeWeight(value.estimatedCostUsd, DEFAULT_PRIORITY_WEIGHTS.estimatedCostUsd),
  };
}

function normalizeWeight(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function countDescendants(taskId: string, plan: Readonly<LoongDelegationPlan>): number {
  const seen = new Set<string>();
  const stack = [taskId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of plan.tasks) {
      if (!(child.dependsOn ?? []).includes(current) || seen.has(child.id)) continue;
      seen.add(child.id);
      stack.push(child.id);
    }
  }
  return seen.size;
}

function riskRank(value: LoongDelegatedTaskRisk | undefined): number {
  switch (value) {
    case "critical": return 4;
    case "high": return 3;
    case "medium": return 2;
    case "low":
    case undefined: return 1;
  }
}

function computeDeadlineUrgency(deadline: string | undefined, nowMs: number): number {
  if (!deadline) return 0;
  const deadlineMs = Date.parse(deadline);
  if (!Number.isFinite(deadlineMs)) return 0;
  const remaining = deadlineMs - nowMs;
  if (remaining <= 0) return 1;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.min(1, 1 - remaining / dayMs));
}

function normalizeRisk(value: string, taskId: string): LoongDelegatedTaskRisk {
  if (value === "low" || value === "medium" || value === "high" || value === "critical") {
    return value;
  }
  throw new Error(`Delegated task "${taskId}" has invalid risk "${value}".`);
}

function normalizeArtifact(value: LoongDelegatedTaskArtifact, taskId: string): LoongDelegatedTaskArtifact {
  if (!isRecord(value)) {
    throw new Error(`Delegated task "${taskId}" artifact must be an object.`);
  }
  const artifact: LoongDelegatedTaskArtifact = {
    type: normalizeText(String(value.type ?? ""), "task artifact type", 100),
  };
  if (value.id !== undefined) artifact.id = normalizeText(String(value.id), "task artifact id", 200);
  if (value.path !== undefined) artifact.path = normalizeText(String(value.path), "task artifact path", 1000);
  return artifact;
}

function normalizeFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite.`);
  }
  return value;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function formatDependencyContext<TOutput>(
  task: Readonly<LoongDelegatedTask>,
  completed: ReadonlyMap<string, LoongDelegatedTaskResult<TOutput>>,
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

function toRuntimeDelegatedTaskOutput(result: LoongTurnResult): LoongRuntimeDelegatedTaskOutput {
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

function assertAcyclic(tasks: readonly LoongDelegatedTask[]): void {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const visited = new Set<string>();

  // Iterative depth-first search with an explicit stack so deep dependency
  // chains (up to MAX_TASKS=100) cannot blow the JS call stack on small
  // worker pools or under stack-limited runtimes.
  type Frame = { taskId: string; depIndex: number };
  for (const start of tasks) {
    if (visited.has(start.id)) continue;
    const inPath = new Set<string>();
    const stack: Frame[] = [{ taskId: start.id, depIndex: 0 }];
    inPath.add(start.id);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const task = byId.get(frame.taskId);
      const dependencies = task?.dependsOn ?? [];
      if (frame.depIndex >= dependencies.length) {
        inPath.delete(frame.taskId);
        visited.add(frame.taskId);
        stack.pop();
        continue;
      }
      const depId = dependencies[frame.depIndex]!;
      frame.depIndex += 1;
      if (visited.has(depId)) continue;
      if (inPath.has(depId)) {
        throw new Error(`Delegation plan contains a dependency cycle at "${depId}".`);
      }
      inPath.add(depId);
      stack.push({ taskId: depId, depIndex: 0 });
    }
  }
}

function dependenciesComplete<TOutput>(
  task: LoongDelegatedTask,
  completed: ReadonlyMap<string, LoongDelegatedTaskResult<TOutput>>,
): boolean {
  return (task.dependsOn ?? []).every(dependency => completed.get(dependency)?.status === "ok");
}

function failedDependencyIds<TOutput>(
  task: LoongDelegatedTask,
  completed: ReadonlyMap<string, LoongDelegatedTaskResult<TOutput>>,
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
