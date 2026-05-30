import { GatewayApiError, type GatewayClient } from "../../api/index.js";
import type { OrgEmployeeFormState } from "./types.js";
import type { MemoryCandidateRow, SkillOption } from "./skillTypes.js";

export interface WorkspaceSnapshot {
  workspace: string;
  role: string;
  workflow: string;
  memory: string;
  enabledSkills: string[];
}

export async function fetchWorkspaceSnapshot(
  client: GatewayClient,
  form: Pick<OrgEmployeeFormState, "employeeId" | "profileId" | "workspace" | "workspacePath">,
): Promise<WorkspaceSnapshot | null> {
  try {
    return await client.rpc<WorkspaceSnapshot>("employee.workspace.get", {
      employeeId: form.employeeId,
      profileId: form.profileId,
      ...(form.workspace.trim() ? { workspace: form.workspace.trim() } : {}),
      ...(form.workspacePath.trim() && !form.workspace.trim()
        ? { workspace: form.workspacePath.trim() }
        : {}),
    });
  } catch {
    return null;
  }
}

export async function saveWorkspaceSnapshot(
  client: GatewayClient,
  workspace: string,
  patch: {
    role?: string;
    workflow?: string;
    memory?: string;
    enabledSkills?: readonly string[];
  },
): Promise<WorkspaceSnapshot> {
  return client.rpc<WorkspaceSnapshot>("employee.workspace.save", {
    workspace,
    ...patch,
  });
}

export async function fetchSkillOptions(client: GatewayClient): Promise<{
  skills: SkillOption[];
  available: boolean;
  warning?: string;
}> {
  try {
    const remote = await client.rpc<{
      skills?: SkillOption[];
      available?: boolean;
      warnings?: string[];
    }>("skills.list");
    const gatewayWarnings = remote.warnings?.filter(entry => entry.trim()) ?? [];
    return {
      skills: remote.skills ?? [],
      available: remote.available !== false,
      ...(gatewayWarnings.length > 0 ? { warning: gatewayWarnings.join(" ") } : {}),
    };
  } catch (error) {
    const message =
      error instanceof GatewayApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      skills: [],
      available: false,
      warning: message,
    };
  }
}

export async function fetchMemoryCandidates(client: GatewayClient): Promise<MemoryCandidateRow[]> {
  try {
    const payload = await client.rpc<{ output?: { candidates?: MemoryCandidateRow[] } }>(
      "memory.candidates.list",
      { limit: 8 },
    );
    return payload.output?.candidates ?? [];
  } catch {
    return [];
  }
}

export async function bootstrapOrgExample(client: GatewayClient): Promise<{ bootstrapped: boolean; reason?: string }> {
  return client.rpc<{ bootstrapped: boolean; reason?: string }>("org.bootstrap.example");
}
