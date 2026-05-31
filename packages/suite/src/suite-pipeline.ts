import { promises as fs } from "node:fs";
import path from "node:path";
import type { SuiteManifest } from "./suite-manifest.js";

/** Shape-compatible with `@loong/delegation` `LoongDelegatedTask`. */
export interface DelegatedTask {
  id: string;
  title: string;
  prompt: string;
  dependsOn?: string[];
  metadata?: Record<string, unknown>;
}

/** Shape-compatible with `@loong/delegation` `LoongDelegationPlan`. */
export interface DelegationPlan {
  description?: string;
  tasks: DelegatedTask[];
}

/**
 * Map `pipeline.stages` to a sequential delegation plan: each stage becomes a
 * task that depends on the previous stage. The result is a `runDelegationPlan`-
 * ready plan (acyclic by construction). Returns undefined when no pipeline.
 */
export function buildDelegationPlan(manifest: SuiteManifest): DelegationPlan | undefined {
  const stages = manifest.pipeline?.stages;
  if (!stages || stages.length === 0) {
    return undefined;
  }
  const ids = stages.map((stage, index) => stage.stage?.trim() || `stage-${index + 1}`);
  const tasks: DelegatedTask[] = stages.map((stage, index) => ({
    id: ids[index],
    title: stage.stage || ids[index],
    prompt: stage.description ?? `Run skill ${stage.skill}`,
    ...(index > 0 ? { dependsOn: [ids[index - 1]] } : {}),
    metadata: { suiteId: manifest.id, skill: stage.skill, order: index },
  }));
  return {
    ...(manifest.pipeline?.description ? { description: manifest.pipeline.description } : {}),
    tasks,
  };
}

/** Persist the plan as a portable artifact under the workspace. */
export async function writeDelegationPlan(workspaceDir: string, plan: DelegationPlan): Promise<string> {
  const dir = path.join(workspaceDir, ".loong-suite");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "pipeline.plan.json");
  await fs.writeFile(file, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return file;
}
