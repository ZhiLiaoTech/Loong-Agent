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
import { runTests } from "./runner.js";
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
} from "./lib/test-helpers.js";
import { mergeAllTestCases } from "./suites/registry.js";

async function main(): Promise<void> {
  await runTests(mergeAllTestCases([
    ["openrouter provider plugin", testOpenRouterProviderPlugin],
    ["dashboard memory review smoke", testDashboardMemoryReviewSmoke],
    ["memory candidate review tools", testMemoryCandidateTools],
    ["model catalog", testModelCatalog],
    ["security redaction", testSecurityRedaction],
    ["sandbox exec tool", testSandboxExecTool],
    ["cron schedule and gateway delivery", testCronScheduleAndGatewayDelivery],
    ["cron file store and runner", testCronFileStoreAndRunner],
    ["browser snapshot and form submit tools", testBrowserSnapshotTool],
    ["delegation planner and runner", testDelegationPlannerAndRunner],
    ["browser playwright snapshot tool", testBrowserPlaywrightSnapshotTool],
    ["mcp http transport", testMcpHttpTransport],
    ["browser SSRF redirect block", testBrowserSsrfRedirectBlock],
    ["openai provider tool call translation", testOpenAIProviderToolCallTranslation],
    ["openai provider streaming", testOpenAIProviderStreaming],
    ["anthropic provider tool use translation", testAnthropicProviderToolUse],
    ["anthropic provider streaming", testAnthropicProviderStreaming],
  ]));
}

async function testOpenRouterProviderPlugin(): Promise<void> {
  let captured: {
    url: string | undefined;
    authorization: string | undefined;
    referer: string | undefined;
    title: string | undefined;
    body: Record<string, unknown> | undefined;
  } = {
    url: undefined,
    authorization: undefined,
    referer: undefined,
    title: undefined,
    body: undefined,
  };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      captured = {
        url: request.url,
        authorization: readHeader(request.headers.authorization),
        referer: readHeader(request.headers["http-referer"]),
        title: readHeader(request.headers["x-openrouter-title"]),
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      };
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(toSse([
        { id: "openrouter-test", choices: [{ delta: { content: "openrouter-ok" } }] },
        "[DONE]",
      ]));
    });
  });
  const port = await listenOnLoopback(server);

  try {
    const result = await runCli(
      [
        "chat",
        "--no-session",
        "--plugin-root",
        path.join(WORKSPACE_ROOT, "packages", "plugin-openrouter-compatible"),
        "--model",
        "openrouter:openai/test-model",
        "route through openrouter",
      ],
      {
        DRAGON_OPENROUTER_API_KEY: "or-test-key",
        DRAGON_OPENROUTER_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
        DRAGON_OPENROUTER_REFERER: "https://dragon.local",
        DRAGON_OPENROUTER_TITLE: "Dragon Test",
      },
    );
    assert(result.stdout.trim() === "openrouter-ok", "OpenRouter plugin should return provider response text");
    assert(captured.url === "/api/v1/chat/completions", "OpenRouter plugin should use the OpenAI-compatible chat completions path");
    assert(captured.authorization === "Bearer or-test-key", "OpenRouter plugin should forward bearer auth");
    assert(captured.referer === "https://dragon.local", "OpenRouter plugin should forward HTTP-Referer");
    assert(captured.title === "Dragon Test", "OpenRouter plugin should forward X-OpenRouter-Title");
    assert(captured.body?.model === "openai/test-model", "OpenRouter plugin should strip the explicit provider prefix");
    assert(captured.body?.stream === true, "OpenRouter plugin should support streamed Dragon turns");
  } finally {
    await closeServer(server);
  }
}

async function testDashboardMemoryReviewSmoke(): Promise<void> {
  const gateway = createHttpGateway({ runtime: createNoopRuntime() });
  await gateway.start({ host: "127.0.0.1", port: 0 });
  const address = gateway.address();
  assert(address !== undefined, "Gateway did not start");

  try {
    const response = await fetch(address.url);
    const html = await response.text();
    assert(response.status === 200, `Expected dashboard status 200, got ${response.status}`);
    assert(html.includes('data-tab="run"'), "dashboard should include the Run workspace");
    assert(html.includes('data-tab="models"'), "dashboard should include the Models tab");
    assert(html.includes('data-tab="agents"'), "dashboard should include the Agents tab");
    assert(html.includes('data-tab="observe"'), "dashboard should include the Observe tab");
    assert(html.includes('data-tab="system"'), "dashboard should include the System tab");
    assert(html.includes("providers.list"), "dashboard should call providers.list RPC");
    assert(html.includes("model.config.get"), "dashboard should call model config get RPC");
    assert(html.includes("model.config.save"), "dashboard should call model config save RPC");
    assert(html.includes("agent.config.get"), "dashboard should call agent config get RPC");
    assert(html.includes("agent.config.save"), "dashboard should call agent config save RPC");
    assert(html.includes('id="model"'), "dashboard should expose a model input");
    assert(html.includes('id="modelProviderKey"'), "dashboard should expose a model API key input");
    assert(html.includes('id="runProfile"'), "dashboard should expose an agent profile selector");
    assert(html.includes("modelSuggestions"), "dashboard should expose model suggestions");
    assert(html.includes("memory.candidates.list"), "dashboard should call memory candidate list RPC");
    assert(html.includes("memory.candidate.promote"), "dashboard should call memory candidate promote RPC");
    assert(html.includes("memory.candidate.reject"), "dashboard should call memory candidate reject RPC");
    assert(html.includes("cron.jobs.list"), "dashboard should call cron jobs list RPC");
    assert(html.includes("cron.job.upsert"), "dashboard should call cron job upsert RPC");
    assert(html.includes("cron.tick"), "dashboard should call cron tick RPC");
    assert(html.includes("Requires write permission"), "dashboard should label disabled memory review actions");
    assert(!html.includes("localStorage"), "dashboard must not persist secrets to localStorage");
    assert(
      html.includes("dragon.gateway.secret") || html.includes("GATEWAY_SECRET_STORAGE_KEY"),
      "dashboard or studio bundle should reference gateway session secret storage",
    );
  } finally {
    await gateway.stop();
  }
}

async function testMemoryCandidateTools(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dragon-candidate-tools-"));
  const provider = {
    id: "mock",
    displayName: "Mock",
    defaultModel: "mock-model",
    supportsToolCalling: false,
    async complete() {
      return { id: "mock-response", text: "ack" };
    },
  };

  try {
    const runtime = createDragonRuntime({
      providers: [provider],
      defaultModel: "mock-model",
      lifecycleHooks: [createMemoryCandidateLifecycleHook({ rootDir: root })],
    });
    await runtime.runTurn({ sessionId: "s1", source: "cli", message: "remember that I prefer terse answers" });
    await delay(5);
    await runtime.runTurn({ sessionId: "s1", source: "cli", workspace: root, message: "remember that this project uses TypeScript only" });
    await delay(5);
    await runtime.runTurn({ sessionId: "s1", source: "cli", message: "remember that concurrency should store once" });

    const store = createFileMemoryStore({ rootDir: root });
    const tools = createMemoryCandidateTools({ rootDir: root, store });
    const list = mustFindTool<MemoryCandidateListInput, MemoryCandidateListOutput>(tools, "memory_candidates_list");
    const promote = mustFindTool<MemoryCandidatePromoteInput, MemoryCandidatePromoteOutput>(tools, "memory_candidate_promote");
    const reject = mustFindTool<MemoryCandidateRejectInput, MemoryCandidateRejectOutput>(tools, "memory_candidate_reject");

    const pending = await list.invoke({ id: "list-1", name: list.name, input: {}, sessionId: "s1" });
    assert(pending.ok, `list failed: ${pending.error}`);
    assert(pending.output !== undefined, "list should return output");
    const pendingOutput = pending.output;
    assert(pendingOutput.candidates.length === 3, `Expected three pending candidates, got ${pendingOutput.candidates.length}`);
    assert(pendingOutput.candidates[0]?.content.includes("concurrency"), "latest candidate should be listed first");

    const concurrencyCandidate = pendingOutput.candidates[0];
    assert(concurrencyCandidate !== undefined, "expected concurrency candidate");
    const concurrent = await Promise.all([
      promote.invoke({ id: "promote-concurrent-1", name: promote.name, input: { id: concurrencyCandidate.id }, sessionId: "s1" }),
      promote.invoke({ id: "promote-concurrent-2", name: promote.name, input: { id: concurrencyCandidate.id }, sessionId: "s1" }),
    ]);
    assert(concurrent.filter(result => result.ok).length === 1, "exactly one concurrent promote should succeed");
    assert((await store.search("concurrency", 5)).length === 1, "concurrent promotion should store once");

    const userCandidate = pendingOutput.candidates.find(candidate => candidate.scope === "user" && candidate.id !== concurrencyCandidate.id);
    const projectCandidate = pendingOutput.candidates.find(candidate => candidate.scope === "project");
    assert(userCandidate !== undefined && projectCandidate !== undefined, "expected user and project candidates");

    const promoted = await promote.invoke({
      id: "promote-1",
      name: promote.name,
      input: { id: userCandidate.id, source: "test-promote" },
      sessionId: "s1",
      metadata: { runId: "review-run" },
    });
    assert(promoted.ok, `promote failed: ${promoted.error}`);
    assert(promoted.output !== undefined, "promote should return output");
    const promotedOutput = promoted.output;
    assert(promotedOutput.candidate.status === "promoted", "candidate should become promoted");
    assert(promotedOutput.candidate.promotedMemoryId === promotedOutput.record.id, "promoted memory id should match record");
    assert(promotedOutput.record.metadata?.candidateId === userCandidate.id, "memory metadata should include candidate id");

    const duplicatePromote = await promote.invoke({ id: "promote-2", name: promote.name, input: { id: userCandidate.id }, sessionId: "s1" });
    assert(!duplicatePromote.ok && duplicatePromote.error?.includes("already promoted"), "duplicate promote should fail");

    const rejected = await reject.invoke({
      id: "reject-1",
      name: reject.name,
      input: { id: projectCandidate.id, reason: "too transient" },
      sessionId: "s1",
    });
    assert(rejected.ok, `reject failed: ${rejected.error}`);
    assert(rejected.output !== undefined, "reject should return output");
    assert(rejected.output.candidate.status === "rejected", "candidate should become rejected");
    assert((await store.search("TypeScript only", 5)).length === 0, "rejected candidate should not enter durable memory");

    const remaining = await list.invoke({ id: "list-2", name: list.name, input: {}, sessionId: "s1" });
    assert(remaining.ok && remaining.output !== undefined && remaining.output.candidates.length === 0, "default list should only return pending candidates");
    const all = await list.invoke({ id: "list-3", name: list.name, input: { status: "all" }, sessionId: "s1" });
    assert(all.ok && all.output !== undefined && all.output.candidates.length === 3, "status all should include reviewed candidates");

    const candidateFile = path.join(root, "candidates", (await readdir(path.join(root, "candidates")))[0] ?? "");
    const lines = (await readFile(candidateFile, "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line) as { status?: string });
    assert(lines.some(line => line.status === "promoted"), "candidate file should contain promoted status");
    assert(lines.some(line => line.status === "rejected"), "candidate file should contain rejected status");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testModelCatalog(): Promise<void> {
  const entries = catalogEntriesFromProviders([
    {
      id: "openai",
      displayName: "OpenAI Compatible",
      defaultModel: "gpt-4.1-mini",
      supportsToolCalling: true,
      models: [
        {
          id: "gpt-4.1",
          aliases: ["gpt-main"],
          contextWindow: 1_000_000,
          capabilities: { toolCalling: true, streaming: true },
          status: "stable",
        },
      ],
    },
    {
      id: "local",
      displayName: "Local",
      models: [{ id: "small", default: true, status: "preview" }],
    },
  ]);
  const defaultEntry = entries.find(entry => entry.providerId === "openai" && entry.id === "gpt-4.1-mini");
  assert(defaultEntry?.default === true, "model catalog should add provider default model entries");
  assert(defaultEntry.capabilities?.toolCalling === true, "model catalog should inherit provider tool capability for default entries");
  const catalog = createModelCatalog(entries);
  assert(catalog.resolve("openai:gpt-4.1")?.id === "gpt-4.1", "model catalog should resolve provider-colon refs");
  assert(catalog.resolve("openai/gpt-4.1")?.id === "gpt-4.1", "model catalog should resolve provider-slash refs");
  assert(catalog.resolve("gpt-main")?.providerId === "openai", "model catalog should resolve unique aliases");
  assert(catalog.listByProvider("local")[0]?.id === "small", "model catalog should list by provider");
  const first = entries[0];
  assert(first !== undefined, "model catalog test fixture should include entries");
  assertThrows(() => createModelCatalog([first, first]), "duplicate model registration should fail");
}

async function testSecurityRedaction(): Promise<void> {
  assert(isSensitiveKey("apiKey"), "security should classify API key fields as sensitive");
  assert(isSensitiveKey("key"), "security should classify standalone key fields as sensitive");
  assert(!isSensitiveKey("monkey"), "security should not classify words that merely contain key");
  assert(isSensitiveKey("authorization"), "security should classify authorization fields as sensitive");
  const redacted = redactSecretsInText([
    "{\"api_key\":\"sk-abc123456789\",\"password\":\"plain\"}",
    "authorization=Bearer secret-token",
    "https://user:pass@example.com/path?token=value&ok=1",
    "bearer sk-live-secret-token",
  ].join("\n"), { compactWhitespace: true });
  assert(redacted.includes("\"api_key\":\"[REDACTED]\""), "security should redact JSON-shaped secrets");
  assert(redacted.includes("password\":\"[REDACTED]\""), "security should redact password fields");
  assert(redacted.includes("authorization=[REDACTED]"), "security should redact assignment-shaped secrets");
  assert(redacted.includes("https://[REDACTED]@example.com"), "security should redact URL credentials");
  assert(redacted.includes("token=[REDACTED]"), "security should redact query tokens");
  assert(!redacted.includes("secret-token") && !redacted.includes("plain"), "security redaction should remove secret values");
  assert(redactSecretsInText("abcdef", { maxLength: 3 }) === "abc...", "security redaction should enforce max length");
}

async function testSandboxExecTool(): Promise<void> {
  const dockerPlan = planSandboxExecCommand({
    backend: "docker",
    command: "git status",
    docker: { container: "dragon-dev", workspace: "/workspace" },
  });
  assert(dockerPlan.executable === "docker", "docker sandbox should use docker executable");
  assert(JSON.stringify(dockerPlan.args) === JSON.stringify(["exec", "-i", "-w", "/workspace", "dragon-dev", "git", "status"]), "docker sandbox plan should be stable");
  assert(dockerPlan.profile === "inspect", "sandbox default profile should remain inspect");
  assert(dockerPlan.innerExecutable === "git", "docker sandbox should retain inner executable");

  let defaultRejected = false;
  try {
    planSandboxExecCommand({
      backend: "docker",
      command: "git diff --stat",
      docker: { container: "dragon-dev", workspace: "/workspace" },
    });
  } catch {
    defaultRejected = true;
  }
  assert(defaultRejected, "default sandbox profile should not expand Git read commands");

  const repoReadPlan = planSandboxExecCommand({
    backend: "docker",
    profile: "repo-read",
    command: "git diff --stat",
    docker: { container: "dragon-dev", workspace: "/workspace" },
  });
  assert(repoReadPlan.profile === "repo-read", "sandbox plan should preserve selected profile");
  assert(repoReadPlan.innerExecutable === "git", "repo-read profile should allow read-only Git commands");

  let unsafeGitReadRejected = false;
  try {
    planSandboxExecCommand({
      backend: "docker",
      profile: "repo-read",
      command: "git diff --ext-diff",
      docker: { container: "dragon-dev", workspace: "/workspace" },
    });
  } catch {
    unsafeGitReadRejected = true;
  }
  assert(unsafeGitReadRejected, "repo-read profile should reject Git flags that can trigger external commands");

  let gitProfileBlocksSearch = false;
  try {
    planSandboxExecCommand({
      backend: "docker",
      profile: "git-read",
      command: "rg hello src",
      docker: { container: "dragon-dev", workspace: "/workspace" },
    });
  } catch {
    gitProfileBlocksSearch = true;
  }
  assert(gitProfileBlocksSearch, "git-read profile should not allow search commands");

  const sshPlan = planSandboxExecCommand({
    backend: "ssh",
    profile: "search-read",
    command: "rg hello src",
    ssh: { host: "example.test", user: "dragon", port: 2222, workspace: "/srv/dragon" },
  });
  assert(sshPlan.executable === "ssh", "ssh sandbox should use ssh executable");
  assert(sshPlan.profile === "search-read", "ssh sandbox should preserve selected profile");
  assert(sshPlan.args.includes("dragon@example.test"), "ssh sandbox should include user and host");
  assert(sshPlan.args.includes("2222"), "ssh sandbox should include port");
  assert(sshPlan.args.at(-1) === "cd '/srv/dragon' && exec 'rg' 'hello' 'src'", "ssh sandbox should quote the remote command");

  let rejected = false;
  try {
    planSandboxExecCommand({
      backend: "docker",
      command: "rm -rf .",
      docker: { container: "dragon-dev", workspace: "/workspace" },
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "sandbox_exec should reject commands outside the read-only allowlist");

  const tool = createSandboxExecTool();
  const local = await tool.invoke({
    id: "sandbox-local-1",
    name: tool.name,
    input: { backend: "local", profile: "versions", command: "node --version" },
    sessionId: "sandbox-session",
    workspace: WORKSPACE_ROOT,
  });
  assert(local.ok, `local sandbox_exec failed: ${local.error}`);
  assert(local.output?.backend === "local", "local sandbox output should report backend");
  assert(local.output?.profile === "versions", "local sandbox output should report profile");
  assert(local.output?.innerExecutable.toLowerCase() === "node", "local sandbox output should report inner executable");
  assert(local.output?.stdout.trim().startsWith("v"), "local sandbox should execute node --version");
}

async function testCronScheduleAndGatewayDelivery(): Promise<void> {
  const everyFifteen = parseCronSchedule("*/15 * * * *");
  assert(everyFifteen.minutes.join(",") === "0,15,30,45", "cron parser should support step fields");
  const nextFifteen = nextCronRun(everyFifteen, new Date("2026-05-17T10:07:30.000Z"));
  assert(nextFifteen.toISOString() === "2026-05-17T10:15:00.000Z", "cron next run should advance to next matching minute");
  const nextMonday = nextCronRun("0 9 * * 1", new Date("2026-05-17T10:00:00.000Z"));
  assert(nextMonday.toISOString() === "2026-05-18T09:00:00.000Z", "cron next run should support day-of-week");

  const payload = toGatewayWebhookCronPayload({
    id: "cron-1",
    sessionId: "cron-session",
    message: "daily check",
    schedule: "0 9 * * *",
    metadata: { project: "dragon" },
  }, {
    jobId: "cron-1",
    scheduledAt: "2026-05-18T09:00:00.000Z",
    deliveredAt: "2026-05-18T09:00:01.000Z",
  });
  assert(payload.channel === "cron", "cron payload should target the cron channel");
  assert(readPath(payload, ["metadata", "cronJobId"]) === "cron-1", "cron payload should include job id metadata");
  assert(readPath(payload, ["metadata", "project"]) === "dragon", "cron payload should preserve custom metadata");

  let captured: {
    url: string | undefined;
    authorization: string | undefined;
    body: Record<string, unknown> | undefined;
  } = {
    url: undefined,
    authorization: undefined,
    body: undefined,
  };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => {
      captured = {
        url: request.url,
        authorization: readHeader(request.headers.authorization),
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, payload: { accepted: true } }));
    });
  });
  const port = await listenOnLoopback(server);
  try {
    const target = createGatewayWebhookCronTarget({
      gatewayUrl: `http://127.0.0.1:${port}`,
      sharedSecret: "secret",
    });
    const result = await target.deliver({
      id: "cron-2",
      sessionId: "cron-session",
      message: "run scheduled task",
      schedule: "@hourly",
      model: "mock:model",
    }, {
      jobId: "cron-2",
      scheduledAt: "2026-05-18T10:00:00.000Z",
    });
    assert(result.ok && result.status === 200, "cron webhook delivery should succeed");
    assert(captured.url === "/channels/webhook", "cron target should deliver to Gateway webhook channel");
    assert(captured.authorization === "Bearer secret", "cron target should forward shared secret auth");
    assert(captured.body?.channel === "cron", "cron target should mark payload channel");
    assert(captured.body?.model === "mock:model", "cron target should forward model override");
  } finally {
    await closeServer(server);
  }
}

async function testCronFileStoreAndRunner(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dragon-cron-store-"));
  const filePath = path.join(root, "jobs.json");
  try {
    const store = createFileCronJobStore({ filePath });
    const created = await store.upsert({
      id: "cron-runner-1",
      sessionId: "cron-session",
      message: "scheduled review",
      schedule: "* * * * *",
      metadata: { project: "dragon" },
    }, { now: new Date("2026-05-17T10:00:30.000Z") });
    assert(created.enabled === true, "cron store should enable new jobs by default");
    assert(created.createdAt === "2026-05-17T10:00:30.000Z", "cron store should use supplied creation time");
    assert(created.nextRunAt === "2026-05-17T10:01:00.000Z", "cron store should compute next run");

    await store.upsert({
      id: "cron-update",
      sessionId: "cron-session",
      message: "reschedule me",
      schedule: "* * * * *",
    }, { now: new Date("2026-05-17T10:00:30.000Z") });
    const rescheduled = await store.upsert({
      id: "cron-update",
      sessionId: "cron-session",
      message: "reschedule me",
      schedule: "*/5 * * * *",
    }, { now: new Date("2026-05-17T10:01:10.000Z") });
    assert(rescheduled.createdAt === "2026-05-17T10:00:30.000Z", "cron store should preserve creation time on update");
    assert(rescheduled.nextRunAt === "2026-05-17T10:05:00.000Z", "cron store should recompute next run when schedule changes");
    await store.remove("cron-update");

    const reloaded = createFileCronJobStore({ filePath });
    const listed = await reloaded.list();
    assert(listed.length === 1 && listed[0]?.id === "cron-runner-1", "cron file store should persist jobs");

    const delivered: Array<{ jobId: string; scheduledAt: string; metadata?: Record<string, unknown> }> = [];
    const runner = createCronRunner({
      store: reloaded,
      now: () => new Date("2026-05-17T10:01:30.000Z"),
      target: {
        async deliver(job, occurrence) {
          delivered.push({
            jobId: job.id,
            scheduledAt: occurrence.scheduledAt,
            ...(job.metadata !== undefined ? { metadata: job.metadata } : {}),
          });
          return { ok: true, status: 200, payload: { accepted: true } };
        },
      },
    });
    const tick = await runner.tick();
    assert(tick.checkedAt === "2026-05-17T10:01:30.000Z", "cron runner should report tick time");
    assert(tick.delivered.length === 1, "cron runner should deliver due jobs");
    assert(delivered[0]?.jobId === "cron-runner-1", "cron runner should deliver the stored job");
    assert(delivered[0]?.scheduledAt === "2026-05-17T10:01:00.000Z", "cron runner should preserve scheduled occurrence time");
    assert(delivered[0]?.metadata?.project === "dragon", "cron runner should preserve job metadata");

    const updated = await reloaded.get("cron-runner-1");
    assert(updated?.lastStatus === "ok", "cron runner should persist successful delivery status");
    assert(updated?.lastScheduledAt === "2026-05-17T10:01:00.000Z", "cron runner should persist last scheduled time");
    assert(updated?.lastDeliveredAt === "2026-05-17T10:01:30.000Z", "cron runner should persist delivery time");
    assert(updated?.nextRunAt === "2026-05-17T10:02:00.000Z", "cron runner should advance to the next schedule");

    await reloaded.upsert({
      id: "cron-disabled",
      sessionId: "cron-session",
      message: "disabled",
      schedule: "* * * * *",
      enabled: false,
      createdAt: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:00.000Z",
      nextRunAt: "2026-05-17T10:01:00.000Z",
    }, { now: new Date("2026-05-17T10:01:30.000Z") });
    const disabledTick = await runner.tick();
    assert(disabledTick.delivered.length === 0, "cron runner should ignore disabled jobs");

    const removed = await reloaded.remove("cron-disabled");
    assert(removed, "cron file store should remove existing jobs");
    assert(await reloaded.get("cron-disabled") === undefined, "cron file store should not return removed jobs");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testBrowserSnapshotTool(): Promise<void> {
  let submitted: { method?: string; url?: string; body?: string } = {};
  const server = createServer((request, response) => {
    if (request.url === "/login") {
      const chunks: Buffer[] = [];
      request.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      request.on("end", () => {
        submitted = {
          body: Buffer.concat(chunks).toString("utf8"),
          ...(request.method !== undefined ? { method: request.method } : {}),
          ...(request.url !== undefined ? { url: request.url } : {}),
        };
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><title>Submitted</title><p>Submitted OK</p><a href='/done'>Done</a>");
      });
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end([
      "<!doctype html>",
      "<html>",
      "<head><title>Dragon &amp; Browser</title><style>body{color:red}</style></head>",
      "<body>",
      "<h1>Dragon Browser</h1>",
      "<script>document.body.textContent='hidden'</script>",
      "<p>Minimal page inspection.</p>",
      "<a href='/docs'>Docs</a>",
      "<a href='https://example.com/out'>External</a>",
      "<form id='login' name='loginForm' action='/login' method='post'>",
      "<label for='email'>Email</label>",
      "<input id='email' name='email' type='email' required>",
      "<input name='csrf' type='hidden' value='secret-token'>",
      "<input name='password' type='password' value='secret-password'>",
      "<textarea name='note'>hello &amp; welcome</textarea>",
      "<select name='plan'><option value='free'>Free</option><option selected value='pro'>Pro</option></select>",
      "</form>",
      "<form id='external' action='https://example.com/collect' method='post'><input name='q'></form>",
      "<form id='upload' action='/upload' method='post' enctype='multipart/form-data'><input name='file' type='file'></form>",
      "</body>",
      "</html>",
    ].join(""));
  });
  const port = await listenOnLoopback(server);
  try {
    const tool = createBrowserSnapshotTool({ allowPrivateHosts: true });
    const submitTool = createBrowserFormSubmitTool({ allowPrivateHosts: true });
    const result = await tool.invoke({
      id: "browser-1",
      name: tool.name,
      input: { url: `http://127.0.0.1:${port}/`, timeoutMs: 1000 },
      sessionId: "browser-session",
    });
    assert(result.ok, `browser_snapshot failed: ${result.error}`);
    assert(result.output?.status === 200, "browser_snapshot should report HTTP status");
    assert(result.output?.title === "Dragon & Browser", "browser_snapshot should decode title");
    assert(result.output?.text.includes("Dragon Browser"), "browser_snapshot should include visible text");
    assert(!result.output?.text.includes("hidden"), "browser_snapshot should remove script content");
    assert(result.output?.links.some(link => link.href === `http://127.0.0.1:${port}/docs` && link.text === "Docs"), "browser_snapshot should resolve relative links");
    assert(result.output?.forms[0]?.action === `http://127.0.0.1:${port}/login`, "browser_snapshot should resolve form actions");
    assert(result.output?.forms[0]?.method === "post", "browser_snapshot should parse form methods");
    assert(result.output?.forms[0]?.fields.some(field => field.name === "email" && field.type === "email" && field.label === "Email" && field.required), "browser_snapshot should parse labeled required inputs");
    const hiddenField = result.output?.forms[0]?.fields.find(field => field.name === "csrf");
    assert(hiddenField?.type === "hidden" && hiddenField.value === undefined, "browser_snapshot should not expose hidden field values");
    const passwordField = result.output?.forms[0]?.fields.find(field => field.name === "password");
    assert(passwordField?.type === "password" && passwordField.value === undefined, "browser_snapshot should not expose password values");
    assert(result.output?.forms[0]?.fields.some(field => field.name === "note" && field.value === "hello & welcome"), "browser_snapshot should decode textarea defaults");
    assert(result.output?.forms[0]?.fields.some(field => field.name === "plan" && field.value === "pro" && field.options?.includes("free")), "browser_snapshot should parse select defaults and options");

    const submittedResult = await submitTool.invoke({
      id: "browser-submit-1",
      name: submitTool.name,
      input: {
        url: `http://127.0.0.1:${port}/`,
        formId: "login",
        fields: { email: "reader@example.test", note: "override", plan: "free" },
        timeoutMs: 1000,
      },
      sessionId: "browser-session",
    });
    assert(submittedResult.ok, `browser_form_submit failed: ${submittedResult.error}`);
    assert(submitted.method === "POST", "browser_form_submit should use form method");
    assert(submitted.body?.includes("csrf=secret-token"), "browser_form_submit should preserve hidden fields internally");
    assert(submitted.body?.includes("email=reader%40example.test"), "browser_form_submit should submit caller fields");
    assert(submitted.body?.includes("note=override"), "browser_form_submit should override defaults");
    assert(submittedResult.output?.submitted.fieldNames.includes("csrf"), "browser_form_submit should report submitted field names");
    assert(submittedResult.output?.snapshot.title === "Submitted", "browser_form_submit should return resulting page snapshot");
    assert(submittedResult.output?.snapshot.links.some(link => link.href === `http://127.0.0.1:${port}/done`), "browser_form_submit should snapshot resulting links");

    const crossOrigin = await submitTool.invoke({
      id: "browser-submit-2",
      name: submitTool.name,
      input: { url: `http://127.0.0.1:${port}/`, formId: "external", fields: { q: "x" }, timeoutMs: 1000 },
      sessionId: "browser-session",
    });
    assert(!crossOrigin.ok && crossOrigin.error?.includes("cross-origin"), "browser_form_submit should block cross-origin forms by default");

    const multipart = await submitTool.invoke({
      id: "browser-submit-3",
      name: submitTool.name,
      input: { url: `http://127.0.0.1:${port}/`, formId: "upload", timeoutMs: 1000 },
      sessionId: "browser-session",
    });
    assert(!multipart.ok && multipart.error?.includes("application/x-www-form-urlencoded"), "browser_form_submit should reject unsupported form encodings");

    const blocked = await tool.invoke({
      id: "browser-2",
      name: tool.name,
      input: { url: "file:///etc/passwd" },
      sessionId: "browser-session",
    });
    assert(!blocked.ok && blocked.error?.includes("HTTP(S)"), "browser_snapshot should reject non-HTTP URLs");
  } finally {
    await closeServer(server);
  }
}

async function testDelegationPlannerAndRunner(): Promise<void> {
  const plan = createDelegationPlan([
    { id: "inspect", title: "Inspect", prompt: "Inspect code." },
    { id: "review", title: "Review", prompt: "Review findings.", dependsOn: ["inspect"] },
    { id: "summarize", title: "Summarize", prompt: "Summarize.", dependsOn: ["inspect", "review"] },
  ]);
  const executionOrder: string[] = [];
  const run = await runDelegationPlan(plan, async task => {
    executionOrder.push(task.id);
    await delay(5);
    return `done:${task.id}`;
  }, { maxConcurrency: 2 });
  assert(run.status === "ok", "delegation run should complete successfully");
  assert(run.results.map(result => result.taskId).join(",") === "inspect,review,summarize", "delegation results should follow plan order");
  assert(executionOrder[0] === "inspect", "delegation should respect dependencies");
  assert(readPath(run.results[2], ["output"]) === "done:summarize", "delegation should preserve executor output");

  const runtimeInputs: DragonTurnInput[] = [];
  const runtimeExecutor = createRuntimeDelegatedTaskExecutor({
    runtime: {
      async runTurn(input) {
        runtimeInputs.push(input);
        const assistant = input.message.includes("Dependency results:")
          ? "used dependency context"
          : "first task output";
        return {
          runId: `run-${runtimeInputs.length}`,
          status: "ok",
          messages: [
            { id: `user-${runtimeInputs.length}`, role: "user", content: input.message, createdAt: "2026-05-17T10:00:00.000Z" },
            { id: `assistant-${runtimeInputs.length}`, role: "assistant", content: assistant, createdAt: "2026-05-17T10:00:01.000Z" },
          ],
        };
      },
      subscribe() {
        return () => undefined;
      },
    },
    sessionId: task => `delegated-${task.id}`,
    workspace: "/tmp/dragon",
    model: "mock:model",
    metadata: { parentRunId: "parent-run" },
  });
  const runtimePlan = createDelegationPlan([
    { id: "draft", title: "Draft", prompt: "Draft the design.", metadata: { stage: "draft" } },
    { id: "review", title: "Review", prompt: "Review the design.", dependsOn: ["draft"], role: "reviewer" },
  ]);
  const runtimeRun = await runDelegationPlan(runtimePlan, runtimeExecutor, { maxConcurrency: 1 });
  assert(runtimeRun.status === "ok", "runtime delegation executor should complete successfully");
  assert(runtimeInputs.length === 2, "runtime delegation executor should call the runtime for each task");
  assert(runtimeInputs[0]?.sessionId === "delegated-draft", "runtime delegation executor should derive task sessions");
  assert(runtimeInputs[0]?.source === "api", "runtime delegation executor should default to api source");
  assert(runtimeInputs[0]?.workspace === "/tmp/dragon", "runtime delegation executor should pass workspace");
  assert(runtimeInputs[0]?.model === "mock:model", "runtime delegation executor should pass model");
  assert(readPath(runtimeInputs[0]?.metadata, ["parentRunId"]) === "parent-run", "runtime delegation executor should merge parent metadata");
  assert(readPath(runtimeInputs[0]?.metadata, ["stage"]) === "draft", "runtime delegation executor should merge task metadata");
  assert(readPath(runtimeInputs[1]?.metadata, ["delegationTaskRole"]) === "reviewer", "runtime delegation executor should annotate task role");
  assert(runtimeInputs[1]?.message.includes("Dependency results:"), "dependent runtime task should receive dependency context");
  assert(runtimeInputs[1]?.message.includes("first task output"), "dependent runtime task should include upstream assistant output");
  assert(readPath(runtimeRun.results[1], ["output", "assistantMessage"]) === "used dependency context", "runtime delegation output should expose assistant message");

  const toolRuntimeInputs: DragonTurnInput[] = [];
  const delegationTool = createRuntimeDelegationTool({
    runtime: {
      async runTurn(input) {
        toolRuntimeInputs.push(input);
        const taskId = String(input.metadata?.delegationTaskId ?? "unknown");
        return {
          runId: `tool-run-${taskId}`,
          status: "ok",
          messages: [
            { id: `tool-user-${taskId}`, role: "user", content: input.message, createdAt: "2026-05-17T10:00:00.000Z" },
            { id: `tool-assistant-${taskId}`, role: "assistant", content: `tool:${taskId}`, createdAt: "2026-05-17T10:00:01.000Z" },
          ],
        };
      },
      subscribe() {
        return () => undefined;
      },
    },
    defaultSessionPrefix: "tool-delegate",
    defaultWorkspace: "/tmp/tool",
    defaultModel: "mock:tool",
    maxTasks: 4,
  });
  const toolRun = await delegationTool.invoke({
    id: "delegation-tool-1",
    name: delegationTool.name,
    input: {
      tasks: [
        { id: "alpha", title: "Alpha", prompt: "Draft alpha." },
        { id: "beta", title: "Beta", prompt: "Review beta.", dependsOn: ["alpha"], role: "reviewer" },
      ],
      maxConcurrency: 2,
    },
    sessionId: "parent-session",
    metadata: { runId: "parent-run" },
  });
  assert(toolRun.ok, `delegation_run tool failed: ${toolRun.error}`);
  assert(toolRun.output?.status === "ok", "delegation_run tool should return a successful run");
  assert(toolRuntimeInputs.length === 2, "delegation_run tool should call runtime once per task");
  assert(toolRuntimeInputs[0]?.sessionId === "tool-delegate:alpha", "delegation_run tool should derive child session ids");
  assert(toolRuntimeInputs[0]?.workspace === "/tmp/tool", "delegation_run tool should apply default workspace");
  assert(toolRuntimeInputs[0]?.model === "mock:tool", "delegation_run tool should apply default model");
  assert(readPath(toolRuntimeInputs[0]?.metadata, ["parentSessionId"]) === "parent-session", "delegation_run tool should annotate parent session");
  assert(readPath(toolRuntimeInputs[0]?.metadata, ["parentRunId"]) === "parent-run", "delegation_run tool should annotate parent run");
  assert(toolRuntimeInputs[1]?.message.includes("Dependency results:"), "delegation_run tool should include dependency context");
  assert(readPath(toolRun.output, ["results", 1, "output", "assistantMessage"]) === "tool:beta", "delegation_run output should expose assistant messages");

  const tooManyTasks = await delegationTool.invoke({
    id: "delegation-tool-2",
    name: delegationTool.name,
    input: {
      tasks: Array.from({ length: 5 }, (_value, index) => ({
        id: `t${index}`,
        title: `Task ${index}`,
        prompt: "Run task.",
      })),
    },
    sessionId: "parent-session",
  });
  assert(!tooManyTasks.ok && tooManyTasks.error?.includes("at most 4 tasks"), "delegation_run tool should enforce task bounds");

  const invalidTask = await delegationTool.invoke({
    id: "delegation-tool-3",
    name: delegationTool.name,
    input: {
      tasks: [{ id: "bad", title: "Bad", prompt: 42 }],
    } as unknown as DragonRuntimeDelegationToolInput,
    sessionId: "parent-session",
  });
  assert(!invalidTask.ok && invalidTask.error?.includes("task prompt must be a string"), "delegation_run tool should reject malformed task input");

  const failingRuntimeExecutor = createRuntimeDelegatedTaskExecutor({
    runtime: {
      async runTurn(input) {
        if (input.metadata?.delegationTaskId === "a") {
          return {
            runId: "runtime-error",
            status: "error",
            error: "runtime failed",
            messages: [],
          };
        }
        return {
          runId: "runtime-ok",
          status: "ok",
          messages: [],
        };
      },
      subscribe() {
        return () => undefined;
      },
    },
    sessionId: task => `runtime-failure-${task.id}`,
  });
  const failurePlan = createDelegationPlan([
    { id: "a", title: "A", prompt: "A" },
    { id: "b", title: "B", prompt: "B", dependsOn: ["a"] },
  ]);
  const runtimeFailed = await runDelegationPlan(failurePlan, failingRuntimeExecutor);
  assert(runtimeFailed.status === "error", "runtime delegation executor should fail non-ok runtime turns");
  assert(runtimeFailed.results[0]?.error?.includes("runtime failed"), "runtime delegation executor should surface runtime errors");
  assert(runtimeFailed.results[1]?.status === "skipped", "runtime delegation executor should skip dependents after runtime errors");

  const failed = await runDelegationPlan(failurePlan, async task => {
    if (task.id === "a") {
      throw new Error("boom");
    }
    return "unreachable";
  });
  assert(failed.status === "error", "delegation run should report executor failure");
  assert(failed.results[0]?.status === "error", "failed task should be marked error");
  assert(failed.results[1]?.status === "skipped", "dependent task should be skipped");
  assert(failed.results[1]?.skippedBecause?.includes("a"), "skipped task should name failed dependency");

  let cycleRejected = false;
  try {
    createDelegationPlan([
      { id: "a", title: "A", prompt: "A", dependsOn: ["b"] },
      { id: "b", title: "B", prompt: "B", dependsOn: ["a"] },
    ]);
  } catch {
    cycleRejected = true;
  }
  assert(cycleRejected, "delegation planner should reject dependency cycles");
}

async function testAnthropicProviderToolUse(): Promise<void> {
  const requests: Array<Record<string, unknown>> = [];
  const provider = createAnthropicProvider({
    apiKey: "test-key",
    defaultModel: "claude-test",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        id: "msg_1",
        content: [
          { type: "text", text: "Checking." },
          { type: "tool_use", id: "toolu_1", name: "git_status", input: { porcelain: true } },
        ],
        usage: {
          input_tokens: 11,
          output_tokens: 7,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert(provider.supportsToolCalling === true, "Anthropic provider should advertise tool calling");
  assert(provider.models?.[0]?.id === "claude-test" && provider.models[0].default === true, "Anthropic provider should expose its default model catalog entry");
  const response = await provider.complete({
    model: "claude-test",
    messages: [
      { role: "system", content: "System prompt." },
      { role: "user", content: "Check git status." },
      {
        role: "assistant",
        toolCalls: [{
          id: "toolu_prior",
          type: "function",
          function: { name: "git_status", arguments: JSON.stringify({ porcelain: false }) },
        }],
      },
      { role: "tool", toolCallId: "toolu_prior", content: JSON.stringify({ ok: true }) },
    ],
    tools: [{
      type: "function",
      function: {
        name: "git_status",
        description: "Read git status.",
        parameters: {
          type: "object",
          properties: {
            porcelain: { type: "boolean" },
          },
        },
      },
    }],
  });

  const body = requests[0];
  assert(body !== undefined, "Anthropic provider should issue one request");
  assert(readPath(body, ["system"]) === "System prompt.", "system prompt should be sent separately");
  assert(readPath(body, ["tools", 0, "name"]) === "git_status", "OpenAI-shaped tool should become Anthropic tool");
  assert(readPath(body, ["tools", 0, "input_schema", "properties", "porcelain", "type"]) === "boolean", "tool schema should be preserved");
  assert(readPath(body, ["messages", 1, "content", 0, "type"]) === "tool_use", "assistant tool calls should become tool_use blocks");
  assert(readPath(body, ["messages", 1, "content", 0, "input", "porcelain"]) === false, "tool call arguments should be parsed");
  assert(readPath(body, ["messages", 2, "content", 0, "type"]) === "tool_result", "tool result should become user tool_result block");
  assert(readPath(body, ["messages", 2, "content", 0, "tool_use_id"]) === "toolu_prior", "tool result should preserve tool use id");
  assert(response.text === "Checking.", "text response should be preserved");
  assert(response.toolCalls?.[0]?.id === "toolu_1", "tool_use id should become Dragon tool call id");
  assert(response.toolCalls?.[0]?.function?.name === "git_status", "tool_use name should become Dragon tool call name");
  assert(response.toolCalls?.[0]?.function?.arguments === JSON.stringify({ porcelain: true }), "tool_use input should be stringified");
  assert(response.usage?.inputTokens === 11 && response.usage.outputTokens === 7, "usage should be mapped");
}

async function testAnthropicProviderStreaming(): Promise<void> {
  const requests: Array<Record<string, unknown>> = [];
  const provider = createAnthropicProvider({
    apiKey: "test-key",
    defaultModel: "claude-test",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(toSse([
        {
          type: "message_start",
          message: {
            id: "msg_stream",
            usage: { input_tokens: 5 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hel" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "lo" },
        },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "toolu_stream", name: "git_status", input: {} },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: "{\"por" },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: "celain\":true}" },
        },
        {
          type: "message_delta",
          usage: { output_tokens: 3 },
        },
        { type: "message_stop" },
      ], "message"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
  });

  const deltas: string[] = [];
  const response = await provider.complete({
    model: "claude-test",
    messages: [{ role: "user", content: "hello" }],
    onTextDelta: delta => deltas.push(delta),
  });

  assert(readPath(requests[0], ["stream"]) === true, "Anthropic stream request should set stream true");
  assert(deltas.join("") === "Hello", "Anthropic text deltas should stream");
  assert(response.streamedText === true, "Anthropic streaming response should mark streamed text");
  assert(response.text === "Hello", "Anthropic streaming text should be accumulated");
  assert(response.toolCalls?.[0]?.id === "toolu_stream", "Anthropic streaming tool_use id should be accumulated");
  assert(response.toolCalls?.[0]?.function?.arguments === JSON.stringify({ porcelain: true }), "Anthropic streaming tool args should be accumulated");
  assert(response.usage?.inputTokens === 5 && response.usage.outputTokens === 3, "Anthropic streaming usage should be mapped");
}

async function testMcpHttpTransport(): Promise<void> {
  const requests: Array<{ method?: string; id?: number }> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; id?: number };
    requests.push(body);
    if (body.method === "initialize") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05" } }),
        { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } },
      );
    }
    if (body.method === "notifications/initialized") {
      return new Response("", { status: 202, headers: { "content-type": "application/json" } });
    }
    if (body.method === "tools/list") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [{ name: "ping", description: "ping tool" }] },
        }),
        { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } },
      );
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "pong" }] } }),
      { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } },
    );
  };
  const registry = createToolRegistry();
  const result = await registerMcpTools(registry, {
    servers: [{ id: "demo", url: "http://127.0.0.1:9999/mcp" }],
    fetchImpl,
  });
  assert(result.errors.length === 0, `MCP HTTP registration should succeed: ${result.errors.join("; ")}`);
  assert(result.registered.includes("mcp_demo_ping"), "MCP HTTP tools should register with prefixed names");
  assert(requests.some(request => request.method === "initialize"), "MCP HTTP client should initialize");
  assert(requests.some(request => request.method === "tools/list"), "MCP HTTP client should list tools");
  const tool = registry.get("mcp_demo_ping");
  assert(tool !== undefined, "registered MCP HTTP tool should be retrievable");
  const invocation = await tool.invoke({
    id: "mcp-http-1",
    name: "mcp_demo_ping",
    input: {},
    sessionId: "test",
  });
  assert(invocation.ok === true, "MCP HTTP tool invoke should succeed");
  assert(requests.some(request => request.method === "tools/call"), "MCP HTTP client should call tools");
}

async function testBrowserSsrfRedirectBlock(): Promise<void> {
  for (const [url, needle, label] of [
    ["file:///etc/passwd", "HTTP(S)", "file URLs should be rejected"],
    ["http://127.0.0.1/", "private", "loopback IP should be rejected"],
    ["http://metadata.google.internal/computeMetadata/v1/", "blocked host", "cloud metadata host should be rejected"],
  ] as const) {
    try {
      validateBrowserTargetUrl(url);
      assert(false, label);
    } catch (error) {
      assert(error instanceof Error && error.message.includes(needle), label);
    }
  }

  const fetchImpl: typeof fetch = async (_url, init) => {
    if (init?.redirect === "manual") {
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      });
    }
    return new Response("ok", { status: 200 });
  };
  const tool = createBrowserSnapshotTool({ fetchImpl });
  const result = await tool.invoke({
    id: "redirect-block",
    name: tool.name,
    input: { url: "https://example.com/start", timeoutMs: 1000 },
    sessionId: "browser-ssrf",
  });
  assert(!result.ok, "redirect to private host should fail");
  assert(
    result.error?.includes("localhost") || result.error?.includes("private"),
    `redirect SSRF should be blocked: ${result.error}`,
  );
}

async function testBrowserPlaywrightSnapshotTool(): Promise<void> {
  const tool = createBrowserPlaywrightSnapshotTool();
  const result = await tool.invoke({
    id: "pw-1",
    name: tool.name,
    input: { url: "https://example.com" },
    sessionId: "browser-pw",
  });
  if (result.ok) {
    assert(result.output?.rendered === true, "output should be marked rendered");
    assert(result.output?.engine === "playwright-chromium", "output should name playwright engine");
    assert(typeof result.output?.text === "string" && result.output.text.length > 0, "playwright should return body text");
    return;
  }
  assert(result.error?.includes("Playwright"), "missing playwright should mention install instructions");
}

async function testOpenAIProviderToolCallTranslation(): Promise<void> {
  const requests: Array<Record<string, unknown>> = [];
  const provider = createOpenAICompatibleProvider({
    apiKey: "test-key",
    defaultModel: "openai-test",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        id: "chatcmpl_1",
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "git_status", arguments: JSON.stringify({ porcelain: true }) },
            }],
          },
        }],
        usage: {
          prompt_tokens: 9,
          completion_tokens: 3,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert(provider.supportsToolCalling === true, "OpenAI-compatible provider should advertise tool calling by default");
  assert(provider.models?.[0]?.id === "openai-test" && provider.models[0].default === true, "OpenAI-compatible provider should expose its default model catalog entry");
  const response = await provider.complete({
    model: "openai-test",
    messages: [
      { role: "system", content: "System prompt." },
      { role: "user", content: "Check git status." },
      {
        role: "assistant",
        toolCalls: [{
          id: "call_prior",
          type: "function",
          function: { name: "git_status", arguments: JSON.stringify({ porcelain: false }) },
        }],
      },
      { role: "tool", toolCallId: "call_prior", content: JSON.stringify({ ok: true }) },
    ],
    tools: [{
      type: "function",
      function: {
        name: "git_status",
        description: "Read git status.",
        parameters: { type: "object" },
      },
    }],
  });

  const body = requests[0];
  assert(body !== undefined, "OpenAI-compatible provider should issue one request");
  assert(readPath(body, ["tools", 0, "function", "name"]) === "git_status", "tool definition should be forwarded");
  assert(readPath(body, ["messages", 2, "tool_calls", 0, "id"]) === "call_prior", "assistant tool calls should be forwarded");
  assert(readPath(body, ["messages", 3, "tool_call_id"]) === "call_prior", "tool result id should be forwarded");
  assert(response.toolCalls?.[0]?.id === "call_1", "provider tool call id should be preserved");
  assert(response.toolCalls?.[0]?.function?.name === "git_status", "provider tool call name should be preserved");
  assert(response.toolCalls?.[0]?.function?.arguments === JSON.stringify({ porcelain: true }), "provider tool call args should be preserved");
  assert(response.usage?.inputTokens === 9 && response.usage.outputTokens === 3, "usage should be mapped");
}

async function testOpenAIProviderStreaming(): Promise<void> {
  const requests: Array<Record<string, unknown>> = [];
  const provider = createOpenAICompatibleProvider({
    apiKey: "test-key",
    defaultModel: "openai-test",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(toSse([
        {
          id: "chatcmpl_stream",
          choices: [{ delta: { content: "Hel" } }],
        },
        {
          id: "chatcmpl_stream",
          choices: [{ delta: { content: "lo" } }],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
        },
        {
          id: "chatcmpl_stream",
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_stream",
                type: "function",
                function: { name: "git_status", arguments: "{\"por" },
              }],
            },
          }],
        },
        {
          id: "chatcmpl_stream",
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: "celain\":true}" },
              }],
            },
          }],
        },
        "[DONE]",
      ]), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
  });

  const deltas: string[] = [];
  const response = await provider.complete({
    model: "openai-test",
    messages: [{ role: "user", content: "hello" }],
    onTextDelta: delta => deltas.push(delta),
  });

  assert(readPath(requests[0], ["stream"]) === true, "OpenAI stream request should set stream true");
  assert(deltas.join("") === "Hello", "OpenAI text deltas should stream");
  assert(response.streamedText === true, "OpenAI streaming response should mark streamed text");
  assert(response.text === "Hello", "OpenAI streaming text should be accumulated");
  assert(response.toolCalls?.[0]?.id === "call_stream", "OpenAI streaming tool call id should be accumulated");
  assert(response.toolCalls?.[0]?.function?.arguments === JSON.stringify({ porcelain: true }), "OpenAI streaming tool args should be accumulated");
  assert(response.usage?.inputTokens === 4 && response.usage.outputTokens === 2, "OpenAI streaming usage should be mapped when present");
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});




