import { randomBytes } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createGatewayBridgeHandler,
  createGatewayWebhookChannelTarget,
  parseSlackWebhook,
  parseTelegramWebhook,
  toGatewayWebhookPayload,
} from "@dragon/channels";
import type { DragonAgentRuntime, DragonEvent, DragonTurnInput, DragonTurnResult } from "@dragon/core";
import {
  appendCancelledToolResults,
  appendWorkspaceToolGuidance,
  applyTurnPrep,
  augmentResponseWithTextToolCalls,
  buildTurnPrepOptions,
  classifyTierHeuristic,
  canRunToolCallsInParallel,
  createDragonRuntime,
  runTurnWithQueryLoop,
  isParallelSafeTool,
  decideTier,
  extractTextToolCalls,
  isLikelyContextOverflowError,
  normalizeTierConfig,
  pickAssistantDisplayText,
  compactSessionMessagesByTurn,
  estimateModelMessagesChars,
  mergeAgentProfileIntoTurnInput,
  resolveSessionCompactionForTurn,
  prepareSessionHistoryForModel,
  repairModelMessagesAfterCancel,
  TOOL_CANCELLED_CODE,
} from "@dragon/core";
import type { ModelMessage } from "@dragon/providers";
import { createCronRunner, createFileCronJobStore, createGatewayWebhookCronTarget, nextCronRun, parseCronSchedule, toGatewayWebhookCronPayload } from "@dragon/cron";
import {
  createDelegationPlan,
  createRuntimeDelegatedTaskExecutor,
  createRuntimeDelegationTool,
  runDelegationPlan,
  type DragonRuntimeDelegationToolInput,
} from "@dragon/delegation";
import {
  applyModelCatalogToAgentParams,
  assertDragonGatewayWebhookPayload,
  createHttpGateway,
  createModelCatalogFromProviderSummaries,
  FilePairingStore,
} from "@dragon/gateway";
import {
  createFileMemoryStore,
  createFileTrajectoryStore,
  createMemoryCandidateLifecycleHook,
  createMemoryCandidateTools,
  type MemoryCandidateListInput,
  type MemoryCandidateListOutput,
  type MemoryCandidatePromoteInput,
  type MemoryCandidatePromoteOutput,
  type MemoryCandidateRejectInput,
  type MemoryCandidateRejectOutput,
} from "@dragon/memory";
import {
  applyModelCatalogToParams,
  catalogEntriesFromProviders,
  createModelCatalog,
} from "@dragon/model-catalog";
import { createAnthropicProvider, createOpenAICompatibleProvider, ProviderError, type ModelProvider, type ModelRequest } from "@dragon/providers";
import { isSensitiveKey, redactSecretsInText } from "@dragon/security";
import {
  createBrowserFormSubmitTool,
  createBrowserPlaywrightSnapshotTool,
  createBrowserSnapshotTool,
  createToolRegistry,
  createSandboxExecTool,
  createToolPermissionEngine,
  planSandboxExecCommand,
  registerMcpTools,
  validateBrowserTargetUrl,
  type ToolDefinition,
} from "@dragon/tools";

import {
  assert,
  assertThrows,
  closeServer,
  createEventRuntime,
  createMockTool,
  createNoopRuntime,
  delay,
  isRecord,
  listenOnLoopback,
  mustFindTool,
  postJson,
  rawWebSocketUpgrade,
  RawWebSocketClient,
  readArray,
  readHeader,
  readPath,
  readRecordArray,
  readRecordArrayAt,
  rpc,
  runCli,
  toSse,
  WORKSPACE_ROOT,
} from "../lib/test-helpers.js";
import type { TestCase } from "../runner.js";

async function testCliSkillsSlashCommand(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dragon-cli-skills-"));
  const skillDir = path.join(root, "dragon-review");
  await mkdir(path.join(skillDir, "references"), { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), [
    "---",
    "name: dragon-review",
    "description: Review Dragon changes before continuing.",
    "category: workflow",
    "---",
    "",
    "# Dragon Review",
    "",
    "Check implementation, review the code, then fix issues before the next task.",
    "",
  ].join("\n"), "utf8");
  await writeFile(path.join(skillDir, "references", "notes.md"), "Keep reviews bounded and actionable.\n", "utf8");

  try {
    const listed = await runCli(["agent", "--skill-root", root, "/skills"]);
    assert(listed.stdout.includes("Dragon skills:"), "skills list should print a header");
    assert(listed.stdout.includes("dragon-review"), "skills list should include the test skill");
    assert(listed.stdout.includes("Review Dragon changes"), "skills list should include the description");
    assert(!listed.stderr.includes("No model provider"), "skills slash command should not require a model provider");

    const loaded = await runCli(["agent", "--skill-root", root, "/skills", "load", "dragon-review"]);
    assert(loaded.stdout.includes("# dragon-review"), "skills load should print the normalized skill name");
    assert(loaded.stdout.includes("Check implementation"), "skills load should include SKILL.md content");
    assert(loaded.stdout.includes("references/notes.md") || loaded.stdout.includes("notes.md"), "skills load should include reference summaries");

    const help = await runCli(["gateway", "--help"]);
    assert(help.stdout.includes("--cron-jobs <path>"), "gateway help should document cron jobs configuration");
    assert(help.stdout.includes("--model-fallback <ref>"), "CLI help should document model fallback configuration");
    assert(help.stdout.includes("DRAGON_MODEL_FALLBACKS"), "CLI help should document model fallback environment variable");

    const agentHelp = await runCli(["agent", "--help"]);
    assert(agentHelp.stdout.includes("--query-loop"), "agent help should document --query-loop");
    assert(agentHelp.stdout.includes("--finish-task"), "agent help should document --finish-task");
    assert(agentHelp.stdout.includes("--query-loop-max-turns"), "agent help should document --query-loop-max-turns");
    assert(agentHelp.stdout.includes("--profile"), "agent help should document --profile");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}


async function testCliCronOnce(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dragon-cli-cron-"));
  const jobsFile = path.join(root, "jobs.json");
  const store = createFileCronJobStore({ filePath: jobsFile });
  let captured: {
    authorization: string | undefined;
    body: Record<string, unknown> | undefined;
  } = {
    authorization: undefined,
    body: undefined,
  };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => {
      captured = {
        authorization: readHeader(request.headers.authorization),
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, payload: { delivered: true } }));
    });
  });
  const port = await listenOnLoopback(server);

  try {
    await store.upsert({
      id: "cli-cron-1",
      sessionId: "cli-cron-session",
      message: "scheduled cli task",
      schedule: "* * * * *",
      enabled: true,
      createdAt: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:00.000Z",
      nextRunAt: "2000-01-01T00:00:00.000Z",
      metadata: { project: "dragon" },
    });
    const result = await runCli(["cron", "--once", "--jobs", jobsFile, "--gateway-url", `http://127.0.0.1:${port}`, "--secret", "secret"]);
    const stdout = JSON.parse(result.stdout) as Record<string, unknown>;
    assert(readPath(stdout, ["delivered", 0, "jobId"]) === "cli-cron-1", "cron CLI should report delivered job");
    assert(captured.authorization === "Bearer secret", "cron CLI should forward Gateway shared secret");
    assert(captured.body?.sessionId === "cli-cron-session", "cron CLI should deliver job session");
    assert(captured.body?.message === "scheduled cli task", "cron CLI should deliver job message");
    assert(readPath(captured.body, ["metadata", "cronJobId"]) === "cli-cron-1", "cron CLI should include cron metadata");
    assert(readPath(captured.body, ["metadata", "project"]) === "dragon", "cron CLI should preserve job metadata");

    const updated = await store.get("cli-cron-1");
    assert(updated?.lastStatus === "ok", "cron CLI should persist successful status");
    assert(updated?.nextRunAt !== "2000-01-01T00:00:00.000Z", "cron CLI should advance next run");
  } finally {
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  }
}


async function testCliModelProviderPlugin(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dragon-cli-provider-plugin-"));
  await writeFile(path.join(root, "dragon.plugin.json"), JSON.stringify({
    name: "dragon.mock-provider",
    version: "0.0.0",
    entry: "index.js",
    description: "Test provider plugin.",
    dragonVersion: "0.x",
  }), "utf8");
  await writeFile(path.join(root, "index.js"), [
    "export default {",
    "  manifest: {",
    "    name: 'dragon.mock-provider',",
    "    version: '0.0.0',",
    "    entry: 'index.js',",
    "    description: 'Test provider plugin.',",
    "    dragonVersion: '0.x',",
    "  },",
    "  activate(context) {",
    "    context.registerProvider({",
    "      id: 'mock-provider',",
    "      displayName: 'Mock Provider',",
    "      defaultModel: 'mock-default',",
    "      supportsToolCalling: false,",
    "      async complete(request) {",
    "        const last = request.messages.at(-1)?.content ?? '';",
    "        return { id: 'mock-response', text: `plugin:${request.model}:${last}` };",
    "      },",
    "    });",
    "  },",
    "};",
    "",
  ].join("\n"), "utf8");

  try {
    const explicit = await runCli(["chat", "--no-session", "--plugin-root", root, "--model", "mock-provider:custom-model", "hello"]);
    assert(explicit.stdout.trim() === "plugin:custom-model:hello", "provider plugin should handle explicit provider-prefixed model refs");

    const defaulted = await runCli(["chat", "--no-session", "--plugin-root", root, "hi"]);
    assert(defaulted.stdout.trim() === "plugin:mock-default:hi", "provider plugin should act as default when no built-in providers are configured");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}


async function testCliModelProviderConfig(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dragon-cli-model-config-"));
  let captured: {
    authorization: string | undefined;
    body: Record<string, unknown> | undefined;
  } = {
    authorization: undefined,
    body: undefined,
  };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      captured = {
        authorization: readHeader(request.headers.authorization),
        body,
      };
      if (body.stream === true) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(toSse([
          { id: "configured-response", choices: [{ delta: { content: "configured-ok" } }] },
          "[DONE]",
        ]));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "configured-response",
        choices: [{ message: { content: "configured-ok" } }],
      }));
    });
  });
  const port = await listenOnLoopback(server);
  const configFile = path.join(root, "providers.json");

  try {
    await writeFile(configFile, JSON.stringify({
      providers: [{
        id: "configured",
        type: "openai-compatible",
        displayName: "Configured Provider",
        apiKey: "config-key",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        defaultModel: "configured-model",
        supportsToolCalling: false,
        enabled: true,
      }],
    }), "utf8");
    const result = await runCli(
      ["chat", "--no-session", "--model", "configured:configured-model", "hello"],
      { DRAGON_MODEL_CONFIG: configFile },
    );
    assert(result.stdout.trim() === "configured-ok", "configured model provider should answer CLI chat");
    assert(captured.authorization === "Bearer config-key", "configured provider should use the persisted API key");
    assert(captured.body?.model === "configured-model", "configured provider should strip its explicit prefix");
  } finally {
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  }
}


export const cliTestCases: TestCase[] = [
  ["cli skills slash command", testCliSkillsSlashCommand],
  ["cli cron once", testCliCronOnce],
  ["cli model provider plugin", testCliModelProviderPlugin],
  ["cli model provider config", testCliModelProviderConfig],
];
