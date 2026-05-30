import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const EMPLOYEE_WORKSPACE_FILES = {
  role: "role.md",
  workflow: "workflow.md",
  memory: "memory.md",
  skillsEnabled: "skills.enabled.json",
} as const;

export interface EmployeeWorkspaceSnapshot {
  workspace: string;
  role: string;
  workflow: string;
  memory: string;
  enabledSkills: string[];
}

function resolveInsideWorkspace(workspaceDir: string, relativePath: string): string {
  const root = path.resolve(workspaceDir);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Workspace path escapes the employee directory.");
  }
  return target;
}

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function readEnabledSkills(filePath: string): Promise<string[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { enabled?: unknown };
    if (!Array.isArray(parsed.enabled)) {
      return [];
    }
    return parsed.enabled.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  } catch {
    return [];
  }
}

export async function loadEmployeeWorkspaceFiles(workspaceDir: string): Promise<EmployeeWorkspaceSnapshot> {
  const workspace = path.resolve(workspaceDir);
  await mkdir(workspace, { recursive: true });
  const rolePath = resolveInsideWorkspace(workspace, EMPLOYEE_WORKSPACE_FILES.role);
  const workflowPath = resolveInsideWorkspace(workspace, EMPLOYEE_WORKSPACE_FILES.workflow);
  const memoryPath = resolveInsideWorkspace(workspace, EMPLOYEE_WORKSPACE_FILES.memory);
  const skillsPath = resolveInsideWorkspace(workspace, EMPLOYEE_WORKSPACE_FILES.skillsEnabled);

  return {
    workspace,
    role: await readOptionalText(rolePath),
    workflow: await readOptionalText(workflowPath),
    memory: await readOptionalText(memoryPath),
    enabledSkills: await readEnabledSkills(skillsPath),
  };
}

export interface EmployeeWorkspaceSaveInput {
  workspace: string;
  role?: string;
  workflow?: string;
  memory?: string;
  enabledSkills?: readonly string[];
}

export async function saveEmployeeWorkspaceFiles(input: EmployeeWorkspaceSaveInput): Promise<EmployeeWorkspaceSnapshot> {
  const workspace = path.resolve(input.workspace.trim());
  if (!workspace) {
    throw new Error("workspace is required.");
  }
  await mkdir(workspace, { recursive: true });

  if (input.role !== undefined) {
    await writeFile(resolveInsideWorkspace(workspace, EMPLOYEE_WORKSPACE_FILES.role), input.role, "utf8");
  }
  if (input.workflow !== undefined) {
    await writeFile(resolveInsideWorkspace(workspace, EMPLOYEE_WORKSPACE_FILES.workflow), input.workflow, "utf8");
  }
  if (input.memory !== undefined) {
    await writeFile(resolveInsideWorkspace(workspace, EMPLOYEE_WORKSPACE_FILES.memory), input.memory, "utf8");
  }
  if (input.enabledSkills !== undefined) {
    const payload = { enabled: [...input.enabledSkills] };
    await writeFile(
      resolveInsideWorkspace(workspace, EMPLOYEE_WORKSPACE_FILES.skillsEnabled),
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
  }

  return loadEmployeeWorkspaceFiles(workspace);
}

export function resolveEmployeeWorkspaceDir(workspace: string | undefined, employeeId: string, orgRoot: string): string {
  const trimmed = workspace?.trim();
  if (trimmed) {
    return path.resolve(trimmed);
  }
  const safeId = employeeId.trim() || "default";
  return path.join(path.resolve(orgRoot), "workspaces", safeId);
}
