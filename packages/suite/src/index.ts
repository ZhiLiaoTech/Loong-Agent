import type { Dirent } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { downloadAndExtractSuite, extractZipFileToTempDir, type DownloadOptions } from "./suite-fetch.js";
import { resolveLoongDataRoot } from "./paths.js";
import { parseSuiteManifest } from "./suite-manifest.js";
import { buildDelegationPlan, writeDelegationPlan } from "./suite-pipeline.js";

const DEFAULT_MAX_TEXT_FILE_BYTES = 256 * 1024;

export const LOONG_SUITE_RELEASE_RECORD_SCHEMA_VERSION = "loong.suite.release.v1";
export const LOONG_SUITE_INSTANCE_RECORD_SCHEMA_VERSION = "loong.suite.instance.v1";

export interface LoongSuiteLoadOptions {
  maxTextFileBytes?: number;
}

export interface LoongSuiteManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  schemaVersion?: string;
  uiConfigPath?: string;
  raw: Record<string, unknown>;
}

export interface LoongSuiteIdentity {
  roleJson?: unknown;
  soul?: string;
  agents?: string;
  userTemplate?: string;
}

export interface LoongSuiteSkill {
  name: string;
  slug: string;
  rootDir: string;
  skillPath: string;
  content: string;
}

export interface LoongSuiteFileRef {
  path: string;
  size: number;
}

export type LoongSuiteIssueSeverity = "error" | "warning";

export interface LoongSuiteValidationIssue {
  severity: LoongSuiteIssueSeverity;
  code: string;
  message: string;
  path?: string;
}

export type LoongSuiteWarning = LoongSuiteValidationIssue & { severity: "warning" };

export interface LoongSuitePackage {
  rootDir: string;
  workspaceDir: string;
  manifest: LoongSuiteManifest;
  identity: LoongSuiteIdentity;
  skills: LoongSuiteSkill[];
  configFiles: LoongSuiteFileRef[];
  schemaFiles: LoongSuiteFileRef[];
  warnings: LoongSuiteWarning[];
  ui?: unknown;
  policy?: unknown;
  crons?: unknown;
}

export interface LoongSuiteMaterializeReleaseOptions extends LoongSuiteLoadOptions {
  dataDir: string;
  overwrite?: boolean;
  installedAt?: string;
}

export interface LoongSuiteReleaseRecord {
  schemaVersion: typeof LOONG_SUITE_RELEASE_RECORD_SCHEMA_VERSION;
  suiteId: string;
  suiteName: string;
  suiteVersion: string;
  workspacePath: "workspace";
  installedAt: string;
  warnings: LoongSuiteWarning[];
}

export interface LoongSuiteReleaseMaterialization {
  suite: LoongSuitePackage;
  releaseDir: string;
  releaseWorkspaceDir: string;
  recordPath: string;
  record: LoongSuiteReleaseRecord;
}

export interface LoongSuiteMaterializeInstanceOptions extends LoongSuiteLoadOptions {
  dataDir: string;
  tenantId: string;
  agentInstanceId: string;
  suiteId: string;
  suiteVersion: string;
  employeeId?: string;
  overwrite?: boolean;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface LoongSuiteLoadInstanceOptions extends LoongSuiteLoadOptions {
  dataDir: string;
  tenantId: string;
  agentInstanceId: string;
}

export interface LoongSuiteInstanceRecord {
  schemaVersion: typeof LOONG_SUITE_INSTANCE_RECORD_SCHEMA_VERSION;
  tenantId: string;
  agentInstanceId: string;
  suiteId: string;
  suiteVersion: string;
  createdAt: string;
  releaseRef: {
    suiteId: string;
    version: string;
  };
  runtime: {
    workspacePath: "workspace";
    sessionPath: "sessions";
    memoryPath: "memory";
    instanceSkillPath: "skills";
    suiteSkillPath: string;
    skillRoots: string[];
  };
  employeeId?: string;
  metadata?: Record<string, unknown>;
}

export interface LoongSuiteInstanceMaterialization {
  suite: LoongSuitePackage;
  instanceDir: string;
  recordPath: string;
  record: LoongSuiteInstanceRecord;
  runtimePaths: {
    workspaceDir: string;
    sessionDir: string;
    memoryDir: string;
    instanceSkillDir: string;
    suiteSkillDir: string;
    skillRoots: string[];
  };
}

export interface LoongSuiteInstanceRuntimeContext extends LoongSuiteInstanceMaterialization {
  turnDefaults: {
    workspace: string;
    systemPrompt: string;
    metadata: Record<string, unknown>;
  };
  skillRoots: string[];
}

export class LoongSuiteError extends Error {
  readonly code: string;
  readonly path?: string;

  constructor(code: string, message: string, options: { path?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LoongSuiteError";
    this.code = code;
    if (options.path !== undefined) {
      this.path = options.path;
    }
  }
}

export async function loadSuiteWorkspace(
  inputDir: string,
  options: LoongSuiteLoadOptions = {},
): Promise<LoongSuitePackage> {
  const resolvedInputDir = path.resolve(inputDir);
  const { rootDir, workspaceDir } = await resolveSuiteWorkspace(resolvedInputDir);
  const warnings: LoongSuiteWarning[] = [];

  const manifest = normalizeSuiteManifest(await readRequiredJson(workspaceDir, "suite.json", options));
  const identity: LoongSuiteIdentity = {};
  const roleJson = await readOptionalJson(workspaceDir, "role.json", options);
  const soul = await readOptionalText(workspaceDir, "soul/SOUL.md", options);
  const agents = await readOptionalText(workspaceDir, "soul/AGENTS.md", options);
  const userTemplate = await readOptionalText(workspaceDir, "soul/USER.md.template", options);
  const ui = await readOptionalJson(workspaceDir, "ui.json", options);
  const policy = await readOptionalJson(workspaceDir, "policy.json", options);
  const crons = await readOptionalJson(workspaceDir, "crons.json", options);
  const skills = await readSkills(workspaceDir, options, warnings);
  const configFiles = await listFileRefs(workspaceDir, "config");
  const schemaFiles = await listFileRefs(workspaceDir, "schemas");

  if (roleJson !== undefined) {
    identity.roleJson = roleJson;
  }
  if (soul !== undefined) {
    identity.soul = soul;
  }
  if (agents !== undefined) {
    identity.agents = agents;
  }
  if (userTemplate !== undefined) {
    identity.userTemplate = userTemplate;
  }

  const suitePackage: LoongSuitePackage = {
    rootDir,
    workspaceDir,
    manifest,
    identity,
    skills,
    configFiles,
    schemaFiles,
    warnings,
  };
  if (ui !== undefined) {
    suitePackage.ui = ui;
  }
  if (policy !== undefined) {
    suitePackage.policy = policy;
  }
  if (crons !== undefined) {
    suitePackage.crons = crons;
  }

  const issues = validateSuitePackage(suitePackage);
  const error = issues.find(issue => issue.severity === "error");
  if (error !== undefined) {
    throw new LoongSuiteError(error.code, error.message, errorOptions(error.path));
  }
  suitePackage.warnings = [...warnings, ...issues.filter(isWarning)];
  return suitePackage;
}

export async function materializeSuiteRelease(
  inputDir: string,
  options: LoongSuiteMaterializeReleaseOptions,
): Promise<LoongSuiteReleaseMaterialization> {
  const sourceSuite = await loadSuiteWorkspace(inputDir, options);
  const dataDir = path.resolve(options.dataDir);
  const suiteId = toSafePathSegment(sourceSuite.manifest.id, "suite id");
  const suiteVersion = toSafePathSegment(sourceSuite.manifest.version, "suite version");
  const releaseDir = resolveDataPath(dataDir, "suites", suiteId, suiteVersion);
  const releaseWorkspaceDir = path.join(releaseDir, "workspace");

  await prepareInstallTarget(releaseDir, options.overwrite === true, "SUITE_RELEASE_EXISTS");
  await mkdir(releaseDir, { recursive: true });
  await cp(sourceSuite.workspaceDir, releaseWorkspaceDir, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });

  const suite = await loadSuiteWorkspace(releaseWorkspaceDir, options);
  const record: LoongSuiteReleaseRecord = {
    schemaVersion: LOONG_SUITE_RELEASE_RECORD_SCHEMA_VERSION,
    suiteId: suite.manifest.id,
    suiteName: suite.manifest.name,
    suiteVersion: suite.manifest.version,
    workspacePath: "workspace",
    installedAt: options.installedAt ?? new Date().toISOString(),
    warnings: suite.warnings,
  };
  const recordPath = path.join(releaseDir, "release.json");
  await writeJsonAtomic(recordPath, record);
  return {
    suite,
    releaseDir,
    releaseWorkspaceDir,
    recordPath,
    record,
  };
}

export async function materializeSuiteInstance(
  options: LoongSuiteMaterializeInstanceOptions,
): Promise<LoongSuiteInstanceMaterialization> {
  const dataDir = path.resolve(options.dataDir);
  const tenantId = toSafePathSegment(options.tenantId, "tenant id");
  const agentInstanceId = toSafePathSegment(options.agentInstanceId, "agent instance id");
  const suiteId = toSafePathSegment(options.suiteId, "suite id");
  const suiteVersion = toSafePathSegment(options.suiteVersion, "suite version");
  const releaseWorkspaceDir = resolveDataPath(dataDir, "suites", suiteId, suiteVersion, "workspace");
  const suite = await loadSuiteWorkspace(releaseWorkspaceDir, options);
  if (suite.manifest.id !== suiteId || suite.manifest.version !== suiteVersion) {
    throw new LoongSuiteError(
      "SUITE_RELEASE_MISMATCH",
      "Installed suite release does not match the requested suite id and version.",
      { path: releaseWorkspaceDir },
    );
  }

  const instanceDir = resolveDataPath(dataDir, "instances", tenantId, agentInstanceId);
  const workspaceDir = path.join(instanceDir, "workspace");
  const sessionDir = path.join(instanceDir, "sessions");
  const memoryDir = path.join(instanceDir, "memory");
  const instanceSkillDir = path.join(instanceDir, "skills");
  const suiteSkillDir = path.join(releaseWorkspaceDir, "skills");
  const suiteSkillPath = toPortablePath(path.relative(instanceDir, suiteSkillDir));
  const skillRoots = [suiteSkillPath, "skills"];

  await prepareInstallTarget(instanceDir, options.overwrite === true, "SUITE_INSTANCE_EXISTS");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  await mkdir(memoryDir, { recursive: true });
  await mkdir(instanceSkillDir, { recursive: true });

  const record: LoongSuiteInstanceRecord = {
    schemaVersion: LOONG_SUITE_INSTANCE_RECORD_SCHEMA_VERSION,
    tenantId,
    agentInstanceId,
    suiteId: suite.manifest.id,
    suiteVersion: suite.manifest.version,
    createdAt: options.createdAt ?? new Date().toISOString(),
    releaseRef: {
      suiteId: suite.manifest.id,
      version: suite.manifest.version,
    },
    runtime: {
      workspacePath: "workspace",
      sessionPath: "sessions",
      memoryPath: "memory",
      instanceSkillPath: "skills",
      suiteSkillPath,
      skillRoots,
    },
  };
  if (options.employeeId !== undefined) {
    record.employeeId = options.employeeId;
  }
  if (options.metadata !== undefined) {
    record.metadata = options.metadata;
  }

  const recordPath = path.join(instanceDir, "suite-instance.json");
  await writeJsonAtomic(recordPath, record);
  return {
    suite,
    instanceDir,
    recordPath,
    record,
    runtimePaths: {
      workspaceDir,
      sessionDir,
      memoryDir,
      instanceSkillDir,
      suiteSkillDir,
      skillRoots: [suiteSkillDir, instanceSkillDir],
    },
  };
}

export async function loadSuiteInstance(
  options: LoongSuiteLoadInstanceOptions,
): Promise<LoongSuiteInstanceMaterialization> {
  const dataDir = path.resolve(options.dataDir);
  const tenantId = toSafePathSegment(options.tenantId, "tenant id");
  const agentInstanceId = toSafePathSegment(options.agentInstanceId, "agent instance id");
  const instanceDir = resolveDataPath(dataDir, "instances", tenantId, agentInstanceId);
  const recordPath = path.join(instanceDir, "suite-instance.json");
  const record = normalizeSuiteInstanceRecord(await readAbsoluteJson(recordPath, "suite-instance.json"));
  const releaseWorkspaceDir = resolveDataPath(dataDir, "suites", record.releaseRef.suiteId, record.releaseRef.version, "workspace");
  const suite = await loadSuiteWorkspace(releaseWorkspaceDir, options);
  if (suite.manifest.id !== record.suiteId || suite.manifest.version !== record.suiteVersion) {
    throw new LoongSuiteError(
      "SUITE_INSTANCE_RELEASE_MISMATCH",
      "Suite instance record does not match the installed suite release.",
      { path: recordPath },
    );
  }
  const workspaceDir = resolveInside(instanceDir, record.runtime.workspacePath);
  const sessionDir = resolveInside(instanceDir, record.runtime.sessionPath);
  const memoryDir = resolveInside(instanceDir, record.runtime.memoryPath);
  const instanceSkillDir = resolveInside(instanceDir, record.runtime.instanceSkillPath);
  const suiteSkillDir = resolveDataPath(dataDir, "suites", record.releaseRef.suiteId, record.releaseRef.version, "workspace", "skills");
  return {
    suite,
    instanceDir,
    recordPath,
    record,
    runtimePaths: {
      workspaceDir,
      sessionDir,
      memoryDir,
      instanceSkillDir,
      suiteSkillDir,
      skillRoots: [suiteSkillDir, instanceSkillDir],
    },
  };
}

export async function resolveSuiteInstanceRuntimeContext(
  options: LoongSuiteLoadInstanceOptions,
): Promise<LoongSuiteInstanceRuntimeContext> {
  const materialized = await loadSuiteInstance(options);
  return {
    ...materialized,
    turnDefaults: {
      workspace: materialized.runtimePaths.workspaceDir,
      systemPrompt: composeSuiteSystemPrompt(materialized.suite, materialized.record),
      metadata: composeSuiteRuntimeMetadata(materialized.record),
    },
    skillRoots: materialized.runtimePaths.skillRoots,
  };
}

export function validateSuitePackage(suitePackage: LoongSuitePackage): LoongSuiteValidationIssue[] {
  const issues: LoongSuiteValidationIssue[] = [];
  if (suitePackage.manifest.id.trim() === "") {
    issues.push({
      severity: "error",
      code: "SUITE_MANIFEST_INVALID",
      message: "suite.json must include a non-empty id.",
      path: "suite.json",
    });
  }
  if (suitePackage.manifest.version.trim() === "") {
    issues.push({
      severity: "error",
      code: "SUITE_MANIFEST_INVALID",
      message: "suite.json must include a non-empty version.",
      path: "suite.json",
    });
  }
  if (
    suitePackage.identity.roleJson === undefined &&
    suitePackage.identity.soul === undefined &&
    suitePackage.identity.agents === undefined
  ) {
    issues.push({
      severity: "warning",
      code: "SUITE_IDENTITY_MISSING",
      message: "Suite workspace has no role.json, soul/SOUL.md, or soul/AGENTS.md identity source.",
    });
  }
  if (suitePackage.skills.length === 0) {
    issues.push({
      severity: "warning",
      code: "SUITE_SKILLS_EMPTY",
      message: "Suite workspace has no skills with SKILL.md.",
      path: "skills",
    });
  }
  return issues;
}

export function assertValidSuitePackage(suitePackage: LoongSuitePackage): void {
  const error = validateSuitePackage(suitePackage).find(issue => issue.severity === "error");
  if (error !== undefined) {
    throw new LoongSuiteError(error.code, error.message, errorOptions(error.path));
  }
}

async function resolveSuiteWorkspace(inputDir: string): Promise<{ rootDir: string; workspaceDir: string }> {
  if (await fileExists(inputDir, "suite.json")) {
    return { rootDir: inputDir, workspaceDir: inputDir };
  }
  const nestedWorkspaceDir = path.join(inputDir, "workspace");
  if (await fileExists(nestedWorkspaceDir, "suite.json")) {
    return { rootDir: inputDir, workspaceDir: nestedWorkspaceDir };
  }
  throw new LoongSuiteError(
    "SUITE_WORKSPACE_NOT_FOUND",
    "Expected suite.json in the given directory or in its workspace/ child.",
    { path: inputDir },
  );
}

async function readSkills(
  workspaceDir: string,
  options: LoongSuiteLoadOptions,
  warnings: LoongSuiteWarning[],
): Promise<LoongSuiteSkill[]> {
  const skillsDir = resolveInside(workspaceDir, "skills");
  const entries = await readDirectoryIfExists(skillsDir);
  const skills: LoongSuiteSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillRelativeRoot = joinSuitePath("skills", entry.name);
    const skillPath = joinSuitePath(skillRelativeRoot, "SKILL.md");
    const content = await readOptionalText(workspaceDir, skillPath, options);
    if (content === undefined) {
      warnings.push({
        severity: "warning",
        code: "SUITE_SKILL_MISSING_SKILL_MD",
        message: `Skill directory ${skillRelativeRoot} has no SKILL.md.`,
        path: skillRelativeRoot,
      });
      continue;
    }
    skills.push({
      name: readSkillName(content, entry.name),
      slug: entry.name,
      rootDir: resolveInside(workspaceDir, skillRelativeRoot),
      skillPath,
      content,
    });
  }
  return skills.sort((left, right) => left.slug.localeCompare(right.slug));
}

async function listFileRefs(workspaceDir: string, relativeDir: string): Promise<LoongSuiteFileRef[]> {
  const absoluteDir = resolveInside(workspaceDir, relativeDir);
  const entries = await readDirectoryIfExists(absoluteDir);
  const files: LoongSuiteFileRef[] = [];
  for (const entry of entries) {
    const relativePath = joinSuitePath(relativeDir, entry.name);
    const absolutePath = resolveInside(workspaceDir, relativePath);
    if (entry.isDirectory()) {
      files.push(...await listFileRefs(workspaceDir, relativePath));
    } else if (entry.isFile()) {
      const item = await stat(absolutePath);
      files.push({ path: relativePath, size: item.size });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function readRequiredJson(
  workspaceDir: string,
  relativePath: string,
  options: LoongSuiteLoadOptions,
): Promise<unknown> {
  const text = await readTextFile(workspaceDir, relativePath, options);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new LoongSuiteError("SUITE_JSON_INVALID", `${relativePath} is not valid JSON.`, {
      path: relativePath,
      cause: error,
    });
  }
}

async function readOptionalJson(
  workspaceDir: string,
  relativePath: string,
  options: LoongSuiteLoadOptions,
): Promise<unknown | undefined> {
  try {
    return await readRequiredJson(workspaceDir, relativePath, options);
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function readOptionalText(
  workspaceDir: string,
  relativePath: string,
  options: LoongSuiteLoadOptions,
): Promise<string | undefined> {
  try {
    return await readTextFile(workspaceDir, relativePath, options);
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function readTextFile(
  workspaceDir: string,
  relativePath: string,
  options: LoongSuiteLoadOptions,
): Promise<string> {
  const absolutePath = resolveInside(workspaceDir, relativePath);
  let item;
  try {
    item = await stat(absolutePath);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw error;
    }
    throw new LoongSuiteError("SUITE_FILE_UNREADABLE", `Unable to read ${relativePath}.`, {
      path: relativePath,
      cause: error,
    });
  }
  if (!item.isFile()) {
    throw new LoongSuiteError("SUITE_FILE_INVALID", `${relativePath} must be a file.`, { path: relativePath });
  }
  const maxBytes = options.maxTextFileBytes ?? DEFAULT_MAX_TEXT_FILE_BYTES;
  if (item.size > maxBytes) {
    throw new LoongSuiteError("SUITE_FILE_TOO_LARGE", `${relativePath} exceeds ${maxBytes} bytes.`, {
      path: relativePath,
    });
  }
  return await readFile(absolutePath, "utf8");
}

function normalizeSuiteManifest(raw: unknown): LoongSuiteManifest {
  const record = requireRecord(raw, "suite.json");
  const id = firstString(record, ["id", "suiteId", "suite_id", "code", "suiteCode", "suite_code"]);
  const name = firstString(record, ["name", "displayName", "display_name", "suiteName", "suite_name"]);
  const version = firstString(record, ["version", "suiteVersion", "suite_version"]);
  if (id === undefined || version === undefined) {
    throw new LoongSuiteError(
      "SUITE_MANIFEST_INVALID",
      "suite.json must include non-empty id and version fields.",
      { path: "suite.json" },
    );
  }
  const manifest: LoongSuiteManifest = {
    id,
    name: name ?? id,
    version,
    raw: record,
  };
  const description = firstString(record, ["description", "summary"]);
  const schemaVersion = firstString(record, ["schemaVersion", "schema_version"]);
  if (description !== undefined) {
    manifest.description = description;
  }
  if (schemaVersion !== undefined) {
    manifest.schemaVersion = schemaVersion;
  }
  return manifest;
}

function normalizeSuiteInstanceRecord(raw: unknown): LoongSuiteInstanceRecord {
  const record = requireRecord(raw, "suite-instance.json");
  const releaseRef = requireRecord(record["releaseRef"], "suite-instance.json.releaseRef");
  const runtime = requireRecord(record["runtime"], "suite-instance.json.runtime");
  const schemaVersion = requiredString(record, "schemaVersion", "suite-instance.json");
  if (schemaVersion !== LOONG_SUITE_INSTANCE_RECORD_SCHEMA_VERSION) {
    throw new LoongSuiteError(
      "SUITE_INSTANCE_RECORD_INVALID",
      `Unsupported suite instance schemaVersion: ${schemaVersion}`,
      { path: "suite-instance.json" },
    );
  }
  const normalized: LoongSuiteInstanceRecord = {
    schemaVersion: LOONG_SUITE_INSTANCE_RECORD_SCHEMA_VERSION,
    tenantId: toSafePathSegment(requiredString(record, "tenantId", "suite-instance.json"), "tenant id"),
    agentInstanceId: toSafePathSegment(requiredString(record, "agentInstanceId", "suite-instance.json"), "agent instance id"),
    suiteId: toSafePathSegment(requiredString(record, "suiteId", "suite-instance.json"), "suite id"),
    suiteVersion: toSafePathSegment(requiredString(record, "suiteVersion", "suite-instance.json"), "suite version"),
    createdAt: requiredString(record, "createdAt", "suite-instance.json"),
    releaseRef: {
      suiteId: toSafePathSegment(requiredString(releaseRef, "suiteId", "suite-instance.json.releaseRef"), "suite id"),
      version: toSafePathSegment(requiredString(releaseRef, "version", "suite-instance.json.releaseRef"), "suite version"),
    },
    runtime: {
      workspacePath: requiredLiteral(runtime, "workspacePath", "workspace", "suite-instance.json.runtime"),
      sessionPath: requiredLiteral(runtime, "sessionPath", "sessions", "suite-instance.json.runtime"),
      memoryPath: requiredLiteral(runtime, "memoryPath", "memory", "suite-instance.json.runtime"),
      instanceSkillPath: requiredLiteral(runtime, "instanceSkillPath", "skills", "suite-instance.json.runtime"),
      suiteSkillPath: requiredString(runtime, "suiteSkillPath", "suite-instance.json.runtime"),
      skillRoots: requiredStringArray(runtime, "skillRoots", "suite-instance.json.runtime"),
    },
  };
  if (typeof record["employeeId"] === "string" && record["employeeId"].trim() !== "") {
    normalized.employeeId = record["employeeId"].trim();
  }
  if (record["metadata"] !== undefined) {
    normalized.metadata = requireRecord(record["metadata"], "suite-instance.json.metadata");
  }
  return normalized;
}

function requireRecord(value: unknown, pathLabel: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LoongSuiteError("SUITE_JSON_INVALID", `${pathLabel} must be a JSON object.`, { path: pathLabel });
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string, pathLabel: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new LoongSuiteError(
      "SUITE_JSON_INVALID",
      `${pathLabel}.${key} must be a non-empty string.`,
      { path: pathLabel },
    );
  }
  return value.trim();
}

function requiredLiteral<T extends string>(
  record: Record<string, unknown>,
  key: string,
  expected: T,
  pathLabel: string,
): T {
  const value = requiredString(record, key, pathLabel);
  if (value !== expected) {
    throw new LoongSuiteError(
      "SUITE_JSON_INVALID",
      `${pathLabel}.${key} must be ${expected}.`,
      { path: pathLabel },
    );
  }
  return expected;
}

function requiredStringArray(record: Record<string, unknown>, key: string, pathLabel: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every(item => typeof item === "string" && item.trim() !== "")) {
    throw new LoongSuiteError(
      "SUITE_JSON_INVALID",
      `${pathLabel}.${key} must be an array of strings.`,
      { path: pathLabel },
    );
  }
  return value.map(item => item.trim());
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return undefined;
}

function readSkillName(content: string, fallback: string): string {
  const line = content.split(/\r?\n/, 1)[0];
  if (line !== undefined) {
    const match = /^#\s+(.+)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[1].trim() !== "") {
      return match[1].trim();
    }
  }
  return fallback;
}

async function readAbsoluteJson(filePath: string, pathLabel: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new LoongSuiteError("SUITE_FILE_NOT_FOUND", `${pathLabel} was not found.`, {
        path: filePath,
        cause: error,
      });
    }
    if (error instanceof SyntaxError) {
      throw new LoongSuiteError("SUITE_JSON_INVALID", `${pathLabel} is not valid JSON.`, {
        path: filePath,
        cause: error,
      });
    }
    throw error;
  }
}

function composeSuiteSystemPrompt(suite: LoongSuitePackage, record: LoongSuiteInstanceRecord): string {
  const sections = [
    `Suite ${suite.manifest.name} (${suite.manifest.id}@${suite.manifest.version})`,
    `Tenant: ${record.tenantId}`,
    `Agent instance: ${record.agentInstanceId}`,
  ];
  if (record.employeeId !== undefined) {
    sections.push(`Digital employee: ${record.employeeId}`);
  }
  if (suite.identity.roleJson !== undefined) {
    sections.push(`Suite role.json\n${JSON.stringify(suite.identity.roleJson, null, 2)}`);
  }
  if (suite.identity.soul !== undefined) {
    sections.push(`Suite soul/SOUL.md\n${suite.identity.soul}`);
  }
  if (suite.identity.agents !== undefined) {
    sections.push(`Suite soul/AGENTS.md\n${suite.identity.agents}`);
  }
  if (suite.identity.userTemplate !== undefined) {
    sections.push(`Suite soul/USER.md.template\n${suite.identity.userTemplate}`);
  }
  return sections.join("\n\n");
}

function composeSuiteRuntimeMetadata(record: LoongSuiteInstanceRecord): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    source: "loong-suite",
    tenantId: record.tenantId,
    agentInstanceId: record.agentInstanceId,
    suiteId: record.suiteId,
    suiteVersion: record.suiteVersion,
  };
  if (record.employeeId !== undefined) {
    metadata["employeeId"] = record.employeeId;
  }
  if (record.metadata !== undefined) {
    metadata["suiteInstance"] = record.metadata;
  }
  return metadata;
}

async function fileExists(rootDir: string, relativePath: string): Promise<boolean> {
  try {
    const item = await stat(resolveInside(rootDir, relativePath));
    return item.isFile();
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function readDirectoryIfExists(absoluteDir: string): Promise<Dirent[]> {
  try {
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    return entries.sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

async function prepareInstallTarget(targetDir: string, overwrite: boolean, existsCode: string): Promise<void> {
  if (!await pathExists(targetDir)) {
    return;
  }
  if (!overwrite) {
    throw new LoongSuiteError(existsCode, `Install target already exists: ${targetDir}`, { path: targetDir });
  }
  await rm(targetDir, { recursive: true, force: true });
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function resolveDataPath(dataDir: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(dataDir);
  const safeSegments = segments.map((segment, index) => toSafePathSegment(segment, `path segment ${index + 1}`));
  const resolvedPath = path.resolve(resolvedRoot, ...safeSegments);
  const rootWithSeparator = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(rootWithSeparator)) {
    throw new LoongSuiteError("SUITE_PATH_ESCAPE", `Path escapes suite data directory: ${segments.join("/")}`, {
      path: segments.join("/"),
    });
  }
  return resolvedPath;
}

function resolveInside(rootDir: string, relativePath: string): string {
  const normalizedRelativePath = normalizeSuiteRelativePath(relativePath);
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRoot, ...normalizedRelativePath.split("/"));
  const rootWithSeparator = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(rootWithSeparator)) {
    throw new LoongSuiteError("SUITE_PATH_ESCAPE", `Path escapes suite workspace: ${relativePath}`, {
      path: relativePath,
    });
  }
  return resolvedPath;
}

function normalizeSuiteRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized === "" || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new LoongSuiteError("SUITE_PATH_INVALID", `Invalid suite-relative path: ${relativePath}`, {
      path: relativePath,
    });
  }
  const parts = normalized.split("/").filter(part => part !== "" && part !== ".");
  if (parts.length === 0 || parts.some(part => part === "..")) {
    throw new LoongSuiteError("SUITE_PATH_INVALID", `Invalid suite-relative path: ${relativePath}`, {
      path: relativePath,
    });
  }
  return parts.join("/");
}

function joinSuitePath(...parts: string[]): string {
  return parts.filter(part => part !== "").join("/");
}

function toSafePathSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._@+-]{0,127}$/.test(normalized)) {
    throw new LoongSuiteError("SUITE_PATH_SEGMENT_INVALID", `Invalid ${label}: ${value}`);
  }
  return normalized;
}

function toPortablePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isWarning(issue: LoongSuiteValidationIssue): issue is LoongSuiteWarning {
  return issue.severity === "warning";
}

function errorOptions(pathValue: string | undefined): { path?: string } {
  return pathValue === undefined ? {} : { path: pathValue };
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
export * from "./suite-fetch.js";
export * from "./cron-schedule.js";
export { resolveLoongDataRoot, loongConfigDir, loongSuitesDir } from "./paths.js";

export interface InstallSuiteOptions extends LoongSuiteLoadOptions {
  /** Compatibility alias used by the suite CLI. Prefer dataDir for hosted runtime code. */
  dataRoot?: string;
  dataDir?: string;
  overwrite?: boolean;
  installedAt?: string;
  /** Skip when the same suite release is already materialized. */
  skipIfUpToDate?: boolean;
}

export interface InstallAndRegisterResult extends LoongSuiteReleaseMaterialization {
  manifest: LoongSuiteManifest;
  workspaceDir: string;
  dataRoot: string;
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
  skipped?: boolean;
}

export interface InstallSuiteFromUrlOptions extends InstallSuiteOptions, DownloadOptions {
  cleanup?: boolean;
  suiteCode?: string;
  expectedVersion?: string;
  expectedDigest?: string;
}

export interface InstalledSuiteSummary {
  id: string;
  version: string;
  workspace: string;
}

export async function installSuite(
  sourceDir: string,
  options: InstallSuiteOptions = {},
): Promise<InstallAndRegisterResult> {
  const dataDir = resolveInstallDataDir(options);
  const suite = await loadSuiteWorkspace(sourceDir, options);
  if (options.skipIfUpToDate === true && await isReleaseMaterialized(dataDir, suite.manifest.id, suite.manifest.version)) {
    return skippedInstallResult(suite, dataDir);
  }
  const materialized = await materializeSuiteRelease(sourceDir, {
    dataDir,
    overwrite: options.overwrite,
    installedAt: options.installedAt,
    maxTextFileBytes: options.maxTextFileBytes,
  });
  const result = toInstallResult(materialized, dataDir, false);
  const pipeline = buildDelegationPlan(parseSuiteManifest(materialized.suite.manifest.raw));
  if (pipeline !== undefined) {
    result.pipelinePlanFile = await writeDelegationPlan(materialized.releaseWorkspaceDir, pipeline);
  }
  return result;
}

export async function installSuiteFromUrl(
  url: string,
  options: InstallSuiteFromUrlOptions = {},
): Promise<InstallAndRegisterResult> {
  const dataDir = resolveInstallDataDir(options);
  if (
    options.skipIfUpToDate === true
    && options.suiteCode
    && options.expectedVersion
    && await isReleaseMaterialized(dataDir, options.suiteCode, options.expectedVersion)
  ) {
    return skippedInstallResultFromIdentity(options.suiteCode, options.expectedVersion, dataDir);
  }
  const tempDir = await downloadAndExtractSuite(url, options);
  try {
    return await installSuite(tempDir, { ...options, dataDir });
  } finally {
    if (options.cleanup !== false) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

export async function installSuiteFromZipFile(
  zipPath: string,
  options: InstallSuiteOptions & { cleanup?: boolean } = {},
): Promise<InstallAndRegisterResult> {
  const dataDir = resolveInstallDataDir(options);
  const tempDir = await extractZipFileToTempDir(zipPath);
  try {
    return await installSuite(tempDir, { ...options, dataDir });
  } finally {
    if (options.cleanup !== false) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

export async function listInstalledSuites(dataRoot?: string): Promise<InstalledSuiteSummary[]> {
  const dataDir = path.resolve(dataRoot ?? resolveLoongDataRoot());
  const suitesDir = path.join(dataDir, "suites");
  const summaries: InstalledSuiteSummary[] = [];
  let suiteEntries: Dirent[];
  try {
    suiteEntries = await readdir(suitesDir, { withFileTypes: true });
  } catch {
    return summaries;
  }
  for (const suiteEntry of suiteEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!suiteEntry.isDirectory()) {
      continue;
    }
    const suiteDir = path.join(suitesDir, suiteEntry.name);
    let versionEntries: Dirent[];
    try {
      versionEntries = await readdir(suiteDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const versionEntry of versionEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!versionEntry.isDirectory()) {
        continue;
      }
      const releaseDir = path.join(suiteDir, versionEntry.name);
      const record = await readReleaseRecord(releaseDir);
      summaries.push({
        id: record?.suiteId ?? suiteEntry.name,
        version: record?.suiteVersion ?? versionEntry.name,
        workspace: path.join(releaseDir, "workspace"),
      });
    }
  }
  return summaries;
}

function resolveInstallDataDir(options: { dataDir?: string; dataRoot?: string }): string {
  return path.resolve(options.dataDir ?? options.dataRoot ?? resolveLoongDataRoot());
}

async function isReleaseMaterialized(dataDir: string, suiteId: string, version: string): Promise<boolean> {
  const releaseDir = resolveDataPath(dataDir, "suites", suiteId, version);
  const record = await readReleaseRecord(releaseDir);
  return record?.suiteId === suiteId && record.suiteVersion === version;
}

async function readReleaseRecord(releaseDir: string): Promise<LoongSuiteReleaseRecord | undefined> {
  try {
    const raw = JSON.parse(await readFile(path.join(releaseDir, "release.json"), "utf8")) as Partial<LoongSuiteReleaseRecord>;
    if (raw.schemaVersion !== LOONG_SUITE_RELEASE_RECORD_SCHEMA_VERSION) {
      return undefined;
    }
    if (typeof raw.suiteId !== "string" || typeof raw.suiteVersion !== "string") {
      return undefined;
    }
    return raw as LoongSuiteReleaseRecord;
  } catch {
    return undefined;
  }
}

function toInstallResult(
  materialized: LoongSuiteReleaseMaterialization,
  dataRoot: string,
  skipped: boolean,
): InstallAndRegisterResult {
  return {
    ...materialized,
    manifest: materialized.suite.manifest,
    workspaceDir: materialized.releaseWorkspaceDir,
    dataRoot,
    profileId: materialized.suite.manifest.id,
    skillsCopied: [],
    skillsMissing: [],
    cronsImported: 0,
    skipped,
  };
}

function skippedInstallResult(suite: LoongSuitePackage, dataRoot: string): InstallAndRegisterResult {
  const releaseDir = resolveDataPath(dataRoot, "suites", suite.manifest.id, suite.manifest.version);
  const releaseWorkspaceDir = path.join(releaseDir, "workspace");
  const record: LoongSuiteReleaseRecord = {
    schemaVersion: LOONG_SUITE_RELEASE_RECORD_SCHEMA_VERSION,
    suiteId: suite.manifest.id,
    suiteName: suite.manifest.name,
    suiteVersion: suite.manifest.version,
    workspacePath: "workspace",
    installedAt: "",
    warnings: suite.warnings,
  };
  return toInstallResult({ suite, releaseDir, releaseWorkspaceDir, recordPath: path.join(releaseDir, "release.json"), record }, dataRoot, true);
}

function skippedInstallResultFromIdentity(suiteId: string, version: string, dataRoot: string): InstallAndRegisterResult {
  const manifest: LoongSuiteManifest = { id: suiteId, name: suiteId, version, raw: {} };
  const suite: LoongSuitePackage = {
    rootDir: "",
    workspaceDir: "",
    manifest,
    identity: {},
    skills: [],
    configFiles: [],
    schemaFiles: [],
    warnings: [],
  };
  return skippedInstallResult(suite, dataRoot);
}
