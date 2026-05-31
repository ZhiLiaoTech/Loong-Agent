import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Permission declaration carried by a ClawWorks-style suite.
 * Field names are normalized from the on-disk snake_case to camelCase.
 */
export interface SuitePermissions {
  browserReadonly?: boolean;
  browserInteract?: string[];
  browserPublish?: string[];
  filesystem?: string[];
  shell?: boolean;
  mcpServers?: string[];
}

export interface SuitePipelineStage {
  stage: string;
  skill: string;
  description?: string;
}

/**
 * Parsed `suite.json` (or legacy `manifest.json`).
 *
 * NOTE: `ui.json` is intentionally NOT modeled here beyond `uiConfigPath`.
 * Loong keeps it for ClawWorks compatibility but never parses or renders it.
 */
export interface SuiteManifest {
  id: string;
  name: string;
  version: string;
  icon?: string;
  color?: string;
  description?: string;
  author?: string;
  license?: string;
  minRuntimeVersion?: string;
  identity?: { name?: string; emoji?: string };
  skills: string[];
  requiredModels?: string[];
  defaultModelRouting?: Record<string, string>;
  pipeline?: { description?: string; stages: SuitePipelineStage[] };
  permissions?: SuitePermissions;
  supportedPlatforms?: unknown[];
  onboarding?: { enabled?: boolean; template?: string; firstTaskAfterOnboarding?: boolean };
  /** Path to ui.json, kept for compatibility only. Never parsed or rendered. */
  uiConfigPath?: string;
  /** Original manifest JSON, preserved verbatim. */
  raw: unknown;
}

const MANIFEST_FILES = ["suite.json", "manifest.json"] as const;

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Accepts `["a","b"]` or `[{ id: "a" }, { id: "b" }]`. */
function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push(item);
    } else if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
      out.push((item as { id: string }).id);
    }
  }
  return out;
}

export function parseSuiteManifest(raw: unknown): SuiteManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("suite manifest is not a JSON object");
  }
  const obj = raw as Record<string, unknown>;

  const id = asString(obj.id);
  if (!id) {
    throw new Error("suite manifest missing required field: id");
  }

  const permRaw = (obj.permissions ?? {}) as Record<string, unknown>;
  const permissions: SuitePermissions = {
    browserReadonly: asBoolean(permRaw.browser_readonly),
    browserInteract: asStringArray(permRaw.browser_interact),
    browserPublish: asStringArray(permRaw.browser_publish),
    filesystem: asStringArray(permRaw.filesystem),
    shell: asBoolean(permRaw.shell),
    mcpServers: asStringArray(permRaw.mcp_servers),
  };

  const identityRaw = (obj.identity ?? {}) as Record<string, unknown>;
  const onboardingRaw = (obj.onboarding ?? {}) as Record<string, unknown>;
  const pipelineRaw = obj.pipeline as Record<string, unknown> | undefined;

  return {
    id,
    name: asString(obj.name) ?? id,
    version: asString(obj.version) ?? "0.0.0",
    icon: asString(obj.icon),
    color: asString(obj.color),
    description: asString(obj.description),
    author: asString(obj.author),
    license: asString(obj.license),
    minRuntimeVersion: asString(obj.min_openclaw_version) ?? asString(obj.minRuntimeVersion),
    identity: {
      name: asString(identityRaw.name),
      emoji: asString(identityRaw.emoji),
    },
    skills: asStringArray(obj.skills) ?? [],
    requiredModels: asStringArray(obj.required_models),
    defaultModelRouting:
      obj.default_model_routing && typeof obj.default_model_routing === "object"
        ? (obj.default_model_routing as Record<string, string>)
        : undefined,
    pipeline: pipelineRaw
      ? {
          description: asString(pipelineRaw.description),
          stages: Array.isArray(pipelineRaw.stages)
            ? (pipelineRaw.stages as Array<Record<string, unknown>>).map((stage) => ({
                stage: asString(stage.stage) ?? "",
                skill: asString(stage.skill) ?? "",
                description: asString(stage.description),
              }))
            : [],
        }
      : undefined,
    permissions,
    supportedPlatforms: Array.isArray(obj.supported_platforms)
      ? (obj.supported_platforms as unknown[])
      : undefined,
    onboarding: {
      enabled: asBoolean(onboardingRaw.enabled),
      template: asString(onboardingRaw.template),
      firstTaskAfterOnboarding: asBoolean(onboardingRaw.first_task_after_onboarding),
    },
    raw,
  };
}

async function hasManifest(dir: string): Promise<boolean> {
  for (const file of MANIFEST_FILES) {
    try {
      await fs.access(path.join(dir, file));
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

/** Read and JSON-parse the first of suite.json / manifest.json found in `dir`. */
export async function readManifestFile(dir: string): Promise<unknown> {
  for (const file of MANIFEST_FILES) {
    const fullPath = path.join(dir, file);
    let text: string;
    try {
      text = await fs.readFile(fullPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`failed to parse ${fullPath}: ${(error as Error).message}`);
    }
  }
  return undefined;
}

/**
 * Locate the suite payload directory (the one holding `suite.json`).
 * Handles: the dir itself, `<dir>/workspace`, or a single child suite dir.
 */
export async function resolveSuitePayloadDir(root: string): Promise<string | undefined> {
  if (await hasManifest(root)) {
    return root;
  }
  const workspace = path.join(root, "workspace");
  if (await hasManifest(workspace)) {
    return workspace;
  }
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidate = path.join(root, entry.name);
      if (await hasManifest(candidate)) {
        return candidate;
      }
      const candidateWorkspace = path.join(candidate, "workspace");
      if (await hasManifest(candidateWorkspace)) {
        return candidateWorkspace;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}
