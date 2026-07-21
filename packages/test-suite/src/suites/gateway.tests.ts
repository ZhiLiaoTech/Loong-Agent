import { randomBytes } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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
} from "@loong/channels";
import type { LoongAgentRuntime, LoongEvent, LoongTurnInput, LoongTurnResult } from "@loong/core";
import {
  appendCancelledToolResults,
  appendWorkspaceToolGuidance,
  applyTurnPrep,
  augmentResponseWithTextToolCalls,
  buildTurnPrepOptions,
  classifyTierHeuristic,
  canRunToolCallsInParallel,
  createLoongRuntime,
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
} from "@loong/core";
import type { ModelMessage } from "@loong/providers";
import { createCronRunner, createFileCronJobStore, createGatewayWebhookCronTarget, nextCronRun, parseCronSchedule, toGatewayWebhookCronPayload } from "@loong/cron";
import {
  createDelegationPlan,
  createRuntimeDelegatedTaskExecutor,
  createRuntimeDelegationTool,
  runDelegationPlan,
  type LoongRuntimeDelegationToolInput,
} from "@loong/delegation";
import {
  applyModelCatalogToAgentParams,
  assertLoongGatewayWebhookPayload,
  createHttpGateway,
  createModelCatalogFromProviderSummaries,
  FilePairingStore,
  GATEWAY_DEFAULT_TENANT_ID,
  parseGatewayAgentParams,
  toTurnInput,
} from "@loong/gateway";
import {
  createFileMemoryStore,
  createFileTrajectoryStore,
  createMemoryCandidateLifecycleHook,
  createMemoryCandidateTools,
  createOntologyCandidateTools,
  createSqliteOntologyStore,
  ONTOLOGY_SELF_ENTITY_NAME,
  type MemoryCandidateListInput,
  type MemoryCandidateListOutput,
  type MemoryCandidatePromoteInput,
  type MemoryCandidatePromoteOutput,
  type MemoryCandidateRejectInput,
  type MemoryCandidateRejectOutput,
} from "@loong/memory";
import {
  applyModelCatalogToParams,
  catalogEntriesFromProviders,
  createModelCatalog,
} from "@loong/model-catalog";
import { createAnthropicProvider, createOpenAICompatibleProvider, ProviderError, type ModelProvider, type ModelRequest } from "@loong/providers";
import { isSensitiveKey, redactSecretsInText } from "@loong/security";
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
} from "@loong/tools";

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
  let savedModelConfig: unknown;
  let savedAgentConfig: unknown;
  const gateway = createHttpGateway({
    runtime: createNoopRuntime(),
    providerSummaries: [{
      id: "openai",
      displayName: "OpenAI Compatible",
      defaultModel: "gpt-test",
      supportsToolCalling: true,
      models: [{
        id: "gpt-test",
        aliases: ["test-model"],
        capabilities: { toolCalling: true },
        default: true,
      }],
    }],
    modelConfigStore: {
      async load() {
        return {
          appliesOn: "next-turn",
          configPath: "/tmp/loong/providers.json",
          providers: [{
            id: "openai",
            type: "openai-compatible",
            displayName: "OpenAI",
            apiKey: "raw-secret",
            apiKeyConfigured: true,
            defaultModel: "gpt-test",
            supportsToolCalling: true,
            enabled: true,
          }],
        };
      },
      async save(config) {
        savedModelConfig = config;
        return {
          appliesOn: "next-turn",
          configPath: "/tmp/loong/providers.json",
          providers: config.providers,
        };
      },
    },
    agentConfigStore: {
      async load() {
        return {
          configPath: "/tmp/loong/agents.json",
          defaultProfileId: "default",
          profiles: [{
            id: "default",
            name: "Default Agent",
            defaultModel: "openai:gpt-test",
            thinking: "low",
            memoryEnabled: true,
            toolsEnabled: true,
          }],
        };
      },
      async save(config) {
        savedAgentConfig = config;
        return {
          configPath: "/tmp/loong/agents.json",
          profiles: config.profiles,
          ...(config.defaultProfileId !== undefined ? { defaultProfileId: config.defaultProfileId } : {}),
        };
      },
    },
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
    assert(readPath(providers.json, ["payload", "providers", 0, "models", 0, "id"]) === "gpt-test", "provider model catalog should be returned");
    assert(readPath(providers.json, ["payload", "providers", 0, "models", 0, "default"]) === true, "provider default model flag should be returned");

    const modelConfig = await rpc(address.url, "model.config.get");
    assert(modelConfig.status === 200 && modelConfig.json.ok === true, "model.config.get should succeed");
    assert(readPath(modelConfig.json, ["payload", "providers", 0, "id"]) === "openai", "model config provider id should be returned");
    assert(readPath(modelConfig.json, ["payload", "providers", 0, "apiKeyConfigured"]) === true, "model config should expose secret presence");
    assert(!JSON.stringify(modelConfig.json).includes("raw-secret"), "model config must not return raw API keys");

    const saved = await rpc(address.url, "model.config.save", {
      providers: [{
        id: "custom",
        type: "openai-compatible",
        apiKey: "new-secret",
        baseUrl: "http://127.0.0.1:9999/v1",
        defaultModel: "custom-model",
        supportsToolCalling: false,
        enabled: true,
      }],
    });
    assert(saved.status === 200 && saved.json.ok === true, "model.config.save should succeed");
    assert(readPath(saved.json, ["payload", "appliesOn"]) === "next-turn", "saved model config should advertise next-turn hot apply");
    assert(readPath(saved.json, ["payload", "providers", 0, "apiKeyConfigured"]) === true, "saved model config should expose secret presence");
    assert(!JSON.stringify(saved.json).includes("new-secret"), "saved model config must not return raw API keys");
    assert(readPath(savedModelConfig, ["providers", 0, "apiKey"]) === "new-secret", "model config store should receive submitted API key");

    const agentConfig = await rpc(address.url, "agent.config.get");
    assert(agentConfig.status === 200 && agentConfig.json.ok === true, "agent.config.get should succeed");
    assert(readPath(agentConfig.json, ["payload", "profiles", 0, "id"]) === "default", "agent config profile id should be returned");
    assert(readPath(agentConfig.json, ["payload", "profiles", 0, "thinking"]) === "low", "agent config profile thinking should be returned");

    const savedAgent = await rpc(address.url, "agent.config.save", {
      defaultProfileId: "ops",
      profiles: [{
        id: "ops",
        name: "Ops Agent",
        defaultModel: "openai:gpt-test",
        workspace: "/tmp/project",
        thinking: "medium",
        memoryEnabled: true,
        toolsEnabled: true,
      }],
    });
    assert(savedAgent.status === 200 && savedAgent.json.ok === true, "agent.config.save should succeed");
    assert(readPath(savedAgent.json, ["payload", "defaultProfileId"]) === "ops", "agent config default profile should round-trip");
    assert(readPath(savedAgentConfig, ["profiles", 0, "id"]) === "ops", "agent config store should receive submitted profile");

    const health = await rpc(address.url, "health");
    assert(readPath(health.json, ["payload", "providerCount"]) === 1, "health should include provider count");
    const connect = await rpc(address.url, "connect");
    assert(readArray(connect.json.payload, "capabilities").includes("providers.list"), "connect should advertise providers.list");
    assert(readArray(connect.json.payload, "capabilities").includes("model.config.get"), "connect should advertise model.config.get");
    assert(readArray(connect.json.payload, "capabilities").includes("model.config.save"), "connect should advertise model.config.save");
    assert(readArray(connect.json.payload, "capabilities").includes("agent.config.get"), "connect should advertise agent.config.get");
    assert(readArray(connect.json.payload, "capabilities").includes("agent.config.save"), "connect should advertise agent.config.save");

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


async function testGatewayPairingRpc(): Promise<void> {
  const pairingDir = await mkdtemp(path.join(os.tmpdir(), "loong-pairing-"));
  const pairingStore = new FilePairingStore({ filePath: path.join(pairingDir, "devices.json") });
  const gateway = createHttpGateway({
    runtime: createNoopRuntime(),
    pairingStore,
  });
  await gateway.start({ host: "127.0.0.1", port: 0, authMode: "shared-secret", sharedSecret: "secret" });
  const address = gateway.address();
  assert(address !== undefined, "Gateway did not start");

  try {
    const created = await rpc(address.url, "pairing.token.create", { label: "ci-node" });
    assert(created.status === 200 && created.json.ok === true, "pairing.token.create should succeed");
    const token = readPath(created.json, ["payload", "token"]);
    assert(typeof token === "string" && token.length > 0, "pairing token should be returned");

    const empty = await rpc(address.url, "pairing.devices.list");
    assert(empty.status === 200 && readRecordArray(empty.json.payload, "devices").length === 0, "devices should start empty");

    const registered = await rpc(address.url, "pairing.device.register", { token });
    assert(registered.status === 200 && registered.json.ok === true, "pairing.device.register should succeed");
    const deviceId = readPath(registered.json, ["payload", "device", "id"]);
    assert(typeof deviceId === "string", "registered device id should be returned");

    const listed = await rpc(address.url, "pairing.devices.list");
    assert(listed.status === 200, "pairing.devices.list should succeed");
    const devices = readRecordArray(listed.json.payload, "devices");
    assert(devices.some(device => device.id === deviceId), "registered device should appear in list");

    const reused = await rpc(address.url, "pairing.device.register", { token });
    assert(reused.status === 400 || reused.json.ok === false, "pairing token must be single-use");

    const revoked = await rpc(address.url, "pairing.device.revoke", { deviceId });
    assert(revoked.status === 200 && readPath(revoked.json, ["payload", "revoked"]) === true, "revoke should succeed");

    const afterRevoke = await rpc(address.url, "pairing.devices.list");
    assert(readRecordArray(afterRevoke.json.payload, "devices").length === 0, "revoked device should not be listed");
  } finally {
    await gateway.stop();
    await rm(pairingDir, { recursive: true, force: true });
  }
}


async function testGatewayMcpCatalogAndAgent(): Promise<void> {
  const mcpMethods: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; id?: number };
    if (body.method) {
      mcpMethods.push(body.method);
    }
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
  const registered = await registerMcpTools(registry, {
    servers: [{ id: "demo", url: "http://127.0.0.1:9999/mcp" }],
    fetchImpl,
  });
  assert(registered.errors.length === 0, `MCP registration failed: ${registered.errors.join("; ")}`);

  let modelCalls = 0;
  const provider: ModelProvider = {
    id: "mcp-agent-mock",
    displayName: "MCP Agent Mock",
    defaultModel: "mcp-agent-model",
    supportsToolCalling: true,
    async complete() {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          id: "first",
          toolCalls: [{
            id: "call_mcp",
            type: "function",
            function: { name: "mcp_demo_ping", arguments: "{}" },
          }],
        };
      }
      return { id: "second", text: "mcp-agent-done" };
    },
  };
  const runtime = createLoongRuntime({
    providers: [provider],
    defaultModel: "mcp-agent-model",
    toolRegistry: registry,
    permissionEngine: createToolPermissionEngine({
      defaultDecision: "ask",
      rules: [{ toolName: "mcp_demo_ping", decision: "allow", reason: "test allow mcp" }],
    }),
  });
  const gateway = createHttpGateway({ runtime, toolRegistry: registry });
  await gateway.start({ host: "127.0.0.1", port: 0 });
  const address = gateway.address();
  assert(address !== undefined, "Gateway did not start");

  try {
    const catalog = await rpc(address.url, "tools.catalog");
    assert(catalog.status === 200 && catalog.json.ok === true, "tools.catalog should succeed");
    const mcpTool = readRecordArray(catalog.json.payload, "tools").find(tool => tool.name === "mcp_demo_ping");
    assert(mcpTool !== undefined, "MCP tool should appear in catalog");
    assert(mcpTool.source === "mcp", "MCP tool should be tagged with source mcp");
    assert(mcpTool.directInvokeAllowed === false, "MCP tools should not be direct-invokable by default");

    const agent = await rpc(address.url, "agent", {
      sessionId: "mcp-agent-session",
      message: "call the ping tool",
      toolsEnabled: true,
    });
    assert(agent.status === 200 && agent.json.ok === true, "agent RPC should succeed");
    assert(modelCalls === 2, "agent should run model twice for tool + answer");
    assert(mcpMethods.includes("tools/call"), "MCP tools/call should run during agent turn");
    assert(
      readPath(agent.json, ["payload", "result", "messages", 1, "content"]) === "mcp-agent-done",
      "final assistant message should come after MCP tool execution",
    );
    const toolEvents = readRecordArrayAt(agent.json, ["payload", "events"]).filter(
      event => event.type === "tool" && event.toolName === "mcp_demo_ping",
    );
    assert(toolEvents.length >= 1, "agent should emit MCP tool events");
  } finally {
    await gateway.stop();
  }
}


async function testGatewayProductionConfigGuards(): Promise<void> {
  const blocked = createHttpGateway({ runtime: createNoopRuntime() });
  let rejected = false;
  try {
    await blocked.start({ host: "0.0.0.0", port: 0, requireExplicitSecret: true });
  } catch (error) {
    rejected = true;
    assert(
      error instanceof Error && error.message.includes("requireExplicitSecret"),
      "non-loopback start without secret should fail",
    );
  }
  assert(rejected, "gateway.start should throw when requireExplicitSecret is violated");
  if (blocked.address()) {
    await blocked.stop();
  }

  const customTool = createMockTool("custom_git_status", ["read"], async () => ({ ok: true }));
  const gateway = createHttpGateway({
    runtime: createNoopRuntime(),
    tools: [customTool],
    permissionEngine: createToolPermissionEngine({
      defaultDecision: "ask",
      rules: [{ toolName: "custom_git_status", decision: "allow", reason: "test allow" }],
    }),
  });
  await gateway.start({
    host: "127.0.0.1",
    port: 0,
    authMode: "shared-secret",
    sharedSecret: "secret",
    toolInvokeAllowlist: ["custom_git_status"],
  });
  const address = gateway.address();
  assert(address !== undefined, "Gateway did not start");
  try {
    const catalog = await rpc(address.url, "tools.catalog");
    const toolsByName = new Map(
      readRecordArray(catalog.json.payload, "tools").map(tool => [String(tool.name), tool]),
    );
    assert(toolsByName.get("custom_git_status")?.directInvokeAllowed === true, "allowlisted tool should be direct invokable");
    assert(toolsByName.get("git_status")?.directInvokeAllowed !== true, "default git tools should be off allowlist");

    const invoked = await rpc(address.url, "tool.invoke", { toolName: "custom_git_status", input: {} });
    assert(invoked.status === 200 && invoked.json.ok === true, "allowlisted direct invoke should succeed");

    const denied = await rpc(address.url, "tool.invoke", { toolName: "git_status", input: {} });
    assert(denied.status === 400 || denied.json.ok === false, "non-allowlisted direct invoke should fail");
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
      "Sec-WebSocket-Protocol": "loong.gateway.v1",
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
  let capturedInput: LoongTurnInput | undefined;
  const listeners = new Set<(event: LoongEvent) => void>();
  const runtime: LoongAgentRuntime = {
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


async function testChannelsServeBridge(): Promise<void> {
  let capturedBody: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      ok: true,
      payload: { channel: "telegram", result: { status: "ok" } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const handler = createGatewayBridgeHandler({
    gatewayUrl: "http://127.0.0.1:17357",
    sharedSecret: "secret",
    fetchImpl,
  });
  const server = createServer((request, response) => {
    handler(request, response).catch(error => {
      response.statusCode = 500;
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert(address && typeof address === "object", "channels bridge should listen");
  const port = address.port;
  try {
    const telegram = await postJson(`http://127.0.0.1:${port}/telegram`, {
      update_id: 1,
      message: { message_id: 2, date: 1, chat: { id: 99 }, text: "hello bridge" },
    }, "");
    assert(telegram.status === 200 && telegram.json.ok === true, "telegram bridge should return ok");
    assert(capturedBody?.channel === "telegram", "bridge should forward channel to gateway webhook");
    assert(capturedBody?.message === "hello bridge", "bridge should forward message text");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
}


async function testChannelAdapters(): Promise<void> {
  const telegram = parseTelegramWebhook({
    update_id: 123,
    message: {
      message_id: 456,
      date: 1_779_000_000,
      text: "  hello loong  ",
      chat: { id: -1001, type: "supergroup" },
      from: { id: 42, username: "alice" },
    },
  });
  assert(telegram !== undefined, "telegram adapter should parse text messages");
  assert(telegram.channel === "telegram", "telegram adapter should label channel");
  assert(telegram.text === "hello loong", "telegram adapter should trim message text");
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
    sessionPrefix: "loong",
    workspace: "/workspace",
    model: "mock:model",
    metadata: { source: "test" },
  });
  assert(telegramPayload.sessionId === "loong:telegram:-1001", "gateway payload should derive stable session ids");
  assert(telegramPayload.message === "hello loong", "gateway payload should carry channel text");
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
    command: "/loong",
    text: "",
    user_id: "U2",
    channel_id: "C2",
    trigger_id: "trigger-1",
  });
  assert(slash?.text === "/loong", "slack adapter should keep slash commands without text");

  const ignored = parseSlackWebhook({ type: "event_callback", event: { type: "reaction_added", user: "U1" } });
  assert(ignored === undefined, "slack adapter should ignore non-text events");

  const deliveries: Array<{
    url: string | undefined;
    authorization: string | undefined;
    body: Record<string, unknown>;
  }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      deliveries.push({
        url: request.url,
        authorization: readHeader(request.headers.authorization),
        body,
      });
      if (body.message === "fail") {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "gateway down" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, payload: { accepted: true } }));
    });
  });
  const port = await listenOnLoopback(server);
  try {
    const target = createGatewayWebhookChannelTarget({
      gatewayUrl: `http://127.0.0.1:${port}/`,
      sharedSecret: "secret",
      defaults: {
        sessionPrefix: "loong",
        model: "mock:model",
        metadata: { global: "yes" },
      },
    });
    const result = await target.deliver(telegram, { metadata: { source: "test" } });
    assert(result.ok && result.status === 200, "channel target should deliver successfully");
    assert(readPath(result.payload, ["payload", "accepted"]) === true, "channel target should return success payload");
    assert(deliveries[0]?.url === "/channels/webhook", "channel target should deliver to Gateway webhook channel");
    assert(deliveries[0]?.authorization === "Bearer secret", "channel target should forward shared secret auth");
    assert(deliveries[0]?.body.sessionId === "loong:telegram:-1001", "channel target should derive stable session id");
    assert(deliveries[0]?.body.channel === "telegram", "channel target should carry channel name");
    assert(deliveries[0]?.body.message === "hello loong", "channel target should carry message text");
    assert(deliveries[0]?.body.model === "mock:model", "channel target should apply default model");
    assert(readPath(deliveries[0]?.body, ["metadata", "global"]) === "yes", "channel target should apply default metadata");
    assert(readPath(deliveries[0]?.body, ["metadata", "source"]) === "test", "channel target should merge delivery metadata");
    assert(readPath(deliveries[0]?.body, ["metadata", "channelMessageId"]) === "456", "channel target should preserve channel message id");

    const failed = await target.deliver({ channel: "telegram", text: "fail", threadId: "thread-fail" });
    assert(!failed.ok && failed.status === 500, "channel target should report Gateway errors");
    assert(failed.error === "gateway down", "channel target should expose Gateway error text");
  } finally {
    await closeServer(server);
  }
}


async function testGatewayCronRpc(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-gateway-cron-"));
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
      metadata: { project: "loong" },
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
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-gateway-candidates-"));
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
    const runtime = createLoongRuntime({
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


async function testGatewayOntologyUserControlRpc(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-gateway-ontology-"));
  const store = createSqliteOntologyStore({ databasePath: path.join(root, "ontology.db") });
  const alice = { tenantId: GATEWAY_DEFAULT_TENANT_ID, userId: "alice" };

  // Seed alice's ontology directly through the store: one active explicit fact,
  // one disputed fact, one pending candidate.
  const self = await store.insertEntity(alice, { type: "Person", canonicalName: ONTOLOGY_SELF_ENTITY_NAME });
  const cursor = await store.insertEntity(alice, { type: "Tool", canonicalName: "Cursor" });
  const evidence = await store.insertEvidence(alice, { source: "p5-gateway-test", excerpt: "我用 Cursor 写代码" });
  const active = await store.insertAssertion(alice, {
    subjectId: self.id,
    predicate: "usesTool",
    objectEntityId: cursor.id,
    confidence: 0.9,
    sourceType: "explicit",
    status: "active",
    evidenceIds: [evidence.id],
  });
  const disputedEvidence = await store.insertEvidence(alice, { source: "p5-gateway-test", excerpt: "也许不喜欢开会" });
  await store.insertAssertion(alice, {
    subjectId: self.id,
    predicate: "avoids",
    objectValue: "开会",
    confidence: 0.6,
    sourceType: "observed",
    status: "disputed",
    evidenceIds: [disputedEvidence.id],
  });
  const candidateEvidence = await store.insertEvidence(alice, { source: "p5-gateway-test", excerpt: "想学会 Rust" });
  const candidate = await store.insertAssertion(alice, {
    subjectId: self.id,
    predicate: "hasGoal",
    objectValue: "学会 Rust",
    confidence: 0.8,
    sourceType: "explicit",
    status: "candidate",
    evidenceIds: [candidateEvidence.id],
  });

  const tools = createOntologyCandidateTools({ store });
  try {
    const readOnlyGateway = createHttpGateway({
      runtime: createNoopRuntime(),
      ontologyStore: store,
      tools,
      permissionEngine: createToolPermissionEngine({
        defaultDecision: "ask",
        rules: [
          { toolName: "ontology_candidates_list", decision: "allow", reason: "test list allow" },
        ],
      }),
    });
    await readOnlyGateway.start({ host: "127.0.0.1", port: 0 });
    const readOnlyAddress = readOnlyGateway.address();
    assert(readOnlyAddress !== undefined, "Read-only ontology gateway did not start");
    try {
      const connect = await rpc(readOnlyAddress.url, "connect", undefined, "");
      const capabilities = readArray(connect.json.payload, "capabilities");
      assert(capabilities.includes("ontology.knowledge.list"), "connect should advertise ontology knowledge list");
      assert(capabilities.includes("ontology.export"), "connect should advertise ontology export");
      assert(capabilities.includes("ontology.candidates.list"), "connect should advertise ontology candidate review");

      const missingUser = await rpc(readOnlyAddress.url, "ontology.knowledge.list", {}, "");
      assert(missingUser.status === 400 && missingUser.json.ok === false, "knowledge.list without userId should fail");

      const listed = await rpc(readOnlyAddress.url, "ontology.knowledge.list", { userId: "alice" }, "");
      assert(listed.status === 200 && listed.json.ok === true, "ontology.knowledge.list should succeed");
      assert(readPath(listed.json, ["payload", "activeCount"]) === 1, "alice should have one active fact");
      assert(readPath(listed.json, ["payload", "disputedCount"]) === 1, "alice should have one disputed fact");
      assert(readPath(listed.json, ["payload", "permissions", "canWrite"]) === false, "read-only gateway should report canWrite=false");

      const crossUser = await rpc(readOnlyAddress.url, "ontology.knowledge.list", { userId: "bob" }, "");
      assert(crossUser.status === 200 && readPath(crossUser.json, ["payload", "activeCount"]) === 0, "bob must not see alice's knowledge");

      const crossExplain = await rpc(readOnlyAddress.url, "ontology.assertion.explain", { userId: "bob", assertionId: active.id }, "");
      assert(crossExplain.status === 400 && crossExplain.json.ok === false, "bob must not explain alice's assertion");

      const explained = await rpc(readOnlyAddress.url, "ontology.assertion.explain", { userId: "alice", assertionId: active.id }, "");
      assert(explained.status === 200 && explained.json.ok === true, "assertion.explain should succeed for the owner");

      const conflicts = await rpc(readOnlyAddress.url, "ontology.conflicts.list", { userId: "alice" }, "");
      assert(conflicts.status === 200 && conflicts.json.ok === true, "conflicts.list should succeed");

      const deniedCorrect = await rpc(readOnlyAddress.url, "ontology.assertion.correct", {
        userId: "alice",
        assertionId: active.id,
        correction: { objectValue: "VS Code", excerpt: "我其实改用 VS Code 了" },
      }, "");
      assert(deniedCorrect.status === 400 && deniedCorrect.json.ok === false, "correct should require write permission");
      assert(String(deniedCorrect.json.error).includes("ontology_user_control_write"), "correct denial should name the write probe");

      const deniedDeleteAll = await rpc(readOnlyAddress.url, "ontology.deleteAll", { userId: "alice" }, "");
      assert(deniedDeleteAll.status === 400 && deniedDeleteAll.json.ok === false, "deleteAll should require write permission");

      const deniedSensitiveExport = await rpc(readOnlyAddress.url, "ontology.export", { userId: "alice", includeSensitiveEvidence: true }, "");
      assert(deniedSensitiveExport.status === 400 && deniedSensitiveExport.json.ok === false, "sensitive export should require write permission");

      const exportAllowed = await rpc(readOnlyAddress.url, "ontology.export", { userId: "alice" }, "");
      assert(exportAllowed.status === 200 && exportAllowed.json.ok === true, "non-sensitive export should be read-allowed");

      const candidatesListed = await rpc(readOnlyAddress.url, "ontology.candidates.list", { userId: "alice" }, "");
      assert(candidatesListed.status === 200 && candidatesListed.json.ok === true, "ontology.candidates.list should succeed");
      assert(readPath(candidatesListed.json, ["payload", "review", "canPromote"]) === false, "read-only gateway should not allow promote");
      assert(readPath(candidatesListed.json, ["payload", "review", "canReject"]) === false, "read-only gateway should not allow reject");
      const readOnlyCandidates = readRecordArrayAt(candidatesListed.json, ["payload", "output", "candidates"]);
      assert(readOnlyCandidates.length === 1, `expected one pending ontology candidate, got ${readOnlyCandidates.length}`);

      const deniedPromote = await rpc(readOnlyAddress.url, "ontology.candidate.promote", { userId: "alice", id: candidate.id }, "");
      assert(deniedPromote.status === 400 && deniedPromote.json.ok === false, "ontology promote should require write permission");
      assert(String(deniedPromote.json.error).includes("Tool permission ask"), "promote denial should mention permission ask");
    } finally {
      await readOnlyGateway.stop();
    }

    const writeGateway = createHttpGateway({
      runtime: createNoopRuntime(),
      ontologyStore: store,
      tools,
      permissionEngine: createToolPermissionEngine({
        defaultDecision: "ask",
        rules: [
          { toolName: "ontology_candidates_list", decision: "allow", reason: "test list allow" },
          { toolName: "ontology_candidate_promote", decision: "allow", reason: "test promote allow" },
          { toolName: "ontology_candidate_reject", decision: "allow", reason: "test reject allow" },
          { toolName: "ontology_user_control_write", decision: "allow", reason: "test ontology write allow" },
        ],
      }),
    });
    await writeGateway.start({ host: "127.0.0.1", port: 0 });
    const writeAddress = writeGateway.address();
    assert(writeAddress !== undefined, "Write ontology gateway did not start");
    try {
      const listed = await rpc(writeAddress.url, "ontology.knowledge.list", { userId: "alice" }, "");
      assert(readPath(listed.json, ["payload", "permissions", "canWrite"]) === true, "write gateway should report canWrite=true");

      const candidatesListed = await rpc(writeAddress.url, "ontology.candidates.list", { userId: "alice" }, "");
      assert(readPath(candidatesListed.json, ["payload", "review", "canPromote"]) === true, "write gateway should allow promote");
      assert(readPath(candidatesListed.json, ["payload", "review", "canReject"]) === true, "write gateway should allow reject");
      const writeCandidates = readRecordArrayAt(candidatesListed.json, ["payload", "output", "candidates"]);
      assert(writeCandidates.length === 1, "one pending candidate should be listed on the write gateway");

      const promoted = await rpc(writeAddress.url, "ontology.candidate.promote", { userId: "alice", id: candidate.id }, "");
      assert(promoted.status === 200 && promoted.json.ok === true, "ontology.candidate.promote should succeed");

      const corrected = await rpc(writeAddress.url, "ontology.assertion.correct", {
        userId: "alice",
        assertionId: active.id,
        correction: { objectValue: "VS Code", excerpt: "我其实改用 VS Code 了" },
        reason: "user correction via RPC",
      }, "");
      assert(corrected.status === 200 && corrected.json.ok === true, "ontology.assertion.correct should succeed");
      assert(readPath(corrected.json, ["payload", "corrected", "status"]) === "active", "corrected fact should be active");
      assert(readPath(corrected.json, ["payload", "corrected", "objectValue"]) === "VS Code", "corrected fact should carry the new value");
      const supersededEntries = readRecordArrayAt(corrected.json, ["payload", "superseded"]);
      const supersededPrevious = supersededEntries.find(entry => entry.id === active.id);
      assert(supersededPrevious?.status === "superseded", "previous fact should be superseded by the correction");

      const correctedId = String(readPath(corrected.json, ["payload", "corrected", "id"]) ?? "");
      assert(correctedId.length > 0, "corrected assertion id should be present");
      const retracted = await rpc(writeAddress.url, "ontology.assertion.retract", {
        userId: "alice",
        assertionId: correctedId,
        reason: "no longer relevant",
      }, "");
      assert(retracted.status === 200 && retracted.json.ok === true, "ontology.assertion.retract should succeed");
      assert(readPath(retracted.json, ["payload", "status"]) === "retracted", "retracted fact should report retracted status");

      const sensitiveExport = await rpc(writeAddress.url, "ontology.export", { userId: "alice", includeSensitiveEvidence: true }, "");
      assert(sensitiveExport.status === 200 && sensitiveExport.json.ok === true, "sensitive export should succeed with write permission");

      const regenerated = await rpc(writeAddress.url, "ontology.snapshot.regenerate", { userId: "alice" }, "");
      assert(regenerated.status === 200 && regenerated.json.ok === true, "snapshot.regenerate should succeed");

      const deleted = await rpc(writeAddress.url, "ontology.deleteAll", { userId: "alice", reason: "test wipe" }, "");
      assert(deleted.status === 200 && deleted.json.ok === true, "ontology.deleteAll should succeed");
      const wiped = await rpc(writeAddress.url, "ontology.knowledge.list", { userId: "alice" }, "");
      assert(readPath(wiped.json, ["payload", "activeCount"]) === 0, "deleteAll should remove all active facts");
      assert(readPath(wiped.json, ["payload", "candidateCount"]) === 0, "deleteAll should remove all candidates");
    } finally {
      await writeGateway.stop();
    }
  } finally {
    store.close?.();
    await rm(root, { recursive: true, force: true });
  }
}


async function testTrajectoryPersistenceAndGatewayRpc(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "loong-trajectories-"));
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
    const runtime = createLoongRuntime({
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


async function testGatewayTierRpc(): Promise<void> {
  let stored: unknown;
  let changeNotified: unknown;
  const gateway = createHttpGateway({
    runtime: createNoopRuntime(),
    tierConfigStore: {
      async load() {
        return {
          enabled: false,
          tiers: { fast: { thinking: "none", maxContextChars: 4000 } },
          classifier: { mode: "heuristic" },
          appliesOn: "next-turn",
          configPath: "/tmp/loong/tiers.json",
        };
      },
      async save(config) {
        stored = config;
        return {
          enabled: config.enabled,
          tiers: { ...config.tiers },
          classifier: { ...config.classifier },
          appliesOn: "next-turn",
          configPath: "/tmp/loong/tiers.json",
        };
      },
    },
    onTierConfigChange: (saved) => { changeNotified = saved; },
  });
  await gateway.start({ host: "127.0.0.1", port: 0, authMode: "shared-secret", sharedSecret: "secret" });
  const address = gateway.address();
  assert(address !== undefined, "tier-rpc Gateway did not start");

  try {
    const connect = await rpc(address.url, "connect");
    const caps = readArray(connect.json.payload, "capabilities");
    assert(caps.includes("tier.config.get"), "connect should advertise tier.config.get");
    assert(caps.includes("tier.config.save"), "connect should advertise tier.config.save");
    assert(caps.includes("tier.classify"), "connect should advertise tier.classify");

    const get = await rpc(address.url, "tier.config.get");
    assert(get.status === 200 && get.json.ok === true, "tier.config.get should succeed");
    assert(readPath(get.json, ["payload", "enabled"]) === false, "tier.config.get should return enabled flag");
    assert(readPath(get.json, ["payload", "tiers", "fast", "thinking"]) === "none", "tier.config.get should return fast tier spec");

    const saved = await rpc(address.url, "tier.config.save", {
      enabled: true,
      tiers: {
        fast: { model: "deepseek:deepseek-chat", thinking: "none", maxContextChars: 3500 },
        deep: { model: "anthropic:claude-sonnet-4-5", thinking: "high" },
      },
      classifier: {
        mode: "heuristic",
        keywordHints: [{ tier: "deep", words: ["regulation", "compliance"] }],
      },
    });
    assert(saved.status === 200 && saved.json.ok === true, `tier.config.save should succeed (got ${saved.status} ${JSON.stringify(saved.json)})`);
    assert(readPath(saved.json, ["payload", "enabled"]) === true, "saved tier config should report enabled");
    assert(readPath(saved.json, ["payload", "tiers", "fast", "model"]) === "deepseek:deepseek-chat", "saved tier config should round-trip model");
    assert(readPath(saved.json, ["payload", "appliesOn"]) === "next-turn", "saved tier config should advertise appliesOn");
    assert(readPath(stored, ["enabled"]) === true, "tier config store should receive enabled flag");
    assert(readPath(changeNotified, ["enabled"]) === true, "onTierConfigChange listener should fire");

    const heuristicFast = await rpc(address.url, "tier.classify", { message: "translate hello" });
    assert(heuristicFast.status === 200 && heuristicFast.json.ok === true, "tier.classify should succeed");
    // Note: gateway uses its in-memory config (stored above is the SAVED one,
    // but the load() above returns the seed config; on next call load() still
    // returns the seed. So the classifier output depends on the load() value
    // which is enabled=false. In our store stub load() never changes — so the
    // gateway falls back to standard. That's acceptable; we just assert the
    // RPC shape.
    assert(typeof readPath(heuristicFast.json, ["payload", "tier"]) === "string", "tier.classify payload should include tier");
    assert(typeof readPath(heuristicFast.json, ["payload", "reason"]) === "string", "tier.classify payload should include reason");
    assert(typeof readPath(heuristicFast.json, ["payload", "score"]) === "number", "tier.classify payload should include score");

    // Reject invalid tier name
    const bad = await rpc(address.url, "tier.config.save", {
      enabled: true,
      tiers: { unknown: {} },
      classifier: { mode: "heuristic" },
    });
    // Unknown tier names are silently dropped by parser — still ok.
    assert(bad.status === 200, "save should ignore unknown tier names rather than fail");

    const badClassifier = await rpc(address.url, "tier.config.save", {
      enabled: true,
      tiers: {},
      classifier: { mode: "fixed", fixedTier: "invalid-tier" },
    });
    // fixedTier=invalid is silently dropped → still 200 since classifier.mode parses.
    assert(badClassifier.status === 200, "save should silently drop invalid fixedTier values");
  } finally {
    await gateway.stop();
  }
}


async function testGatewaySessionTurnQueue(): Promise<void> {
  let concurrent = 0;
  let maxConcurrent = 0;
  const runtime: LoongAgentRuntime = {
    async runTurn(input) {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(resolve => setTimeout(resolve, 150));
      concurrent -= 1;
      return {
        runId: `run-${input.message}`,
        status: "ok",
        messages: [
          { id: "u1", role: "user", content: input.message, createdAt: "2026-05-22T10:00:00.000Z" },
          { id: "a1", role: "assistant", content: `done:${input.message}`, createdAt: "2026-05-22T10:00:01.000Z" },
        ],
      };
    },
    subscribe() {
      return () => {};
    },
  };
  const gateway = createHttpGateway({ runtime });
  await gateway.start({ host: "127.0.0.1", port: 0 });
  const address = gateway.address();
  assert(address !== undefined, "queue gateway should start");
  try {
    const firstPromise = rpc(address.url, "agent", { sessionId: "queue-session", message: "first" });
    await new Promise(resolve => setTimeout(resolve, 20));
    const second = await rpc(address.url, "agent", { sessionId: "queue-session", message: "second" });
    assert(second.status === 200 && second.json.ok === true, "second agent RPC should succeed");
    assert(readPath(second.json, ["payload", "queued"]) === true, "second turn should be queued");
    const queueTurnId = readPath(second.json, ["payload", "queueTurnId"]);
    assert(typeof queueTurnId === "string" && queueTurnId.length > 0, "queueTurnId should be returned");
    const first = await firstPromise;
    assert(first.status === 200 && first.json.ok === true, "first agent RPC should succeed");
    assert(readPath(first.json, ["payload", "queued"]) !== true, "first turn should not be queued");
    const waited = await rpc(address.url, "agent.wait", { queueTurnId });
    assert(waited.status === 200 && waited.json.ok === true, "agent.wait should succeed");
    assert(
      readPath(waited.json, ["payload", "result", "messages", 1, "content"]) === "done:second",
      "queued turn should complete with second message",
    );
    assert(maxConcurrent === 1, "session turns should not run concurrently");
  } finally {
    await gateway.stop();
  }
}


async function testGatewayQueryLoop(): Promise<void> {
  let turnCount = 0;
  const runtime: LoongAgentRuntime = {
    async runTurn(input) {
      turnCount += 1;
      const needsContinue = turnCount === 1;
      return {
        runId: `run-${turnCount}`,
        status: "ok",
        messages: [
          { id: "u1", role: "user", content: input.message, createdAt: "2026-05-22T10:00:00.000Z" },
          {
            id: "a1",
            role: "assistant",
            content: needsContinue ? "partial" : "done",
            createdAt: "2026-05-22T10:00:01.000Z",
            metadata: needsContinue
              ? { queryLoopContinue: true, toolIterationLimitReached: true }
              : {},
          },
        ],
      };
    },
    subscribe() {
      return () => {};
    },
  };
  const gateway = createHttpGateway({ runtime });
  await gateway.start({ host: "127.0.0.1", port: 0 });
  const address = gateway.address();
  assert(address !== undefined, "query loop gateway should start");
  try {
    const response = await rpc(address.url, "agent", {
      sessionId: "query-loop-session",
      message: "start task",
      queryLoop: true,
    });
    assert(response.status === 200 && response.json.ok === true, "query loop agent RPC should succeed");
    assert(turnCount === 2, "query loop should auto-continue after queryLoopContinue");
    assert(
      readPath(response.json, ["payload", "result", "messages", 1, "content"]) === "done",
      "final assistant message should come from continuation turn",
    );
    const events = readPath(response.json, ["payload", "events"]);
    assert(Array.isArray(events) && events.length >= 0, "query loop should return events array");
  } finally {
    await gateway.stop();
  }
}


async function testGatewayModelCatalogBridge(): Promise<void> {
  const catalog = createModelCatalogFromProviderSummaries([
    {
      id: "openai",
      displayName: "OpenAI",
      supportsToolCalling: true,
      models: [{ id: "gpt-4.1", aliases: ["gpt-main"] }],
    },
  ]);
  const resolved = applyModelCatalogToAgentParams({ model: "gpt-main" }, catalog);
  assert(resolved.model === "openai:gpt-4.1", "gateway should canonicalize bare alias to provider:model");
  const shared = applyModelCatalogToParams({ model: "gpt-main" }, catalog);
  assert(shared.model === "openai:gpt-4.1", "shared model-catalog helper should canonicalize alias");
  assertThrows(
    () =>
      assertLoongGatewayWebhookPayload({
        sessionId: "s1",
        message: "hi",
        channel: "telegram",
        thinking: "turbo",
      }),
    "webhook validator should reject invalid thinking",
  );
}


async function testGatewaySkillsListRpc(): Promise<void> {
  const mockSkillList = createMockTool("skill_list", ["read"], async () => ({
    skills: [{ name: "custom-skill", description: "From disk", category: "custom" }],
    total: 1,
    truncated: false,
  }));
  const gateway = createHttpGateway({
    runtime: createNoopRuntime(),
    toolRegistry: createToolRegistry([mockSkillList]),
  });
  await gateway.start({ host: "127.0.0.1", port: 0 });
  const address = gateway.address();
  assert(address !== undefined, "skills list gateway should start");
  try {
    const response = await rpc(address.url, "skills.list");
    assert(response.status === 200 && response.json.ok === true, "skills.list RPC should succeed");
    const skills = readRecordArrayAt(response.json, ["payload", "skills"]);
    assert(skills.some(skill => skill.name === "custom-skill"), "skills.list should include runtime skills");
    assert(skills.some(skill => skill.name === "pptx"), "skills.list should include bundled preset skills");
    assert(readPath(response.json, ["payload", "available"]) === true, "skills.list should report available=true");
  } finally {
    await gateway.stop();
  }
}


/** FR-01: gateway builds a MemoryIdentity on the turn input from the channel user id. */
async function testGatewayTurnIdentityPassthrough(): Promise<void> {
  // Unit level: toTurnInput builds identity from userId or metadata.channelUserId.
  const fromUserId = toTurnInput({ sessionId: "s1", message: "hello", userId: "alice" });
  assert(fromUserId.identity?.tenantId === GATEWAY_DEFAULT_TENANT_ID, "identity should use the default tenant");
  assert(fromUserId.identity?.userId === "alice", "identity should carry the explicit userId");

  const fromMetadata = toTurnInput({ sessionId: "s1", message: "hello", metadata: { channelUserId: "bob" } });
  assert(fromMetadata.identity?.userId === "bob", "identity should fall back to metadata.channelUserId");

  const explicitWins = toTurnInput({
    sessionId: "s1",
    message: "hello",
    userId: "alice",
    metadata: { channelUserId: "bob" },
  });
  assert(explicitWins.identity?.userId === "alice", "explicit userId should win over metadata.channelUserId");

  const anonymous = toTurnInput({ sessionId: "s1", message: "hello" });
  assert(anonymous.identity === undefined, "turn without user id must stay anonymous (backward compatible)");

  const parsed = parseGatewayAgentParams({ sessionId: "s1", message: "hello", userId: "carol" });
  assert(parsed.userId === "carol", "parseGatewayAgentParams should accept userId");
  assert(toTurnInput(parsed).identity?.userId === "carol", "parsed userId should flow into the turn identity");

  // End to end: webhook userId lands on the LoongTurnInput identity.
  let capturedInput: LoongTurnInput | undefined;
  const listeners = new Set<(event: LoongEvent) => void>();
  const runtime: LoongAgentRuntime = {
    async runTurn(input) {
      capturedInput = input;
      const runId = "identity-run-1";
      for (const listener of listeners) {
        listener({ type: "lifecycle", runId, phase: "start", metadata: { sessionId: input.sessionId } });
      }
      return {
        runId,
        status: "ok",
        messages: [
          { id: "user-1", role: "user", content: input.message, createdAt: new Date().toISOString() },
          { id: "assistant-1", role: "assistant", content: "identity-ok", createdAt: new Date().toISOString() },
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
  assert(address !== undefined, "identity gateway did not start");
  try {
    const delivered = await postJson(`${address.url}/channels/webhook`, {
      sessionId: "identity-session",
      message: "hello with identity",
      channel: "telegram",
      userId: "user-1",
    });
    assert(delivered.status === 200 && delivered.json.ok === true, "webhook delivery should succeed");
    assert(capturedInput?.identity?.userId === "user-1", "webhook userId should reach the turn identity");
    assert(
      capturedInput?.identity?.tenantId === GATEWAY_DEFAULT_TENANT_ID,
      "webhook identity should use the default tenant",
    );
    assert(capturedInput?.metadata?.channelUserId === "user-1", "webhook should still annotate channel metadata");
  } finally {
    await gateway.stop();
  }
}


export const gatewayTestCases: TestCase[] = [
  ["gateway direct tool RPC", testGatewayDirectToolRpc],
  ["gateway pairing RPC", testGatewayPairingRpc],
  ["gateway MCP catalog and agent tool", testGatewayMcpCatalogAndAgent],
  ["gateway production config guards", testGatewayProductionConfigGuards],
  ["gateway websocket RPC and events", testGatewayWebSocket],
  ["gateway webhook channel", testGatewayWebhookChannel],
  ["gateway turn identity passthrough", testGatewayTurnIdentityPassthrough],
  ["gateway cron RPC", testGatewayCronRpc],
  ["channels serve bridge", testChannelsServeBridge],
  ["channel adapters", testChannelAdapters],
  ["gateway memory candidate review RPC", testGatewayMemoryCandidateRpc],
  ["gateway ontology user-control RPC", testGatewayOntologyUserControlRpc],
  ["trajectory persistence and gateway RPC", testTrajectoryPersistenceAndGatewayRpc],
  ["gateway tier RPC", testGatewayTierRpc],
  ["gateway session turn queue", testGatewaySessionTurnQueue],
  ["gateway query loop continuation", testGatewayQueryLoop],
  ["gateway skills.list RPC", testGatewaySkillsListRpc],
  ["gateway model catalog bridge", testGatewayModelCatalogBridge],
];
