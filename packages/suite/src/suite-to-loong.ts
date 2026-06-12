import { promises as fs } from "node:fs";
import path from "node:path";
import type { SuiteManifest } from "./suite-manifest.js";

/**
 * Subset of `LoongAgentProfile` (from `@loong/core`) that a suite produces.
 * Re-declared locally to keep `@loong/suite` free of cross-package build
 * (project-reference) coupling. Shape matches `.loong/config/agents.json`.
 */
export interface SuiteAgentProfile {
  id: string;
  name: string;
  description?: string;
  defaultModel?: string;
  workspace?: string;
  systemPrompt?: string;
  toolsEnabled?: boolean;
  memoryEnabled?: boolean;
}

/**
 * Loong employee-workspace files, matching
 * `@loong/gateway` `EMPLOYEE_WORKSPACE_FILES`.
 */
export const EMPLOYEE_WORKSPACE_FILES = {
  role: "role.md",
  workflow: "workflow.md",
  memory: "memory.md",
  skillsEnabled: "skills.enabled.json",
} as const;

export interface EmployeeWorkspaceFiles {
  role: string;
  workflow: string;
  memory: string;
  skillsEnabled: string[];
}

async function readIfExists(dir: string, file: string): Promise<string> {
  try {
    return await fs.readFile(path.join(dir, file), "utf8");
  } catch {
    return "";
  }
}

/**
 * Pick a default model from `default_model_routing` (`*` first, else first
 * entry) or fall back to the first `required_models` entry.
 */
export function pickDefaultModel(manifest: SuiteManifest): string | undefined {
  const routing = manifest.defaultModelRouting;
  if (routing) {
    if (typeof routing["*"] === "string") {
      return routing["*"];
    }
    const first = Object.values(routing).find((value) => typeof value === "string");
    if (first) {
      return first;
    }
  }
  return manifest.requiredModels?.[0];
}

/**
 * Build the agent system prompt from the suite's identity markdown.
 * Loong has no SOUL.md/AGENTS.md concept, so we fold them into systemPrompt.
 */
export async function assembleSystemPrompt(manifest: SuiteManifest, workspaceDir: string): Promise<string> {
  const identity = await readIfExists(workspaceDir, "IDENTITY.md");
  const soul = await readIfExists(workspaceDir, "SOUL.md");
  const agents = await readIfExists(workspaceDir, "AGENTS.md");

  const parts: string[] = [];
  parts.push(`# ${manifest.name}${manifest.identity?.emoji ? ` ${manifest.identity.emoji}` : ""}`);
  if (manifest.description) {
    parts.push(manifest.description);
  }
  for (const block of [identity, soul, agents]) {
    if (block.trim()) {
      parts.push(block.trim());
    }
  }
  return parts.join("\n\n");
}

export async function buildAgentProfile(manifest: SuiteManifest, workspaceDir: string): Promise<SuiteAgentProfile> {
  return {
    id: manifest.id,
    name: manifest.identity?.name ?? manifest.name,
    description: manifest.description,
    defaultModel: pickDefaultModel(manifest),
    workspace: workspaceDir,
    systemPrompt: await assembleSystemPrompt(manifest, workspaceDir),
    toolsEnabled: true,
    memoryEnabled: true,
  };
}

/**
 * Map suite identity/behavior markdown to Loong employee-workspace files:
 *   SOUL.md + IDENTITY.md  -> role.md
 *   AGENTS.md + HEARTBEAT.md -> workflow.md
 *   MEMORY.md              -> memory.md
 *   manifest.skills        -> skills.enabled.json
 */
export async function buildEmployeeWorkspaceFiles(
  manifest: SuiteManifest,
  workspaceDir: string,
): Promise<EmployeeWorkspaceFiles> {
  const soul = await readIfExists(workspaceDir, "SOUL.md");
  const identity = await readIfExists(workspaceDir, "IDENTITY.md");
  const agents = await readIfExists(workspaceDir, "AGENTS.md");
  const heartbeat = await readIfExists(workspaceDir, "HEARTBEAT.md");
  const memory = await readIfExists(workspaceDir, "MEMORY.md");

  const role =
    [identity.trim(), soul.trim()].filter(Boolean).join("\n\n") ||
    `# ${manifest.name}\n\n${manifest.description ?? ""}`.trim();
  const workflow = [agents.trim(), heartbeat.trim()].filter(Boolean).join("\n\n");

  return { role, workflow, memory, skillsEnabled: manifest.skills };
}

/** Write the generated employee-workspace files into `workspaceDir`. */
export async function writeEmployeeWorkspaceFiles(
  workspaceDir: string,
  files: EmployeeWorkspaceFiles,
): Promise<void> {
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(path.join(workspaceDir, EMPLOYEE_WORKSPACE_FILES.role), files.role, "utf8");
  await fs.writeFile(path.join(workspaceDir, EMPLOYEE_WORKSPACE_FILES.workflow), files.workflow, "utf8");

  const memoryPath = path.join(workspaceDir, EMPLOYEE_WORKSPACE_FILES.memory);
  if (files.memory.trim()) {
    await fs.writeFile(memoryPath, files.memory, "utf8");
  } else {
    // Preserve an existing memory.md (runtime state); otherwise seed an empty one.
    try {
      await fs.access(memoryPath);
    } catch {
      await fs.writeFile(memoryPath, "", "utf8");
    }
  }

  await fs.writeFile(
    path.join(workspaceDir, EMPLOYEE_WORKSPACE_FILES.skillsEnabled),
    `${JSON.stringify(files.skillsEnabled, null, 2)}\n`,
    "utf8",
  );
}
