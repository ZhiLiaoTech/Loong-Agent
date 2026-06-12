import path from "node:path";
import {
  createFileEmployeeStore,
  createFileToolPolicyStore,
  defaultEmployeeConfigPath,
  defaultToolPolicyConfigPath,
} from "@loong/org";
import type { SuiteManifest } from "./suite-manifest.js";
import { buildToolPolicyRules } from "./suite-permissions.js";

export interface RegisterOrgResult {
  toolPolicyId: string;
  toolPolicyFile: string;
  employeeId: string;
  employeeFile: string;
}

/**
 * Resolve the org config root. With an explicit data root we nest org config
 * under `<dataRoot>/org`; otherwise we defer to `@loong/org`'s own defaults
 * (which honour `LOONG_ORG_ROOT` / `LOONG_*_CONFIG`) so the gateway reads the
 * same files it always does.
 */
function orgRootFor(dataRoot: string | undefined): string | undefined {
  return dataRoot ? path.join(path.resolve(dataRoot), "org") : undefined;
}

/**
 * P6-b finish: write the suite's tool policy into the live `@loong/org`
 * ToolPolicyStore and register a DigitalEmployee that references it. Uses the
 * canonical `@loong/org` stores so format/paths match the gateway exactly.
 * The org stores perform no referential validation, so a standalone employee
 * with a fresh `toolPolicyId` is safe without bootstrapping units/positions.
 */
export async function registerSuiteInOrg(
  manifest: SuiteManifest,
  dataRoot: string | undefined,
  workspaceDir?: string,
): Promise<RegisterOrgResult> {
  const orgRoot = orgRootFor(dataRoot);
  const toolPolicyFile = orgRoot ? defaultToolPolicyConfigPath(orgRoot) : defaultToolPolicyConfigPath();
  const employeeFile = orgRoot ? defaultEmployeeConfigPath(orgRoot) : defaultEmployeeConfigPath();
  const policyId = `suite:${manifest.id}`;

  const policyStore = createFileToolPolicyStore(toolPolicyFile);
  const policyDoc = await policyStore.load();
  await policyStore.save({
    ...policyDoc,
    policies: [
      ...policyDoc.policies.filter((policy) => policy.id !== policyId),
      {
        id: policyId,
        description: `Tool policy for suite ${manifest.id}`,
        rules: buildToolPolicyRules(manifest.permissions, workspaceDir),
      },
    ],
  });

  const employeeStore = createFileEmployeeStore(employeeFile);
  const registry = await employeeStore.load();
  await employeeStore.save({
    ...registry,
    employees: [
      ...registry.employees.filter((employee) => employee.id !== manifest.id),
      {
        id: manifest.id,
        displayName: manifest.identity?.name ?? manifest.name,
        profileId: manifest.id,
        positionId: "suite",
        unitId: "suites",
        status: "active",
        toolPolicyId: policyId,
      },
    ],
  });

  return { toolPolicyId: policyId, toolPolicyFile, employeeId: manifest.id, employeeFile };
}
