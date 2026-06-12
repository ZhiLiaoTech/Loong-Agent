import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loongSuitesDir, resolveLoongDataRoot } from "./paths.js";
import type { SuiteManifest } from "./suite-manifest.js";

/** Stable content hash of the suite manifest (sha256 of the raw JSON). */
export function computeManifestDigest(manifest: SuiteManifest): string {
  return createHash("sha256").update(JSON.stringify(manifest.raw ?? {})).digest("hex");
}

export interface InstalledSuiteMeta {
  id: string;
  version: string;
  digest?: string;
  installedAt?: string;
  source?: string;
}

/** Read `<dataRoot>/suites/<id>/.loong-suite/meta.json`, or undefined if absent. */
export async function readInstalledSuiteMeta(
  suiteId: string,
  dataRoot?: string,
): Promise<InstalledSuiteMeta | undefined> {
  const root = dataRoot ? path.resolve(dataRoot) : resolveLoongDataRoot();
  const metaPath = path.join(loongSuitesDir(root), suiteId, ".loong-suite", "meta.json");
  try {
    return JSON.parse(await fs.readFile(metaPath, "utf8")) as InstalledSuiteMeta;
  } catch {
    return undefined;
  }
}

/**
 * Decide whether an installed suite already matches a candidate. Prefers digest
 * comparison when both sides have one; falls back to version equality.
 */
export function isSuiteUpToDate(
  installed: InstalledSuiteMeta | undefined,
  candidate: { version?: string; digest?: string },
): boolean {
  if (!installed) {
    return false;
  }
  if (candidate.digest && installed.digest) {
    return installed.digest === candidate.digest;
  }
  if (candidate.version) {
    return installed.version === candidate.version;
  }
  return false;
}
