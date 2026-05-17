import { randomBytes } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseSlackWebhook, parseTelegramWebhook, toGatewayWebhookPayload } from "@dragon/channels";
import type { DragonAgentRuntime, DragonEvent, DragonTurnInput, DragonTurnResult } from "@dragon/core";
import { createDragonRuntime } from "@dragon/core";
import { createCronRunner, createFileCronJobStore, createGatewayWebhookCronTarget, nextCronRun, parseCronSchedule, toGatewayWebhookCronPayload } from "@dragon/cron";
import { createDelegationPlan, createRuntimeDelegatedTaskExecutor, runDelegationPlan } from "@dragon/delegation";
import { createHttpGateway } from "@dragon/gateway";
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
import { createAnthropicProvider, createOpenAICompatibleProvider, type ModelProvider, type ModelRequest } from "@dragon/providers";
import { createBrowserSnapshotTool, createSandboxExecTool, createToolPermissionEngine, planSandboxExecCommand, type ToolDefinition } from "@dragon/tools";

const TEST_TIMEOUT_MS = 5000;
type AnyBuffer = Buffer<ArrayBufferLike>;
const execFile = promisify(execFileCallback);
const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function main(): Promise<void> {
  const tests: Array<[string, () => Promise<void>]> = [
    ["cli skills slash command", testCliSkillsSlashCommand],
    ["cli cron once", testCliCronOnce],
    ["cli model provider plugin", testCliModelProviderPlugin],
    ["openrouter provider plugin", testOpenRouterProviderPlugin],
    ["gateway direct tool RPC", testGatewayDirectToolRpc],
    ["gateway websocket RPC and events", testGatewayWebSocket],
    ["gateway webhook channel", testGatewayWebhookChannel],
    ["gateway cron RPC", testGatewayCronRpc],
    ["channel adapters", testChannelAdapters],
    ["gateway memory candidate review RPC", testGatewayMemoryCandidateRpc],
    ["dashboard memory review smoke", testDashboardMemoryReviewSmoke],
    ["memory candidate review tools", testMemoryCandidateTools],
    ["trajectory persistence and gateway RPC", testTrajectoryPersistenceAndGatewayRpc],
    ["sandbox exec tool", testSandboxExecTool],
    ["cron schedule and gateway delivery", testCronScheduleAndGatewayDelivery],
    ["cron file store and runner", testCronFileStoreAndRunner],
    ["browser snapshot tool", testBrowserSnapshotTool],
    ["delegation planner and runner", testDelegationPlannerAndRunner],
    ["runtime tool-call loop", testRuntimeToolCallLoop],
    ["openai provider tool call translation", testOpenAIProviderToolCallTranslation],
    ["openai provider streaming", testOpenAIProviderStreaming],
    ["anthropic provider tool use translation", testAnthropicProviderToolUse],
    ["anthropic provider streaming", testAnthropicProviderStreaming],
  ];

  for (const [name, test] of tests) {
    await test();
    process.stdout.write(`ok - ${name}\n`);
  }
}

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

async function testGatewayDirectToolRpc(): Promise<void> {
  const tools: ToolDefinition[] = [
    createMockTool("git_status", ["read", "execute"], async invocation => ({
      input: invocation.input,
      sessionId: invocation.sessionId,
    })),
    createMockTool("git_diff", ["read", "execute"], async () => "denied by policy"),
    createMockTool("git_log", ["read", "execute"], async () => "x".repeat(300_000)),
    createMockTool("file_read", ["read"], async () => "not allowed for direct invocation"),
    createMockTool("network_read", ["read", "network"], async () => "not allowed for direct invocation"),
  ];
  const permissionEngine = createToolPermissionEngine({
    defaultDecision: "ask",
    rules: [
      { toolName: "git_status", decision: "allow", reason: "test allow" },
      { toolName: "git_log", decision: "allow", reason: "test allow" },
      { toolName: "git_diff", decision: "deny", reason: "test deny" },
    ],
  });
  const gateway = createHttpGateway({
    runtime: createNoopRuntime(),
    providerSummaries: [{
      id: "openai",
      displayName: "OpenAI Compatible",
      defaultModel: "gpt-test",
      supportsToolCalling: true,
    }],
    tools,
    permissionEngine,
  });
  await gateway.start({ host: "127.0.0.1", port: 0, authMode: "shared-secret", sharedSecret: "secret" });
  const address = gateway.address();
  assert(address !== undefined, "Gateway did not start");

  try {
    const unauthorized = await rpc(address.url, "tools.catalog", undefined, "bad-secret");
    assert(unauthorized.status === 401, `Expected 401 for bad secret, got ${unauthorized.status}`);

    const catalog = await rpc(address.url, "tools.catalog", { includeSchemas: true });
    assert(catalog.status === 200 && catalog.json.ok === true, "tools.catalog should succeed");
    const toolsByName = new Map<string, Record<string, unknown>>(
      readRecordArray(catalog.json.payload, "tools").map(tool => [String(tool.name), tool]),
    );
    assert(toolsByName.get("git_status")?.directInvokeAllowed === true, "git_status should be direct invokable");
    assert(toolsByName.get("file_read")?.directInvokeAllowed === false, "file_read should not be direct invokable");
    assert(toolsByName.get("network_read")?.directInvokeAllowed === false, "network_read should not be direct invokable");

    const providers = await rpc(address.url, "providers.list");
    assert(providers.status === 200 && providers.json.ok === true, "providers.list should succeed");
    assert(readPath(providers.json, ["payload", "providers", 0, "id"]) === "openai", "provider id should be returned");
    assert(readPath(providers.json, ["payload", "providers", 0, "supportsToolCalling"]) === true, "provider tool capability should be returned");

    const health = await rpc(address.url, "health");
    assert(readPath(health.json, ["payload", "providerCount"]) === 1, "health should include provider count");
    const connect = await rpc(address.url, "connect");
    assert(readArray(connect.json.payload, "capabilities").includes("providers.list"), "connect should advertise providers.list");

    const ok = await rpc(address.url, "tool.invoke", {
      toolName: "git_status",
      input: { porcelain: true },
      sessionId: "s1",
    });
    assert(ok.status === 200 && ok.json.ok === true, "git_status direct invoke should succeed");
    assert(readPath(ok.json, ["payload", "result", "output", "input", "porcelain"]) === true, "tool input should round-trip");
    assert(readPath(ok.json, ["payload", "permission", "decision"]) === "allow", "permission summary should be returned");

    const denied = await rpc(address.url, "tool.invoke", { toolName: "git_diff" });
    assert(denied.status === 400 && denied.json.ok === false, "git_diff should be denied by permission engine");
    assert(String(denied.json.error).includes("Tool permission deny"), "permission denial should be explicit");

    const blocked = await rpc(address.url, "tool.invoke", { toolName: "file_read", input: { path: "README.md" } });
    assert(blocked.status === 400 && blocked.json.ok === false, "file_read should be blocked before invocation");
    assert(String(blocked.json.error).includes("not available for direct"), "blocked tool error should explain restriction");

    const large = await rpc(address.url, "tool.invoke", { toolName: "git_log" });
    assert(large.status === 200 && large.json.ok === true, "large result should return a bounded payload");
    assert(readPath(large.json, ["payload", "result", "truncated"]) === true, "large result should be marked truncated");
    assert(JSON.stringify(large.json).length < 90_000, "large result should stay bounded");
  } finally {
    await gateway.stop();
  }
}

async function testGatewayWebSocket(): Promise<void> {
  const runtime = createEventRuntime();
  const gateway = createHttpGateway({ runtime });
  await gateway.start({ host: "127.0.0.1", port: 0 });
  const address = gateway.address();
  assert(address !== undefined, "Gateway did not start");

  try {
    const client = await RawWebSocketClient.connect(address.port, "/ws?sessionId=s1", {
      "Sec-WebSocket-Protocol": "dragon.gateway.v1",
    });
    try {
      const ready = await client.waitForJson(message => message.type === "ready", "ready");
      assert(ready.protocolVersion === 1, "ready should include protocol version");

      client.sendJson({ type: "connect", id: "connect-1" });
      const connect = await client.waitForJson(message => message.type === "response" && message.id === "connect-1", "connect response");
      assert(connect.ok === true, "connect response should be ok");
      assert(readArray(connect.payload, "capabilities").includes("events.websocket"), "connect should advertise websocket events");

      client.sendJson({ type: "agent", id: "agent-1", params: { sessionId: "s1", message: "hello" } });
      const event = await client.waitForJson(
        message => message.type === "event" && isRecord(message.event) && message.event.runId === "ws-run-1",
        "runtime event",
      );
      assert(event.sessionId === "s1", "event should preserve session identity");
      const agent = await client.waitForJson(message => message.type === "response" && message.id === "agent-1", "agent response");
      assert(agent.ok === true, "agent response should be ok");
      assert(readPath(agent, ["payload", "result", "messages", 1, "content"]) === "ws-ok", "agent result should round-trip");
    } finally {
      client.close();
    }
  } finally {
    await gateway.stop();
  }

  const authGateway = createHttpGateway({ runtime: createNoopRuntime() });
  await authGateway.start({ host: "127.0.0.1", port: 0, authMode: "shared-secret", sharedSecret: "secret" });
  const authAddress = authGateway.address();
  assert(authAddress !== undefined, "Auth gateway did not start");
  try {
    const raw = await rawWebSocketUpgrade(authAddress.port, "/ws", {});
    assert(raw.startsWith("HTTP/1.1 401 Unauthorized"), `Expected WebSocket auth rejection, got ${raw.split("\r\n")[0]}`);
  } finally {
    await authGateway.stop();
  }
}

async function testGatewayWebhookChannel(): Promise<void> {
  let capturedInput: DragonTurnInput | undefined;
  const listeners = new Set<(event: DragonEvent) => void>();
  const runtime: DragonAgentRuntime = {
    async runTurn(input) {
      capturedInput = input;
      const runId = "webhook-run-1";
      for (const listener of listeners) {
        listener({
          type: "lifecycle",
          runId,
          phase: "start",
          metadata: { sessionId: input.sessionId },
        });
      }
      for (const listener of listeners) {
        listener({ type: "assistant_delta", runId, text: "channel-ok" });
      }
      return {
        runId,
        status: "ok",
        messages: [
          { id: "user-1", role: "user", content: input.message, createdAt: new Date().toISOString() },
          { id: "assistant-1", role: "assistant", content: "channel-ok", createdAt: new Date().toISOString() },
        ],
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const gateway = createHttpGateway({ runtime });
  await gateway.start({ host: "127.0.0.1", port: 0, authMode: "shared-secret", sharedSecret: "secret" });
  const address = gateway.address();
  assert(address !== undefined, "Webhook gateway did not start");

  try {
    const unauthorized = await postJson(`${address.url}/channels/webhook`, {
      sessionId: "channel-session",
      message: "hello",
    }, "bad-secret");
    assert(unauthorized.status === 401, "webhook channel should require gateway auth when configured");

    const connect = await rpc(address.url, "connect");
    assert(readArray(connect.json.payload, "capabilities").includes("channels.webhook"), "connect should advertise webhook channel");

    const delivered = await postJson(`${address.url}/channels/webhook`, {
      sessionId: "channel-session",
      message: "hello from channel",
      channel: "telegram",
      userId: "user-1",
      threadId: "thread-1",
      metadata: { custom: "value" },
    });
    assert(delivered.status === 200 && delivered.json.ok === true, "webhook channel delivery should succeed");
    assert(readPath(delivered.json, ["payload", "channel"]) === "telegram", "webhook response should echo channel");
    assert(readPath(delivered.json, ["payload", "result", "messages", 1, "content"]) === "channel-ok", "webhook response should include agent result");
    assert(capturedInput?.source === "web", "webhook channel should default source to web");
    assert(capturedInput?.sessionId === "channel-session", "webhook channel should forward session id");
    assert(capturedInput?.metadata?.channel === "telegram", "webhook channel should annotate channel metadata");
    assert(capturedInput?.metadata?.channelUserId === "user-1", "webhook channel should annotate user metadata");
    assert(capturedInput?.metadata?.channelThreadId === "thread-1", "webhook channel should annotate thread metadata");
    assert(capturedInput?.metadata?.custom === "value", "webhook channel should preserve custom metadata");
  } finally {
    await gateway.stop();
  }
}

async function testChannelAdapters(): Promise<void> {
  const telegram = parseTelegramWebhook({
    update_id: 123,
    message: {
      message_id: 456,
      date: 1_779_000_000,
      text: "  hello dragon  ",
      chat: { id: -1001, type: "supergroup" },
      from: { id: 42, username: "alice" },
    },
  });
  assert(telegram !== undefined, "telegram adapter should parse text messages");
  assert(telegram.channel === "telegram", "telegram adapter should label channel");
  assert(telegram.text === "hello dragon", "telegram adapter should trim message text");
  assert(telegram.userId === "42", "telegram adapter should normalize numeric user ids");
  assert(telegram.threadId === "-1001", "telegram adapter should use chat id as thread");
  assert(readPath(telegram.metadata, ["telegramChatType"]) === "supergroup", "telegram adapter should preserve chat type metadata");
  const caption = parseTelegramWebhook({
    update_id: 124,
    message: {
      message_id: 457,
      text: "",
      caption: "image caption",
      chat: { id: 99 },
    },
  });
  assert(caption?.text === "image caption", "telegram adapter should fall back to caption text");

  const telegramPayload = toGatewayWebhookPayload(telegram, {
    sessionPrefix: "dragon",
    workspace: "/workspace",
    model: "mock:model",
    metadata: { source: "test" },
  });
  assert(telegramPayload.sessionId === "dragon:telegram:-1001", "gateway payload should derive stable session ids");
  assert(telegramPayload.message === "hello dragon", "gateway payload should carry channel text");
  assert(telegramPayload.channel === "telegram", "gateway payload should carry channel name");
  assert(telegramPayload.userId === "42", "gateway payload should carry user id");
  assert(readPath(telegramPayload.metadata, ["channelMessageId"]) === "456", "gateway payload should annotate channel message id");
  assert(readPath(telegramPayload.metadata, ["source"]) === "test", "gateway payload should preserve caller metadata");

  const slack = parseSlackWebhook({
    type: "event_callback",
    team_id: "T1",
    event: {
      type: "message",
      channel: "C1",
      user: "U1",
      text: "review this",
      ts: "1710000000.000100",
      thread_ts: "1710000000.000000",
    },
  });
  assert(slack !== undefined, "slack adapter should parse message events");
  assert(slack.channel === "slack", "slack adapter should label channel");
  assert(slack.userId === "U1", "slack adapter should preserve user id");
  assert(slack.threadId === "1710000000.000000", "slack adapter should prefer thread timestamp");
  assert(readPath(slack.metadata, ["slackTeamId"]) === "T1", "slack adapter should preserve team metadata");
  const slash = parseSlackWebhook({
    command: "/dragon",
    text: "",
    user_id: "U2",
    channel_id: "C2",
    trigger_id: "trigger-1",
  });
  assert(slash?.text === "/dragon", "slack adapter should keep slash commands without text");

  const ignored = parseSlackWebhook({ type: "event_callback", event: { type: "reaction_added", user: "U1" } });
  assert(ignored === undefined, "slack adapter should ignore non-text events");
}

async function testGatewayCronRpc(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dragon-gateway-cron-"));
  const store = createFileCronJobStore({ filePath: path.join(root, "jobs.json") });
  const delivered: string[] = [];
  const runner = createCronRunner({
    store,
    now: () => new Date("2026-05-17T10:01:30.000Z"),
    target: {
      async deliver(job, occurrence) {
        delivered.push(`${job.id}:${occurrence.scheduledAt}`);
        return { ok: true, status: 200, payload: { accepted: true } };
      },
    },
  });
  const gateway = createHttpGateway({
    runtime: createNoopRuntime(),
    cronStore: store,
    cronRunner: runner,
  });
  await gateway.start({ host: "127.0.0.1", port: 0 });
  const address = gateway.address();
  assert(address !== undefined, "Cron gateway did not start");

  try {
    const connect = await rpc(address.url, "connect");
    assert(readArray(connect.json.payload, "capabilities").includes("cron.jobs.list"), "connect should advertise cron job listing");
    assert(readArray(connect.json.payload, "capabilities").includes("cron.tick"), "connect should advertise cron ticking");

    const upsert = await rpc(address.url, "cron.job.upsert", {
      id: "gateway-cron-1",
      sessionId: "cron-session",
      message: "run via gateway",
      schedule: "* * * * *",
      nextRunAt: "2026-05-17T10:01:00.000Z",
      metadata: { project: "dragon" },
    });
    assert(upsert.status === 200 && upsert.json.ok === true, "cron.job.upsert should succeed");
    assert(readPath(upsert.json, ["payload", "job", "id"]) === "gateway-cron-1", "cron.job.upsert should return job");

    const listed = await rpc(address.url, "cron.jobs.list");
    assert(listed.status === 200 && listed.json.ok === true, "cron.jobs.list should succeed");
    assert(readPath(listed.json, ["payload", "jobs", 0, "id"]) === "gateway-cron-1", "cron.jobs.list should return stored job");

    const tick = await rpc(address.url, "cron.tick");
    assert(tick.status === 200 && tick.json.ok === true, "cron.tick should succeed");
    assert(readPath(tick.json, ["payload", "delivered", 0, "jobId"]) === "gateway-cron-1", "cron.tick should deliver due job");
    assert(delivered[0] === "gateway-cron-1:2026-05-17T10:01:00.000Z", "cron.tick should preserve occurrence time");

    const afterTick = await rpc(address.url, "cron.jobs.list");
    assert(readPath(afterTick.json, ["payload", "jobs", 0, "lastStatus"]) === "ok", "cron.tick should persist job status");

    const removed = await rpc(address.url, "cron.job.remove", { id: "gateway-cron-1" });
    assert(removed.status === 200 && removed.json.ok === true, "cron.job.remove should succeed");
    assert(readPath(removed.json, ["payload", "removed"]) === true, "cron.job.remove should report removal");
  } finally {
    await gateway.stop();
    await rm(root, { recursive: true, force: true });
  }
}

async function testGatewayMemoryCandidateRpc(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dragon-gateway-candidates-"));
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
    await runtime.runTurn({ sessionId: "s1", source: "cli", message: "remember that dashboard promotion is explicit" });
    await delay(5);
    await runtime.runTurn({ sessionId: "s1", source: "cli", workspace: root, message: "remember that dashboard rejection is auditable" });

    const store = createFileMemoryStore({ rootDir: root });
    const tools = createMemoryCandidateTools({ rootDir: root, store });
    const readOnlyGateway = createHttpGateway({
      runtime: createNoopRuntime(),
      tools,
      permissionEngine: createToolPermissionEngine({
        defaultDecision: "ask",
        rules: [
          { toolName: "memory_candidates_list", decision: "allow", reason: "test list allow" },
        ],
      }),
    });
    await readOnlyGateway.start({ host: "127.0.0.1", port: 0 });
    const readOnlyAddress = readOnlyGateway.address();
    assert(readOnlyAddress !== undefined, "Read-only gateway did not start");
    try {
      const connect = await rpc(readOnlyAddress.url, "connect", undefined, "");
      assert(connect.status === 200 && connect.json.ok === true, "connect should succeed");
      assert(
        readArray(connect.json.payload, "capabilities").includes("memory.candidates.list"),
        "connect should advertise memory candidate review",
      );

      const catalog = await rpc(readOnlyAddress.url, "tools.catalog", undefined, "");
      const memoryTool = readRecordArray(catalog.json.payload, "tools").find(tool => tool.name === "memory_candidates_list");
      assert(memoryTool?.directInvokeAllowed === false, "memory candidate list must not be exposed through generic direct tool RPC");

      const direct = await rpc(readOnlyAddress.url, "tool.invoke", { toolName: "memory_candidates_list" }, "");
      assert(direct.status === 400 && direct.json.ok === false, "generic direct memory tool invocation should stay blocked");

      const listed = await rpc(readOnlyAddress.url, "memory.candidates.list", { status: "pending", limit: 5 }, "");
      assert(listed.status === 200 && listed.json.ok === true, "memory.candidates.list should succeed");
      assert(readPath(listed.json, ["payload", "review", "canPromote"]) === false, "read-only gateway should not allow promote");
      assert(readPath(listed.json, ["payload", "review", "canReject"]) === false, "read-only gateway should not allow reject");
      const candidates = readRecordArrayAt(listed.json, ["payload", "output", "candidates"]);
      assert(candidates.length === 2, `Expected two pending candidates, got ${candidates.length}`);

      const denied = await rpc(readOnlyAddress.url, "memory.candidate.promote", { id: String(candidates[0]?.id) }, "");
      assert(denied.status === 400 && denied.json.ok === false, "promote should require write permission");
      assert(String(denied.json.error).includes("Tool permission ask"), "promote denial should mention permission ask");
    } finally {
      await readOnlyGateway.stop();
    }

    const writeGateway = createHttpGateway({
      runtime: createNoopRuntime(),
      tools,
      permissionEngine: createToolPermissionEngine({
        defaultDecision: "ask",
        rules: [
          { toolName: "memory_candidates_list", decision: "allow", reason: "test list allow" },
          { toolName: "memory_candidate_promote", decision: "allow", reason: "test promote allow" },
          { toolName: "memory_candidate_reject", decision: "allow", reason: "test reject allow" },
        ],
      }),
    });
    await writeGateway.start({ host: "127.0.0.1", port: 0 });
    const writeAddress = writeGateway.address();
    assert(writeAddress !== undefined, "Write gateway did not start");
    try {
      const listed = await rpc(writeAddress.url, "memory.candidates.list", { status: "pending", limit: 5 }, "");
      assert(readPath(listed.json, ["payload", "review", "canPromote"]) === true, "write gateway should allow promote");
      assert(readPath(listed.json, ["payload", "review", "canReject"]) === true, "write gateway should allow reject");
      const candidates = readRecordArrayAt(listed.json, ["payload", "output", "candidates"]);
      assert(candidates.length === 2, `Expected two pending candidates, got ${candidates.length}`);
      const promoteCandidate = candidates.find(candidate => String(candidate.content ?? "").includes("promotion"));
      const rejectCandidate = candidates.find(candidate => String(candidate.content ?? "").includes("rejection"));
      const promoteId = String(promoteCandidate?.id ?? "");
      const rejectId = String(rejectCandidate?.id ?? "");
      assert(promoteId && rejectId, "expected promotion and rejection candidate ids");

      const promoted = await rpc(writeAddress.url, "memory.candidate.promote", { id: promoteId, source: "test-dashboard" }, "");
      assert(promoted.status === 200 && promoted.json.ok === true, "memory.candidate.promote should succeed");
      assert(readPath(promoted.json, ["payload", "output", "candidate", "status"]) === "promoted", "candidate should be promoted");
      assert((await store.search("auditable", 5)).length === 0, "unreviewed candidate should not enter memory before rejection");

      const rejected = await rpc(writeAddress.url, "memory.candidate.reject", { id: rejectId, reason: "test rejection" }, "");
      assert(rejected.status === 200 && rejected.json.ok === true, "memory.candidate.reject should succeed");
      assert(readPath(rejected.json, ["payload", "output", "candidate", "status"]) === "rejected", "candidate should be rejected");

      const remaining = await rpc(writeAddress.url, "memory.candidates.list", { status: "pending" }, "");
      assert(readRecordArrayAt(remaining.json, ["payload", "output", "candidates"]).length === 0, "no pending candidates should remain");
    } finally {
      await writeGateway.stop();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
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
    assert(html.includes('data-tab="memory"'), "dashboard should include the Memory tab");
    assert(html.includes('data-tab="providers"'), "dashboard should include the Providers tab");
    assert(html.includes('data-tab="cron"'), "dashboard should include the Cron tab");
    assert(html.includes("providers.list"), "dashboard should call providers.list RPC");
    assert(html.includes('id="model"'), "dashboard should expose a model input");
    assert(html.includes("modelSuggestions"), "dashboard should expose model suggestions");
    assert(html.includes("memory.candidates.list"), "dashboard should call memory candidate list RPC");
    assert(html.includes("memory.candidate.promote"), "dashboard should call memory candidate promote RPC");
    assert(html.includes("memory.candidate.reject"), "dashboard should call memory candidate reject RPC");
    assert(html.includes("cron.jobs.list"), "dashboard should call cron jobs list RPC");
    assert(html.includes("cron.job.upsert"), "dashboard should call cron job upsert RPC");
    assert(html.includes("cron.tick"), "dashboard should call cron tick RPC");
    assert(html.includes("Requires write permission"), "dashboard should label disabled memory review actions");
    assert(!html.includes("localStorage"), "dashboard must not persist secrets to localStorage");
    assert(!html.includes("sessionStorage"), "dashboard must not persist secrets to sessionStorage");
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

async function testTrajectoryPersistenceAndGatewayRpc(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dragon-trajectories-"));
  const trajectoryStore = createFileTrajectoryStore({ rootDir: root });
  const provider = {
    id: "mock",
    displayName: "Mock",
    defaultModel: "mock-model",
    supportsToolCalling: false,
    async complete() {
      return { id: "mock-response", text: "trajectory-ok" };
    },
  };

  try {
    const runtime = createDragonRuntime({
      providers: [provider],
      defaultModel: "mock-model",
      trajectoryStore,
    });
    const result = await runtime.runTurn({
      sessionId: "trajectory-session",
      source: "cli",
      workspace: root,
      message: "record this trajectory",
    });
    assert(result.status === "ok", "trajectory runtime turn should succeed");

    const listed = await trajectoryStore.list({ sessionId: "trajectory-session", limit: 5 });
    assert(listed.trajectories.length === 1, `Expected one trajectory, got ${listed.trajectories.length}`);
    assert(listed.trajectories[0]?.runId === result.runId, "trajectory summary should include the run id");
    assert(listed.trajectories[0]?.userPreview.includes("record this trajectory"), "trajectory summary should include user preview");
    assert(listed.trajectories[0]?.assistantPreview === "trajectory-ok", "trajectory summary should include assistant preview");

    const record = await trajectoryStore.get(result.runId, { sessionId: "trajectory-session" });
    assert(record !== undefined, "trajectory record should be retrievable");
    assert(record.events.some(event => event.type === "lifecycle" && event.phase === "start"), "trajectory should capture lifecycle start");
    assert(record.events.some(event => event.type === "assistant_delta"), "trajectory should capture assistant delta");
    assert(record.events.some(event => event.type === "lifecycle" && event.phase === "end"), "trajectory should capture lifecycle end");

    const gateway = createHttpGateway({ runtime: createNoopRuntime(), trajectoryStore });
    await gateway.start({ host: "127.0.0.1", port: 0 });
    const address = gateway.address();
    assert(address !== undefined, "Trajectory gateway did not start");
    try {
      const capabilities = await rpc(address.url, "connect");
      assert(readArray(capabilities.json.payload, "capabilities").includes("trajectory.list"), "gateway should advertise trajectory.list");
      assert(readArray(capabilities.json.payload, "capabilities").includes("trajectory.get"), "gateway should advertise trajectory.get");

      const gatewayList = await rpc(address.url, "trajectory.list", { sessionId: "trajectory-session", limit: 5 });
      assert(gatewayList.status === 200 && gatewayList.json.ok === true, "trajectory.list should succeed");
      assert(readPath(gatewayList.json, ["payload", "trajectories", 0, "runId"]) === result.runId, "gateway trajectory list should return the run");

      const gatewayGet = await rpc(address.url, "trajectory.get", {
        sessionId: "trajectory-session",
        runId: result.runId,
        maxEvents: 1,
      });
      assert(gatewayGet.status === 200 && gatewayGet.json.ok === true, "trajectory.get should succeed");
      assert(readPath(gatewayGet.json, ["payload", "record", "runId"]) === result.runId, "gateway trajectory get should return the run");
      assert(readPath(gatewayGet.json, ["payload", "eventsTruncated"]) === true, "gateway trajectory get should report truncated events");
    } finally {
      await gateway.stop();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testSandboxExecTool(): Promise<void> {
  const dockerPlan = planSandboxExecCommand({
    backend: "docker",
    command: "git status",
    docker: { container: "dragon-dev", workspace: "/workspace" },
  });
  assert(dockerPlan.executable === "docker", "docker sandbox should use docker executable");
  assert(JSON.stringify(dockerPlan.args) === JSON.stringify(["exec", "-i", "-w", "/workspace", "dragon-dev", "git", "status"]), "docker sandbox plan should be stable");
  assert(dockerPlan.innerExecutable === "git", "docker sandbox should retain inner executable");

  const sshPlan = planSandboxExecCommand({
    backend: "ssh",
    command: "rg hello src",
    ssh: { host: "example.test", user: "dragon", port: 2222, workspace: "/srv/dragon" },
  });
  assert(sshPlan.executable === "ssh", "ssh sandbox should use ssh executable");
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
    input: { backend: "local", command: "node --version" },
    sessionId: "sandbox-session",
    workspace: WORKSPACE_ROOT,
  });
  assert(local.ok, `local sandbox_exec failed: ${local.error}`);
  assert(local.output?.backend === "local", "local sandbox output should report backend");
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
  const server = createServer((_request, response) => {
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
      "</body>",
      "</html>",
    ].join(""));
  });
  const port = await listenOnLoopback(server);
  try {
    const tool = createBrowserSnapshotTool();
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

async function testRuntimeToolCallLoop(): Promise<void> {
  const requests: ModelRequest[] = [];
  const toolInputs: unknown[] = [];
  const provider: ModelProvider = {
    id: "mock-tools",
    displayName: "Mock Tools",
    defaultModel: "mock-tool-model",
    supportsToolCalling: true,
    async complete(request) {
      requests.push(request);
      if (requests.length === 1) {
        return {
          id: "first",
          toolCalls: [{
            id: "call_1",
            type: "function",
            function: { name: "echo_tool", arguments: JSON.stringify({ text: "hello" }) },
          }],
        };
      }
      request.onTextDelta?.("do");
      request.onTextDelta?.("ne");
      return {
        id: "second",
        text: "done",
      };
    },
  };
  const echoTool = createMockTool("echo_tool", ["read"], async invocation => {
    toolInputs.push(invocation.input);
    return {
      input: invocation.input,
      sessionId: invocation.sessionId,
      workspace: invocation.workspace,
    };
  });
  const runtime = createDragonRuntime({
    providers: [provider],
    defaultModel: "mock-tool-model",
    tools: [echoTool],
    permissionEngine: createToolPermissionEngine({
      defaultDecision: "ask",
      rules: [{ toolName: "echo_tool", decision: "allow", reason: "test allow" }],
    }),
  });
  const events: DragonEvent[] = [];
  const unsubscribe = runtime.subscribe(event => events.push(event));
  try {
    const result = await runtime.runTurn({
      sessionId: "tool-loop",
      source: "cli",
      workspace: "D:/workspace",
      message: "use the tool",
    });
    assert(result.status === "ok", `runtime tool loop failed: ${result.error}`);
    assert(result.messages[1]?.content === "done", "final assistant message should come from second model call");
    assert(toolInputs.length === 1, "tool should be invoked once");
    assert(readPath(toolInputs[0], ["text"]) === "hello", "tool arguments should be parsed from model tool call");
    assert(requests.length === 2, "runtime should call the model twice");
    assert(Array.isArray(requests[0]?.tools) && requests[0]?.tools?.length === 1, "first request should include tool definitions");
    assert(requests[1]?.messages.some(message => message.role === "tool" && message.toolCallId === "call_1"), "second request should include tool result");
    assert(events.some(event => event.type === "tool" && event.toolName === "echo_tool" && event.phase === "start"), "tool start event should be emitted");
    assert(events.some(event => event.type === "tool" && event.toolName === "echo_tool" && event.phase === "end"), "tool end event should be emitted");
    const assistantDeltas = events.filter(event => event.type === "assistant_delta").map(event => event.text);
    assert(assistantDeltas.join("") === "done", "runtime should forward provider text deltas");
    assert(!assistantDeltas.includes("done"), "runtime should not duplicate full assistant text after streaming");
  } finally {
    unsubscribe();
  }
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

function createMockTool(
  name: string,
  capabilities: NonNullable<ToolDefinition["capabilities"]>,
  output: (invocation: Parameters<ToolDefinition["invoke"]>[0]) => Promise<unknown>,
): ToolDefinition {
  return {
    name,
    description: name,
    inputSchema: { type: "object", additionalProperties: true },
    capabilities,
    permission: "allow",
    async invoke(invocation) {
      return {
        id: invocation.id,
        ok: true,
        output: await output(invocation),
      };
    },
  };
}

function createNoopRuntime(): DragonAgentRuntime {
  return {
    async runTurn(): Promise<DragonTurnResult> {
      throw new Error("Runtime should not be called in this test.");
    },
    subscribe() {
      return () => undefined;
    },
  };
}

function createEventRuntime(): DragonAgentRuntime {
  const listeners = new Set<(event: DragonEvent) => void>();
  return {
    async runTurn(input: DragonTurnInput): Promise<DragonTurnResult> {
      const runId = "ws-run-1";
      for (const listener of listeners) {
        listener({
          type: "lifecycle",
          runId,
          phase: "start",
          metadata: { sessionId: input.sessionId },
        });
      }
      await delay(10);
      return {
        runId,
        status: "ok",
        messages: [
          { id: "user-1", role: "user", content: input.message, createdAt: new Date().toISOString() },
          { id: "assistant-1", role: "assistant", content: "ws-ok", createdAt: new Date().toISOString() },
        ],
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

async function rpc(baseUrl: string, type: string, params?: unknown, secret = "secret"): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ type, id: `${type}-${Date.now()}`, params }),
  });
  return {
    status: response.status,
    json: await response.json() as Record<string, unknown>,
  };
}

async function postJson(url: string, body: unknown, secret = "secret"): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    json: await response.json() as Record<string, unknown>,
  };
}

class RawWebSocketClient {
  readonly #socket: net.Socket;
  #buffer: AnyBuffer = Buffer.alloc(0);
  #messages: Array<Record<string, unknown>> = [];
  #waiters: Array<{
    predicate: (message: Record<string, unknown>) => boolean;
    resolve: (message: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    label: string;
    timer: NodeJS.Timeout;
  }> = [];

  private constructor(socket: net.Socket, initialBuffer: AnyBuffer) {
    this.#socket = socket;
    this.#buffer = initialBuffer;
    this.#socket.on("data", chunk => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#drainFrames();
    });
    this.#socket.on("error", error => {
      this.#rejectAll(error);
    });
    this.#socket.on("close", () => {
      this.#rejectAll(new Error("WebSocket closed."));
    });
    this.#drainFrames();
  }

  static async connect(port: number, pathname: string, headers: Record<string, string>): Promise<RawWebSocketClient> {
    const response = await rawWebSocketUpgrade(port, pathname, headers, true);
    assert(response.statusLine.startsWith("HTTP/1.1 101"), `Expected 101 upgrade, got ${response.statusLine}`);
    return new RawWebSocketClient(response.socket, response.remaining);
  }

  sendJson(value: unknown): void {
    this.#socket.write(createClientTextFrame(JSON.stringify(value)));
  }

  async waitForJson(
    predicate: (message: Record<string, unknown>) => boolean,
    label: string,
  ): Promise<Record<string, unknown>> {
    const existing = this.#messages.find(predicate);
    if (existing) {
      return existing;
    }
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter(waiter => waiter.timer !== timer);
        reject(new Error(`Timed out waiting for ${label}`));
      }, TEST_TIMEOUT_MS);
      this.#waiters.push({ predicate, resolve, reject, label, timer });
    });
  }

  close(): void {
    this.#socket.end(createClientCloseFrame());
  }

  #drainFrames(): void {
    while (this.#buffer.length >= 2) {
      const parsed = parseServerFrame(this.#buffer);
      if (!parsed) {
        return;
      }
      this.#buffer = parsed.remaining;
      if (parsed.opcode === 0x1) {
        const message = JSON.parse(parsed.payload.toString("utf8")) as Record<string, unknown>;
        this.#messages.push(message);
        const waiter = this.#waiters.find(item => item.predicate(message));
        if (waiter) {
          clearTimeout(waiter.timer);
          this.#waiters = this.#waiters.filter(item => item !== waiter);
          waiter.resolve(message);
        }
      } else if (parsed.opcode === 0x9) {
        this.#socket.write(createClientPongFrame(parsed.payload));
      } else if (parsed.opcode === 0x8) {
        this.close();
      }
    }
  }

  #rejectAll(error: Error): void {
    for (const waiter of this.#waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.#waiters = [];
  }
}

async function rawWebSocketUpgrade(
  port: number,
  pathname: string,
  headers: Record<string, string>,
  keepOpen?: false,
): Promise<string>;
async function rawWebSocketUpgrade(
  port: number,
  pathname: string,
  headers: Record<string, string>,
  keepOpen: true,
): Promise<{ statusLine: string; socket: net.Socket; remaining: AnyBuffer }>;
async function rawWebSocketUpgrade(
  port: number,
  pathname: string,
  headers: Record<string, string>,
  keepOpen = false,
): Promise<string | { statusLine: string; socket: net.Socket; remaining: AnyBuffer }> {
  return await new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let buffer: AnyBuffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Raw WebSocket upgrade timed out."));
    }, TEST_TIMEOUT_MS);

    socket.on("connect", () => {
      const key = randomBytes(16).toString("base64");
      socket.write([
        `GET ${pathname} HTTP/1.1`,
        "Host: 127.0.0.1",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        "",
        "",
      ].join("\r\n"));
    });
    socket.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }
      clearTimeout(timer);
      const rawHeader = buffer.subarray(0, headerEnd).toString("utf8");
      const remaining = buffer.subarray(headerEnd + 4);
      if (keepOpen) {
        socket.removeAllListeners("data");
        socket.removeAllListeners("close");
        socket.removeAllListeners("error");
        resolve({ statusLine: rawHeader.split("\r\n")[0] ?? "", socket, remaining });
        return;
      }
      socket.destroy();
      resolve(rawHeader);
    });
    socket.on("close", () => {
      if (!keepOpen && buffer.length > 0) {
        clearTimeout(timer);
        resolve(buffer.toString("utf8"));
      }
    });
    socket.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function createClientTextFrame(text: string): AnyBuffer {
  return createClientFrame(0x1, Buffer.from(text, "utf8"));
}

function createClientPongFrame(payload: AnyBuffer): AnyBuffer {
  return createClientFrame(0xA, payload);
}

function createClientCloseFrame(): AnyBuffer {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(1000, 0);
  return createClientFrame(0x8, payload);
}

function createClientFrame(opcode: number, payload: AnyBuffer): AnyBuffer {
  const mask = randomBytes(4);
  let header: AnyBuffer;
  if (payload.byteLength < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payload.byteLength]);
  } else if (payload.byteLength <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.byteLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.byteLength), 2);
  }
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] = masked[index]! ^ mask[index % 4]!;
  }
  return Buffer.concat([header, mask, masked]);
}

function parseServerFrame(buffer: AnyBuffer): { opcode: number; payload: AnyBuffer; remaining: AnyBuffer } | undefined {
  if (buffer.length < 2) {
    return undefined;
  }
  const first = buffer[0]!;
  const second = buffer[1]!;
  const opcode = first & 0x0f;
  let payloadLength = second & 0x7f;
  let headerLength = 2;
  if (payloadLength === 126) {
    if (buffer.length < 4) {
      return undefined;
    }
    payloadLength = buffer.readUInt16BE(2);
    headerLength = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) {
      return undefined;
    }
    payloadLength = Number(buffer.readBigUInt64BE(2));
    headerLength = 10;
  }
  const frameLength = headerLength + payloadLength;
  if (buffer.length < frameLength) {
    return undefined;
  }
  return {
    opcode,
    payload: buffer.subarray(headerLength, frameLength),
    remaining: buffer.subarray(frameLength),
  };
}

async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert(address !== null && typeof address !== "string", "test HTTP server did not bind to a TCP port");
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function readHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function runCli(args: string[], envOverrides: Record<string, string> = {}): Promise<{ stdout: string; stderr: string }> {
  const cliPath = path.join(WORKSPACE_ROOT, "packages", "cli", "dist", "index.js");
  return await execFile(process.execPath, [cliPath, ...args], {
    cwd: WORKSPACE_ROOT,
    timeout: TEST_TIMEOUT_MS,
    windowsHide: true,
    env: {
      ...process.env,
      DRAGON_OPENAI_API_KEY: "",
      OPENAI_API_KEY: "",
      DRAGON_ANTHROPIC_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      DRAGON_OPENROUTER_API_KEY: "",
      OPENROUTER_API_KEY: "",
      DRAGON_MODEL: "",
      DRAGON_PLUGIN_ROOTS: "",
      DRAGON_SKILL_ROOTS: "",
      ...envOverrides,
    },
  });
}

function mustFindTool<TInput, TOutput>(
  tools: ToolDefinition[],
  name: string,
): ToolDefinition<TInput, TOutput> {
  const tool = tools.find(item => item.name === name);
  assert(tool !== undefined, `Missing tool: ${name}`);
  return tool as ToolDefinition<TInput, TOutput>;
}

function readArray(value: unknown, key: string): Array<Record<string, unknown> | string> {
  const item = isRecord(value) ? value[key] : undefined;
  return Array.isArray(item) ? item : [];
}

function readRecordArray(value: unknown, key: string): Array<Record<string, unknown>> {
  return readArray(value, key).filter(isRecord);
}

function readRecordArrayAt(value: unknown, pathItems: Array<string | number>): Array<Record<string, unknown>> {
  const item = readPath(value, pathItems);
  return Array.isArray(item) ? item.filter(isRecord) : [];
}

function toSse(items: Array<Record<string, unknown> | string>, eventName?: string): string {
  return items.map(item => {
    const lines = [];
    if (eventName !== undefined) {
      lines.push(`event: ${eventName}`);
    }
    lines.push(`data: ${typeof item === "string" ? item : JSON.stringify(item)}`);
    return `${lines.join("\n")}\n\n`;
  }).join("");
}

function readPath(value: unknown, pathItems: Array<string | number>): unknown {
  let current = value;
  for (const item of pathItems) {
    if (typeof item === "number") {
      current = Array.isArray(current) ? current[item] : undefined;
    } else {
      current = isRecord(current) ? current[item] : undefined;
    }
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
