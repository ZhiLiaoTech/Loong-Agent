import type { LoongTierHint, LoongTrajectoryRecord } from "./types.js";

export type CausalTreatmentKey = "tier" | "employeeId" | "scheduler" | "model";

export interface CausalOutcome {
  success: boolean;
  reward: number;
  latencyMs?: number;
  costUsd?: number;
}

export interface CausalObservation {
  id: string;
  treatment: Record<string, string>;
  context: Record<string, string>;
  outcome: CausalOutcome;
  weight: number;
}

export interface TreatmentEffectEstimate {
  treatment: string;
  samples: number;
  treatedMean: number;
  controlMean: number;
  effect: number;
  support: number;
  strata: number;
}

export interface TreatmentRecommendation {
  treatment: string;
  score: number;
  estimate: TreatmentEffectEstimate;
  reason: string;
}

export interface CausalLearningOptions {
  contextKeys?: readonly string[];
  minSamples?: number;
  latencyPenaltyPerSecond?: number;
  costPenalty?: number;
}

const DEFAULT_CONTEXT_KEYS = [
  "taskType",
  "taskRisk",
  "requiredRole",
  "source",
  "workspace",
];

export function trajectoryToCausalObservation(
  record: LoongTrajectoryRecord,
  options: CausalLearningOptions = {},
): CausalObservation {
  const metadata = record.metadata ?? {};
  const latencyMs = Math.max(0, Date.parse(record.completedAt) - Date.parse(record.createdAt));
  const costUsd = record.usage?.costUsd;
  const success = record.status === "ok";
  const reward = computeReward({
    success,
    latencyMs,
    ...(costUsd !== undefined ? { costUsd } : {}),
  }, options);
  const treatment = compactRecord({
    tier: readString(metadata.tier) ?? readString(metadata.parentTier),
    employeeId: readString(metadata.employeeId),
    scheduler: readString(metadata.scheduler) ?? readString(metadata.delegationScheduler),
    model: record.model,
  });
  const context = compactRecord({
    taskType: readString(metadata.delegationTaskType) ?? readString(metadata.taskType),
    taskRisk: readString(metadata.delegationTaskRisk) ?? readString(metadata.taskRisk),
    requiredRole: readString(metadata.delegationRequiredRole) ?? readString(metadata.requiredRole),
    source: record.source,
    workspace: record.workspace,
  });
  return {
    id: record.runId,
    treatment,
    context,
    outcome: {
      success,
      reward,
      latencyMs,
      ...(costUsd !== undefined ? { costUsd } : {}),
    },
    weight: 1,
  };
}

export function trajectoriesToCausalObservations(
  records: readonly LoongTrajectoryRecord[],
  options: CausalLearningOptions = {},
): CausalObservation[] {
  return records.map(record => trajectoryToCausalObservation(record, options));
}

export function estimateTreatmentEffects(
  observations: readonly CausalObservation[],
  treatmentKey: CausalTreatmentKey,
  options: CausalLearningOptions = {},
): TreatmentEffectEstimate[] {
  const minSamples = options.minSamples ?? 2;
  const eligible = observations.filter(observation => observation.treatment[treatmentKey] !== undefined);
  const treatments = [...new Set(eligible.map(observation => observation.treatment[treatmentKey]!).filter(Boolean))];
  return treatments.flatMap(treatment => {
    const strata = groupByStratum(eligible, options.contextKeys ?? DEFAULT_CONTEXT_KEYS);
    let weightedEffect = 0;
    let totalWeight = 0;
    let support = 0;
    let treatedSamples = 0;
    let treatedReward = 0;
    let controlReward = 0;
    let usedStrata = 0;

    for (const group of strata.values()) {
      const treated = group.filter(observation => observation.treatment[treatmentKey] === treatment);
      const control = group.filter(observation => observation.treatment[treatmentKey] !== treatment);
      if (treated.length === 0 || control.length === 0) continue;
      const treatedMean = weightedMean(treated);
      const controlMean = weightedMean(control);
      const stratumWeight = group.reduce((sum, observation) => sum + observation.weight, 0);
      weightedEffect += (treatedMean - controlMean) * stratumWeight;
      totalWeight += stratumWeight;
      support += treated.length + control.length;
      treatedSamples += treated.length;
      treatedReward += treatedMean * treated.length;
      controlReward += controlMean * control.length;
      usedStrata += 1;
    }

    if (treatedSamples < minSamples || totalWeight <= 0) return [];
    return [{
      treatment,
      samples: treatedSamples,
      treatedMean: treatedReward / Math.max(1, treatedSamples),
      controlMean: controlReward / Math.max(1, support - treatedSamples),
      effect: weightedEffect / totalWeight,
      support,
      strata: usedStrata,
    }];
  }).sort((left, right) => right.effect - left.effect || right.samples - left.samples);
}

export function recommendTreatmentByCausalEffect(
  observations: readonly CausalObservation[],
  treatmentKey: CausalTreatmentKey,
  options: CausalLearningOptions = {},
): TreatmentRecommendation | undefined {
  const estimates = estimateTreatmentEffects(observations, treatmentKey, options);
  const best = estimates[0];
  if (!best) return undefined;
  const confidence = Math.min(1, best.samples / Math.max(1, options.minSamples ?? 2) / 4);
  const score = best.effect * confidence;
  return {
    treatment: best.treatment,
    score,
    estimate: best,
    reason: `effect=${best.effect.toFixed(3)}; samples=${best.samples}; strata=${best.strata}; confidence=${confidence.toFixed(2)}`,
  };
}

export function recommendTierByCausalEffect(
  observations: readonly CausalObservation[],
  fallback: LoongTierHint = "standard",
  options: CausalLearningOptions = {},
): { tier: LoongTierHint; reason: string; recommendation?: TreatmentRecommendation } {
  const recommendation = recommendTreatmentByCausalEffect(observations, "tier", options);
  if (
    recommendation
    && (recommendation.treatment === "fast"
      || recommendation.treatment === "standard"
      || recommendation.treatment === "deep")
  ) {
    return {
      tier: recommendation.treatment,
      reason: recommendation.reason,
      recommendation,
    };
  }
  return { tier: fallback, reason: "No supported causal tier recommendation; using fallback." };
}

function computeReward(outcome: { success: boolean; latencyMs?: number; costUsd?: number }, options: CausalLearningOptions): number {
  const latencyPenaltyPerSecond = options.latencyPenaltyPerSecond ?? 0.01;
  const costPenalty = options.costPenalty ?? 1;
  const successReward = outcome.success ? 1 : -1;
  const latencyPenalty = ((outcome.latencyMs ?? 0) / 1000) * latencyPenaltyPerSecond;
  const tokenCostPenalty = (outcome.costUsd ?? 0) * costPenalty;
  return successReward - latencyPenalty - tokenCostPenalty;
}

function groupByStratum(
  observations: readonly CausalObservation[],
  contextKeys: readonly string[],
): Map<string, CausalObservation[]> {
  const groups = new Map<string, CausalObservation[]>();
  for (const observation of observations) {
    const key = contextKeys.map(contextKey => `${contextKey}:${observation.context[contextKey] ?? "*"}`).join("|");
    const group = groups.get(key) ?? [];
    group.push(observation);
    groups.set(key, group);
  }
  return groups;
}

function weightedMean(observations: readonly CausalObservation[]): number {
  const totalWeight = observations.reduce((sum, observation) => sum + observation.weight, 0);
  if (totalWeight <= 0) return 0;
  return observations.reduce((sum, observation) => sum + observation.outcome.reward * observation.weight, 0) / totalWeight;
}

function compactRecord(value: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined && entry.trim()) out[key] = entry.trim();
  }
  return out;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
