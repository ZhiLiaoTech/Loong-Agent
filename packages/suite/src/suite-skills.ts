import { promises as fs } from "node:fs";
import path from "node:path";
import type { SuiteManifest } from "./suite-manifest.js";

export interface CopySkillsResult {
  copied: string[];
  missing: string[];
  skillRoot: string;
}

/**
 * Copy each declared skill from the suite workspace into the Loong skill root
 * (`<dataRoot>/skills/<id>`), mirroring the preset-skill install model used by
 * `@loong/gateway` (`installPresetSkills`). A declared skill without a
 * `SKILL.md` is reported as missing rather than copied.
 */
export async function copySuiteSkills(
  manifest: SuiteManifest,
  workspaceDir: string,
  dataRoot: string,
): Promise<CopySkillsResult> {
  const skillRoot = path.join(dataRoot, "skills");
  await fs.mkdir(skillRoot, { recursive: true });

  const copied: string[] = [];
  const missing: string[] = [];

  for (const skillId of manifest.skills) {
    const from = path.join(workspaceDir, "skills", skillId);
    try {
      await fs.access(path.join(from, "SKILL.md"));
    } catch {
      missing.push(skillId);
      continue;
    }
    const to = path.join(skillRoot, skillId);
    await fs.rm(to, { recursive: true, force: true });
    await fs.cp(from, to, { recursive: true });
    copied.push(skillId);
  }

  return { copied, missing, skillRoot };
}
