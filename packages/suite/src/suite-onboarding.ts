import { promises as fs } from "node:fs";
import path from "node:path";
import type { SuiteManifest } from "./suite-manifest.js";

export interface OnboardingResult {
  seeded: boolean;
  userFile?: string;
}

/**
 * Seed `USER.md` from the suite's onboarding template (e.g.
 * `soul/USER.md.template`) on first install. Never overwrites an existing
 * USER.md — that is the user's filled-in profile, which is preserved across
 * upgrades (see PRESERVE_ON_UPGRADE in suite-install).
 */
export async function applyOnboarding(
  manifest: SuiteManifest,
  workspaceDir: string,
): Promise<OnboardingResult> {
  const onboarding = manifest.onboarding;
  if (!onboarding?.enabled || !onboarding.template) {
    return { seeded: false };
  }

  const userFile = path.join(workspaceDir, "USER.md");
  try {
    await fs.access(userFile);
    return { seeded: false, userFile };
  } catch {
    // not present yet — seed below
  }

  let template: string;
  try {
    template = await fs.readFile(path.join(workspaceDir, onboarding.template), "utf8");
  } catch {
    return { seeded: false };
  }

  await fs.writeFile(userFile, template, "utf8");
  return { seeded: true, userFile };
}
