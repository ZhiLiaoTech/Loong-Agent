import { access, cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultOrgRoot,
  listPresetSkillCatalog,
  MANDATORY_PRESET_SKILL_NAMES,
  MEDIA_PRESET_SKILL_NAMES,
  OFFICE_PRESET_SKILL_NAMES,
} from "@loong/org";

function resolvePresetSkillsBundleRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, "preset-skills"),
    path.join(moduleDir, "../preset-skills"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }
  return path.resolve(candidates[0]!);
}

let cachedPresetSkillsBundleRoot: string | undefined;

function presetSkillsBundleRoot(): string {
  cachedPresetSkillsBundleRoot ??= resolvePresetSkillsBundleRoot();
  return cachedPresetSkillsBundleRoot;
}

function defaultSkillRoot(): string {
  return path.join(path.dirname(defaultOrgRoot()), "skills");
}

export function resolveSkillRootsForSeeding(skillRoots?: readonly string[]): string[] {
  const configured = skillRoots?.map(root => path.resolve(root.trim())).filter(Boolean) ?? [];
  if (configured.length > 0) {
    return [...new Set(configured)];
  }
  return [defaultSkillRoot()];
}

async function skillInstalled(skillRoot: string, skillName: string): Promise<boolean> {
  try {
    await access(path.join(skillRoot, skillName, "SKILL.md"));
    return true;
  } catch {
    return false;
  }
}

async function copyPresetSkill(skillRoot: string, skillName: string): Promise<void> {
  const sourceDir = path.join(presetSkillsBundleRoot(), skillName);
  const targetDir = path.join(skillRoot, skillName);
  await cp(sourceDir, targetDir, { recursive: true, force: true });
}

async function installPresetSkills(skillRoot: string, skillNames: readonly string[], force: boolean): Promise<void> {
  const targetRoot = path.resolve(skillRoot);
  await mkdir(targetRoot, { recursive: true });
  for (const skillName of skillNames) {
    if (force || !(await skillInstalled(targetRoot, skillName))) {
      await copyPresetSkill(targetRoot, skillName);
    }
  }
}

export async function ensureOfficePresetSkills(skillRoot: string = defaultSkillRoot()): Promise<void> {
  await installPresetSkills(skillRoot, OFFICE_PRESET_SKILL_NAMES, true);
}

export async function ensureMediaPresetSkills(skillRoot: string = defaultSkillRoot()): Promise<void> {
  await installPresetSkills(skillRoot, MEDIA_PRESET_SKILL_NAMES, true);
}

export async function seedPresetSkills(skillRoot: string): Promise<void> {
  const targetRoot = path.resolve(skillRoot);
  await mkdir(targetRoot, { recursive: true });
  const entries = await readdir(presetSkillsBundleRoot(), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    await copyPresetSkill(targetRoot, entry.name);
  }
}

export async function seedMandatoryPresetSkills(skillRoots?: readonly string[]): Promise<string[]> {
  const warnings: string[] = [];
  for (const skillRoot of resolveSkillRootsForSeeding(skillRoots)) {
    try {
      await installPresetSkills(skillRoot, MANDATORY_PRESET_SKILL_NAMES, false);
    } catch (error) {
      warnings.push(
        `Failed to install mandatory preset skills in ${skillRoot}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return warnings;
}

export async function ensurePresetSkillsReady(skillRoot: string = defaultSkillRoot()): Promise<void> {
  await installPresetSkills(skillRoot, MANDATORY_PRESET_SKILL_NAMES, false);
}

export function mergePresetSkillsWithRuntime(
  runtimeSkills: Array<{ name: string; description: string; category?: string }>,
): Array<{ name: string; description: string; category?: string; preset: boolean }> {
  const catalog = listPresetSkillCatalog();
  const merged = new Map<string, { name: string; description: string; category?: string; preset: boolean }>();

  for (const entry of catalog) {
    merged.set(entry.name, {
      name: entry.name,
      description: entry.description,
      category: entry.category,
      preset: true,
    });
  }
  for (const skill of runtimeSkills) {
    const existing = merged.get(skill.name);
    const entry: { name: string; description: string; category?: string; preset: boolean } = {
      name: skill.name,
      description: skill.description || existing?.description || "",
      preset: existing?.preset ?? false,
    };
    const category = skill.category ?? existing?.category;
    if (category) {
      entry.category = category;
    }
    merged.set(skill.name, entry);
  }

  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}
