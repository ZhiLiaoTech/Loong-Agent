import { promises as fs } from "node:fs";
import path from "node:path";
import type { SuiteManifest, SuitePermissions } from "./suite-manifest.js";

export type ToolDecision = "allow" | "deny" | "ask" | "approval";
export type ToolRisk = "low" | "medium" | "high" | "critical";

/** Shape-compatible with `@loong/org` `ToolPolicyRule`. */
export interface ToolPolicyRule {
  id?: string;
  match: { toolName?: string; capability?: string; inputPathContains?: string };
  risk?: ToolRisk;
  decision: ToolDecision;
  reason?: string;
}

/**
 * Translate a suite's permission declaration into Loong org tool-policy rules.
 *
 * Capability allows (`read`, `network`) open the gates so the file/search/
 * browser tools the gateway exposes are usable by this employee without
 * per-call approval. Writes are allowed inside the suite workspace and any
 * declared filesystem paths, and prompt (`ask`) elsewhere. Shell stays denied
 * when the suite declares `shell: false`. Browser interact/publish domains
 * become explicit allow rules matched by request path/URL.
 */
export function buildToolPolicyRules(
  permissions: SuitePermissions | undefined,
  workspaceDir?: string,
): ToolPolicyRule[] {
  const rules: ToolPolicyRule[] = [];

  // Read + network: enable file read/search, web search and browser navigation.
  rules.push({
    match: { capability: "read" },
    decision: "allow",
    risk: "low",
    reason: "read files and pages",
  });
  rules.push({
    match: { capability: "network" },
    decision: "allow",
    risk: "medium",
    reason: "web search and browser access",
  });

  // Writes: allow inside the workspace + declared filesystem paths; ask elsewhere.
  const writeAllow: string[] = [];
  if (workspaceDir) {
    writeAllow.push(workspaceDir);
  }
  for (const allowed of permissions?.filesystem ?? []) {
    writeAllow.push(allowed);
  }
  for (const allowed of writeAllow) {
    rules.push({
      match: { capability: "write", inputPathContains: allowed },
      decision: "allow",
      risk: "medium",
      reason: "write inside suite workspace / filesystem allowlist",
    });
  }
  rules.push({
    match: { capability: "write" },
    decision: "ask",
    risk: "medium",
    reason: "write outside allowlist",
  });

  // Execute: follow the suite's shell declaration.
  if (permissions?.shell === true) {
    rules.push({
      match: { capability: "execute" },
      decision: "ask",
      risk: "high",
      reason: "suite allows shell",
    });
  } else {
    rules.push({
      match: { capability: "execute" },
      decision: "deny",
      risk: "high",
      reason: "suite declares shell: false",
    });
  }

  // Browser domain allowlist (interact + publish) -> explicit allow by URL match.
  const domains = new Set<string>([
    ...(permissions?.browserInteract ?? []),
    ...(permissions?.browserPublish ?? []),
  ]);
  for (const domain of domains) {
    rules.push({
      match: { inputPathContains: domain },
      decision: "allow",
      risk: "medium",
      reason: "suite browser domain allowlist",
    });
  }

  return rules;
}

export interface SuiteToolPolicy {
  suiteId: string;
  rules: ToolPolicyRule[];
  browserReadonly?: boolean;
  browserInteract?: string[];
  browserPublish?: string[];
  mcpServers?: string[];
}

export function buildSuiteToolPolicy(manifest: SuiteManifest, workspaceDir?: string): SuiteToolPolicy {
  const permissions = manifest.permissions;
  return {
    suiteId: manifest.id,
    rules: buildToolPolicyRules(permissions, workspaceDir),
    ...(permissions?.browserReadonly !== undefined ? { browserReadonly: permissions.browserReadonly } : {}),
    ...(permissions?.browserInteract ? { browserInteract: permissions.browserInteract } : {}),
    ...(permissions?.browserPublish ? { browserPublish: permissions.browserPublish } : {}),
    ...(permissions?.mcpServers ? { mcpServers: permissions.mcpServers } : {}),
  };
}

/**
 * Persist the generated policy as a portable artifact under the suite workspace
 * (`.loong-suite/tool-policy.json`), alongside the live `@loong/org` write.
 */
export async function writeSuiteToolPolicy(workspaceDir: string, policy: SuiteToolPolicy): Promise<string> {
  const dir = path.join(workspaceDir, ".loong-suite");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "tool-policy.json");
  await fs.writeFile(file, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
  return file;
}
