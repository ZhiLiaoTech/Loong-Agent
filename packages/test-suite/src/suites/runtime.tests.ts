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
  resolveAiSummarizationForTurn,
  resolveSessionCompactionForTurn,
  summarizeOldTurnsWithAI,
  prepareSessionHistoryForModel,
  repairModelMessagesAfterCancel,
  TOOL_CANCELLED_CODE,
} from "@loong/core";
import type { ModelMessage, ModelProvider } from "@loong/providers";
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
} from "@loong/gateway";
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
} from "@loong/memory";
import {
  applyModelCatalogToParams,
  catalogEntriesFromProviders,
  createModelCatalog,
} from "@loong/model-catalog";
import { createAnthropicProvider, createOpenAICompatibleProvider, ProviderError, type ModelRequest } from "@loong/providers";
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

async function testRuntimeModelFallback(): Promise<void> {
  const calls: string[] = [];
  const primary: ModelProvider = {
    id: "primary",
    displayName: "Primary",
    defaultModel: "broken",
    supportsToolCalling: false,
    async complete(request) {
      calls.push(`primary:${request.model}:${request.onTextDelta === undefined ? "buffered" : "streaming"}`);
      throw new ProviderError({
        providerId: "primary",
        status: 503,
        retryable: true,
        message: "Primary provider unavailable.",
      });
    },
  };
  const backup: ModelProvider = {
    id: "backup",
    displayName: "Backup",
    defaultModel: "stable",
    supportsToolCalling: false,
    async complete(request) {
      calls.push(`backup:${request.model}:${request.onTextDelta === undefined ? "buffered" : "streaming"}`);
      return { id: "backup-ok", text: `backup:${request.model}` };
    },
  };
  const runtime = createLoongRuntime({
    providers: [primary, backup],
    defaultModel: "primary:broken",
    modelFallbacks: ["backup:stable"],
  });
  const events: LoongEvent[] = [];
  const unsubscribe = runtime.subscribe(event => events.push(event));
  try {
    const result = await runtime.runTurn({
      sessionId: "fallback",
      source: "cli",
      message: "hello",
    });
    assert(result.status === "ok", `runtime model fallback failed: ${result.error}`);
    assert(result.messages[1]?.content === "backup:stable", "runtime should return backup model response");
    // Provider still receives onTextDelta on every attempt (so true streaming
    // is preserved) but the runtime buffers deltas per-attempt and only
    // flushes on success — see assertion below on assistant_delta events.
    assert(calls.join(",") === "primary:broken:streaming,backup:stable:streaming", "fallback attempts should still stream at the provider level and be ordered");
    assert(readPath(result.messages[1]?.metadata, ["providerId"]) === "backup", "assistant metadata should record final provider");
    assert(readPath(result.messages[1]?.metadata, ["modelFallbacks", 0, "providerId"]) === "primary", "assistant metadata should record failed provider");
    assert(events.filter(event => event.type === "assistant_delta").map(event => event.text).join("") === "backup:stable", "runtime should emit only the successful fallback text");
  } finally {
    unsubscribe();
  }

  const nonRetryableRuntime = createLoongRuntime({
    providers: [{
      ...primary,
      async complete() {
        throw new ProviderError({
          providerId: "primary",
          status: 400,
          retryable: false,
          message: "Primary provider rejected the request.",
        });
      },
    }, backup],
    defaultModel: "primary:broken",
    modelFallbacks: ["backup:stable"],
  });
  const failed = await nonRetryableRuntime.runTurn({
    sessionId: "fallback-non-retryable",
    source: "cli",
    message: "hello",
  });
  assert(failed.status === "error", "runtime should not fallback after non-retryable provider errors");
  assert(failed.error?.includes("Primary provider rejected"), "runtime should preserve non-retryable provider error");
}

async function testProviderNetworkErrorCauseDetails(): Promise<void> {
  const createFetchError = (): TypeError & { cause?: unknown } => {
    const error = new TypeError("fetch failed") as TypeError & { cause?: unknown };
    error.cause = Object.assign(new Error("Connect Timeout Error"), {
      name: "ConnectTimeoutError",
      code: "UND_ERR_CONNECT_TIMEOUT",
    });
    return error;
  };
  const provider = createOpenAICompatibleProvider({
    apiKey: "test-key",
    defaultModel: "network-test",
    retry: { maxAttempts: 1 },
    fetchImpl: async () => {
      throw createFetchError();
    },
  });

  let caught: unknown;
  try {
    await provider.complete({
      model: "network-test",
      messages: [{ role: "user", content: "hello" }],
    });
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof ProviderError, "provider network errors should be wrapped as ProviderError");
  assert(caught.code === "network_error", "provider network errors should keep network_error code");
  assert(caught.responseBody === "fetch failed", "provider network errors should preserve the top-level fetch error message");
  assert(caught.attempts === 1, "provider network errors should report attempt count");
  assert(caught.causeName === "ConnectTimeoutError", "provider network errors should capture fetch cause name");
  assert(caught.causeCode === "UND_ERR_CONNECT_TIMEOUT", "provider network errors should capture fetch cause code");
  assert(caught.causeMessage === "Connect Timeout Error", "provider network errors should capture fetch cause message");

  const runtime = createLoongRuntime({
    providers: [provider],
    defaultModel: "openai:network-test",
  });
  const events: LoongEvent[] = [];
  const unsubscribe = runtime.subscribe(event => events.push(event));
  try {
    const result = await runtime.runTurn({
      sessionId: "network-cause",
      source: "cli",
      message: "hello",
    });
    assert(result.status === "error", "runtime should surface provider network failures");
  } finally {
    unsubscribe();
  }
  const errorEvent = events.find((event): event is Extract<LoongEvent, { type: "lifecycle" }> =>
    event.type === "lifecycle" && event.phase === "error",
  );
  assert(readPath(errorEvent?.metadata, ["causeName"]) === "ConnectTimeoutError", "runtime error metadata should include fetch cause name");
  assert(readPath(errorEvent?.metadata, ["causeCode"]) === "UND_ERR_CONNECT_TIMEOUT", "runtime error metadata should include fetch cause code");
  assert(readPath(errorEvent?.metadata, ["causeMessage"]) === "Connect Timeout Error", "runtime error metadata should include fetch cause message");
  assert(readPath(errorEvent?.metadata, ["attempts"]) === 1, "runtime error metadata should include attempt count");
}

async function testProviderRetriesTransientNetworkFailures(): Promise<void> {
  let attempts = 0;
  const provider = createOpenAICompatibleProvider({
    apiKey: "test-key",
    defaultModel: "retry-test",
    retry: { maxAttempts: 3, baseDelayMs: 0 },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new TypeError("fetch failed") as TypeError & { cause?: unknown };
        error.cause = Object.assign(new Error("socket hang up"), {
          name: "SocketError",
          code: "ECONNRESET",
        });
        throw error;
      }
      return new Response(JSON.stringify({
        id: "retry_ok",
        choices: [{ message: { content: "retried-ok" } }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const response = await provider.complete({
    model: "retry-test",
    messages: [{ role: "user", content: "hello" }],
  });
  assert(attempts === 3, `provider should retry transient network errors (got ${attempts} attempts)`);
  assert(response.text === "retried-ok", "provider should return the successful retry response");

  let rateLimitAttempts = 0;
  const rateLimitProvider = createOpenAICompatibleProvider({
    apiKey: "test-key",
    defaultModel: "retry-429-test",
    retry: { maxAttempts: 3, baseDelayMs: 0 },
    fetchImpl: async () => {
      rateLimitAttempts += 1;
      if (rateLimitAttempts < 3) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded." }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "0",
          },
        });
      }
      return new Response(JSON.stringify({
        id: "retry_429_ok",
        choices: [{ message: { content: "rate-limit-retried-ok" } }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const rateLimitResponse = await rateLimitProvider.complete({
    model: "retry-429-test",
    messages: [{ role: "user", content: "hello" }],
  });
  assert(rateLimitAttempts === 3, `provider should retry HTTP 429 responses (got ${rateLimitAttempts} attempts)`);
  assert(rateLimitResponse.text === "rate-limit-retried-ok", "provider should return the successful 429 retry response");
}


async function testTierClassifierHeuristic(): Promise<void> {
  // Short prompts with fast keywords → fast.
  const fast = classifyTierHeuristic(
    { sessionId: "t", source: "cli", message: "请翻译这句话" },
    {},
  );
  assert(fast.tier === "fast", `fast keyword should classify as fast (got ${fast.tier}: ${fast.reason})`);
  assert(fast.source === "heuristic", "heuristic source should be reported");

  // Deep keywords (+3) + agentMode (+1) + long prompt (+1) reach deep.
  const deepMessage = `Please design a sharded multi-tenant rate limiter and analyze deeply. ${"x".repeat(600)}`;
  const deep = classifyTierHeuristic(
    { sessionId: "t", source: "cli", message: deepMessage, workspace: "/tmp/proj" },
    {},
  );
  assert(deep.tier === "deep", `deep keyword should classify as deep (got ${deep.tier}: ${deep.reason})`);
  assert(deep.score >= 5, `deep score should be >= 5 (got ${deep.score})`);

  // Long prompt with no keywords drifts to standard or deep depending on length.
  const longMessage = "a".repeat(2100);
  const long = classifyTierHeuristic(
    { sessionId: "t", source: "cli", message: longMessage },
    {},
  );
  assert(long.tier === "standard" || long.tier === "deep", `long prompt should escalate (got ${long.tier})`);

  // Heavy doc (PDF) + workspace pushes standard or deep.
  const heavy = classifyTierHeuristic(
    {
      sessionId: "t",
      source: "cli",
      message: "Quick summary please.",
      workspace: "/tmp/proj",
      attachments: [
        { kind: "document", mimeType: "application/pdf", data: "" },
      ],
    },
    {},
  );
  assert(heavy.tier !== "fast", `PDF attachment should bump above fast (got ${heavy.tier})`);

  // Inherited tier wins.
  const inherited = classifyTierHeuristic(
    { sessionId: "t", source: "cli", message: "翻译" },
    { inheritedTier: "deep", delegationDepth: 2 },
  );
  assert(inherited.tier === "deep", "inherited tier should win over keyword");
  assert(inherited.source === "inherited", "inherited source should be reported");

  // Explicit input.tier wins over heuristic and fixed.
  const explicit = decideTier(
    { enabled: true, tiers: {}, classifier: { mode: "fixed", fixedTier: "fast" } },
    { sessionId: "t", source: "cli", message: "翻译", tier: "deep" },
    {},
  );
  assert(explicit?.tier === "deep", "explicit input tier should beat fixed-mode");
  assert(explicit?.source === "explicit-input", "explicit-input source should be reported");
}


async function testRuntimeTierOverrides(): Promise<void> {
  const captured: Array<{ model: string }> = [];
  const fastProvider: ModelProvider = {
    id: "fast-prov",
    displayName: "Fast",
    defaultModel: "fast-default",
    supportsToolCalling: false,
    async complete(req) {
      captured.push({ model: req.model });
      return { id: "fast-1", text: "fast-ok" };
    },
  };
  const deepProvider: ModelProvider = {
    id: "deep-prov",
    displayName: "Deep",
    defaultModel: "deep-default",
    supportsToolCalling: false,
    async complete(req) {
      captured.push({ model: req.model });
      return { id: "deep-1", text: "deep-ok" };
    },
  };

  const runtime = createLoongRuntime({
    providers: [fastProvider, deepProvider],
    tierConfig: normalizeTierConfig({
      enabled: true,
      tiers: {
        fast: { model: "fast-prov:fast-default" },
        standard: { model: "fast-prov:fast-default" },
        deep: { model: "deep-prov:deep-default" },
      },
      classifier: { mode: "heuristic" },
    }),
  });

  const events: LoongEvent[] = [];
  const unsubscribe = runtime.subscribe(event => events.push(event));
  try {
    // Heuristic should fire fast for "翻译"
    const fast = await runtime.runTurn({ sessionId: "tier-fast", source: "cli", message: "翻译这句话" });
    assert(fast.status === "ok", `tier fast turn failed: ${fast.error}`);
    assert(captured.at(-1)?.model === "fast-default", `fast tier should route to fast model (got ${captured.at(-1)?.model})`);

    // Deep keyword should route to deep model
    const deepMessage = `design a multi-tenant scheduler and analyze deeply. ${"x".repeat(600)}`;
    const deep = await runtime.runTurn({
      sessionId: "tier-deep",
      source: "cli",
      message: deepMessage,
      workspace: "/tmp/proj",
    });
    assert(deep.status === "ok", `tier deep turn failed: ${deep.error}`);
    assert(captured.at(-1)?.model === "deep-default", `deep tier should route to deep model (got ${captured.at(-1)?.model})`);

    // Explicit input.model wins over tier
    const overridden = await runtime.runTurn({
      sessionId: "tier-explicit",
      source: "cli",
      message: deepMessage,
      workspace: "/tmp/proj",
      model: "fast-prov:fast-default",
    });
    assert(overridden.status === "ok", `explicit-model turn failed: ${overridden.error}`);
    assert(captured.at(-1)?.model === "fast-default", `explicit model should win over deep tier (got ${captured.at(-1)?.model})`);

    // lifecycle:start metadata should expose tier + tierSource
    const startEvent = events.find(event =>
      event.type === "lifecycle"
      && event.phase === "start"
      && (event.metadata as Record<string, unknown> | undefined)?.tier !== undefined,
    );
    assert(startEvent !== undefined, "lifecycle:start should expose tier metadata");
    const meta = (startEvent as { metadata?: Record<string, unknown> }).metadata ?? {};
    assert(typeof meta.tier === "string", "lifecycle metadata.tier should be present");
    assert(typeof meta.tierSource === "string", "lifecycle metadata.tierSource should be present");
    assert(typeof meta.tierReason === "string", "lifecycle metadata.tierReason should be present");
  } finally {
    unsubscribe();
  }

  // setTierConfig hot-swap: passing undefined disables tier scheduling on next turn.
  const setter = runtime as LoongAgentRuntime & { setTierConfig?: (c: unknown) => void };
  assert(typeof setter.setTierConfig === "function", "runtime should expose setTierConfig");
  setter.setTierConfig?.(undefined);
  const afterDisable = await runtime.runTurn({
    sessionId: "tier-disabled",
    source: "cli",
    message: "design a multi-tenant scheduler and analyze deeply.",
  });
  assert(afterDisable.status === "ok", `disabled-tier turn failed: ${afterDisable.error}`);
  // With tier disabled and no defaultModel, runtime should fall back to first provider
  const lastCall = captured.at(-1)?.model;
  assert(lastCall === "fast-default" || lastCall === "deep-default",
    `after setTierConfig(undefined) runtime should still complete via provider registry (got ${lastCall})`);
}


async function testTextToolCallExtraction(): Promise<void> {
  const fileRead = extractTextToolCalls("让我直接查看工作目录的内容：\n\n<file_read>\n<path>.</path>\n</file_read>\n");
  assert(fileRead.length === 1, "file_read XML block should parse");
  assert(fileRead[0]?.function?.name === "file_read", "tool name should map to file_read");
  assert(fileRead[0]?.function?.arguments === JSON.stringify({ path: "." }), "path field should parse");

  const bash = extractTextToolCalls("<bash>ls -la</bash>");
  assert(bash.length === 1, "bash block should parse");
  assert(bash[0]?.function?.name === "file_read", "ls bash should rewrite to file_read");
  assert(JSON.parse(bash[0]?.function?.arguments ?? "{}").path === ".", "ls -la should list workspace root");

  const workspaceLs = extractTextToolCalls("<bash>ls /workspace/</bash>");
  assert(workspaceLs[0]?.function?.name === "file_read", "/workspace ls should map to file_read");
  assert(JSON.parse(workspaceLs[0]?.function?.arguments ?? "{}").path === ".", "/workspace should normalize to .");

  const lsWithFlagsPath = extractTextToolCalls("<bash>ls -la src</bash>");
  assert(lsWithFlagsPath[0]?.function?.name === "file_read", "ls -la <path> should rewrite to file_read");
  assert(JSON.parse(lsWithFlagsPath[0]?.function?.arguments ?? "{}").path === "src", "ls flags + path should keep path");

  assert(
    pickAssistantDisplayText("<bash>ls</bash>", "") === "",
    "pure XML rpc text should not fall back to raw XML",
  );
  assert(
    pickAssistantDisplayText("done", "<bash>x</bash>") === "done",
    "rpc text should win over stream XML",
  );
  assert(
    appendWorkspaceToolGuidance("base", "").includes("no workspace"),
    "missing workspace should add guidance",
  );

  const augmented = augmentResponseWithTextToolCalls({
    id: "test-augment",
    text: "<file_read>\n<path>README.md</path>\n</file_read>",
  });
  assert(augmented.toolCalls?.length === 1, "augment should attach toolCalls");
  assert(augmented.textToolCallsExtracted === true, "augment should flag text extraction");
  assert(augmented.text === "", "tool XML should be stripped from assistant text");

  const skipped = augmentResponseWithTextToolCalls(
    {
      id: "test-skip",
      text: "<file_read><path>x</path></file_read>",
      toolCalls: [{ id: "native-1", type: "function", function: { name: "file_read", arguments: "{}" } }],
    },
    true,
  );
  assert(skipped.toolCalls?.length === 1 && skipped.toolCalls[0]?.id === "native-1", "native toolCalls should win");
  assert(skipped.textToolCallsExtracted === undefined, "should not extract when native toolCalls exist");
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
  const runtime = createLoongRuntime({
    providers: [provider],
    defaultModel: "mock-tool-model",
    tools: [echoTool],
    permissionEngine: createToolPermissionEngine({
      defaultDecision: "ask",
      rules: [{ toolName: "echo_tool", decision: "allow", reason: "test allow" }],
    }),
  });
  const events: LoongEvent[] = [];
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


async function testRuntimeParallelReadOnlyTools(): Promise<void> {
  let concurrent = 0;
  let maxConcurrent = 0;
  const delayMs = 80;
  const track = async (label: string) => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    concurrent -= 1;
    return { label };
  };
  const toolA = createMockTool("parallel_a", ["read"], async () => track("a"));
  const toolB = createMockTool("parallel_b", ["read", "network"], async () => track("b"));
  let requestCount = 0;
  const provider: ModelProvider = {
    id: "mock-parallel",
    displayName: "Mock Parallel",
    defaultModel: "mock",
    supportsToolCalling: true,
    async complete(request) {
      requestCount += 1;
      if (requestCount === 1) {
        return {
          id: "first",
          toolCalls: [
            { id: "call_a", type: "function", function: { name: "parallel_a", arguments: "{}" } },
            { id: "call_b", type: "function", function: { name: "parallel_b", arguments: "{}" } },
          ],
        };
      }
      return { id: "second", text: "done" };
    },
  };
  const runtime = createLoongRuntime({
    providers: [provider],
    defaultModel: "mock",
    tools: [toolA, toolB],
    permissionEngine: createToolPermissionEngine({
      defaultDecision: "allow",
    }),
  });
  const result = await runtime.runTurn({
    sessionId: "parallel-tools",
    source: "cli",
    message: "run both",
  });
  assert(result.status === "ok", `parallel tool turn failed: ${result.error}`);
  assert(maxConcurrent === 2, `expected concurrent tool execution, saw max ${maxConcurrent}`);
  assert(requestCount === 2, "model should be called twice after parallel tools");
}


async function testRuntimeParallelReadStreamingEvents(): Promise<void> {
  const delayMs = 60;
  const toolA = createMockTool("stream_parallel_a", ["read"], async () => {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return { label: "a" };
  });
  const toolB = createMockTool("stream_parallel_b", ["read"], async () => {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return { label: "b" };
  });
  let requestCount = 0;
  const provider: ModelProvider = {
    id: "mock-parallel-stream",
    displayName: "Mock Parallel Stream",
    defaultModel: "mock",
    supportsToolCalling: true,
    async complete() {
      requestCount += 1;
      if (requestCount === 1) {
        return {
          id: "first",
          toolCalls: [
            { id: "call_a", type: "function", function: { name: "stream_parallel_a", arguments: "{}" } },
            { id: "call_b", type: "function", function: { name: "stream_parallel_b", arguments: "{}" } },
          ],
        };
      }
      return { id: "second", text: "done" };
    },
  };
  const events: LoongEvent[] = [];
  const runtime = createLoongRuntime({
    providers: [provider],
    defaultModel: "mock",
    tools: [toolA, toolB],
    permissionEngine: createToolPermissionEngine({ defaultDecision: "allow" }),
  });
  const unsubscribe = runtime.subscribe(event => events.push(event));
  try {
    const result = await runtime.runTurn({
      sessionId: "parallel-stream",
      source: "cli",
      message: "run parallel reads",
    });
    assert(result.status === "ok", `parallel stream turn failed: ${result.error}`);
    const updates = events.filter((event): event is Extract<LoongEvent, { type: "tool" }> =>
      event.type === "tool"
      && event.phase === "update"
      && isRecord(event.payload)
      && event.payload.parallelBatch === true,
    );
    assert(updates.length === 2, "each parallel read tool should emit a streaming update event");
    assert(
      updates.some(event => event.toolName === "stream_parallel_a" && readPath(event.payload, ["completed"]) === 1),
      "first completed tool should report progress",
    );
    assert(
      updates.some(event => event.toolName === "stream_parallel_b" && readPath(event.payload, ["total"]) === 2),
      "updates should include batch total",
    );
  } finally {
    unsubscribe();
  }
}


async function testParallelSafeToolPolicy(): Promise<void> {
  const readOnly = createMockTool("read_only", ["read"], async () => ({}));
  assert(isParallelSafeTool(readOnly), "read-only allow tools should be parallel-safe");
  const readNetwork = createMockTool("read_net", ["read", "network"], async () => ({}));
  assert(isParallelSafeTool(readNetwork), "read+network allow tools should be parallel-safe");
  const askTool = createMockTool("ask_tool", ["read"], async () => ({}));
  askTool.permission = "ask";
  assert(!isParallelSafeTool(askTool), "ask tools should not be parallel-safe");
  const writeTool = createMockTool("write_tool", ["read", "write"], async () => ({}));
  assert(!isParallelSafeTool(writeTool), "write tools should not be parallel-safe");

  const registry = createToolRegistry([readOnly, readNetwork]);
  assert(
    canRunToolCallsInParallel([
      { id: "c1", type: "function", function: { name: "read_only", arguments: "{}" } },
      { id: "c2", type: "function", function: { name: "read_net", arguments: "{}" } },
    ], registry),
    "registry should allow parallel rounds for safe tools",
  );
}


async function testTurnPrepPipeline(): Promise<void> {
  const messages = [
    { role: "system" as const, content: "system".repeat(200) },
    { role: "user" as const, content: "hello" },
    { role: "tool" as const, content: "payload".repeat(4_000), toolCallId: "call_1" },
    { role: "assistant" as const, content: "analysis".repeat(3_000) },
  ];
  const { messages: prepped, report } = applyTurnPrep(
    messages,
    buildTurnPrepOptions(4_000, {
      toolResultMaxChars: 600,
      assistantContentMaxChars: 800,
      totalEstimatedMaxChars: 2_500,
    }),
  );
  assert(report.truncatedToolResults === 1, "tool output should be truncated");
  assert(report.truncatedAssistantMessages === 1, "assistant text should be truncated");
  const toolContent = prepped[2]?.content;
  assert(typeof toolContent === "string" && toolContent.length < 4_000, "tool output should be smaller after prep");
  assert(
    toolContent.includes("truncated") || toolContent.includes("omitted"),
    "tool truncation marker expected",
  );
  assert(report.estimatedCharsAfter < report.estimatedCharsBefore, "prep should shrink estimated size");
  assert(isLikelyContextOverflowError(new ProviderError({
    providerId: "mock-prep",
    message: "prompt is too long for this model",
    retryable: false,
    status: 413,
  })), "context overflow heuristic should match provider errors");
}


async function testRuntimeTurnPrepReactiveRetry(): Promise<void> {
  let attempts = 0;
  const provider: ModelProvider = {
    id: "mock-prep",
    displayName: "Mock Prep",
    defaultModel: "mock-prep-model",
    supportsToolCalling: false,
    async complete() {
      attempts += 1;
      if (attempts === 1) {
        throw new ProviderError({
          providerId: "mock-prep",
          message: "prompt is too long",
          retryable: false,
          status: 413,
        });
      }
      return { id: "ok", text: "recovered" };
    },
  };
  const runtime = createLoongRuntime({
    providers: [provider],
    defaultModel: "mock-prep-model",
    turnPrepEnabled: true,
    maxContextChars: 4_000,
  });
  const events: LoongEvent[] = [];
  const unsubscribe = runtime.subscribe(event => events.push(event));
  try {
    const result = await runtime.runTurn({
      sessionId: "turn-prep-reactive",
      source: "cli",
      message: "recover from context overflow",
    });
    assert(result.status === "ok", `reactive prep retry failed: ${result.error}`);
    assert(result.messages[1]?.content === "recovered", "second model attempt should succeed");
    assert(attempts === 2, "provider should be called twice after reactive prep");
    const prepEvents = events.filter((event): event is Extract<LoongEvent, { type: "context" }> =>
      event.type === "context" && event.providerName === "turn_prep" && event.phase === "end",
    );
    assert(prepEvents.length >= 1, "turn_prep context event should be emitted");
    assert(prepEvents.some(event => {
      const payload = event.payload;
      return typeof payload === "object"
        && payload !== null
        && (payload as { reactive?: boolean }).reactive === true;
    }), "reactive prep event should be recorded");
  } finally {
    unsubscribe();
  }
}


async function testRuntimeToolIterationLimitGraceful(): Promise<void> {
  let calls = 0;
  const provider: ModelProvider = {
    id: "mock-tool-limit",
    displayName: "Mock Tool Limit",
    defaultModel: "mock-tool-limit-model",
    supportsToolCalling: true,
    async complete(request) {
      calls += 1;
      const toolsDisabled = !request.tools || (Array.isArray(request.tools) && request.tools.length === 0);
      if (toolsDisabled) {
        return { id: "summary", text: "Reached tool limit; here is the summary." };
      }
      return {
        id: `tool-${calls}`,
        toolCalls: [{
          id: `call_${calls}`,
          type: "function",
          function: { name: "echo_tool", arguments: JSON.stringify({ text: `step-${calls}` }) },
        }],
      };
    },
  };
  const echoTool = createMockTool("echo_tool", ["read"], async invocation => ({
    ok: true,
    step: readPath(invocation.input, ["text"]),
  }));
  const runtime = createLoongRuntime({
    providers: [provider],
    defaultModel: "mock-tool-limit-model",
    maxToolIterations: 2,
    tools: [echoTool],
    permissionEngine: createToolPermissionEngine({
      defaultDecision: "ask",
      rules: [{ toolName: "echo_tool", decision: "allow", reason: "test allow" }],
    }),
  });
  const events: LoongEvent[] = [];
  const unsubscribe = runtime.subscribe(event => events.push(event));
  try {
    const result = await runtime.runTurn({
      sessionId: "tool-limit-graceful",
      source: "cli",
      message: "keep using tools",
    });
    assert(result.status === "ok", `graceful tool limit should succeed: ${result.error}`);
    assert(
      result.messages[1]?.content === "Reached tool limit; here is the summary.",
      "final assistant should come from summarize pass",
    );
    const limitEvent = events.find(event =>
      event.type === "context" && event.providerName === "tool_iteration_limit" && event.phase === "end",
    );
    assert(limitEvent !== undefined, "tool_iteration_limit event should be emitted");
    assert(
      result.messages[1]?.metadata?.toolIterationLimitReached === true,
      "assistant metadata should record tool iteration limit",
    );
    assert(calls >= 3, "should run tool rounds plus a final summarize call");
  } finally {
    unsubscribe();
  }
}


async function testTurnCancelProtocol(): Promise<void> {
  const modelMessages = [
    {
      role: "assistant" as const,
      content: "calling tools",
      toolCalls: [{
        id: "call_a",
        type: "function" as const,
        function: { name: "echo_tool", arguments: "{}" },
      }, {
        id: "call_b",
        type: "function" as const,
        function: { name: "echo_tool", arguments: "{}" },
      }],
    },
    { role: "tool" as const, toolCallId: "call_a", content: "{\"ok\":true}" },
  ];
  const repaired = repairModelMessagesAfterCancel(modelMessages);
  assert(repaired === 1, "repair should insert one missing tool result");
  const missingResult = modelMessages.find(message => message.role === "tool" && message.toolCallId === "call_b");
  assert(missingResult !== undefined, "missing tool result should be inserted");
  const payload = JSON.parse(String(missingResult?.content)) as { code?: string };
  assert(payload.code === TOOL_CANCELLED_CODE, "cancelled tool result should use turn_cancelled code");

  const scratch: typeof modelMessages = [];
  const appended = appendCancelledToolResults(scratch, [{
    id: "call_c",
    type: "function",
    function: { name: "echo_tool", arguments: "{}" },
  }]);
  assert(appended === 1, "appendCancelledToolResults should add one synthetic result");
  assert(scratch[0]?.toolCallId === "call_c", "synthetic tool result should reference tool call id");
}


async function testRuntimeTurnCancelDuringTool(): Promise<void> {
  let modelCalls = 0;
  let toolStarted = false;
  const controller = new AbortController();
  const provider: ModelProvider = {
    id: "mock-cancel",
    displayName: "Mock Cancel",
    defaultModel: "mock-cancel-model",
    supportsToolCalling: true,
    async complete() {
      modelCalls += 1;
      return {
        id: "tool-round",
        toolCalls: [{
          id: "call_slow",
          type: "function",
          function: { name: "slow_tool", arguments: JSON.stringify({ waitMs: 2_000 }) },
        }],
      };
    },
  };
  const slowTool = createMockTool("slow_tool", ["read"], async invocation => {
    toolStarted = true;
    const waitMs = typeof readPath(invocation.input, ["waitMs"]) === "number"
      ? (readPath(invocation.input, ["waitMs"]) as number)
      : 2_000;
    await new Promise(resolve => setTimeout(resolve, waitMs));
    return { ok: true };
  });
  const runtime = createLoongRuntime({
    providers: [provider],
    defaultModel: "mock-cancel-model",
    tools: [slowTool],
    permissionEngine: createToolPermissionEngine({
      defaultDecision: "ask",
      rules: [{ toolName: "slow_tool", decision: "allow", reason: "test allow" }],
    }),
  });
  const events: LoongEvent[] = [];
  const unsubscribe = runtime.subscribe(event => events.push(event));
  try {
    const turn = runtime.runTurn({
      sessionId: "cancel-during-tool",
      source: "cli",
      message: "start slow tool",
      signal: controller.signal,
    });
    await new Promise(resolve => setTimeout(resolve, 30));
    controller.abort();
    const result = await turn;
    assert(result.status === "cancelled", `cancel during tool should return cancelled (got ${result.status})`);
    assert(modelCalls === 1, "cancelled turn should not start a second model call");
    assert(toolStarted, "slow tool should have started before cancel");
    assert(
      events.some(event => event.type === "lifecycle" && event.phase === "cancelled"),
      "cancelled lifecycle event should be emitted",
    );
  } finally {
    unsubscribe();
  }
}


async function testSessionHistoryPrep(): Promise<void> {
  const history: ModelMessage[] = [
    { role: "user", content: "hello" },
    { role: "tool", content: "payload".repeat(3_000), toolCallId: "call_old" },
    { role: "assistant", content: "analysis".repeat(2_000) },
  ];
  const { messages, report } = await prepareSessionHistoryForModel(history, 4_000);
  assert(report.providerName === "session_history_prep", "session history prep report should be tagged");
  assert(report.truncatedToolResults >= 1, "historical tool output should be truncated");
  assert(messages[1]?.role === "tool", "tool message should remain in order");
  const toolContent = messages[1]?.content;
  assert(typeof toolContent === "string" && toolContent.length < 3_000, "tool content should shrink");
}


async function testSessionHistoryPrepSkipsWhenUnderBudget(): Promise<void> {
  const history: ModelMessage[] = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "short reply" },
  ];
  const { messages, report } = await prepareSessionHistoryForModel(history, 16_000);
  assert(report.compactionSkipped === true, "under-budget history should skip compaction");
  assert(report.truncatedToolResults === 0, "skipped prep should not truncate tools");
  assert(messages.length === history.length, "skipped prep should preserve message count");
  assert(messages[1]?.content === "short reply", "skipped prep should preserve message content");
}


async function testSessionHistoryPrepAlwaysPolicy(): Promise<void> {
  const history: ModelMessage[] = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "short reply" },
  ];
  const { report } = await prepareSessionHistoryForModel(history, 16_000, {}, { compactionPolicy: "always" });
  assert(report.compactionSkipped !== true, "always policy should run prep even when under budget");
}


async function testSessionMessageCompactionByTurn(): Promise<void> {
  const history: ModelMessage[] = [];
  for (let turn = 0; turn < 20; turn += 1) {
    history.push({ role: "user", content: `question ${turn}` });
    history.push({ role: "tool", content: "x".repeat(8_000), toolCallId: `call_${turn}` });
    history.push({ role: "assistant", content: `answer ${turn}` });
  }
  const beforeChars = estimateModelMessagesChars(history);
  const { messages, report } = compactSessionMessagesByTurn(history, { keepRecentTurns: 4, olderToolMaxChars: 400 });
  const afterChars = estimateModelMessagesChars(messages);
  assert(report.compactedToolMessages >= 12, "older tool messages should be compacted");
  assert(afterChars < beforeChars / 2, "compacted history should shrink substantially");
  const lastTool = messages.filter(message => message.role === "tool").at(-1);
  assert(typeof lastTool?.content === "string" && lastTool.content.length > 1_000, "recent turn tool output should stay large");
}


async function testAgentProfileMergeIntoTurnInput(): Promise<void> {
  const merged = mergeAgentProfileIntoTurnInput(
    { sessionId: "s1", source: "cli", message: "hi", model: "openai:gpt-4o" },
    {
      id: "coder",
      name: "Coder",
      defaultModel: "anthropic:claude-sonnet-4-5",
      toolsEnabled: false,
      thinking: "high",
      workspace: "/tmp/ws",
    },
  );
  assert(merged.model === "openai:gpt-4o", "explicit model should win over profile");
  assert(merged.toolsEnabled === false, "profile toolsEnabled should apply");
  assert(merged.thinking === "high", "profile thinking should apply");
  assert(merged.workspace === "/tmp/ws", "profile workspace should apply");
  assert(merged.metadata?.profileId === "coder", "profile id should be recorded in metadata");

  const withCompaction = mergeAgentProfileIntoTurnInput(
    { sessionId: "s1", source: "cli", message: "hi" },
    { id: "long", name: "Long", sessionCompaction: { keepRecentTurns: 2, olderToolMaxChars: 200 } },
  );
  assert(readPath(withCompaction.metadata, ["sessionCompaction", "keepRecentTurns"]) === 2, "profile sessionCompaction should be in metadata");
  const resolved = resolveSessionCompactionForTurn({ keepRecentTurns: 4 }, withCompaction);
  assert(resolved !== false && resolved.keepRecentTurns === 2, "profile compaction should override runtime default");

  const withAiSummary = mergeAgentProfileIntoTurnInput(
    { sessionId: "s1", source: "cli", message: "hi" },
    { id: "summary", name: "Summary", aiSummarization: { enabled: true, maxSummaryChars: 1500 } },
  );
  assert(readPath(withAiSummary.metadata, ["aiSummarization", "enabled"]) === true, "profile aiSummarization should be in metadata");
  const resolvedAi = resolveAiSummarizationForTurn({ enabled: false }, withAiSummary);
  assert(resolvedAi !== false && resolvedAi.enabled === true, "profile aiSummarization should override runtime default");
}


function createSummaryMockProvider(summaryText: string): ModelProvider {
  return {
    id: "summary-mock",
    displayName: "Summary Mock",
    supportsToolCalling: false,
    defaultModel: "mock-summary",
    async complete() {
      return { id: "sum-1", text: summaryText };
    },
  };
}


async function testAiSummarizationEnabled(): Promise<void> {
  const history: ModelMessage[] = [];
  for (let turn = 0; turn < 8; turn += 1) {
    history.push({ role: "user", content: `question ${turn}` });
    history.push({ role: "tool", content: `result-${turn}-`.repeat(500), toolCallId: `call_${turn}` });
    history.push({ role: "assistant", content: `answer ${turn}` });
  }
  const provider = createSummaryMockProvider("- decided to use TypeScript\n- edited packages/core/src/runtime.ts");
  const { messages, report } = await summarizeOldTurnsWithAI(history, {
    enabled: true,
    provider,
    model: "mock-summary",
    keepRecentTurns: 2,
  });
  assert(report.summarizedTurns === 6, "should summarize 6 older turns");
  assert(messages.length < history.length, "summarized history should shrink");
  assert(messages[0]?.role === "user", "summary should be injected as user message");
  const firstContent = messages[0]?.content;
  assert(typeof firstContent === "string" && firstContent.includes("AI summary"), "summary prefix should be present");
  assert(typeof firstContent === "string" && firstContent.includes("TypeScript"), "summary content should be preserved");
}


async function testAiSummarizationFallback(): Promise<void> {
  const history: ModelMessage[] = [
    { role: "user", content: "old" },
    { role: "assistant", content: "old reply" },
    { role: "user", content: "recent" },
    { role: "assistant", content: "recent reply" },
    { role: "user", content: "latest" },
    { role: "assistant", content: "latest reply" },
  ];
  const provider: ModelProvider = {
    id: "failing-mock",
    displayName: "Failing Mock",
    supportsToolCalling: false,
    defaultModel: "fail",
    async complete() {
      throw new Error("provider unavailable");
    },
  };
  const { messages, report } = await summarizeOldTurnsWithAI(history, {
    enabled: true,
    provider,
    model: "fail",
    keepRecentTurns: 1,
  });
  assert(report.error?.includes("provider unavailable"), "should record summarization error");
  assert(messages.length === history.length, "failed summarization should preserve original messages");
}


async function testAiSummarizationPipeline(): Promise<void> {
  const history: ModelMessage[] = [];
  for (let turn = 0; turn < 6; turn += 1) {
    history.push({ role: "user", content: `q${turn}` });
    history.push({ role: "tool", content: "x".repeat(5_000), toolCallId: `t${turn}` });
    history.push({ role: "assistant", content: `a${turn}` });
  }
  const provider = createSummaryMockProvider("compressed older context");
  const { messages, report } = await prepareSessionHistoryForModel(
    history,
    4_000,
    { keepRecentTurns: 2, olderToolMaxChars: 400 },
    {
      aiSummarization: {
        enabled: true,
        provider,
        model: "mock-summary",
        keepRecentTurns: 2,
      },
    },
  );
  assert(report.aiSummarization?.summarizedTurns === 4, "pipeline should run L1 before L2");
  const firstContent = messages[0]?.content;
  assert(typeof firstContent === "string" && firstContent.includes("compressed"), "summary should appear in final prep output");
}


async function testAiSummarizationDisabledByDefault(): Promise<void> {
  const history: ModelMessage[] = [
    { role: "user", content: "a" },
    { role: "assistant", content: "b" },
    { role: "user", content: "c" },
    { role: "assistant", content: "d" },
  ];
  const { messages, report } = await summarizeOldTurnsWithAI(history, {});
  assert(report.skipped === true, "disabled summarization should skip");
  assert(messages.length === history.length, "disabled summarization should not mutate messages");
}


async function testCoreRunTurnWithQueryLoop(): Promise<void> {
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
            metadata: needsContinue ? { queryLoopContinue: true } : { queryLoopDone: true },
          },
        ],
      };
    },
    subscribe() {
      return () => {};
    },
  };
  const { result, turnCount: loops } = await runTurnWithQueryLoop(runtime, {
    sessionId: "cli-query-loop",
    source: "cli",
    message: "finish the task",
    queryLoop: true,
  });
  assert(loops === 2, "runTurnWithQueryLoop should run two turns");
  assert(result.status === "ok", "query loop result should be ok");
  const assistant = result.messages.find(message => message.role === "assistant");
  assert(assistant?.content === "done", "final assistant content should be from continuation turn");
}


async function testRuntimeFailOnPermissionDeny(): Promise<void> {
  const provider: ModelProvider = {
    id: "mock-perm-deny",
    displayName: "Mock Perm Deny",
    defaultModel: "mock-perm-model",
    supportsToolCalling: true,
    async complete() {
      return {
        id: "tool-round",
        toolCalls: [{
          id: "call_patch",
          type: "function",
          function: { name: "file_patch", arguments: JSON.stringify({ path: "README.md", oldText: "a", newText: "b" }) },
        }],
      };
    },
  };
  const patchTool = createMockTool("file_patch", ["write"], async () => ({ ok: true }));
  const runtime = createLoongRuntime({
    providers: [provider],
    defaultModel: "mock-perm-model",
    tools: [patchTool],
    failOnPermissionDeny: true,
    permissionEngine: createToolPermissionEngine({ defaultDecision: "ask" }),
    denyAskWithoutHandler: true,
  });
  const result = await runtime.runTurn({
    sessionId: "fail-on-ask",
    source: "cli",
    message: "patch the readme",
  });
  assert(result.status === "error", `failOnPermissionDeny should error the turn (got ${result.status})`);
  assert(result.error?.includes("permission"), "error should mention permission denial");
}


export const runtimeTestCases: TestCase[] = [
  ["runtime model fallback", testRuntimeModelFallback],
  ["provider network error cause details", testProviderNetworkErrorCauseDetails],
  ["provider retries transient network failures", testProviderRetriesTransientNetworkFailures],
  ["tier classifier heuristic", testTierClassifierHeuristic],
  ["runtime tier overrides", testRuntimeTierOverrides],
  ["text tool call extraction", testTextToolCallExtraction],
  ["runtime tool-call loop", testRuntimeToolCallLoop],
  ["runtime parallel read-only tools", testRuntimeParallelReadOnlyTools],
  ["runtime parallel read streaming events", testRuntimeParallelReadStreamingEvents],
  ["parallel safe tool policy", testParallelSafeToolPolicy],
  ["turn prep pipeline", testTurnPrepPipeline],
  ["runtime turn prep reactive retry", testRuntimeTurnPrepReactiveRetry],
  ["runtime tool iteration limit graceful", testRuntimeToolIterationLimitGraceful],
  ["turn cancel protocol", testTurnCancelProtocol],
  ["runtime turn cancel during tool", testRuntimeTurnCancelDuringTool],
  ["session history prep", testSessionHistoryPrep],
  ["session history prep skips when under budget", testSessionHistoryPrepSkipsWhenUnderBudget],
  ["session history prep always policy", testSessionHistoryPrepAlwaysPolicy],
  ["session message compaction by turn", testSessionMessageCompactionByTurn],
  ["ai summarization enabled", testAiSummarizationEnabled],
  ["ai summarization fallback", testAiSummarizationFallback],
  ["ai summarization pipeline", testAiSummarizationPipeline],
  ["ai summarization disabled by default", testAiSummarizationDisabledByDefault],
  ["agent profile merge into turn input", testAgentProfileMergeIntoTurnInput],
  ["core runTurnWithQueryLoop", testCoreRunTurnWithQueryLoop],
  ["runtime fail on permission deny", testRuntimeFailOnPermissionDeny],
];
