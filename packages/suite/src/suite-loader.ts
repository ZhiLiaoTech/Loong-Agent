import { promises as fs } from "node:fs";
import path from "node:path";
import { loongConfigDir } from "./paths.js";
import { buildAgentProfile, type SuiteAgentProfile } from "./suite-to-loong.js";
import type { SuiteManifest } from "./suite-manifest.js";

interface AgentsConfigFile {
  profiles: SuiteAgentProfile[];
  defaultProfileId?: string;
  [key: string]: unknown;
}

/**
 * Register (or upsert) a suite as a Loong agent profile in
 * `<dataRoot>/config/agents.json`. Existing non-suite fields are preserved.
 */
export async function registerSuiteAgentProfile(
  manifest: SuiteManifest,
  workspaceDir: string,
  dataRoot: string,
): Promise<SuiteAgentProfile> {
  const profile = await buildAgentProfile(manifest, workspaceDir);
  const agentsPath = path.join(loongConfigDir(dataRoot), "agents.json");
  await fs.mkdir(path.dirname(agentsPath), { recursive: true });

  let config: AgentsConfigFile = { profiles: [] };
  try {
    const text = await fs.readFile(agentsPath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as AgentsConfigFile).profiles)) {
      config = parsed as AgentsConfigFile;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  config.profiles = config.profiles.filter((existing) => existing.id !== profile.id);
  config.profiles.push(profile);

  await fs.writeFile(agentsPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return profile;
}
