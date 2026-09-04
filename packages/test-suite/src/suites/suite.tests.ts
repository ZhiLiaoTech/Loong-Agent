import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  installSuite,
  loadSuiteWorkspace,
  LoongSuiteError,
  loadSuiteInstance,
  materializeSuiteInstance,
  materializeSuiteRelease,
  resolveSuiteInstanceRuntimeContext,
  validateSuitePackage,
} from "@loong/suite";
import type { TestCase } from "../runner.js";

export const suiteTestCases: TestCase[] = [
  ["suite parser loads canonical workspace package", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "loong-suite-package-"));
    try {
      await writeWorkspaceJson(packageRoot, "suite.json", {
        id: "sales-researcher",
        name: "Sales Researcher",
        version: "1.2.3",
        schemaVersion: "2026-06",
      });
      await writeWorkspaceJson(packageRoot, "role.json", {
        title: "Sales Researcher",
        responsibilities: ["research", "summarize"],
      });
      await writeWorkspaceJson(packageRoot, "ui.json", { theme: "focused" });
      await writeWorkspaceJson(packageRoot, "policy.json", { tools: { web_search: "allow" } });
      await writeWorkspaceJson(packageRoot, "crons.json", { jobs: [{ id: "daily-brief", schedule: "0 9 * * *" }] });
      await writeWorkspaceFile(packageRoot, "soul/SOUL.md", "# Soul\nPersistent identity.");
      await writeWorkspaceFile(packageRoot, "soul/AGENTS.md", "# Agents\nOperational behavior.");
      await writeWorkspaceFile(packageRoot, "soul/USER.md.template", "Hello {{user.name}}.");
      await writeWorkspaceFile(packageRoot, "skills/research/SKILL.md", "# Research\nUse sources carefully.");
      await writeWorkspaceFile(packageRoot, "config/business.json", "{}");
      await writeWorkspaceFile(packageRoot, "schemas/output.schema.json", "{}");

      const suitePackage = await loadSuiteWorkspace(packageRoot);

      assert.equal(suitePackage.manifest.id, "sales-researcher", "manifest id should be parsed");
      assert.equal(suitePackage.manifest.name, "Sales Researcher", "manifest name should be parsed");
      assert.equal(suitePackage.manifest.version, "1.2.3", "manifest version should be parsed");
      assert.equal(suitePackage.identity.soul?.includes("Persistent identity."), true, "SOUL.md should be parsed");
      assert.equal(suitePackage.identity.agents?.includes("Operational behavior."), true, "AGENTS.md should be parsed");
      assert.equal(suitePackage.skills.length, 1, "one skill should be loaded");
      assert.equal(suitePackage.skills[0]?.slug, "research", "skill slug should use directory name");
      assert.equal(suitePackage.skills[0]?.name, "Research", "skill name should use heading");
      assert.equal(suitePackage.configFiles[0]?.path, "config/business.json", "config file should be listed");
      assert.equal(suitePackage.schemaFiles[0]?.path, "schemas/output.schema.json", "schema file should be listed");
      assert.equal(validateSuitePackage(suitePackage).filter(issue => issue.severity === "error").length, 0, "suite should validate");
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  }],
  ["suite parser accepts direct workspace directory", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "loong-suite-workspace-"));
    try {
      await writeWorkspaceJson(packageRoot, "suite.json", {
        id: "direct-workspace",
        version: "0.0.1",
      });
      await writeWorkspaceFile(packageRoot, "soul/AGENTS.md", "# Agents\nHeadless behavior.");
      await writeWorkspaceFile(packageRoot, "skills/brief/SKILL.md", "# Brief\nCreate concise briefs.");

      const suitePackage = await loadSuiteWorkspace(path.join(packageRoot, "workspace"));

      assert.equal(suitePackage.rootDir.endsWith("workspace"), true, "direct workspace root should be the workspace directory");
      assert.equal(suitePackage.manifest.name, "direct-workspace", "manifest name should default to id");
      assert.equal(suitePackage.skills[0]?.slug, "brief", "direct workspace skill should load");
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  }],
  ["suite materialization installs release and instance runtime shell", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "loong-suite-materialize-source-"));
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "loong-suite-materialize-data-"));
    try {
      await writeWorkspaceJson(packageRoot, "suite.json", {
        id: "sales-researcher",
        name: "Sales Researcher",
        version: "1.2.3",
      });
      await writeWorkspaceFile(packageRoot, "soul/AGENTS.md", "# Agents\nHeadless behavior.");
      await writeWorkspaceFile(packageRoot, "skills/research/SKILL.md", "# Research\nUse sources carefully.");

      const release = await materializeSuiteRelease(packageRoot, {
        dataDir,
        installedAt: "2026-06-11T00:00:00.000Z",
      });

      assert.equal(release.record.schemaVersion, "loong.suite.release.v1", "release record schema should be stable");
      assert.equal(release.record.suiteId, "sales-researcher", "release should record suite id");
      assert.equal(release.record.suiteVersion, "1.2.3", "release should record suite version");
      assert.equal(await pathExists(path.join(release.releaseWorkspaceDir, "suite.json")), true, "release should copy suite workspace");
      const releaseRecord = JSON.parse(await readFile(release.recordPath, "utf8")) as Record<string, unknown>;
      assert.equal(releaseRecord["workspacePath"], "workspace", "release record should use workspace path");

      let duplicateReleaseError: unknown;
      try {
        await materializeSuiteRelease(packageRoot, { dataDir });
      } catch (error) {
        duplicateReleaseError = error;
      }
      assert.ok(duplicateReleaseError instanceof LoongSuiteError, "duplicate release should fail without overwrite");
      assert.equal(duplicateReleaseError.code, "SUITE_RELEASE_EXISTS", "duplicate release should use release exists code");

      const instance = await materializeSuiteInstance({
        dataDir,
        tenantId: "tenant-a",
        agentInstanceId: "agent-1",
        employeeId: "employee-1",
        suiteId: "sales-researcher",
        suiteVersion: "1.2.3",
        createdAt: "2026-06-11T00:01:00.000Z",
        metadata: { billingSubject: "digital-employee" },
      });

      assert.equal(instance.record.schemaVersion, "loong.suite.instance.v1", "instance record schema should be stable");
      assert.equal(instance.record.tenantId, "tenant-a", "instance should record tenant id");
      assert.equal(instance.record.agentInstanceId, "agent-1", "instance should record agent instance id");
      assert.equal(instance.record.releaseRef.suiteId, "sales-researcher", "instance should reference suite release");
      assert.equal(instance.record.runtime.skillRoots[1], "skills", "instance should keep an overlay skill root");
      assert.equal(path.isAbsolute(instance.record.runtime.skillRoots[0] ?? ""), false, "recorded suite skill root should be portable");
      assert.equal(instance.runtimePaths.skillRoots[0], path.join(release.releaseWorkspaceDir, "skills"), "runtime path should point to release skills");
      assert.equal(await pathExists(path.join(instance.instanceDir, "workspace")), true, "instance workspace directory should exist");
      assert.equal(await pathExists(path.join(instance.instanceDir, "memory")), true, "instance memory directory should exist");
      assert.equal(await pathExists(path.join(instance.instanceDir, "sessions")), true, "instance sessions directory should exist");
      assert.equal(await pathExists(path.join(instance.instanceDir, "workspace", "role.md")), false, "instance should not map Suite into role.md");
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
      await rm(dataDir, { recursive: true, force: true });
    }
  }],
  ["suite instance resolves runtime context from native suite identity", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "loong-suite-context-source-"));
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "loong-suite-context-data-"));
    try {
      await writeWorkspaceJson(packageRoot, "suite.json", {
        id: "ops-analyst",
        name: "Ops Analyst",
        version: "2.0.0",
      });
      await writeWorkspaceJson(packageRoot, "role.json", {
        title: "Operations Analyst",
      });
      await writeWorkspaceFile(packageRoot, "soul/SOUL.md", "# Soul\nCare about service reliability.");
      await writeWorkspaceFile(packageRoot, "soul/AGENTS.md", "# Agents\nInvestigate incidents.");
      await writeWorkspaceFile(packageRoot, "skills/incident/SKILL.md", "# Incident\nFollow the runbook.");

      await materializeSuiteRelease(packageRoot, { dataDir });
      await materializeSuiteInstance({
        dataDir,
        tenantId: "tenant-b",
        agentInstanceId: "agent-ops",
        employeeId: "employee-ops",
        suiteId: "ops-analyst",
        suiteVersion: "2.0.0",
        metadata: { billingSubject: "suite-instance" },
      });

      const loaded = await loadSuiteInstance({
        dataDir,
        tenantId: "tenant-b",
        agentInstanceId: "agent-ops",
      });
      const context = await resolveSuiteInstanceRuntimeContext({
        dataDir,
        tenantId: "tenant-b",
        agentInstanceId: "agent-ops",
      });

      assert.equal(loaded.suite.manifest.id, "ops-analyst", "loaded instance should resolve release suite");
      assert.equal(context.turnDefaults.workspace, loaded.runtimePaths.workspaceDir, "turn workspace should use instance workspace");
      assert.equal(context.turnDefaults.metadata["tenantId"], "tenant-b", "metadata should include tenant id");
      assert.equal(context.turnDefaults.metadata["suiteId"], "ops-analyst", "metadata should include suite id");
      assert.equal(context.turnDefaults.systemPrompt.includes("Care about service reliability."), true, "system prompt should include SOUL.md");
      assert.equal(context.turnDefaults.systemPrompt.includes("Investigate incidents."), true, "system prompt should include AGENTS.md");
      assert.equal(context.skillRoots[0], loaded.runtimePaths.suiteSkillDir, "context should include release suite skills");
      assert.equal(context.skillRoots[1], loaded.runtimePaths.instanceSkillDir, "context should include instance skill overlay");
      assert.equal(await pathExists(path.join(context.turnDefaults.workspace, "role.md")), false, "runtime context should not create role.md");
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
      await rm(dataDir, { recursive: true, force: true });
    }
  }],
  ["suite materialization rejects unsafe path segments", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "loong-suite-unsafe-data-"));
    try {
      let thrown: unknown;
      try {
        await materializeSuiteInstance({
          dataDir,
          tenantId: "../tenant",
          agentInstanceId: "agent-1",
          suiteId: "sales-researcher",
          suiteVersion: "1.2.3",
        });
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown instanceof LoongSuiteError, "unsafe tenant id should throw LoongSuiteError");
      assert.equal(thrown.code, "SUITE_PATH_SEGMENT_INVALID", "unsafe tenant id should use path segment error code");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  }],
  ["suite parser rejects incomplete manifest", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "loong-suite-invalid-"));
    try {
      await writeWorkspaceJson(packageRoot, "suite.json", {
        id: "missing-version",
      });

      let thrown: unknown;
      try {
        await loadSuiteWorkspace(packageRoot);
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown instanceof LoongSuiteError, "incomplete manifest should throw LoongSuiteError");
      assert.equal(thrown.code, "SUITE_MANIFEST_INVALID", "incomplete manifest should use manifest error code");
      assert.equal(thrown.path, "suite.json", "incomplete manifest error should point to suite.json");
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  }],
  ["suite install materializes declared pipeline plan", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "loong-suite-pipeline-source-"));
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "loong-suite-pipeline-data-"));
    try {
      await writeWorkspaceJson(packageRoot, "suite.json", {
        id: "video-pipeline",
        name: "Video Pipeline",
        version: "1.0.0",
        skills: ["ingest", "render"],
        pipeline: {
          description: "Ingest then render",
          stages: [
            { stage: "ingest", skill: "ingest", description: "Inspect media" },
            { stage: "render", skill: "render", description: "Render output" },
          ],
        },
      });
      await writeWorkspaceFile(packageRoot, "skills/ingest/SKILL.md", "# Ingest\nInspect media.");
      await writeWorkspaceFile(packageRoot, "skills/render/SKILL.md", "# Render\nRender output.");

      const installed = await installSuite(packageRoot, { dataDir });
      assert.ok(installed.pipelinePlanFile, "pipeline plan path should be returned");
      const plan = JSON.parse(await readFile(installed.pipelinePlanFile, "utf8")) as {
        tasks: Array<{ id: string; dependsOn?: string[]; metadata?: Record<string, unknown> }>;
      };
      assert.equal(plan.tasks.length, 2, "each stage should become one task");
      assert.deepEqual(plan.tasks[1]?.dependsOn, ["ingest"], "manifest stages should be sequential by default");
      assert.equal(plan.tasks[1]?.metadata?.["skill"], "render", "task metadata should retain skill id");
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
      await rm(dataDir, { recursive: true, force: true });
    }
  }],
];

async function writeWorkspaceJson(packageRoot: string, relativePath: string, value: unknown): Promise<void> {
  await writeWorkspaceFile(packageRoot, relativePath, JSON.stringify(value, null, 2));
}

async function writeWorkspaceFile(packageRoot: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(packageRoot, "workspace", ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
