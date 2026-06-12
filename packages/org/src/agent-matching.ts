import type { DigitalEmployee, EmployeeRegistry, OrgRiskLevel } from "./types.js";

export interface AgentTaskProfile {
  type?: string;
  requiredRole?: string;
  requiredCapabilities?: readonly string[];
  risk?: OrgRiskLevel;
  estimatedCostUsd?: number;
  requiredTier?: "fast" | "standard" | "deep";
  metadata?: Record<string, unknown>;
}

export interface AgentCapabilityIndex {
  byEmployeeId?: Readonly<Record<string, readonly string[]>>;
  byProfileId?: Readonly<Record<string, readonly string[]>>;
  byPositionId?: Readonly<Record<string, readonly string[]>>;
}

export interface AgentLoadSnapshot {
  employeeId: string;
  activeRuns?: number;
  queuedTasks?: number;
}

export interface AgentTrajectoryStats {
  employeeId: string;
  taskType?: string;
  attempts: number;
  successes: number;
  avgLatencyMs?: number;
  avgCostUsd?: number;
  approvalRejectionRate?: number;
  humanCorrectionRate?: number;
}

export interface AgentMatchWeights {
  role: number;
  capability: number;
  trajectorySuccess: number;
  latency: number;
  cost: number;
  load: number;
  riskBudget: number;
  tierPreference: number;
}

export interface AgentMatchOptions {
  capabilities?: AgentCapabilityIndex;
  loads?: readonly AgentLoadSnapshot[];
  trajectoryStats?: readonly AgentTrajectoryStats[];
  weights?: Partial<AgentMatchWeights>;
}

export interface AgentMatchScore {
  employeeId: string;
  employee: DigitalEmployee;
  score: number;
  reasons: readonly string[];
}

const DEFAULT_WEIGHTS: AgentMatchWeights = {
  role: 20,
  capability: 30,
  trajectorySuccess: 20,
  latency: -4,
  cost: -6,
  load: -8,
  riskBudget: 10,
  tierPreference: 6,
};

export function rankEmployeesForTask(
  registry: EmployeeRegistry,
  task: AgentTaskProfile,
  options: AgentMatchOptions = {},
): AgentMatchScore[] {
  return registry.employees
    .filter(employee => employee.status === "active")
    .map(employee => scoreEmployeeForTask(employee, task, options))
    .sort((left, right) => right.score - left.score || left.employeeId.localeCompare(right.employeeId));
}

export function resolveBestEmployeeForTask(
  registry: EmployeeRegistry,
  task: AgentTaskProfile,
  options: AgentMatchOptions = {},
): AgentMatchScore | undefined {
  return rankEmployeesForTask(registry, task, options)[0];
}

export function scoreEmployeeForTask(
  employee: DigitalEmployee,
  task: AgentTaskProfile,
  options: AgentMatchOptions = {},
): AgentMatchScore {
  const weights = normalizeWeights(options.weights);
  const reasons: string[] = [];
  let score = 0;

  const roleScore = roleMatchScore(employee, task.requiredRole);
  score += roleScore * weights.role;
  if (task.requiredRole) reasons.push(`role=${roleScore.toFixed(2)}`);

  const capabilities = collectEmployeeCapabilities(employee, options.capabilities);
  const capabilityScore = capabilityMatchScore(capabilities, task.requiredCapabilities ?? []);
  score += capabilityScore * weights.capability;
  if (task.requiredCapabilities?.length) reasons.push(`capability=${capabilityScore.toFixed(2)}`);

  const stats = pickTrajectoryStats(employee.id, task.type, options.trajectoryStats ?? []);
  if (stats) {
    const successRate = stats.attempts > 0 ? stats.successes / stats.attempts : 0;
    score += successRate * weights.trajectorySuccess;
    reasons.push(`success=${successRate.toFixed(2)}`);
    if (stats.avgLatencyMs !== undefined) {
      const latencyPenalty = Math.min(1, stats.avgLatencyMs / 60_000);
      score += latencyPenalty * weights.latency;
      reasons.push(`latency=${stats.avgLatencyMs}ms`);
    }
    if (stats.avgCostUsd !== undefined) {
      const costPenalty = Math.min(1, stats.avgCostUsd);
      score += costPenalty * weights.cost;
      reasons.push(`cost=$${stats.avgCostUsd.toFixed(4)}`);
    }
    if (stats.approvalRejectionRate !== undefined) {
      score -= Math.max(0, Math.min(1, stats.approvalRejectionRate)) * 8;
      reasons.push(`approvalReject=${stats.approvalRejectionRate.toFixed(2)}`);
    }
    if (stats.humanCorrectionRate !== undefined) {
      score -= Math.max(0, Math.min(1, stats.humanCorrectionRate)) * 6;
      reasons.push(`humanCorrection=${stats.humanCorrectionRate.toFixed(2)}`);
    }
  }

  const load = options.loads?.find(entry => entry.employeeId === employee.id);
  const loadScore = (load?.activeRuns ?? 0) + (load?.queuedTasks ?? 0) * 0.5;
  score += loadScore * weights.load;
  if (loadScore > 0) reasons.push(`load=${loadScore.toFixed(1)}`);

  const riskScore = riskBudgetScore(employee, task.risk);
  score += riskScore * weights.riskBudget;
  if (task.risk) reasons.push(`riskBudget=${riskScore.toFixed(2)}`);

  if (task.requiredTier && employee.budget?.tierDefault) {
    const tierScore = employee.budget.tierDefault === task.requiredTier ? 1 : 0;
    score += tierScore * weights.tierPreference;
    reasons.push(`tier=${tierScore.toFixed(2)}`);
  }

  return {
    employeeId: employee.id,
    employee,
    score,
    reasons,
  };
}

function normalizeWeights(value: Partial<AgentMatchWeights> = {}): AgentMatchWeights {
  return {
    role: numberOr(value.role, DEFAULT_WEIGHTS.role),
    capability: numberOr(value.capability, DEFAULT_WEIGHTS.capability),
    trajectorySuccess: numberOr(value.trajectorySuccess, DEFAULT_WEIGHTS.trajectorySuccess),
    latency: numberOr(value.latency, DEFAULT_WEIGHTS.latency),
    cost: numberOr(value.cost, DEFAULT_WEIGHTS.cost),
    load: numberOr(value.load, DEFAULT_WEIGHTS.load),
    riskBudget: numberOr(value.riskBudget, DEFAULT_WEIGHTS.riskBudget),
    tierPreference: numberOr(value.tierPreference, DEFAULT_WEIGHTS.tierPreference),
  };
}

function numberOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roleMatchScore(employee: DigitalEmployee, role: string | undefined): number {
  if (!role?.trim()) return 0.5;
  const needle = role.trim().toLowerCase();
  const fields = [employee.id, employee.profileId, employee.positionId, employee.displayName]
    .map(value => value.toLowerCase());
  return fields.some(value => value === needle || value.includes(needle)) ? 1 : 0;
}

function collectEmployeeCapabilities(
  employee: DigitalEmployee,
  index: AgentCapabilityIndex | undefined,
): Set<string> {
  const values = [
    employee.id,
    employee.profileId,
    employee.positionId,
    employee.unitId,
    ...(index?.byEmployeeId?.[employee.id] ?? []),
    ...(index?.byProfileId?.[employee.profileId] ?? []),
    ...(index?.byPositionId?.[employee.positionId] ?? []),
  ];
  return new Set(values.map(value => value.trim().toLowerCase()).filter(Boolean));
}

function capabilityMatchScore(available: ReadonlySet<string>, required: readonly string[]): number {
  const normalized = required.map(value => value.trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0) return 0.5;
  const matched = normalized.filter(value => available.has(value)).length;
  return matched / normalized.length;
}

function pickTrajectoryStats(
  employeeId: string,
  taskType: string | undefined,
  stats: readonly AgentTrajectoryStats[],
): AgentTrajectoryStats | undefined {
  return stats.find(entry => entry.employeeId === employeeId && entry.taskType === taskType)
    ?? stats.find(entry => entry.employeeId === employeeId && entry.taskType === undefined);
}

function riskBudgetScore(employee: DigitalEmployee, risk: OrgRiskLevel | undefined): number {
  if (!risk) return 0.5;
  const maxDepth = employee.budget?.maxDelegationDepth;
  if (risk === "critical") return maxDepth !== undefined && maxDepth >= 2 ? 1 : 0;
  if (risk === "high") return maxDepth !== undefined && maxDepth >= 1 ? 1 : 0.5;
  return 1;
}
