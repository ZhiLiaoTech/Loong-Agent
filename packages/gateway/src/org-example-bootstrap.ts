import { mkdir, writeFile } from "node:fs/promises";

import path from "node:path";

import { defaultOrgConfigPath, defaultOrgRoot, getPositionCapabilityPreset } from "@loong/org";

import type { EmployeeStore, ToolPolicyStore } from "@loong/org";

import type { ToolPolicyDocument } from "@loong/org";

import type { GatewayAgentConfigStore } from "./gateway-agent-types.js";

import { EMPLOYEE_WORKSPACE_FILES, saveEmployeeWorkspaceFiles } from "./employee-workspace-files.js";

import { seedPresetSkills, ensureOfficePresetSkills, ensureMediaPresetSkills } from "./org-preset-skills.js";



const WORKFLOW_DELIMITER = "\n\n<!-- loong:workflow -->\n";



function mergeRoleAndWorkflow(role: string, workflow: string): string {

  const roleText = role.trim();

  const workflowText = workflow.trim();

  if (!workflowText) {

    return roleText;

  }

  if (!roleText) {

    return workflowText;

  }

  return `${roleText}${WORKFLOW_DELIMITER}${workflowText}`;

}



const EXAMPLE_ORG = {

  version: 1,

  units: [

    { id: "eng", name: "工程部" },

    { id: "product", name: "产品部" },

  ],

  positions: [

    { id: "engineer", name: "开发工程师", unitId: "eng", level: "IC" },

    { id: "tech-lead", name: "技术负责人", unitId: "eng", level: "M1" },

    { id: "pm", name: "产品经理", unitId: "product", level: "IC" },

  ],

  reporting: [{ employeeId: "dev-01", managerId: "lead-01" }],

  employeeRouting: [

    {

      id: "pm-keywords",

      employeeId: "pm-01",

      match: { keywords: ["需求", "产品", "prd", "原型"] },

    },

    {

      id: "eng-keywords",

      employeeId: "dev-01",

      match: { keywords: ["代码", "bug", "修复", "实现", "重构"] },

    },

  ],

  approvalChains: [

    {

      id: "write-ops",

      name: "写操作审批",

      steps: [{ scope: "manager", approverRole: "tech-lead" }],

    },

  ],

} as const;



const EXAMPLE_EMPLOYEES = {

  defaultEmployeeId: "dev-01",

  employees: [

    {

      id: "dev-01",

      displayName: "开发-小龙",

      profileId: "dev-01",

      positionId: "engineer",

      unitId: "eng",

      managerId: "lead-01",

      status: "active" as const,

      toolPolicyId: "engineer-standard",

      kpiTemplateId: "engineer-delivery",

    },

  ],

};



const EXAMPLE_POLICIES: ToolPolicyDocument = {

  policies: [

    {

      id: "engineer-standard",

      description: "工程师标准权限",

      rules: [

        { match: { toolName: "file_read" }, risk: "low", decision: "allow" },

        { match: { toolName: "file_search" }, risk: "low", decision: "allow" },

        { match: { toolName: "file_patch" }, risk: "high", decision: "approval", chainId: "write-ops" },

        { match: { toolName: "shell_exec" }, risk: "critical", decision: "deny" },

      ],

    },

    {

      id: "lead-standard",

      description: "负责人标准权限",

      rules: [{ match: { toolName: "file_patch" }, risk: "medium", decision: "allow" }],

    },

    {

      id: "pm-readonly",

      description: "产品岗只读权限",

      rules: [

        { match: { capability: "write" }, decision: "deny", reason: "产品岗禁止写操作" },

        { match: { capability: "read" }, decision: "allow" },

      ],

    },

  ],

};



const DEFAULT_POSITION_ID = "engineer";



export interface OrgBootstrapDeps {

  orgConfigPath?: string;

  employeeStore?: EmployeeStore;

  toolPolicyStore?: ToolPolicyStore;

  agentConfigStore?: GatewayAgentConfigStore;

  orgAlreadyConfigured?: boolean;

}



export async function bootstrapOrgExample(deps: OrgBootstrapDeps): Promise<{ bootstrapped: boolean; reason?: string }> {

  if (deps.orgAlreadyConfigured) {

    return { bootstrapped: false, reason: "already_configured" };

  }

  if (!deps.employeeStore || !deps.toolPolicyStore || !deps.agentConfigStore) {

    throw new Error("Organization stores are not available.");

  }



  const positionPreset = getPositionCapabilityPreset(DEFAULT_POSITION_ID);

  if (!positionPreset) {

    throw new Error(`Missing position preset: ${DEFAULT_POSITION_ID}`);

  }



  const orgPath = deps.orgConfigPath ?? defaultOrgConfigPath();

  const orgRoot = defaultOrgRoot(path.dirname(orgPath));

  const skillRoot = path.join(path.dirname(orgRoot), "skills");

  await mkdir(path.dirname(orgPath), { recursive: true });

  await mkdir(path.join(orgRoot, "policies"), { recursive: true });

  await writeFile(orgPath, `${JSON.stringify(EXAMPLE_ORG, null, 2)}\n`, "utf8");



  await ensureOfficePresetSkills(skillRoot);
  await ensureMediaPresetSkills(skillRoot);
  await seedPresetSkills(skillRoot);

  await deps.employeeStore.save(EXAMPLE_EMPLOYEES);

  await deps.toolPolicyStore.save(EXAMPLE_POLICIES);

  await deps.agentConfigStore.save({

    profiles: [

      {

        id: "dev-01",

        name: "开发-小龙",

        description: "后端开发、代码评审、Bug 修复",

        memoryEnabled: true,

        toolsEnabled: true,

        systemPrompt: mergeRoleAndWorkflow(positionPreset.role, positionPreset.workflow),

      },

    ],

    defaultProfileId: "dev-01",

  });



  const workspaceDir = path.join(orgRoot, "workspaces", "dev-01");

  await saveEmployeeWorkspaceFiles({

    workspace: workspaceDir,

    role: positionPreset.role,

    workflow: positionPreset.workflow,

    memory: positionPreset.memory,

    enabledSkills: positionPreset.enabledSkills,

  });



  return { bootstrapped: true };

}



export { EMPLOYEE_WORKSPACE_FILES };

