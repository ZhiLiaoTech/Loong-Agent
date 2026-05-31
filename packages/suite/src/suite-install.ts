import { promises as fs } from "node:fs";
import path from "node:path";
import {
  parseSuiteManifest,
  readManifestFile,
  resolveSuitePayloadDir,
  type SuiteManifest,
} from "./suite-manifest.js";
import { loongSuitesDir, resolveLoongDataRoot } from "./paths.js";
import { buildEmployeeWorkspaceFiles, writeEmployeeWorkspaceFiles } from "./suite-to-loong.js";
import { computeManifestDigest } from "./suite-version.js";

export interface InstallOptions {
  /** Override the Loong data root (the `.loong` dir). Defaults to resolution order. */
  dataRoot?: string;
}

export interface InstalledSuite {
  manifest: SuiteManifest;
  /** Absolute path of the installed workspace: `<dataRoot>/suites/<id>`. */
  workspaceDir: string;
  dataRoot: string;
}

/** Paths preserved across an upgrade (runtime state, not shipped content). */
const PRESERVE_ON_UPGRADE: readonly string[] = [
  "memory.md",
  "USER.md",
  path.join("data", "memory"),
  path.join("data", "drafts"),
];

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function verifySkillIntegrity(payloadDir: string, manifest: SuiteManifest): Promise<void> {
  const missing: string[] = [];
  for (const skillId of manifest.skills) {
    const skillMd = path.join(payloadDir, "skills", skillId, "SKILL.md");
    if (!(await pathExists(skillMd))) {
      missing.push(skillId);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `suite "${manifest.id}" declares skills with no SKILL.md: ${missing.join(", ")}`,
    );
  }
}

/**
 * Install a suite from an already-extracted local directory.
 *
 * P6-a scope: no download/unzip here — `sourceDir` is a folder that contains
 * (or whose `workspace/` or single child contains) a `suite.json`.
 *
 * Steps: locate payload -> parse manifest -> verify skills -> copy into a
 * staging dir -> preserve runtime files on upgrade -> generate Loong employee
 * workspace files -> atomic-ish swap into `<dataRoot>/suites/<id>`.
 *
 * `ui.json` is copied verbatim and recorded on `manifest.uiConfigPath`, but is
 * never parsed or rendered.
 */
export async function installSuiteFromDirectory(
  sourceDir: string,
  options: InstallOptions = {},
): Promise<InstalledSuite> {
  const absSource = path.resolve(sourceDir);
  const payloadDir = await resolveSuitePayloadDir(absSource);
  if (!payloadDir) {
    throw new Error(`no suite.json/manifest.json found under ${absSource}`);
  }

  const raw = await readManifestFile(payloadDir);
  const manifest = parseSuiteManifest(raw);
  await verifySkillIntegrity(payloadDir, manifest);

  const dataRoot = options.dataRoot ? path.resolve(options.dataRoot) : resolveLoongDataRoot();
  const suitesDir = loongSuitesDir(dataRoot);
  const dest = path.join(suitesDir, manifest.id);
  const staging = path.join(suitesDir, `${manifest.id}.__staging__`);
  const backup = path.join(suitesDir, `${manifest.id}.__backup__`);

  // Fresh staging copy of the shipped payload.
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  await fs.cp(payloadDir, staging, { recursive: true });

  // ui.json: kept for compatibility, never parsed/rendered.
  if (await pathExists(path.join(staging, "ui.json"))) {
    manifest.uiConfigPath = path.join(dest, "ui.json");
  }

  // Preserve runtime state from a previous install.
  const destExists = await pathExists(dest);
  if (destExists) {
    for (const rel of PRESERVE_ON_UPGRADE) {
      const from = path.join(dest, rel);
      if (await pathExists(from)) {
        const to = path.join(staging, rel);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.rm(to, { recursive: true, force: true });
        await fs.cp(from, to, { recursive: true });
      }
    }
  }

  // Generate Loong employee-workspace files (role/workflow/memory/skills.enabled).
  const workspaceFiles = await buildEmployeeWorkspaceFiles(manifest, staging);
  await writeEmployeeWorkspaceFiles(staging, workspaceFiles);

  // Install metadata.
  const metaDir = path.join(staging, ".loong-suite");
  await fs.mkdir(metaDir, { recursive: true });
  await fs.writeFile(
    path.join(metaDir, "meta.json"),
    `${JSON.stringify(
      {
        id: manifest.id,
        version: manifest.version,
        digest: computeManifestDigest(manifest),
        installedAt: new Date().toISOString(),
        source: absSource,
        uiConfigPath: manifest.uiConfigPath ?? null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  // Atomic-ish swap.
  await fs.rm(backup, { recursive: true, force: true });
  if (destExists) {
    await fs.rename(dest, backup);
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(staging, dest);
  } catch (error) {
    if (destExists) {
      await fs.rename(backup, dest).catch(() => undefined);
    }
    throw error;
  }
  await fs.rm(backup, { recursive: true, force: true });

  return { manifest, workspaceDir: dest, dataRoot };
}
