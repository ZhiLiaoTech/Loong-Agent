import { randomUUID } from "node:crypto";
import { defaultOrgRoot, listPresetSkillCatalog } from "@loong/org";
import type { ToolDefinition, ToolInvocation, ToolRegistry } from "@loong/tools";
import type { GatewayAgentConfig } from "./gateway-agent-types.js";
import type { EmployeeRegistry } from "@loong/org";
import {
  loadEmployeeWorkspaceFiles,
  resolveEmployeeWorkspaceDir,
  saveEmployeeWorkspaceFiles,
  type EmployeeWorkspaceSaveInput,
} from "./employee-workspace-files.js";
import { mergePresetSkillsWithRuntime, seedMandatoryPresetSkills } from "./org-preset-skills.js";

export interface EmployeeWorkspaceGetParams {
  workspace?: string;
  employeeId?: string;
  profileId?: string;
}

export interface SkillSummaryPayload {
  name: string;
  description: string;
  category?: string;
  preset?: boolean;
}

export interface GatewaySkillsListResult {
  skills: SkillSummaryPayload[];
  available: boolean;
  warnings?: string[];
}

function pickEmployee(registry: EmployeeRegistry, employeeId?: string) {
  if (employeeId?.trim()) {
    return registry.employees.find(entry => entry.id === employeeId.trim());
  }
  if (registry.defaultEmployeeId) {
    return registry.employees.find(entry => entry.id === registry.defaultEmployeeId);
  }
  return registry.employees.find(entry => entry.status === "active") ?? registry.employees[0];
}

function pickProfile(agentConfig: GatewayAgentConfig, profileId?: string, fallbackProfileId?: string) {
  const target = profileId?.trim() || fallbackProfileId?.trim() || agentConfig.defaultProfileId?.trim();
  if (!target) {
    return agentConfig.profiles[0];
  }
  return agentConfig.profiles.find(entry => entry.id === target) ?? agentConfig.profiles[0];
}

function listPresetSkillSummaries(): SkillSummaryPayload[] {
  return listPresetSkillCatalog().map(entry => ({
    name: entry.name,
    description: entry.description,
    category: entry.category,
    preset: true,
  }));
}

function mapRuntimeSkillSummaries(skills: unknown): SkillSummaryPayload[] {
  if (!Array.isArray(skills)) {
    return [];
  }
  return skills.flatMap(skill => {
    if (!skill || typeof skill !== "object") {
      return [];
    }
    const record = skill as { name?: unknown; description?: unknown; category?: unknown };
    if (typeof record.name !== "string" || !record.name.trim()) {
      return [];
    }
    return [{
      name: record.name,
      description: typeof record.description === "string" ? record.description : "",
      ...(typeof record.category === "string" && record.category.trim()
        ? { category: record.category }
        : {}),
    }];
  });
}

function readSkillListFromToolResult(result: unknown): SkillSummaryPayload[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  const record = result as Record<string, unknown>;
  if ("output" in record && record.output && typeof record.output === "object") {
    const output = record.output as Record<string, unknown>;
    if (Array.isArray(output.skills)) {
      return mapRuntimeSkillSummaries(output.skills);
    }
  }
  if (Array.isArray(record.skills)) {
    return mapRuntimeSkillSummaries(record.skills);
  }
  return [];
}

export async function loadEmployeeWorkspaceSnapshot(
  agentConfig: GatewayAgentConfig,
  employeeRegistry: EmployeeRegistry,
  params: EmployeeWorkspaceGetParams = {},
) {
  const employee = pickEmployee(employeeRegistry, params.employeeId);
  const profile = pickProfile(agentConfig, params.profileId, employee?.profileId);
  const employeeId = employee?.id ?? params.employeeId?.trim() ?? "default";
  const workspace = resolveEmployeeWorkspaceDir(
    params.workspace ?? profile?.workspace,
    employeeId,
    defaultOrgRoot(),
  );
  return loadEmployeeWorkspaceFiles(workspace);
}

export async function saveEmployeeWorkspaceSnapshot(input: EmployeeWorkspaceSaveInput) {
  return saveEmployeeWorkspaceFiles(input);
}

export async function listGatewaySkills(
  toolRegistry: ToolRegistry,
  options: { skillRoots?: readonly string[] } = {},
): Promise<GatewaySkillsListResult> {
  const warnings = await seedMandatoryPresetSkills(options.skillRoots);
  const tool = toolRegistry.get("skill_list");
  if (!tool) {
    return {
      skills: listPresetSkillSummaries(),
      available: true,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  let runtimeSkills: SkillSummaryPayload[] = [];
  try {
    const invocation: ToolInvocation = {
      id: randomUUID(),
      name: "skill_list",
      input: { maxResults: 100 },
      sessionId: "gateway-skills",
    };
    const result = await (tool as ToolDefinition).invoke(invocation);
    if (result && typeof result === "object" && "ok" in result && (result as { ok?: boolean }).ok === false) {
      const error = (result as { error?: unknown }).error;
      warnings.push(typeof error === "string" && error.trim() ? error : "skill_list tool failed.");
    } else {
      runtimeSkills = readSkillListFromToolResult(result);
    }
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }

  return {
    skills: mergePresetSkillsWithRuntime(runtimeSkills),
    available: true,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
