import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import { loongSuitesDir, resolveLoongDataRoot } from "./paths.js";
import { parseSuiteManifest, readManifestFile, resolveSuitePayloadDir } from "./suite-manifest.js";
import {
  installSuiteFromDirectory,
  type InstallOptions,
  type InstalledSuite,
} from "./suite-install.js";
import { registerSuiteAgentProfile } from "./suite-loader.js";
import { copySuiteSkills } from "./suite-skills.js";
import { importSuiteCrons } from "./suite-crons.js";
import { buildSuiteToolPolicy, writeSuiteToolPolicy } from "./suite-permissions.js";
import { registerSuiteInOrg } from "./suite-org.js";
import { applyOnboarding } from "./suite-onboarding.js";
import { buildDelegationPlan, writeDelegationPlan } from "./suite-pipeline.js";
import { computeManifestDigest, isSuiteUpToDate, readInstalledSuiteMeta } from "./suite-version.js";
import {
  downloadAndExtractSuite,
  extractZipFileToTempDir,
  type DownloadOptions,
} from "./suite-fetch.js";

export * from "./suite-manifest.js";
export * from "./suite-to-loong.js";
export * from "./suite-install.js";
export * from "./suite-loader.js";
export * from "./suite-skills.js";
export * from "./suite-crons.js";
export * from "./suite-permissions.js";
export * from "./suite-org.js";
export * from "./suite-onboarding.js";
export * from "./suite-pipeline.js";
export * from "./suite-version.js";
export * from "./suite-fetch.js";
export * from "./cron-schedule.js";
export { resolveLoongDataRoot, loongConfigDir, loongSuitesDir } from "./paths.js";

export interface InstallSuiteOptions extends InstallOptions {
  /** Copy declared skills into `<dataRoot>/skills` (default true). */
  copySkills?: boolean;
  /** Import `crons.json` into `<dataRoot>/cron/jobs.json` (default true). */
  importCrons?: boolean;
  /** Write the generated tool-policy artifact under the workspace (default true). */
  writeToolPolicy?: boolean;
  /** Register tool policy + DigitalEmployee in the live `@loong/org` stores (default true). */
  registerInOrg?: boolean;
  /** Seed USER.md from the onboarding template on first install (default true). */
  onboarding?: boolean;
  /** Emit the pipeline → delegation plan artifact (default true). */
  emitPipeline?: boolean;
  /** Skip the install entirely if the installed version/digest already matches. */
  skipIfUpToDate?: boolean;
}

export interface InstallAndRegisterResult extends InstalledSuite {
  profileId: string;
  skillsCopied: string[];
  skillsMissing: string[];
  cronsImported: number;
  cronJobsFile?: string;
  toolPolicyFile?: string;
  orgToolPolicyId?: string;
  orgToolPolicyFile?: string;
  orgEmployeeId?: string;
  orgEmployeeFile?: string;
  onboardingUserFile?: string;
  onboardingSeeded?: boolean;
  pipelinePlanFile?: string;
  /** True when the install was skipped because it was already up to date. */
  skipped?: boolean;
}

/**
 * Install a suite from a local directory and wire it into Loong: agent profile,
 * skills, crons, tool-policy, live org tool policy + employee, onboarding, and
 * pipeline → delegation plan. Honours `skipIfUpToDate`.
 */
export async function installSuite(
  sourceDir: string,
  options: InstallSuiteOptions = {},
): Promise<InstallAndRegisterResult> {
  if (options.skipIfUpToDate) {
    const payloadDir = await resolveSuitePayloadDir(path.resolve(sourceDir));
    if (payloadDir) {
      const candidate = parseSuiteManifest(await readManifestFile(payloadDir));
      const root = options.dataRoot ? path.resolve(options.dataRoot) : resolveLoongDataRoot();
      const installedMeta = await readInstalledSuiteMeta(candidate.id, root);
      if (isSuiteUpToDate(installedMeta, { version: candidate.version, digest: computeManifestDigest(candidate) })) {
        return {
          manifest: candidate,
          workspaceDir: path.join(loongSuitesDir(root), candidate.id),
          dataRoot: root,
          profileId: candidate.id,
          skillsCopied: [],
          skillsMissing: [],
          cronsImported: 0,
          skipped: true,
        };
      }
    }
  }

  const installed = await installSuiteFromDirectory(sourceDir, options);
  const { manifest, workspaceDir, dataRoot } = installed;

  const profile = await registerSuiteAgentProfile(manifest, workspaceDir, dataRoot);

  const result: InstallAndRegisterResult = {
    ...installed,
    profileId: profile.id,
    skillsCopied: [],
    skillsMissing: [],
    cronsImported: 0,
    skipped: false,
  };

  if (options.copySkills !== false) {
    const skills = await copySuiteSkills(manifest, workspaceDir, dataRoot);
    result.skillsCopied = skills.copied;
    result.skillsMissing = skills.missing;
  }

  if (options.importCrons !== false) {
    const crons = await importSuiteCrons(manifest, workspaceDir, dataRoot);
    result.cronsImported = crons.imported;
    if (crons.jobsFile) {
      result.cronJobsFile = crons.jobsFile;
    }
  }

  if (options.writeToolPolicy !== false) {
    result.toolPolicyFile = await writeSuiteToolPolicy(workspaceDir, buildSuiteToolPolicy(manifest, workspaceDir));
  }

  if (options.registerInOrg !== false) {
    const org = await registerSuiteInOrg(manifest, options.dataRoot, workspaceDir);
    result.orgToolPolicyId = org.toolPolicyId;
    result.orgToolPolicyFile = org.toolPolicyFile;
    result.orgEmployeeId = org.employeeId;
    result.orgEmployeeFile = org.employeeFile;
  }

  if (options.onboarding !== false) {
    const onboarding = await applyOnboarding(manifest, workspaceDir);
    result.onboardingSeeded = onboarding.seeded;
    if (onboarding.userFile) {
      result.onboardingUserFile = onboarding.userFile;
    }
  }

  if (options.emitPipeline !== false) {
    const plan = buildDelegationPlan(manifest);
    if (plan) {
      result.pipelinePlanFile = await writeDelegationPlan(workspaceDir, plan);
    }
  }

  return result;
}

export interface InstallSuiteFromUrlOptions extends InstallSuiteOptions, DownloadOptions {
  /** Remove the temp extraction dir after install (default true). */
  cleanup?: boolean;
  /** Suite id, used with `skipIfUpToDate` to skip the download when up to date. */
  suiteCode?: string;
  /** Expected version from the catalog, for pre-download skip. */
  expectedVersion?: string;
  /** Expected digest from the catalog, for pre-download skip. */
  expectedDigest?: string;
}

/** P6-c/d: download a suite ZIP from a URL, extract, then install. */
export async function installSuiteFromUrl(
  url: string,
  options: InstallSuiteFromUrlOptions = {},
): Promise<InstallAndRegisterResult> {
  if (options.skipIfUpToDate && options.suiteCode && (options.expectedVersion || options.expectedDigest)) {
    const root = options.dataRoot ? path.resolve(options.dataRoot) : resolveLoongDataRoot();
    const installedMeta = await readInstalledSuiteMeta(options.suiteCode, root);
    if (isSuiteUpToDate(installedMeta, { version: options.expectedVersion, digest: options.expectedDigest })) {
      return {
        manifest: {
          id: options.suiteCode,
          name: options.suiteCode,
          version: installedMeta?.version ?? options.expectedVersion ?? "0.0.0",
          skills: [],
          raw: {},
        },
        workspaceDir: path.join(loongSuitesDir(root), options.suiteCode),
        dataRoot: root,
        profileId: options.suiteCode,
        skillsCopied: [],
        skillsMissing: [],
        cronsImported: 0,
        skipped: true,
      };
    }
  }

  const tempDir = await downloadAndExtractSuite(url, options);
  try {
    return await installSuite(tempDir, options);
  } finally {
    if (options.cleanup !== false) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

/** P6-c: install a suite from a local ZIP file (extract, then install). */
export async function installSuiteFromZipFile(
  zipPath: string,
  options: InstallSuiteOptions & { cleanup?: boolean } = {},
): Promise<InstallAndRegisterResult> {
  const tempDir = await extractZipFileToTempDir(zipPath);
  try {
    return await installSuite(tempDir, options);
  } finally {
    if (options.cleanup !== false) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

export interface InstalledSuiteSummary {
  id: string;
  version: string;
  workspace: string;
}

/** List suites installed under `<dataRoot>/suites`. */
export async function listInstalledSuites(dataRoot?: string): Promise<InstalledSuiteSummary[]> {
  const root = dataRoot ? path.resolve(dataRoot) : resolveLoongDataRoot();
  const dir = loongSuitesDir(root);
  const out: InstalledSuiteSummary[] = [];

  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.includes("__")) {
      continue;
    }
    let version = "0.0.0";
    try {
      const meta = JSON.parse(
        await fs.readFile(path.join(dir, entry.name, ".loong-suite", "meta.json"), "utf8"),
      ) as { version?: unknown };
      if (typeof meta.version === "string") {
        version = meta.version;
      }
    } catch {
      // no/invalid meta — keep default
    }
    out.push({ id: entry.name, version, workspace: path.join(dir, entry.name) });
  }

  return out;
}
