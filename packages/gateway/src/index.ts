import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { getDashboardHtml, readDashboardAsset } from "./dashboard.js";
import type {
  DragonAgentRuntime,
  DragonEvent,
  DragonSource,
  DragonThinkingLevel,
  DragonTrajectoryRecord,
  DragonTurnInput,
  DragonTurnResult,
} from "@dragon/core";
import { parseCronSchedule, type DragonCronJob, type DragonCronJobStore, type DragonCronRunner } from "@dragon/cron";
import type { DragonModelCapabilities, DragonModelStatus } from "@dragon/model-catalog";
import {
  buildKpiSnapshot,
  type ApprovalRegistry,
  type ApprovalRequest,
  type ApprovalStatus,
  type ApprovalStore,
  type EmployeeRegistry,
  type EmployeeStore,
  type GatewayApprovalService,
  type KpiSnapshot,
  type KpiTemplateDocument,
  type KpiTemplateStore,
  type OrgDocument,
  type OrgStore,
  type OrgTicket,
  type TicketDocument,
  type TicketStore,
  type ToolPolicyDocument,
  type ToolPolicyStore,
} from "@dragon/org";
import {
  createToolPermissionEngine,
  createToolRegistry,
  type ToolDefinition,
  type ToolInvocation,
  type ToolPermissionEngine,
  type ToolPermissionResult,
  type ToolRegistry,
  type ToolResult,
} from "@dragon/tools";

export interface GatewayConfig {
  host?: string;
  port?: number;
  authMode?: "none" | "shared-secret";
  sharedSecret?: string;
}

export interface GatewayAddress {
  host: string;
  port: number;
  url: string;
}

export interface GatewayAgentAttachment {
  kind: "image" | "text" | "document";
  mimeType: string;
  /** base64-encoded bytes */
  data: string;
  name?: string;
  size?: number;
}

export interface GatewayAgentParams {
  sessionId: string;
  message: string;
  source?: DragonSource;
  workspace?: string;
  model?: string;
  thinking?: DragonThinkingLevel;
  profileId?: string;
  employeeId?: string;
  systemPrompt?: string;
  toolsEnabled?: boolean;
  memoryEnabled?: boolean;
  attachments?: GatewayAgentAttachment[];
  tier?: GatewayTierName;
  metadata?: Record<string, unknown>;
}

export interface GatewayWebhookParams extends GatewayAgentParams {
  channel: string;
  userId?: string;
  threadId?: string;
}

export interface GatewayEventEnvelope {
  type: "event";
  sequence: number;
  timestamp: string;
  sessionId?: string;
  event: DragonEvent;
}

export type GatewayRunState = "running" | "cancelling" | "completed" | "cancelled" | "timeout" | "error";

export interface GatewayRunRecord {
  runId: string;
  sessionId?: string;
  state: GatewayRunState;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  source?: DragonSource;
  messagePreview?: string;
  error?: string;
  result?: GatewayRunResultSummary;
}

export interface GatewayRunResultSummary {
  runId: string;
  status: DragonTurnResult["status"];
  messageCount: number;
  assistantPreview?: string;
  usage?: DragonTurnResult["usage"];
  error?: string;
}

export interface GatewayTrajectoryListParams {
  sessionId: string;
  status?: DragonTurnResult["status"];
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface GatewayTrajectoryGetParams {
  sessionId: string;
  runId: string;
  maxEvents?: number;
}

export interface GatewayTrajectoryStore {
  list(filter?: GatewayTrajectoryListParams): Promise<unknown>;
  get(
    runId: string,
    filter?: Pick<GatewayTrajectoryListParams, "sessionId" | "dateFrom" | "dateTo">,
  ): Promise<DragonTrajectoryRecord | undefined>;
}

export interface GatewayPluginToolSummary {
  name: string;
  description?: string;
  permission?: "allow" | "ask" | "deny";
  capabilities?: readonly string[];
}

export interface GatewayPluginProviderSummary {
  id: string;
  displayName: string;
  defaultModel?: string;
  supportsToolCalling: boolean;
  models?: readonly GatewayModelSummary[];
}

export interface GatewayProviderSummary extends GatewayPluginProviderSummary {}

export interface GatewayModelSummary {
  id: string;
  displayName?: string;
  aliases?: readonly string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: DragonModelCapabilities;
  status?: DragonModelStatus;
  default?: boolean;
}

export type GatewayModelProviderType = "openai-compatible" | "anthropic";

export interface GatewayModelProviderConfig {
  id: string;
  type: GatewayModelProviderType;
  displayName?: string;
  apiKey?: string;
  apiKeyConfigured?: boolean;
  baseUrl?: string;
  defaultModel?: string;
  supportsToolCalling?: boolean;
  enabled?: boolean;
}

export interface GatewayModelConfig {
  providers: readonly GatewayModelProviderConfig[];
  appliesOn: "restart";
  configPath?: string;
}

export interface GatewayModelConfigSaveParams {
  providers: readonly GatewayModelProviderConfig[];
}

export interface GatewayModelConfigStore {
  load(): Promise<GatewayModelConfig>;
  save(config: GatewayModelConfigSaveParams): Promise<GatewayModelConfig>;
}

// --- Tier scheduling ---------------------------------------------------------

export type GatewayTierName = "fast" | "standard" | "deep";

export type GatewayTierClassifierMode = "heuristic" | "fixed";

export interface GatewayTierSpec {
  model?: string;
  modelFallbacks?: readonly string[];
  thinking?: DragonThinkingLevel;
  maxContextChars?: number;
  toolsEnabled?: boolean;
  memoryEnabled?: boolean;
  systemPromptAddendum?: string;
}

export interface GatewayTierKeywordHint {
  tier: GatewayTierName;
  words: readonly string[];
}

export interface GatewayTierConfig {
  enabled: boolean;
  tiers: {
    fast?: GatewayTierSpec;
    standard?: GatewayTierSpec;
    deep?: GatewayTierSpec;
  };
  classifier: {
    mode: GatewayTierClassifierMode;
    fixedTier?: GatewayTierName;
    keywordHints?: readonly GatewayTierKeywordHint[];
  };
  appliesOn: "next-turn";
  configPath?: string;
}

export interface GatewayTierConfigSaveParams {
  enabled: boolean;
  tiers: {
    fast?: GatewayTierSpec;
    standard?: GatewayTierSpec;
    deep?: GatewayTierSpec;
  };
  classifier: {
    mode: GatewayTierClassifierMode;
    fixedTier?: GatewayTierName;
    keywordHints?: readonly GatewayTierKeywordHint[];
  };
}

export interface GatewayTierConfigStore {
  load(): Promise<GatewayTierConfig>;
  save(config: GatewayTierConfigSaveParams): Promise<GatewayTierConfig>;
  /**
   * Subscribed by the gateway so a save can hot-swap the runtime's tier
   * decisions for the next turn without restart.
   */
  onChange?(listener: (config: GatewayTierConfig) => void): () => void;
}

export interface GatewayTierClassifyParams {
  message: string;
  attachments?: readonly { kind: "image" | "text" | "document"; mimeType: string; size?: number }[];
  workspace?: string;
  toolsEnabled?: boolean;
  memoryRecallCount?: number;
  hasSkillLoaded?: boolean;
}

export interface GatewayTierClassifyResult {
  tier: GatewayTierName;
  source: "fixed" | "heuristic" | "inherited" | "explicit-input";
  score: number;
  reason: string;
  resolvedModel?: string;
  resolvedThinking?: DragonThinkingLevel;
  resolvedMaxContextChars?: number;
  resolvedToolsEnabled?: boolean;
  resolvedMemoryEnabled?: boolean;
}

export interface GatewayAgentProfileConfig {
  id: string;
  name: string;
  description?: string;
  defaultModel?: string;
  workspace?: string;
  thinking?: DragonThinkingLevel;
  memoryEnabled?: boolean;
  toolsEnabled?: boolean;
  systemPrompt?: string;
}

export interface GatewayAgentConfig {
  profiles: readonly GatewayAgentProfileConfig[];
  defaultProfileId?: string;
  configPath?: string;
}

export interface GatewayAgentConfigSaveParams {
  profiles: readonly GatewayAgentProfileConfig[];
  defaultProfileId?: string;
}

export interface GatewayAgentConfigStore {
  load(): Promise<GatewayAgentConfig>;
  save(config: GatewayAgentConfigSaveParams): Promise<GatewayAgentConfig>;
}

export type GatewayEmployeeSaveParams = EmployeeRegistry;

export type GatewayToolPolicySaveParams = ToolPolicyDocument;

export interface GatewayApprovalListParams {
  status?: ApprovalStatus;
}

export interface GatewayApprovalResolveParams {
  id: string;
  resolvedBy?: string;
  note?: string;
}

export interface GatewayKpiSnapshotParams {
  templateId: string;
  employeeId?: string;
}

export type GatewayTicketUpsertParams = OrgTicket;

export interface GatewayPluginMemoryBackendSummary {
  id: string;
  displayName: string;
}

export interface GatewayPluginSummary {
  name: string;
  version: string;
  description?: string;
  dragonVersion?: string;
  tools: readonly GatewayPluginToolSummary[];
  providers: readonly GatewayPluginProviderSummary[];
  memoryBackends?: readonly GatewayPluginMemoryBackendSummary[];
  lifecycleHooks?: readonly string[];
}

export interface GatewayToolSummary {
  name: string;
  description: string;
  capabilities?: readonly string[];
  permission?: "allow" | "ask" | "deny";
  inputSchema?: unknown;
  directInvokeAllowed: boolean;
}

export interface GatewayToolInvokeParams {
  toolName: string;
  input?: unknown;
  sessionId?: string;
  workspace?: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayMemoryCandidateListParams {
  status?: "pending" | "promoted" | "rejected" | "all";
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface GatewayMemoryCandidatePromoteParams {
  id: string;
  scope?: "user" | "project" | "session" | "skill";
  content?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayMemoryCandidateRejectParams {
  id: string;
  reason?: string;
}

export interface GatewayCronJobUpsertParams extends DragonCronJob {
  enabled?: boolean;
  nextRunAt?: string;
}

export interface GatewayCronJobRemoveParams {
  id: string;
}

export type GatewayRequest =
  | { type: "connect"; id: string; params?: Record<string, unknown> }
  | { type: "agent"; id: string; params: GatewayAgentParams }
  | { type: "health"; id: string }
  | { type: "run.status"; id: string; params: { runId: string } }
  | { type: "run.cancel"; id: string; params: { runId: string; reason?: string } }
  | { type: "runs.list"; id: string; params?: { sessionId?: string; limit?: number } }
  | { type: "providers.list"; id: string }
  | { type: "model.config.get"; id: string }
  | { type: "model.config.save"; id: string; params: GatewayModelConfigSaveParams }
  | { type: "agent.config.get"; id: string }
  | { type: "agent.config.save"; id: string; params: GatewayAgentConfigSaveParams }
  | { type: "org.get"; id: string }
  | { type: "employee.list"; id: string }
  | { type: "employee.save"; id: string; params: GatewayEmployeeSaveParams }
  | { type: "policy.tool.get"; id: string }
  | { type: "policy.tool.save"; id: string; params: GatewayToolPolicySaveParams }
  | { type: "approval.list"; id: string; params?: GatewayApprovalListParams }
  | { type: "approval.approve"; id: string; params: GatewayApprovalResolveParams }
  | { type: "approval.reject"; id: string; params: GatewayApprovalResolveParams }
  | { type: "ticket.list"; id: string }
  | { type: "ticket.upsert"; id: string; params: GatewayTicketUpsertParams }
  | { type: "kpi.template.list"; id: string }
  | { type: "kpi.snapshot.get"; id: string; params: GatewayKpiSnapshotParams }
  | { type: "tier.config.get"; id: string }
  | { type: "tier.config.save"; id: string; params: GatewayTierConfigSaveParams }
  | { type: "tier.classify"; id: string; params: GatewayTierClassifyParams }
  | { type: "plugins.list"; id: string }
  | { type: "tools.catalog"; id: string; params?: { includeSchemas?: boolean } }
  | { type: "tool.invoke"; id: string; params: GatewayToolInvokeParams }
  | { type: "memory.candidates.list"; id: string; params?: GatewayMemoryCandidateListParams }
  | { type: "memory.candidate.promote"; id: string; params: GatewayMemoryCandidatePromoteParams }
  | { type: "memory.candidate.reject"; id: string; params: GatewayMemoryCandidateRejectParams }
  | { type: "trajectory.list"; id: string; params: GatewayTrajectoryListParams }
  | { type: "trajectory.get"; id: string; params: GatewayTrajectoryGetParams }
  | { type: "cron.jobs.list"; id: string }
  | { type: "cron.job.upsert"; id: string; params: GatewayCronJobUpsertParams }
  | { type: "cron.job.remove"; id: string; params: GatewayCronJobRemoveParams }
  | { type: "cron.tick"; id: string };

export type GatewayResponse =
  | { type: "response"; id: string; ok: true; payload?: unknown }
  | { type: "response"; id: string; ok: false; error: string };

export type GatewayWebSocketEnvelope =
  | GatewayResponse
  | GatewayEventEnvelope
  | {
      type: "ready";
      clientId: string;
      filters: EventStreamFilters;
      protocolVersion: 1;
      serverTime: string;
    }
  | { type: "error"; error: string };

export interface DragonGateway {
  start(config?: GatewayConfig): Promise<void>;
  stop(): Promise<void>;
  address(): GatewayAddress | undefined;
}

export interface HttpDragonGatewayOptions {
  runtime: DragonAgentRuntime;
  cronStore?: DragonCronJobStore;
  cronRunner?: DragonCronRunner;
  trajectoryStore?: GatewayTrajectoryStore;
  pluginSummaries?: readonly GatewayPluginSummary[];
  providerSummaries?: readonly GatewayProviderSummary[];
  modelConfigStore?: GatewayModelConfigStore;
  agentConfigStore?: GatewayAgentConfigStore;
  orgStore?: OrgStore;
  employeeStore?: EmployeeStore;
  toolPolicyStore?: ToolPolicyStore;
  approvalService?: GatewayApprovalService;
  approvalStore?: ApprovalStore;
  ticketStore?: TicketStore;
  kpiTemplateStore?: KpiTemplateStore;
  tierConfigStore?: GatewayTierConfigStore;
  /**
   * Notified when a save-tier-config RPC completes successfully. The CLI
   * binds this to rebuild the runtime's #tierConfig field so changes take
   * effect on the next turn without process restart.
   */
  onTierConfigChange?: (config: GatewayTierConfig) => void;
  tools?: readonly ToolDefinition[];
  toolRegistry?: ToolRegistry;
  permissionEngine?: ToolPermissionEngine;
  directToolNames?: readonly string[];
  name?: string;
}

interface NormalizedGatewayConfig {
  host: string;
  port: number;
  authMode: "none" | "shared-secret";
  sharedSecret?: string;
}

interface EventStreamClient {
  id: string;
  response: ServerResponse;
  filters: EventStreamFilters;
  heartbeat: NodeJS.Timeout;
}

interface WebSocketClient {
  id: string;
  socket: Duplex;
  filters: EventStreamFilters;
  heartbeat: NodeJS.Timeout;
  buffer: Buffer;
  closed: boolean;
}

export interface EventStreamFilters {
  sessionId?: string;
  runId?: string;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17357;
// 32 MB request body cap. Large enough to carry up to ~10 image attachments
// (base64-encoded, ~14 MB raw budget enforced separately per attachment in
// parseGatewayAttachments).
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_RUN_RECORDS = 200;
const MAX_DIRECT_TOOL_RESULT_BYTES = 256_000;
const MAX_DIRECT_TOOL_PREVIEW_BYTES = 64_000;
// Match HTTP body limit so WebSocket RPC can carry attachments too.
const MAX_WEBSOCKET_MESSAGE_BYTES = MAX_REQUEST_BYTES;
const MAX_WEBSOCKET_BUFFER_BYTES = MAX_REQUEST_BYTES * 2;
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const WEBSOCKET_PROTOCOL = "dragon.gateway.v1";
const DEFAULT_TOOL_SESSION_ID = "gateway-tools";
const DEFAULT_MEMORY_REVIEW_SESSION_ID = "gateway-memory-review";
const DEFAULT_DIRECT_TOOL_NAMES = Object.freeze(["git_status", "git_diff", "git_log"]);

export function createHttpGateway(options: HttpDragonGatewayOptions): DragonGateway {
  return new HttpDragonGateway(options);
}

export class HttpDragonGateway implements DragonGateway {
  readonly #runtime: DragonAgentRuntime;
  readonly #cronStore: DragonCronJobStore | undefined;
  readonly #cronRunner: DragonCronRunner | undefined;
  readonly #trajectoryStore: GatewayTrajectoryStore | undefined;
  readonly #plugins: readonly GatewayPluginSummary[];
  readonly #providers: readonly GatewayProviderSummary[];
  readonly #modelConfigStore: GatewayModelConfigStore | undefined;
  readonly #agentConfigStore: GatewayAgentConfigStore | undefined;
  readonly #orgStore: OrgStore | undefined;
  readonly #employeeStore: EmployeeStore | undefined;
  readonly #toolPolicyStore: ToolPolicyStore | undefined;
  readonly #approvalService: GatewayApprovalService | undefined;
  readonly #approvalStore: ApprovalStore | undefined;
  readonly #ticketStore: TicketStore | undefined;
  readonly #kpiTemplateStore: KpiTemplateStore | undefined;
  readonly #tierConfigStore: GatewayTierConfigStore | undefined;
  readonly #onTierConfigChange: ((config: GatewayTierConfig) => void) | undefined;
  readonly #toolRegistry: ToolRegistry;
  readonly #permissionEngine: ToolPermissionEngine;
  readonly #directToolNames: ReadonlySet<string>;
  readonly #name: string;
  readonly #lanes = new Map<string, Promise<void>>();
  readonly #eventClients = new Map<string, EventStreamClient>();
  readonly #webSocketClients = new Map<string, WebSocketClient>();
  readonly #runSessions = new Map<string, string>();
  readonly #runs = new Map<string, GatewayRunRecord>();
  readonly #runControllers = new Map<string, AbortController>();
  #eventSequence = 0;
  #server: Server | undefined;
  #config: NormalizedGatewayConfig | undefined;
  #startedAt: string | undefined;
  #address: GatewayAddress | undefined;
  #runtimeUnsubscribe: (() => void) | undefined;

  constructor(options: HttpDragonGatewayOptions) {
    this.#runtime = options.runtime;
    this.#cronStore = options.cronStore;
    this.#cronRunner = options.cronRunner;
    this.#trajectoryStore = options.trajectoryStore;
    this.#plugins = normalizePluginSummaries(options.pluginSummaries ?? []);
    this.#providers = normalizeProviderSummaries(options.providerSummaries ?? []);
    this.#modelConfigStore = options.modelConfigStore;
    this.#agentConfigStore = options.agentConfigStore;
    this.#orgStore = options.orgStore;
    this.#employeeStore = options.employeeStore;
    this.#toolPolicyStore = options.toolPolicyStore;
    this.#approvalService = options.approvalService;
    this.#approvalStore = options.approvalStore;
    this.#ticketStore = options.ticketStore;
    this.#kpiTemplateStore = options.kpiTemplateStore;
    this.#tierConfigStore = options.tierConfigStore;
    this.#onTierConfigChange = options.onTierConfigChange;
    this.#toolRegistry = options.toolRegistry ?? createToolRegistry([...(options.tools ?? [])]);
    this.#permissionEngine = options.permissionEngine ?? createToolPermissionEngine({ defaultDecision: "deny" });
    this.#directToolNames = new Set(options.directToolNames ?? DEFAULT_DIRECT_TOOL_NAMES);
    this.#name = options.name ?? "dragon-gateway";
  }

  async start(config: GatewayConfig = {}): Promise<void> {
    if (this.#server) {
      throw new Error("Gateway is already started.");
    }
    const normalized = normalizeConfig(config);
    const server = createServer((request, response) => {
      this.#handleRequest(request, response).catch(error => {
        writeJson(response, errorToStatusCode(error), {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
    server.on("upgrade", (request, socket, head) => {
      this.#handleUpgrade(request, socket, head);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(normalized.port, normalized.host, () => {
        server.off("error", reject);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Gateway failed to resolve listening address.");
    }

    this.#server = server;
    this.#config = normalized;
    this.#startedAt = new Date().toISOString();
    this.#address = {
      host: normalized.host,
      port: address.port,
      url: `http://${normalized.host}:${address.port}`,
    };
    this.#runtimeUnsubscribe = this.#runtime.subscribe(event => {
      this.#broadcastRuntimeEvent(event);
    });
    if (normalized.authMode === "none") {
      console.error(
        `[${this.#name}] WARNING: Gateway auth is disabled. Set sharedSecret (or authMode: "shared-secret") before exposing this server beyond localhost.`,
      );
    }
  }

  async stop(): Promise<void> {
    const server = this.#server;
    if (!server) {
      return;
    }
    this.#runtimeUnsubscribe?.();
    this.#runtimeUnsubscribe = undefined;
    this.#closeEventStreams();
    this.#closeWebSocketClients();
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    this.#server = undefined;
    this.#config = undefined;
    this.#startedAt = undefined;
    this.#address = undefined;
  }

  address(): GatewayAddress | undefined {
    return this.#address;
  }

  async #resolveAgentParams(params: GatewayAgentParams): Promise<GatewayAgentParams> {
    let resolved = await resolveAgentParamsWithProfile(params, this.#agentConfigStore);
    if (params.employeeId?.trim() && this.#employeeStore) {
      const registry = await this.#employeeStore.load();
      const employee = registry.employees.find(entry => entry.id === params.employeeId!.trim());
      if (employee) {
        resolved = {
          ...resolved,
          profileId: resolved.profileId ?? employee.profileId,
          metadata: {
            ...(resolved.metadata ?? {}),
            employeeId: employee.id,
            employeeDisplayName: employee.displayName,
            employeePositionId: employee.positionId,
            employeeUnitId: employee.unitId,
            ...(employee.managerId ? { employeeManagerId: employee.managerId } : {}),
          },
        };
      }
    }
    return resolved;
  }

  async #handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    applyCors(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", "http://dragon.local");
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
      writeHtml(response, 200, getDashboardHtml());
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
      const asset = readDashboardAsset(url.pathname.slice(1));
      if (asset) {
        response.writeHead(200, {
          "Content-Type": asset.contentType,
          "Cache-Control": "public, max-age=3600",
        });
        response.end(asset.body);
        return;
      }
      writeJson(response, 404, { ok: false, error: "Not found." });
      return;
    }

    if (!this.#isAuthorized(request)) {
      writeJson(response, 401, { ok: false, error: "Unauthorized." });
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, this.#healthPayload());
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      this.#openEventStream(request, response, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/channels/webhook") {
      const payload = await this.#runWebhook(await readJsonBody(request));
      writeJson(response, 200, { ok: true, payload });
      return;
    }

    if (request.method === "POST" && url.pathname === "/rpc") {
      const gatewayRequest = parseGatewayRequest(await readJsonBody(request));
      const gatewayResponse = await this.#handleRpc(gatewayRequest);
      writeJson(response, gatewayResponse.ok ? 200 : 400, gatewayResponse);
      return;
    }

    writeJson(response, 404, { ok: false, error: "Not found." });
  }

  #handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? "/", "http://dragon.local");
    if (url.pathname !== "/ws") {
      rejectWebSocketUpgrade(socket, 404, "Not Found");
      return;
    }
    if (!this.#isAuthorized(request)) {
      rejectWebSocketUpgrade(socket, 401, "Unauthorized");
      return;
    }
    const key = readSingleHeader(request, "sec-websocket-key");
    if (!isValidWebSocketUpgrade(request, key)) {
      rejectWebSocketUpgrade(socket, 400, "Bad Request");
      return;
    }

    const protocols = readWebSocketProtocols(request);
    const selectedProtocol = protocols.includes(WEBSOCKET_PROTOCOL) ? WEBSOCKET_PROTOCOL : undefined;
    const accept = createHash("sha1")
      .update(`${key}${WEBSOCKET_GUID}`)
      .digest("base64");
    const responseHeaders = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      ...(selectedProtocol ? [`Sec-WebSocket-Protocol: ${selectedProtocol}`] : []),
      "",
      "",
    ];
    socket.write(responseHeaders.join("\r\n"));

    const clientId = randomUUID();
    const client: WebSocketClient = {
      id: clientId,
      socket,
      filters: parseEventStreamFilters(url),
      heartbeat: setInterval(() => {
        if (!client.closed) {
          sendWebSocketFrame(client, 0x9, Buffer.alloc(0));
        }
      }, 15_000),
      buffer: Buffer.alloc(0),
      closed: false,
    };
    this.#webSocketClients.set(clientId, client);
    sendWebSocketJson(client, {
      type: "ready",
      clientId,
      filters: client.filters,
      protocolVersion: 1,
      serverTime: new Date().toISOString(),
    });

    socket.on("data", chunk => {
      this.#handleWebSocketData(client, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    socket.on("close", () => {
      this.#removeWebSocketClient(client.id);
    });
    socket.on("error", () => {
      this.#removeWebSocketClient(client.id);
    });
    if (head.length > 0) {
      this.#handleWebSocketData(client, head);
    }
  }

  #handleWebSocketData(client: WebSocketClient, chunk: Buffer): void {
    if (client.closed) {
      return;
    }
    client.buffer = Buffer.concat([client.buffer, chunk]);
    if (client.buffer.byteLength > MAX_WEBSOCKET_BUFFER_BYTES) {
      closeWebSocketClient(client, 1009, "WebSocket buffer limit exceeded.");
      this.#removeWebSocketClient(client.id);
      return;
    }

    let parsed: ParsedWebSocketFrames;
    try {
      parsed = parseWebSocketFrames(client.buffer);
    } catch (error) {
      closeWebSocketClient(client, 1002, error instanceof Error ? error.message : String(error));
      this.#removeWebSocketClient(client.id);
      return;
    }
    client.buffer = parsed.remaining;

    for (const frame of parsed.frames) {
      if (frame.opcode === 0x8) {
        closeWebSocketClient(client, 1000, "Normal closure.");
        this.#removeWebSocketClient(client.id);
        return;
      }
      if (frame.opcode === 0x9) {
        sendWebSocketFrame(client, 0xA, frame.payload);
        continue;
      }
      if (frame.opcode === 0xA) {
        continue;
      }
      if (frame.opcode === 0x1) {
        this.#handleWebSocketText(client, frame.payload.toString("utf8")).catch(error => {
          sendWebSocketJson(client, {
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        });
        continue;
      }
      closeWebSocketClient(client, 1003, "Unsupported WebSocket frame.");
      this.#removeWebSocketClient(client.id);
      return;
    }
  }

  async #handleWebSocketText(client: WebSocketClient, text: string): Promise<void> {
    let request: GatewayRequest;
    try {
      request = parseGatewayRequest(JSON.parse(text) as unknown);
    } catch (error) {
      sendWebSocketJson(client, {
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const response = await this.#handleRpc(request);
    if (!sendWebSocketJson(client, response)) {
      sendWebSocketJson(client, {
        type: "response",
        id: request.id,
        ok: false,
        error: `WebSocket response exceeds ${MAX_WEBSOCKET_MESSAGE_BYTES} bytes.`,
      });
    }
  }

  #isAuthorized(request: IncomingMessage): boolean {
    const config = this.#config;
    if (!config || config.authMode !== "shared-secret") {
      return true;
    }

    const authorization = request.headers.authorization;
    const bearer = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
    const headerSecret = request.headers["x-dragon-secret"];
    return bearer === config.sharedSecret || headerSecret === config.sharedSecret;
  }

  async #handleRpc(request: GatewayRequest): Promise<GatewayResponse> {
    try {
      if (request.type === "health") {
        return { type: "response", id: request.id, ok: true, payload: this.#healthPayload() };
      }
      if (request.type === "connect") {
        return {
          type: "response",
          id: request.id,
          ok: true,
          payload: {
            protocolVersion: 1,
            serverTime: new Date().toISOString(),
            capabilities: [
              "health",
              "connect",
              "agent.run",
              "events.in-response",
              "events.sse",
              "events.websocket",
              "channels.webhook",
              "run.status",
              "run.cancel",
              "runs.list",
              "providers.list",
              ...(this.#modelConfigStore ? ["model.config.get", "model.config.save"] : []),
              ...(this.#agentConfigStore ? ["agent.config.get", "agent.config.save"] : []),
              ...(this.#orgStore ? ["org.get"] : []),
              ...(this.#employeeStore ? ["employee.list", "employee.save"] : []),
              ...(this.#toolPolicyStore ? ["policy.tool.get", "policy.tool.save"] : []),
              ...(this.#approvalService ? ["approval.list", "approval.approve", "approval.reject"] : []),
              ...(this.#ticketStore ? ["ticket.list", "ticket.upsert"] : []),
              ...(this.#kpiTemplateStore ? ["kpi.template.list", "kpi.snapshot.get"] : []),
              ...(this.#tierConfigStore ? ["tier.config.get", "tier.config.save", "tier.classify"] : []),
              "plugins.list",
              "tools.catalog",
              "tool.invoke",
              ...(this.#toolRegistry.has("memory_candidates_list") ? ["memory.candidates.list"] : []),
              ...(this.#toolRegistry.has("memory_candidate_promote") ? ["memory.candidate.promote"] : []),
              ...(this.#toolRegistry.has("memory_candidate_reject") ? ["memory.candidate.reject"] : []),
              ...(this.#trajectoryStore ? ["trajectory.list", "trajectory.get"] : []),
              ...(this.#cronStore ? ["cron.jobs.list", "cron.job.upsert", "cron.job.remove"] : []),
              ...(this.#cronRunner ? ["cron.tick"] : []),
            ],
          },
        };
      }
      if (request.type === "run.status") {
        return { type: "response", id: request.id, ok: true, payload: this.#getRunStatus(request.params.runId) };
      }
      if (request.type === "run.cancel") {
        return { type: "response", id: request.id, ok: true, payload: this.#cancelRun(request.params.runId, request.params.reason) };
      }
      if (request.type === "runs.list") {
        return { type: "response", id: request.id, ok: true, payload: this.#listRuns(request.params) };
      }
      if (request.type === "providers.list") {
        return { type: "response", id: request.id, ok: true, payload: this.#listProviders() };
      }
      if (request.type === "model.config.get") {
        return { type: "response", id: request.id, ok: true, payload: await this.#loadModelConfig() };
      }
      if (request.type === "model.config.save") {
        return { type: "response", id: request.id, ok: true, payload: await this.#saveModelConfig(request.params) };
      }
      if (request.type === "agent.config.get") {
        return { type: "response", id: request.id, ok: true, payload: await this.#loadAgentConfig() };
      }
      if (request.type === "agent.config.save") {
        return { type: "response", id: request.id, ok: true, payload: await this.#saveAgentConfig(request.params) };
      }
      if (request.type === "org.get") {
        return { type: "response", id: request.id, ok: true, payload: await this.#loadOrg() };
      }
      if (request.type === "employee.list") {
        return { type: "response", id: request.id, ok: true, payload: await this.#loadEmployees() };
      }
      if (request.type === "employee.save") {
        return { type: "response", id: request.id, ok: true, payload: await this.#saveEmployees(request.params) };
      }
      if (request.type === "policy.tool.get") {
        return { type: "response", id: request.id, ok: true, payload: await this.#loadToolPolicies() };
      }
      if (request.type === "policy.tool.save") {
        return { type: "response", id: request.id, ok: true, payload: await this.#saveToolPolicies(request.params) };
      }
      if (request.type === "approval.list") {
        return { type: "response", id: request.id, ok: true, payload: await this.#listApprovals(request.params) };
      }
      if (request.type === "approval.approve") {
        return { type: "response", id: request.id, ok: true, payload: await this.#approveRequest(request.params) };
      }
      if (request.type === "approval.reject") {
        return { type: "response", id: request.id, ok: true, payload: await this.#rejectRequest(request.params) };
      }
      if (request.type === "ticket.list") {
        return { type: "response", id: request.id, ok: true, payload: await this.#loadTickets() };
      }
      if (request.type === "ticket.upsert") {
        return { type: "response", id: request.id, ok: true, payload: await this.#upsertTicket(request.params) };
      }
      if (request.type === "kpi.template.list") {
        return { type: "response", id: request.id, ok: true, payload: await this.#loadKpiTemplates() };
      }
      if (request.type === "kpi.snapshot.get") {
        return { type: "response", id: request.id, ok: true, payload: await this.#loadKpiSnapshot(request.params) };
      }
      if (request.type === "tier.config.get") {
        return { type: "response", id: request.id, ok: true, payload: await this.#loadTierConfig() };
      }
      if (request.type === "tier.config.save") {
        return { type: "response", id: request.id, ok: true, payload: await this.#saveTierConfig(request.params) };
      }
      if (request.type === "tier.classify") {
        return { type: "response", id: request.id, ok: true, payload: await this.#classifyTier(request.params) };
      }
      if (request.type === "plugins.list") {
        return { type: "response", id: request.id, ok: true, payload: this.#listPlugins() };
      }
      if (request.type === "tools.catalog") {
        return { type: "response", id: request.id, ok: true, payload: this.#listTools(request.params) };
      }
      if (request.type === "tool.invoke") {
        return { type: "response", id: request.id, ok: true, payload: await this.#invokeTool(request.params) };
      }
      if (request.type === "memory.candidates.list") {
        return { type: "response", id: request.id, ok: true, payload: await this.#listMemoryCandidates(request.params) };
      }
      if (request.type === "memory.candidate.promote") {
        return { type: "response", id: request.id, ok: true, payload: await this.#promoteMemoryCandidate(request.params) };
      }
      if (request.type === "memory.candidate.reject") {
        return { type: "response", id: request.id, ok: true, payload: await this.#rejectMemoryCandidate(request.params) };
      }
      if (request.type === "trajectory.list") {
        return { type: "response", id: request.id, ok: true, payload: await this.#listTrajectories(request.params) };
      }
      if (request.type === "trajectory.get") {
        return { type: "response", id: request.id, ok: true, payload: await this.#getTrajectory(request.params) };
      }
      if (request.type === "cron.jobs.list") {
        return { type: "response", id: request.id, ok: true, payload: await this.#listCronJobs() };
      }
      if (request.type === "cron.job.upsert") {
        return { type: "response", id: request.id, ok: true, payload: await this.#upsertCronJob(request.params) };
      }
      if (request.type === "cron.job.remove") {
        return { type: "response", id: request.id, ok: true, payload: await this.#removeCronJob(request.params) };
      }
      if (request.type === "cron.tick") {
        return { type: "response", id: request.id, ok: true, payload: await this.#tickCron() };
      }
      const payload = await this.#runAgent(request.params);
      return { type: "response", id: request.id, ok: true, payload };
    } catch (error) {
      return {
        type: "response",
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async #runAgent(params: GatewayAgentParams): Promise<{ result: unknown; events: DragonEvent[] }> {
    const resolvedParams = await this.#resolveAgentParams(params);
    const input = toTurnInput(resolvedParams);
    return await this.#runInLane(input.sessionId, async () => {
      const events: DragonEvent[] = [];
      const controller = new AbortController();
      const unsubscribe = this.#runtime.subscribe(event => {
        events.push(event);
      });
      let untrackRun: () => void = () => {};
      try {
        let runId: string | undefined;
        untrackRun = this.#runtime.subscribe(event => {
          if (event.type === "lifecycle" && event.phase === "start") {
            runId = event.runId;
            this.#registerRunStart(event.runId, input, controller);
            untrackRun();
          }
        });
        try {
          const result = await this.#runtime.runTurn({ ...input, signal: controller.signal });
          this.#completeRun(result.runId, result);
          this.#runSessions.delete(result.runId);
          if (runId !== undefined && runId !== result.runId) {
            this.#runSessions.delete(runId);
          }
          return {
            result,
            events: events.filter(event => event.runId === result.runId),
          };
        } catch (error) {
          if (runId !== undefined) {
            this.#failRun(runId, error, controller.signal.aborted ? "cancelled" : "error");
            this.#runSessions.delete(runId);
          }
          throw error;
        }
      } finally {
        untrackRun();
        unsubscribe();
      }
    });
  }

  async #runWebhook(value: unknown): Promise<{ channel: string; result: unknown; events: DragonEvent[] }> {
    const webhook = parseGatewayWebhookParams(value);
    const payload = await this.#runAgent(webhook);
    return {
      channel: webhook.channel,
      ...payload,
    };
  }

  #registerRunStart(runId: string, input: DragonTurnInput, controller: AbortController): void {
    const now = new Date().toISOString();
    this.#runSessions.set(runId, input.sessionId);
    this.#runControllers.set(runId, controller);
    this.#runs.set(runId, {
      runId,
      sessionId: input.sessionId,
      state: "running",
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      source: input.source,
      messagePreview: previewMessage(input.message),
    });
    this.#pruneRuns();
  }

  #completeRun(runId: string, result: DragonTurnResult): void {
    const now = new Date().toISOString();
    const existing = this.#runs.get(runId);
    const state = resultStatusToRunState(result.status);
    const record: GatewayRunRecord = {
      runId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      completedAt: now,
      state,
      ...(result.error !== undefined ? { error: result.error } : {}),
      result: summarizeTurnResult(result),
    };
    if (existing?.sessionId !== undefined) {
      record.sessionId = existing.sessionId;
    }
    if (existing?.startedAt !== undefined) {
      record.startedAt = existing.startedAt;
    }
    if (existing?.source !== undefined) {
      record.source = existing.source;
    }
    if (existing?.messagePreview !== undefined) {
      record.messagePreview = existing.messagePreview;
    }
    this.#runs.set(runId, record);
    this.#runControllers.delete(runId);
    this.#pruneRuns();
  }

  #failRun(runId: string, error: unknown, state: Extract<GatewayRunState, "cancelled" | "error">): void {
    const now = new Date().toISOString();
    const existing = this.#runs.get(runId);
    const message = error instanceof Error ? error.message : String(error);
    const record: GatewayRunRecord = {
      runId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      completedAt: now,
      state,
      error: message,
    };
    if (existing?.sessionId !== undefined) {
      record.sessionId = existing.sessionId;
    }
    if (existing?.startedAt !== undefined) {
      record.startedAt = existing.startedAt;
    }
    if (existing?.source !== undefined) {
      record.source = existing.source;
    }
    if (existing?.messagePreview !== undefined) {
      record.messagePreview = existing.messagePreview;
    }
    this.#runs.set(runId, record);
    this.#runControllers.delete(runId);
    this.#pruneRuns();
  }

  #getRunStatus(runId: string): GatewayRunRecord {
    const record = this.#runs.get(runId);
    if (!record) {
      throw new Error(`Unknown run: ${runId}`);
    }
    return record;
  }

  #cancelRun(runId: string, reason: string | undefined): { cancelled: boolean; run: GatewayRunRecord } {
    const record = this.#runs.get(runId);
    if (!record) {
      throw new Error(`Unknown run: ${runId}`);
    }
    const controller = this.#runControllers.get(runId);
    if (!controller) {
      return { cancelled: false, run: record };
    }

    controller.abort(reason ?? "Cancelled through gateway RPC.");
    const updated: GatewayRunRecord = {
      ...record,
      state: "cancelling",
      updatedAt: new Date().toISOString(),
    };
    this.#runs.set(runId, updated);
    return { cancelled: true, run: updated };
  }

  #listRuns(params: { sessionId?: string; limit?: number } | undefined): { runs: GatewayRunRecord[] } {
    const limit = Math.min(Math.max(1, Math.floor(params?.limit ?? 50)), MAX_RUN_RECORDS);
    const runs = [...this.#runs.values()]
      .filter(run => params?.sessionId === undefined || run.sessionId === params.sessionId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
    return { runs };
  }

  async #listTrajectories(params: GatewayTrajectoryListParams): Promise<unknown> {
    if (!this.#trajectoryStore) {
      throw new Error("Trajectory store is not configured.");
    }
    return await this.#trajectoryStore.list({
      sessionId: params.sessionId,
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.dateFrom !== undefined ? { dateFrom: params.dateFrom } : {}),
      ...(params.dateTo !== undefined ? { dateTo: params.dateTo } : {}),
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
    });
  }

  async #getTrajectory(params: GatewayTrajectoryGetParams): Promise<{ record: DragonTrajectoryRecord; eventsTruncated: boolean }> {
    if (!this.#trajectoryStore) {
      throw new Error("Trajectory store is not configured.");
    }
    const record = await this.#trajectoryStore.get(params.runId, { sessionId: params.sessionId });
    if (!record) {
      throw new Error(`Unknown trajectory: ${params.runId}`);
    }
    const maxEvents = Math.min(Math.max(1, Math.floor(params.maxEvents ?? 200)), 1000);
    const eventsTruncated = record.events.length > maxEvents;
    return {
      record: eventsTruncated ? { ...record, events: record.events.slice(-maxEvents) } : record,
      eventsTruncated,
    };
  }

  async #listCronJobs(): Promise<{ jobs: unknown[] }> {
    if (!this.#cronStore) {
      throw new Error("Cron store is not configured.");
    }
    const jobs = await this.#cronStore.list();
    return {
      jobs: jobs.sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt)),
    };
  }

  async #upsertCronJob(params: GatewayCronJobUpsertParams): Promise<{ job: unknown }> {
    if (!this.#cronStore) {
      throw new Error("Cron store is not configured.");
    }
    const job = await this.#cronStore.upsert(params);
    return { job };
  }

  async #removeCronJob(params: GatewayCronJobRemoveParams): Promise<{ removed: boolean }> {
    if (!this.#cronStore) {
      throw new Error("Cron store is not configured.");
    }
    return { removed: await this.#cronStore.remove(params.id) };
  }

  async #tickCron(): Promise<unknown> {
    const runner = this.#cronRunner;
    if (!runner) {
      throw new Error("Cron runner is not configured.");
    }
    // Serialize manual ticks against any other lane-bound work so a dashboard
    // user clicking "tick" cannot double-execute a job that the automatic
    // runner is already firing on the same instant.
    return await this.#runInLane("__cron__", () => runner.tick());
  }

  #pruneRuns(): void {
    if (this.#runs.size <= MAX_RUN_RECORDS) {
      return;
    }
    for (const [runId, run] of this.#runs) {
      if (this.#runs.size <= MAX_RUN_RECORDS) {
        return;
      }
      if (run.state === "running" || run.state === "cancelling") {
        continue;
      }
      this.#runs.delete(runId);
    }
  }

  #openEventStream(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): void {
    const filters = parseEventStreamFilters(url);
    const clientId = randomUUID();
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write(": connected\n\n");
    writeSse(response, "ready", {
      type: "ready",
      clientId,
      filters,
      serverTime: new Date().toISOString(),
    });

    const heartbeat = setInterval(() => {
      if (!response.destroyed) {
        response.write(": heartbeat\n\n");
      }
    }, 15_000);

    const client: EventStreamClient = {
      id: clientId,
      response,
      filters,
      heartbeat,
    };
    this.#eventClients.set(clientId, client);

    request.on("close", () => {
      this.#removeEventStreamClient(clientId);
    });
  }

  #broadcastRuntimeEvent(event: DragonEvent): void {
    if (this.#eventClients.size === 0 && this.#webSocketClients.size === 0) {
      return;
    }
    const sessionId = this.#runSessions.get(event.runId) ?? readEventSessionId(event);
    const envelope: GatewayEventEnvelope = {
      type: "event",
      sequence: ++this.#eventSequence,
      timestamp: new Date().toISOString(),
      event,
    };
    if (sessionId !== undefined) {
      envelope.sessionId = sessionId;
    }

    for (const client of this.#eventClients.values()) {
      if (!matchesEventFilters(envelope, client.filters)) {
        continue;
      }
      try {
        writeSse(client.response, "dragon.event", envelope);
      } catch {
        this.#removeEventStreamClient(client.id);
      }
    }
    for (const client of this.#webSocketClients.values()) {
      if (!matchesEventFilters(envelope, client.filters)) {
        continue;
      }
      if (!sendWebSocketJson(client, envelope)) {
        sendWebSocketJson(client, {
          type: "error",
          error: `Gateway event exceeds ${MAX_WEBSOCKET_MESSAGE_BYTES} bytes and was skipped.`,
        });
      }
    }
  }

  #removeEventStreamClient(clientId: string): void {
    const client = this.#eventClients.get(clientId);
    if (!client) {
      return;
    }
    clearInterval(client.heartbeat);
    this.#eventClients.delete(clientId);
  }

  #closeEventStreams(): void {
    for (const client of this.#eventClients.values()) {
      clearInterval(client.heartbeat);
      if (!client.response.destroyed) {
        writeSse(client.response, "close", {
          type: "close",
          reason: "gateway_stopped",
          serverTime: new Date().toISOString(),
        });
        client.response.end();
      }
    }
    this.#eventClients.clear();
  }

  #removeWebSocketClient(clientId: string): void {
    const client = this.#webSocketClients.get(clientId);
    if (!client) {
      return;
    }
    clearInterval(client.heartbeat);
    client.closed = true;
    this.#webSocketClients.delete(clientId);
  }

  #closeWebSocketClients(): void {
    for (const client of this.#webSocketClients.values()) {
      clearInterval(client.heartbeat);
      closeWebSocketClient(client, 1001, "Gateway stopped.");
    }
    this.#webSocketClients.clear();
  }

  async #runInLane<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#lanes.get(sessionId) ?? Promise.resolve();
    let releaseCurrent: () => void = () => {};
    const current = new Promise<void>(resolve => {
      releaseCurrent = resolve;
    });
    const next = previous.catch(() => undefined).then(() => current);
    this.#lanes.set(sessionId, next);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      releaseCurrent();
      if (this.#lanes.get(sessionId) === next) {
        this.#lanes.delete(sessionId);
      }
    }
  }

  #healthPayload(): Record<string, unknown> {
    const startedAt = this.#startedAt;
    return {
      ok: true,
      name: this.#name,
      startedAt,
      uptimeMs: startedAt ? Date.now() - Date.parse(startedAt) : 0,
      address: this.#address,
      pluginCount: this.#plugins.length,
      providerCount: this.#providers.length,
    };
  }

  #listProviders(): { providers: readonly GatewayProviderSummary[] } {
    return {
      providers: this.#providers.map(provider => ({ ...provider })),
    };
  }

  async #loadModelConfig(): Promise<GatewayModelConfig> {
    if (!this.#modelConfigStore) {
      throw new GatewayHttpError(404, "Model configuration store is not available.");
    }
    return sanitizeModelConfig(await this.#modelConfigStore.load());
  }

  async #saveModelConfig(params: GatewayModelConfigSaveParams): Promise<GatewayModelConfig> {
    if (!this.#modelConfigStore) {
      throw new GatewayHttpError(404, "Model configuration store is not available.");
    }
    return sanitizeModelConfig(await this.#modelConfigStore.save(params));
  }

  async #loadAgentConfig(): Promise<GatewayAgentConfig> {
    if (!this.#agentConfigStore) {
      throw new GatewayHttpError(404, "Agent configuration store is not available.");
    }
    return sanitizeAgentConfig(await this.#agentConfigStore.load());
  }

  async #saveAgentConfig(params: GatewayAgentConfigSaveParams): Promise<GatewayAgentConfig> {
    if (!this.#agentConfigStore) {
      throw new GatewayHttpError(404, "Agent configuration store is not available.");
    }
    return sanitizeAgentConfig(await this.#agentConfigStore.save(params));
  }

  async #loadOrg(): Promise<OrgDocument> {
    if (!this.#orgStore) {
      throw new GatewayHttpError(404, "Organization store is not available.");
    }
    return await this.#orgStore.load();
  }

  async #loadEmployees(): Promise<EmployeeRegistry> {
    if (!this.#employeeStore) {
      throw new GatewayHttpError(404, "Employee store is not available.");
    }
    return await this.#employeeStore.load();
  }

  async #saveEmployees(params: GatewayEmployeeSaveParams): Promise<EmployeeRegistry> {
    if (!this.#employeeStore) {
      throw new GatewayHttpError(404, "Employee store is not available.");
    }
    return await this.#employeeStore.save(params);
  }

  async #loadToolPolicies(): Promise<ToolPolicyDocument> {
    if (!this.#toolPolicyStore) {
      throw new GatewayHttpError(404, "Tool policy store is not available.");
    }
    return await this.#toolPolicyStore.load();
  }

  async #saveToolPolicies(params: GatewayToolPolicySaveParams): Promise<ToolPolicyDocument> {
    if (!this.#toolPolicyStore) {
      throw new GatewayHttpError(404, "Tool policy store is not available.");
    }
    return await this.#toolPolicyStore.save(params);
  }

  async #listApprovals(params?: GatewayApprovalListParams): Promise<ApprovalRegistry> {
    if (!this.#approvalService) {
      throw new GatewayHttpError(404, "Approval service is not available.");
    }
    return await this.#approvalService.list(params?.status);
  }

  async #approveRequest(params: GatewayApprovalResolveParams): Promise<ApprovalRequest> {
    if (!this.#approvalService) {
      throw new GatewayHttpError(404, "Approval service is not available.");
    }
    return await this.#approvalService.approve(params.id, params.resolvedBy, params.note);
  }

  async #rejectRequest(params: GatewayApprovalResolveParams): Promise<ApprovalRequest> {
    if (!this.#approvalService) {
      throw new GatewayHttpError(404, "Approval service is not available.");
    }
    return await this.#approvalService.reject(params.id, params.resolvedBy, params.note);
  }

  async #loadTickets(): Promise<TicketDocument> {
    if (!this.#ticketStore) {
      throw new GatewayHttpError(404, "Ticket store is not available.");
    }
    return await this.#ticketStore.load();
  }

  async #upsertTicket(params: GatewayTicketUpsertParams): Promise<TicketDocument> {
    if (!this.#ticketStore) {
      throw new GatewayHttpError(404, "Ticket store is not available.");
    }
    const registry = await this.#ticketStore.load();
    const now = new Date().toISOString();
    const nextTicket: OrgTicket = {
      ...params,
      updatedAt: now,
      createdAt: params.createdAt || now,
    };
    const tickets = registry.tickets.some(ticket => ticket.id === nextTicket.id)
      ? registry.tickets.map(ticket => (ticket.id === nextTicket.id ? nextTicket : ticket))
      : [...registry.tickets, nextTicket];
    return await this.#ticketStore.save({ tickets });
  }

  async #loadKpiTemplates(): Promise<KpiTemplateDocument> {
    if (!this.#kpiTemplateStore) {
      throw new GatewayHttpError(404, "KPI template store is not available.");
    }
    return await this.#kpiTemplateStore.load();
  }

  async #loadKpiSnapshot(params: GatewayKpiSnapshotParams): Promise<KpiSnapshot> {
    if (!this.#kpiTemplateStore || !this.#ticketStore) {
      throw new GatewayHttpError(404, "KPI snapshot requires ticket and KPI template stores.");
    }
    const [templates, tickets, approvals] = await Promise.all([
      this.#kpiTemplateStore.load(),
      this.#ticketStore.load(),
      this.#approvalStore ? this.#approvalStore.load() : Promise.resolve({ requests: [] }),
    ]);
    const template = templates.templates.find(entry => entry.id === params.templateId);
    if (!template) {
      throw new GatewayHttpError(404, `KPI template "${params.templateId}" was not found.`);
    }
    return buildKpiSnapshot({
      template,
      tickets,
      approvals,
      ...(params.employeeId ? { employeeId: params.employeeId } : {}),
    });
  }

  async #loadTierConfig(): Promise<GatewayTierConfig> {
    if (!this.#tierConfigStore) {
      throw new GatewayHttpError(404, "Tier configuration store is not available.");
    }
    return sanitizeTierConfig(await this.#tierConfigStore.load());
  }

  async #saveTierConfig(params: GatewayTierConfigSaveParams): Promise<GatewayTierConfig> {
    if (!this.#tierConfigStore) {
      throw new GatewayHttpError(404, "Tier configuration store is not available.");
    }
    const saved = await this.#tierConfigStore.save(params);
    // Hot-swap: notify the runtime so the next turn picks up the change.
    if (this.#onTierConfigChange) {
      try {
        this.#onTierConfigChange(saved);
      } catch (error) {
        console.error(`[${this.#name}] onTierConfigChange listener threw:`, error);
      }
    }
    return sanitizeTierConfig(saved);
  }

  async #classifyTier(params: GatewayTierClassifyParams): Promise<GatewayTierClassifyResult> {
    if (!this.#tierConfigStore) {
      throw new GatewayHttpError(404, "Tier configuration store is not available.");
    }
    const config = await this.#tierConfigStore.load();
    return classifyTierFromGatewayConfig(config, params);
  }

  #listPlugins(): { plugins: readonly GatewayPluginSummary[] } {
    return {
      plugins: this.#plugins.map(plugin => {
        const summary: GatewayPluginSummary = {
          ...plugin,
          tools: plugin.tools.map(tool => {
            const toolSummary: GatewayPluginToolSummary = {
              name: tool.name,
            };
            if (tool.description !== undefined) {
              toolSummary.description = tool.description;
            }
            if (tool.permission !== undefined) {
              toolSummary.permission = tool.permission;
            }
            if (tool.capabilities !== undefined) {
              toolSummary.capabilities = [...tool.capabilities];
            }
            return toolSummary;
          }),
          providers: plugin.providers.map(provider => ({ ...provider })),
        };
        if (plugin.memoryBackends !== undefined) {
          summary.memoryBackends = plugin.memoryBackends.map(backend => ({ ...backend }));
        }
        if (plugin.lifecycleHooks !== undefined) {
          summary.lifecycleHooks = [...plugin.lifecycleHooks];
        }
        return summary;
      }),
    };
  }

  #listTools(params: { includeSchemas?: boolean } | undefined): { tools: GatewayToolSummary[] } {
    const includeSchemas = params?.includeSchemas === true;
    return {
      tools: this.#toolRegistry.list().map(tool => {
        const summary: GatewayToolSummary = {
          name: tool.name,
          description: tool.description,
          directInvokeAllowed: isDirectToolCandidate(tool, this.#directToolNames),
        };
        if (tool.capabilities !== undefined) {
          summary.capabilities = [...tool.capabilities];
        }
        if (tool.permission !== undefined) {
          summary.permission = tool.permission;
        }
        if (includeSchemas) {
          summary.inputSchema = tool.inputSchema;
        }
        return summary;
      }),
    };
  }

  async #invokeTool(params: GatewayToolInvokeParams): Promise<unknown> {
    const tool = this.#toolRegistry.get(params.toolName);
    if (!tool) {
      throw new Error(`Unknown tool: ${params.toolName}`);
    }
    if (!isDirectToolCandidate(tool, this.#directToolNames)) {
      throw new Error(`Tool is not available for direct gateway invocation: ${tool.name}`);
    }
    const invocation: ToolInvocation = {
      id: randomUUID(),
      name: tool.name,
      input: params.input ?? {},
      sessionId: params.sessionId ?? DEFAULT_TOOL_SESSION_ID,
    };
    if (params.workspace !== undefined) {
      invocation.workspace = params.workspace;
    }
    if (params.metadata !== undefined) {
      invocation.metadata = params.metadata;
    }
    const permission = this.#permissionEngine.decide(tool, invocation);
    if (permission.decision !== "allow") {
      throw new Error(`Tool permission ${permission.decision}: ${permission.reason}`);
    }
    const result = await tool.invoke(invocation);
    return sanitizeDirectToolResult(result, permission);
  }

  async #listMemoryCandidates(params: GatewayMemoryCandidateListParams | undefined): Promise<unknown> {
    const payload = await this.#invokeMemoryCandidateTool("memory_candidates_list", params ?? {});
    if (!isRecord(payload)) {
      return payload;
    }
    return {
      ...payload,
      review: this.#memoryCandidateReviewPermissions(),
    };
  }

  async #promoteMemoryCandidate(params: GatewayMemoryCandidatePromoteParams): Promise<unknown> {
    return await this.#invokeMemoryCandidateTool("memory_candidate_promote", params);
  }

  async #rejectMemoryCandidate(params: GatewayMemoryCandidateRejectParams): Promise<unknown> {
    return await this.#invokeMemoryCandidateTool("memory_candidate_reject", params);
  }

  async #invokeMemoryCandidateTool(toolName: string, input: unknown): Promise<unknown> {
    const tool = this.#toolRegistry.get(toolName);
    if (!tool) {
      throw new Error(`Memory candidate tool is unavailable: ${toolName}`);
    }
    const invocation: ToolInvocation = {
      id: randomUUID(),
      name: tool.name,
      input,
      sessionId: DEFAULT_MEMORY_REVIEW_SESSION_ID,
    };
    const permission = this.#permissionEngine.decide(tool, invocation);
    if (permission.decision !== "allow") {
      // The gateway has no interactive permission handler for RPC clients —
      // operators must pre-approve write tools at startup. Make the remedy
      // explicit instead of returning a bare "Tool permission ask" error.
      const isWriteTool = toolName === "memory_candidate_promote" || toolName === "memory_candidate_reject";
      const hint = isWriteTool
        ? " Restart dragon gateway with --allow-write (or configure a permissionEngine that allows this tool) to enable memory candidate write RPCs."
        : "";
      throw new Error(`Tool permission ${permission.decision} for ${toolName}: ${permission.reason}${hint}`);
    }
    const result = await tool.invoke(invocation);
    return sanitizeToolOutput(result, permission);
  }

  #memoryCandidateReviewPermissions(): { canPromote: boolean; canReject: boolean } {
    return {
      canPromote: this.#canInvokeMemoryCandidateTool("memory_candidate_promote"),
      canReject: this.#canInvokeMemoryCandidateTool("memory_candidate_reject"),
    };
  }

  #canInvokeMemoryCandidateTool(toolName: string): boolean {
    const tool = this.#toolRegistry.get(toolName);
    if (!tool) {
      return false;
    }
    const permission = this.#permissionEngine.decide(tool, {
      id: randomUUID(),
      name: tool.name,
      input: { id: "permission-probe" },
      sessionId: DEFAULT_MEMORY_REVIEW_SESSION_ID,
    });
    return permission.decision === "allow";
  }
}

function errorToStatusCode(error: unknown): number {
  if (error instanceof GatewayHttpError) {
    return error.statusCode;
  }
  if (error instanceof SyntaxError) {
    return 400;
  }
  return 500;
}

function normalizeConfig(config: GatewayConfig): NormalizedGatewayConfig {
  const authMode = config.authMode ?? (config.sharedSecret ? "shared-secret" : "none");
  if (authMode === "shared-secret" && !config.sharedSecret) {
    throw new Error("Gateway shared-secret auth requires sharedSecret.");
  }
  const normalized: NormalizedGatewayConfig = {
    host: config.host ?? DEFAULT_HOST,
    port: normalizePort(config.port),
    authMode,
  };
  if (config.sharedSecret !== undefined) {
    normalized.sharedSecret = config.sharedSecret;
  }
  return normalized;
}

function normalizePort(port: number | undefined): number {
  if (port === undefined) {
    return DEFAULT_PORT;
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid gateway port: ${port}`);
  }
  return port;
}

function parseGatewayRequest(value: unknown): GatewayRequest {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.id !== "string" || !value.id.trim()) {
    badRequest("Gateway RPC request requires type and id.");
  }
  if (value.type === "health") {
    return { type: "health", id: value.id };
  }
  if (value.type === "connect") {
    return {
      type: "connect",
      id: value.id,
      ...(isRecord(value.params) ? { params: value.params } : {}),
    };
  }
  if (value.type === "agent") {
    return {
      type: "agent",
      id: value.id,
      params: parseGatewayAgentParams(value.params),
    };
  }
  if (value.type === "run.status") {
    return {
      type: "run.status",
      id: value.id,
      params: parseRunStatusParams(value.params),
    };
  }
  if (value.type === "run.cancel") {
    return {
      type: "run.cancel",
      id: value.id,
      params: parseRunCancelParams(value.params),
    };
  }
  if (value.type === "runs.list") {
    const params = parseRunsListParams(value.params);
    const request: GatewayRequest = {
      type: "runs.list",
      id: value.id,
    };
    if (params !== undefined) {
      request.params = params;
    }
    return request;
  }
  if (value.type === "providers.list") {
    return { type: "providers.list", id: value.id };
  }
  if (value.type === "model.config.get") {
    return { type: "model.config.get", id: value.id };
  }
  if (value.type === "model.config.save") {
    return {
      type: "model.config.save",
      id: value.id,
      params: parseModelConfigSaveParams(value.params),
    };
  }
  if (value.type === "agent.config.get") {
    return { type: "agent.config.get", id: value.id };
  }
  if (value.type === "agent.config.save") {
    return {
      type: "agent.config.save",
      id: value.id,
      params: parseAgentConfigSaveParams(value.params),
    };
  }
  if (value.type === "org.get") {
    return { type: "org.get", id: value.id };
  }
  if (value.type === "employee.list") {
    return { type: "employee.list", id: value.id };
  }
  if (value.type === "employee.save") {
    return {
      type: "employee.save",
      id: value.id,
      params: parseEmployeeSaveParams(value.params),
    };
  }
  if (value.type === "policy.tool.get") {
    return { type: "policy.tool.get", id: value.id };
  }
  if (value.type === "policy.tool.save") {
    return {
      type: "policy.tool.save",
      id: value.id,
      params: parseToolPolicySaveParams(value.params),
    };
  }
  if (value.type === "approval.list") {
    return {
      type: "approval.list",
      id: value.id,
      ...(value.params !== undefined ? { params: parseApprovalListParams(value.params) } : {}),
    };
  }
  if (value.type === "approval.approve") {
    return {
      type: "approval.approve",
      id: value.id,
      params: parseApprovalResolveParams(value.params),
    };
  }
  if (value.type === "approval.reject") {
    return {
      type: "approval.reject",
      id: value.id,
      params: parseApprovalResolveParams(value.params),
    };
  }
  if (value.type === "ticket.list") {
    return { type: "ticket.list", id: value.id };
  }
  if (value.type === "ticket.upsert") {
    return {
      type: "ticket.upsert",
      id: value.id,
      params: parseTicketUpsertParams(value.params),
    };
  }
  if (value.type === "kpi.template.list") {
    return { type: "kpi.template.list", id: value.id };
  }
  if (value.type === "kpi.snapshot.get") {
    return {
      type: "kpi.snapshot.get",
      id: value.id,
      params: parseKpiSnapshotParams(value.params),
    };
  }
  if (value.type === "tier.config.get") {
    return { type: "tier.config.get", id: value.id };
  }
  if (value.type === "tier.config.save") {
    return {
      type: "tier.config.save",
      id: value.id,
      params: parseTierConfigSaveParams(value.params),
    };
  }
  if (value.type === "tier.classify") {
    return {
      type: "tier.classify",
      id: value.id,
      params: parseTierClassifyParams(value.params),
    };
  }
  if (value.type === "plugins.list") {
    return { type: "plugins.list", id: value.id };
  }
  if (value.type === "tools.catalog") {
    const params = parseToolsCatalogParams(value.params);
    const request: GatewayRequest = {
      type: "tools.catalog",
      id: value.id,
    };
    if (params !== undefined) {
      request.params = params;
    }
    return request;
  }
  if (value.type === "tool.invoke") {
    return {
      type: "tool.invoke",
      id: value.id,
      params: parseToolInvokeParams(value.params),
    };
  }
  if (value.type === "memory.candidates.list") {
    const params = parseMemoryCandidateListParams(value.params);
    const request: GatewayRequest = {
      type: "memory.candidates.list",
      id: value.id,
    };
    if (params !== undefined) {
      request.params = params;
    }
    return request;
  }
  if (value.type === "memory.candidate.promote") {
    return {
      type: "memory.candidate.promote",
      id: value.id,
      params: parseMemoryCandidatePromoteParams(value.params),
    };
  }
  if (value.type === "memory.candidate.reject") {
    return {
      type: "memory.candidate.reject",
      id: value.id,
      params: parseMemoryCandidateRejectParams(value.params),
    };
  }
  if (value.type === "trajectory.list") {
    return {
      type: "trajectory.list",
      id: value.id,
      params: parseTrajectoryListParams(value.params),
    };
  }
  if (value.type === "trajectory.get") {
    return {
      type: "trajectory.get",
      id: value.id,
      params: parseTrajectoryGetParams(value.params),
    };
  }
  if (value.type === "cron.jobs.list") {
    return { type: "cron.jobs.list", id: value.id };
  }
  if (value.type === "cron.job.upsert") {
    return {
      type: "cron.job.upsert",
      id: value.id,
      params: parseCronJobUpsertParams(value.params),
    };
  }
  if (value.type === "cron.job.remove") {
    return {
      type: "cron.job.remove",
      id: value.id,
      params: parseCronJobRemoveParams(value.params),
    };
  }
  if (value.type === "cron.tick") {
    return { type: "cron.tick", id: value.id };
  }
  badRequest(`Unknown Gateway RPC type: ${value.type}`);
}

function parseRunStatusParams(value: unknown): { runId: string } {
  if (!isRecord(value) || typeof value.runId !== "string" || !value.runId.trim()) {
    badRequest("run.status requires params.runId.");
  }
  return { runId: value.runId };
}

function parseRunCancelParams(value: unknown): { runId: string; reason?: string } {
  if (!isRecord(value) || typeof value.runId !== "string" || !value.runId.trim()) {
    badRequest("run.cancel requires params.runId.");
  }
  return {
    runId: value.runId,
    ...(typeof value.reason === "string" && value.reason.trim() ? { reason: value.reason } : {}),
  };
}

function parseRunsListParams(value: unknown): { sessionId?: string; limit?: number } | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    badRequest("runs.list params must be an object.");
  }
  return {
    ...(typeof value.sessionId === "string" && value.sessionId.trim() ? { sessionId: value.sessionId } : {}),
    ...(typeof value.limit === "number" ? { limit: value.limit } : {}),
  };
}

function parseToolsCatalogParams(value: unknown): { includeSchemas?: boolean } | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    badRequest("tools.catalog params must be an object.");
  }
  return {
    ...(typeof value.includeSchemas === "boolean" ? { includeSchemas: value.includeSchemas } : {}),
  };
}

function parseModelConfigSaveParams(value: unknown): GatewayModelConfigSaveParams {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    badRequest("model.config.save requires params.providers.");
  }
  return {
    providers: value.providers.map((provider, index) => parseModelProviderConfig(provider, index)),
  };
}

function normalizeProviderBaseUrl(input: string, index: number): string {
  const trimmed = normalizeShortText(input, "baseUrl", 1000);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    badRequest(`model.config.save provider ${index + 1} baseUrl is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    badRequest(`model.config.save provider ${index + 1} baseUrl must use http or https.`);
  }
  if (url.username || url.password) {
    badRequest(`model.config.save provider ${index + 1} baseUrl must not contain credentials.`);
  }
  if (url.search || url.hash) {
    badRequest(`model.config.save provider ${index + 1} baseUrl must not contain query string or fragment.`);
  }
  return trimmed;
}

function parseModelProviderConfig(value: unknown, index: number): GatewayModelProviderConfig {
  if (!isRecord(value)) {
    badRequest(`model.config.save provider ${index + 1} must be an object.`);
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    badRequest(`model.config.save provider ${index + 1} requires id.`);
  }
  if (!isGatewayModelProviderType(value.type)) {
    badRequest(`model.config.save provider ${index + 1} type is invalid.`);
  }
  const provider: GatewayModelProviderConfig = {
    id: normalizeShortText(value.id, "provider id", 120),
    type: value.type,
  };
  if (typeof value.displayName === "string" && value.displayName.trim()) {
    provider.displayName = normalizeShortText(value.displayName, "displayName", 160);
  }
  if (typeof value.apiKey === "string" && value.apiKey.trim()) {
    provider.apiKey = normalizeBoundedText(value.apiKey, "apiKey", 4000);
  }
  if (typeof value.apiKeyConfigured === "boolean") {
    provider.apiKeyConfigured = value.apiKeyConfigured;
  }
  if (typeof value.baseUrl === "string" && value.baseUrl.trim()) {
    provider.baseUrl = normalizeProviderBaseUrl(value.baseUrl, index);
  }
  if (typeof value.defaultModel === "string" && value.defaultModel.trim()) {
    provider.defaultModel = normalizeShortText(value.defaultModel, "defaultModel", 200);
  }
  if (typeof value.supportsToolCalling === "boolean") {
    provider.supportsToolCalling = value.supportsToolCalling;
  }
  if (typeof value.enabled === "boolean") {
    provider.enabled = value.enabled;
  }
  return provider;
}

function parseAgentConfigSaveParams(value: unknown): GatewayAgentConfigSaveParams {
  if (!isRecord(value) || !Array.isArray(value.profiles)) {
    badRequest("agent.config.save requires params.profiles.");
  }
  const params: GatewayAgentConfigSaveParams = {
    profiles: value.profiles.map((profile, index) => parseAgentProfileConfig(profile, index)),
  };
  if (typeof value.defaultProfileId === "string" && value.defaultProfileId.trim()) {
    params.defaultProfileId = normalizeShortText(value.defaultProfileId, "defaultProfileId", 120);
  }
  return params;
}

function parseEmployeeSaveParams(value: unknown): GatewayEmployeeSaveParams {
  if (!isRecord(value) || !Array.isArray(value.employees)) {
    badRequest("employee.save requires params.employees.");
  }
  const params: GatewayEmployeeSaveParams = {
    employees: value.employees as GatewayEmployeeSaveParams["employees"],
  };
  if (typeof value.defaultEmployeeId === "string" && value.defaultEmployeeId.trim()) {
    params.defaultEmployeeId = normalizeShortText(value.defaultEmployeeId, "defaultEmployeeId", 120);
  }
  return params;
}

function parseToolPolicySaveParams(value: unknown): GatewayToolPolicySaveParams {
  if (!isRecord(value) || !Array.isArray(value.policies)) {
    badRequest("policy.tool.save requires params.policies.");
  }
  return {
    policies: value.policies as GatewayToolPolicySaveParams["policies"],
  };
}

function parseApprovalListParams(value: unknown): GatewayApprovalListParams {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    badRequest("approval.list params must be an object.");
  }
  const status = value.status;
  if (status === undefined) {
    return {};
  }
  if (status !== "pending" && status !== "approved" && status !== "rejected" && status !== "expired") {
    badRequest("approval.list status is invalid.");
  }
  return { status };
}

function parseTicketUpsertParams(value: unknown): GatewayTicketUpsertParams {
  if (!isRecord(value)) {
    badRequest("ticket.upsert params must be an object.");
  }
  const status = value.status;
  if (
    status !== "open"
    && status !== "in_progress"
    && status !== "blocked"
    && status !== "done"
    && status !== "cancelled"
  ) {
    badRequest("ticket.upsert status is invalid.");
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    badRequest("ticket.upsert requires params.id.");
  }
  if (typeof value.title !== "string" || !value.title.trim()) {
    badRequest("ticket.upsert requires params.title.");
  }
  const ticket: GatewayTicketUpsertParams = {
    id: normalizeShortText(value.id, "ticketId", 120),
    title: normalizeShortText(value.title, "ticketTitle", 240),
    status,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
  if (typeof value.assigneeEmployeeId === "string" && value.assigneeEmployeeId.trim()) {
    ticket.assigneeEmployeeId = normalizeShortText(value.assigneeEmployeeId, "assigneeEmployeeId", 120);
  }
  if (typeof value.createdByEmployeeId === "string" && value.createdByEmployeeId.trim()) {
    ticket.createdByEmployeeId = normalizeShortText(value.createdByEmployeeId, "createdByEmployeeId", 120);
  }
  if (typeof value.runId === "string" && value.runId.trim()) {
    ticket.runId = normalizeShortText(value.runId, "runId", 120);
  }
  if (typeof value.toolName === "string" && value.toolName.trim()) {
    ticket.toolName = normalizeShortText(value.toolName, "toolName", 120);
  }
  if (typeof value.description === "string" && value.description.trim()) {
    ticket.description = normalizeShortText(value.description, "description", 2000);
  }
  return ticket;
}

function parseKpiSnapshotParams(value: unknown): GatewayKpiSnapshotParams {
  if (!isRecord(value) || typeof value.templateId !== "string" || !value.templateId.trim()) {
    badRequest("kpi.snapshot.get requires params.templateId.");
  }
  const params: GatewayKpiSnapshotParams = {
    templateId: normalizeShortText(value.templateId, "templateId", 120),
  };
  if (typeof value.employeeId === "string" && value.employeeId.trim()) {
    params.employeeId = normalizeShortText(value.employeeId, "employeeId", 120);
  }
  return params;
}

function parseApprovalResolveParams(value: unknown): GatewayApprovalResolveParams {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    badRequest("approval resolve requires params.id.");
  }
  const params: GatewayApprovalResolveParams = {
    id: normalizeShortText(value.id, "approvalId", 120),
  };
  if (typeof value.resolvedBy === "string" && value.resolvedBy.trim()) {
    params.resolvedBy = normalizeShortText(value.resolvedBy, "resolvedBy", 120);
  }
  if (typeof value.note === "string" && value.note.trim()) {
    params.note = normalizeShortText(value.note, "note", 500);
  }
  return params;
}

function parseAgentProfileConfig(value: unknown, index: number): GatewayAgentProfileConfig {
  if (!isRecord(value)) {
    badRequest(`agent.config.save profile ${index + 1} must be an object.`);
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    badRequest(`agent.config.save profile ${index + 1} requires id.`);
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    badRequest(`agent.config.save profile ${index + 1} requires name.`);
  }
  const profile: GatewayAgentProfileConfig = {
    id: normalizeShortText(value.id, "profile id", 120),
    name: normalizeShortText(value.name, "profile name", 160),
  };
  if (typeof value.description === "string" && value.description.trim()) {
    profile.description = normalizeBoundedText(value.description, "description", 1000);
  }
  if (typeof value.defaultModel === "string" && value.defaultModel.trim()) {
    profile.defaultModel = normalizeShortText(value.defaultModel, "defaultModel", 200);
  }
  if (typeof value.workspace === "string" && value.workspace.trim()) {
    profile.workspace = normalizeShortText(value.workspace, "workspace", 4000);
  }
  if (value.thinking !== undefined) {
    if (!isDragonThinking(value.thinking)) {
      badRequest("agent.config.save profile thinking is invalid.");
    }
    profile.thinking = value.thinking;
  }
  if (typeof value.memoryEnabled === "boolean") {
    profile.memoryEnabled = value.memoryEnabled;
  }
  if (typeof value.toolsEnabled === "boolean") {
    profile.toolsEnabled = value.toolsEnabled;
  }
  if (typeof value.systemPrompt === "string" && value.systemPrompt.trim()) {
    profile.systemPrompt = normalizeBoundedText(value.systemPrompt, "systemPrompt", 16_000);
  }
  return profile;
}

function parseTierConfigSaveParams(value: unknown): GatewayTierConfigSaveParams {
  if (!isRecord(value)) {
    badRequest("tier.config.save params must be an object.");
  }
  const enabled = typeof value.enabled === "boolean" ? value.enabled : false;
  const tiers: GatewayTierConfigSaveParams["tiers"] = {};
  if (isRecord(value.tiers)) {
    for (const name of ["fast", "standard", "deep"] as const) {
      const spec = parseTierSpec((value.tiers as Record<string, unknown>)[name], `tier.config.save tiers.${name}`);
      if (spec !== undefined) tiers[name] = spec;
    }
  }
  const classifier: GatewayTierConfigSaveParams["classifier"] = { mode: "heuristic" };
  if (isRecord(value.classifier)) {
    const raw = value.classifier;
    if (raw.mode === "heuristic" || raw.mode === "fixed") {
      classifier.mode = raw.mode;
    }
    if (raw.fixedTier === "fast" || raw.fixedTier === "standard" || raw.fixedTier === "deep") {
      classifier.fixedTier = raw.fixedTier;
    }
    if (Array.isArray(raw.keywordHints)) {
      const hints: GatewayTierKeywordHint[] = [];
      for (const [index, item] of raw.keywordHints.entries()) {
        if (!isRecord(item)) {
          badRequest(`tier.config.save classifier.keywordHints[${index}] must be an object.`);
        }
        if (item.tier !== "fast" && item.tier !== "standard" && item.tier !== "deep") {
          badRequest(`tier.config.save classifier.keywordHints[${index}].tier is invalid.`);
        }
        if (!Array.isArray(item.words)) {
          badRequest(`tier.config.save classifier.keywordHints[${index}].words must be an array.`);
        }
        const words: string[] = [];
        for (const [wi, word] of item.words.entries()) {
          if (typeof word !== "string" || !word.trim()) {
            badRequest(`tier.config.save classifier.keywordHints[${index}].words[${wi}] must be a non-empty string.`);
          }
          words.push(normalizeShortText(word, "keyword", 80));
        }
        if (words.length > 0) {
          hints.push({ tier: item.tier, words });
        }
      }
      if (hints.length > 0) classifier.keywordHints = hints;
    }
  }
  return { enabled, tiers, classifier };
}

function parseTierSpec(value: unknown, ctx: string): GatewayTierSpec | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    badRequest(`${ctx} must be an object.`);
  }
  const spec: GatewayTierSpec = {};
  if (typeof value.model === "string" && value.model.trim()) {
    spec.model = normalizeShortText(value.model, "model", 200);
  }
  if (Array.isArray(value.modelFallbacks)) {
    const fallbacks: string[] = [];
    for (const [i, fb] of value.modelFallbacks.entries()) {
      if (typeof fb !== "string" || !fb.trim()) {
        badRequest(`${ctx}.modelFallbacks[${i}] must be a non-empty string.`);
      }
      fallbacks.push(normalizeShortText(fb, "modelFallback", 200));
    }
    if (fallbacks.length > 0) spec.modelFallbacks = fallbacks;
  }
  if (value.thinking !== undefined) {
    if (!isDragonThinking(value.thinking)) {
      badRequest(`${ctx}.thinking is invalid.`);
    }
    spec.thinking = value.thinking;
  }
  if (value.maxContextChars !== undefined) {
    if (typeof value.maxContextChars !== "number" || !Number.isFinite(value.maxContextChars) || value.maxContextChars <= 0) {
      badRequest(`${ctx}.maxContextChars must be a positive number.`);
    }
    spec.maxContextChars = Math.floor(Math.min(value.maxContextChars, 200_000));
  }
  if (typeof value.toolsEnabled === "boolean") {
    spec.toolsEnabled = value.toolsEnabled;
  }
  if (typeof value.memoryEnabled === "boolean") {
    spec.memoryEnabled = value.memoryEnabled;
  }
  if (typeof value.systemPromptAddendum === "string" && value.systemPromptAddendum.trim()) {
    spec.systemPromptAddendum = normalizeBoundedText(value.systemPromptAddendum, "systemPromptAddendum", 16_000);
  }
  return Object.keys(spec).length > 0 ? spec : undefined;
}

function parseTierClassifyParams(value: unknown): GatewayTierClassifyParams {
  if (!isRecord(value)) {
    badRequest("tier.classify params must be an object.");
  }
  if (typeof value.message !== "string") {
    badRequest("tier.classify requires params.message.");
  }
  const params: GatewayTierClassifyParams = {
    message: normalizeBoundedText(value.message, "message", 64_000),
  };
  if (Array.isArray(value.attachments)) {
    const atts: { kind: "image" | "text" | "document"; mimeType: string; size?: number }[] = [];
    for (const [i, att] of value.attachments.entries()) {
      if (!isRecord(att)) {
        badRequest(`tier.classify attachments[${i}] must be an object.`);
      }
      if (att.kind !== "image" && att.kind !== "text" && att.kind !== "document") {
        badRequest(`tier.classify attachments[${i}].kind is invalid.`);
      }
      if (typeof att.mimeType !== "string" || !att.mimeType.trim()) {
        badRequest(`tier.classify attachments[${i}].mimeType is invalid.`);
      }
      const entry: { kind: "image" | "text" | "document"; mimeType: string; size?: number } = {
        kind: att.kind,
        mimeType: normalizeShortText(att.mimeType, "mimeType", 200),
      };
      if (typeof att.size === "number" && att.size >= 0) {
        entry.size = att.size;
      }
      atts.push(entry);
    }
    params.attachments = atts;
  }
  if (typeof value.workspace === "string" && value.workspace.trim()) {
    params.workspace = normalizeShortText(value.workspace, "workspace", 4000);
  }
  if (typeof value.toolsEnabled === "boolean") params.toolsEnabled = value.toolsEnabled;
  if (typeof value.memoryRecallCount === "number" && value.memoryRecallCount >= 0) {
    params.memoryRecallCount = Math.floor(value.memoryRecallCount);
  }
  if (typeof value.hasSkillLoaded === "boolean") params.hasSkillLoaded = value.hasSkillLoaded;
  return params;
}

function parseToolInvokeParams(value: unknown): GatewayToolInvokeParams {
  if (!isRecord(value)) {
    badRequest("tool.invoke params must be an object.");
  }
  if (typeof value.toolName !== "string" || !value.toolName.trim()) {
    badRequest("tool.invoke requires params.toolName.");
  }
  const params: GatewayToolInvokeParams = {
    toolName: normalizeShortText(value.toolName, "toolName", 120),
    input: value.input ?? {},
  };
  if (typeof value.sessionId === "string" && value.sessionId.trim()) {
    params.sessionId = normalizeShortText(value.sessionId, "sessionId", 200);
  }
  if (typeof value.workspace === "string" && value.workspace.trim()) {
    params.workspace = normalizeShortText(value.workspace, "workspace", 4000);
  }
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) {
      badRequest("tool.invoke metadata must be an object.");
    }
    params.metadata = value.metadata;
  }
  return params;
}

function parseMemoryCandidateListParams(value: unknown): GatewayMemoryCandidateListParams | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    badRequest("memory.candidates.list params must be an object.");
  }
  const params: GatewayMemoryCandidateListParams = {};
  if (value.status !== undefined) {
    if (!isMemoryCandidateStatusFilter(value.status)) {
      badRequest("memory.candidates.list status is invalid.");
    }
    params.status = value.status;
  }
  if (value.dateFrom !== undefined) {
    if (typeof value.dateFrom !== "string" || !value.dateFrom.trim()) {
      badRequest("memory.candidates.list dateFrom must use YYYY-MM-DD.");
    }
    params.dateFrom = normalizeDate(value.dateFrom, "dateFrom");
  }
  if (value.dateTo !== undefined) {
    if (typeof value.dateTo !== "string" || !value.dateTo.trim()) {
      badRequest("memory.candidates.list dateTo must use YYYY-MM-DD.");
    }
    params.dateTo = normalizeDate(value.dateTo, "dateTo");
  }
  if (params.dateFrom !== undefined && params.dateTo !== undefined && params.dateFrom > params.dateTo) {
    badRequest("memory.candidates.list dateFrom must be before or equal to dateTo.");
  }
  if (value.limit !== undefined) {
    if (typeof value.limit !== "number" || !Number.isFinite(value.limit)) {
      badRequest("memory.candidates.list limit must be a number.");
    }
    params.limit = Math.min(Math.max(1, Math.floor(value.limit)), 100);
  }
  return params;
}

function parseMemoryCandidatePromoteParams(value: unknown): GatewayMemoryCandidatePromoteParams {
  if (!isRecord(value)) {
    badRequest("memory.candidate.promote params must be an object.");
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    badRequest("memory.candidate.promote requires params.id.");
  }
  const params: GatewayMemoryCandidatePromoteParams = {
    id: normalizeShortText(value.id, "id", 200),
  };
  if (value.scope !== undefined) {
    if (!isMemoryScope(value.scope)) {
      badRequest("memory.candidate.promote scope is invalid.");
    }
    params.scope = value.scope;
  }
  if (value.content !== undefined) {
    if (typeof value.content !== "string" || !value.content.trim()) {
      badRequest("memory.candidate.promote content must be a non-empty string.");
    }
    params.content = normalizeBoundedText(value.content, "content", 4000);
  }
  if (value.source !== undefined) {
    if (typeof value.source !== "string" || !value.source.trim()) {
      badRequest("memory.candidate.promote source must be a non-empty string.");
    }
    params.source = normalizeShortText(value.source, "source", 200);
  }
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) {
      badRequest("memory.candidate.promote metadata must be an object.");
    }
    params.metadata = value.metadata;
  }
  return params;
}

function parseMemoryCandidateRejectParams(value: unknown): GatewayMemoryCandidateRejectParams {
  if (!isRecord(value)) {
    badRequest("memory.candidate.reject params must be an object.");
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    badRequest("memory.candidate.reject requires params.id.");
  }
  const params: GatewayMemoryCandidateRejectParams = {
    id: normalizeShortText(value.id, "id", 200),
  };
  if (value.reason !== undefined) {
    if (typeof value.reason !== "string" || !value.reason.trim()) {
      badRequest("memory.candidate.reject reason must be a non-empty string.");
    }
    params.reason = normalizeBoundedText(value.reason, "reason", 1000);
  }
  return params;
}

function parseTrajectoryListParams(value: unknown): GatewayTrajectoryListParams {
  if (!isRecord(value)) {
    badRequest("trajectory.list params must be an object.");
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    badRequest("trajectory.list requires params.sessionId.");
  }
  const params: GatewayTrajectoryListParams = {
    sessionId: normalizeShortText(value.sessionId, "sessionId", 200),
  };
  if (value.status !== undefined) {
    if (!isTurnStatus(value.status)) {
      badRequest("trajectory.list status is invalid.");
    }
    params.status = value.status;
  }
  if (value.dateFrom !== undefined) {
    if (typeof value.dateFrom !== "string" || !value.dateFrom.trim()) {
      badRequest("trajectory.list dateFrom must use YYYY-MM-DD.");
    }
    params.dateFrom = normalizeDate(value.dateFrom, "dateFrom");
  }
  if (value.dateTo !== undefined) {
    if (typeof value.dateTo !== "string" || !value.dateTo.trim()) {
      badRequest("trajectory.list dateTo must use YYYY-MM-DD.");
    }
    params.dateTo = normalizeDate(value.dateTo, "dateTo");
  }
  if (params.dateFrom !== undefined && params.dateTo !== undefined && params.dateFrom > params.dateTo) {
    badRequest("trajectory.list dateFrom must be before or equal to dateTo.");
  }
  if (value.limit !== undefined) {
    if (typeof value.limit !== "number" || !Number.isFinite(value.limit)) {
      badRequest("trajectory.list limit must be a number.");
    }
    params.limit = Math.min(Math.max(1, Math.floor(value.limit)), 100);
  }
  return params;
}

function parseTrajectoryGetParams(value: unknown): GatewayTrajectoryGetParams {
  if (!isRecord(value)) {
    badRequest("trajectory.get params must be an object.");
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    badRequest("trajectory.get requires params.sessionId.");
  }
  if (typeof value.runId !== "string" || !value.runId.trim()) {
    badRequest("trajectory.get requires params.runId.");
  }
  const params: GatewayTrajectoryGetParams = {
    sessionId: normalizeShortText(value.sessionId, "sessionId", 200),
    runId: normalizeShortText(value.runId, "runId", 200),
  };
  if (value.maxEvents !== undefined) {
    if (typeof value.maxEvents !== "number" || !Number.isFinite(value.maxEvents)) {
      badRequest("trajectory.get maxEvents must be a number.");
    }
    params.maxEvents = Math.min(Math.max(1, Math.floor(value.maxEvents)), 1000);
  }
  return params;
}

function parseCronJobUpsertParams(value: unknown): GatewayCronJobUpsertParams {
  if (!isRecord(value)) {
    badRequest("cron.job.upsert params must be an object.");
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    badRequest("cron.job.upsert requires params.id.");
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    badRequest("cron.job.upsert requires params.sessionId.");
  }
  if (typeof value.message !== "string" || !value.message.trim()) {
    badRequest("cron.job.upsert requires params.message.");
  }
  if (typeof value.schedule !== "string" || !value.schedule.trim()) {
    badRequest("cron.job.upsert requires params.schedule.");
  }
  const schedule = normalizeShortText(value.schedule, "schedule", 200);
  try {
    parseCronSchedule(schedule);
  } catch (error) {
    badRequest(`cron.job.upsert schedule is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const params: GatewayCronJobUpsertParams = {
    id: normalizeShortText(value.id, "id", 200),
    sessionId: normalizeShortText(value.sessionId, "sessionId", 200),
    message: normalizeBoundedText(value.message, "message", 16_000),
    schedule,
  };
  if (typeof value.enabled === "boolean") {
    params.enabled = value.enabled;
  }
  if (typeof value.workspace === "string" && value.workspace.trim()) {
    params.workspace = normalizeShortText(value.workspace, "workspace", 4000);
  }
  if (typeof value.model === "string" && value.model.trim()) {
    params.model = normalizeShortText(value.model, "model", 200);
  }
  if (typeof value.nextRunAt === "string" && value.nextRunAt.trim()) {
    params.nextRunAt = normalizeIsoTimestamp(value.nextRunAt, "nextRunAt");
  }
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) {
      badRequest("cron.job.upsert metadata must be an object.");
    }
    params.metadata = value.metadata;
  }
  return params;
}

function parseCronJobRemoveParams(value: unknown): GatewayCronJobRemoveParams {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    badRequest("cron.job.remove requires params.id.");
  }
  return { id: normalizeShortText(value.id, "id", 200) };
}

function parseGatewayAgentParams(value: unknown): GatewayAgentParams {
  if (!isRecord(value)) {
    badRequest("Gateway agent request requires params.");
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    badRequest("Gateway agent request requires non-empty sessionId.");
  }
  if (typeof value.message !== "string" || !value.message.trim()) {
    badRequest("Gateway agent request requires non-empty message.");
  }
  const params: GatewayAgentParams = {
    sessionId: value.sessionId,
    message: value.message,
  };
  if (value.source !== undefined) {
    if (!isDragonSource(value.source)) {
      badRequest(`Invalid gateway agent source: ${String(value.source)}`);
    }
    params.source = value.source;
  }
  if (typeof value.workspace === "string") {
    params.workspace = value.workspace;
  }
  if (typeof value.model === "string") {
    params.model = value.model;
  }
  if (value.thinking !== undefined) {
    if (!isDragonThinking(value.thinking)) {
      badRequest(`Invalid gateway agent thinking: ${String(value.thinking)}`);
    }
    params.thinking = value.thinking;
  }
  if (typeof value.profileId === "string" && value.profileId.trim()) {
    params.profileId = normalizeShortText(value.profileId, "profileId", 200);
  }
  if (typeof value.employeeId === "string" && value.employeeId.trim()) {
    params.employeeId = normalizeShortText(value.employeeId, "employeeId", 200);
  }
  if (typeof value.systemPrompt === "string" && value.systemPrompt.trim()) {
    params.systemPrompt = normalizeBoundedText(value.systemPrompt, "systemPrompt", 16_000);
  }
  if (value.toolsEnabled !== undefined) {
    if (typeof value.toolsEnabled !== "boolean") {
      badRequest("Gateway agent toolsEnabled must be a boolean.");
    }
    params.toolsEnabled = value.toolsEnabled;
  }
  if (value.memoryEnabled !== undefined) {
    if (typeof value.memoryEnabled !== "boolean") {
      badRequest("Gateway agent memoryEnabled must be a boolean.");
    }
    params.memoryEnabled = value.memoryEnabled;
  }
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) {
      badRequest("Gateway agent metadata must be an object.");
    }
    params.metadata = value.metadata;
  }
  if (value.attachments !== undefined) {
    params.attachments = parseGatewayAttachments(value.attachments);
  }
  if (value.tier !== undefined) {
    if (value.tier !== "fast" && value.tier !== "standard" && value.tier !== "deep") {
      badRequest(`Invalid gateway agent tier: ${String(value.tier)}`);
    }
    params.tier = value.tier;
  }
  return params;
}

const GATEWAY_MAX_ATTACHMENTS = 10;
const GATEWAY_MAX_ATTACHMENT_BASE64 = 14 * 1024 * 1024; // ~10MB raw

function parseGatewayAttachments(value: unknown): GatewayAgentAttachment[] {
  if (!Array.isArray(value)) {
    badRequest("Gateway agent attachments must be an array.");
  }
  if (value.length > GATEWAY_MAX_ATTACHMENTS) {
    badRequest(`Gateway agent attachments exceed cap of ${GATEWAY_MAX_ATTACHMENTS}.`);
  }
  const out: GatewayAgentAttachment[] = [];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) {
      badRequest(`Gateway agent attachment ${index + 1} must be an object.`);
    }
    if (raw.kind !== "image" && raw.kind !== "text" && raw.kind !== "document") {
      badRequest(`Gateway agent attachment ${index + 1} kind must be image, text, or document.`);
    }
    if (typeof raw.mimeType !== "string" || !raw.mimeType.trim()) {
      badRequest(`Gateway agent attachment ${index + 1} requires mimeType.`);
    }
    if (typeof raw.data !== "string" || raw.data.length === 0) {
      badRequest(`Gateway agent attachment ${index + 1} requires base64 data.`);
    }
    if (raw.data.length > GATEWAY_MAX_ATTACHMENT_BASE64) {
      badRequest(`Gateway agent attachment ${index + 1} exceeds size cap.`);
    }
    const att: GatewayAgentAttachment = {
      kind: raw.kind,
      mimeType: raw.mimeType.trim(),
      data: raw.data,
    };
    if (typeof raw.name === "string" && raw.name.trim()) {
      att.name = normalizeShortText(raw.name, "attachment name", 200);
    }
    if (typeof raw.size === "number" && Number.isFinite(raw.size) && raw.size >= 0) {
      att.size = Math.floor(raw.size);
    }
    out.push(att);
  }
  return out;
}

function parseGatewayWebhookParams(value: unknown): GatewayWebhookParams {
  if (!isRecord(value)) {
    badRequest("Webhook channel request requires a JSON object.");
  }
  const channel = typeof value.channel === "string" && value.channel.trim()
    ? normalizeShortText(value.channel, "channel", 120)
    : "webhook";
  const params = parseGatewayAgentParams({
    ...value,
    source: value.source ?? "web",
    metadata: mergeWebhookMetadata(value.metadata, channel, value.userId, value.threadId),
  });
  return {
    ...params,
    channel,
    ...(typeof value.userId === "string" && value.userId.trim()
      ? { userId: normalizeShortText(value.userId, "userId", 200) }
      : {}),
    ...(typeof value.threadId === "string" && value.threadId.trim()
      ? { threadId: normalizeShortText(value.threadId, "threadId", 200) }
      : {}),
  };
}

function mergeWebhookMetadata(
  metadata: unknown,
  channel: string,
  userId: unknown,
  threadId: unknown,
): Record<string, unknown> {
  if (metadata !== undefined && !isRecord(metadata)) {
    badRequest("Webhook channel metadata must be an object.");
  }
  const merged: Record<string, unknown> = {
    ...(metadata ?? {}),
    channel,
    channelSurface: "webhook",
  };
  if (typeof userId === "string" && userId.trim()) {
    merged.channelUserId = normalizeShortText(userId, "userId", 200);
  }
  if (typeof threadId === "string" && threadId.trim()) {
    merged.channelThreadId = normalizeShortText(threadId, "threadId", 200);
  }
  return merged;
}

function parseEventStreamFilters(url: URL): EventStreamFilters {
  const filters: EventStreamFilters = {};
  const sessionId = url.searchParams.get("sessionId")?.trim();
  const runId = url.searchParams.get("runId")?.trim();
  if (sessionId) {
    filters.sessionId = sessionId;
  }
  if (runId) {
    filters.runId = runId;
  }
  return filters;
}

function matchesEventFilters(envelope: GatewayEventEnvelope, filters: EventStreamFilters): boolean {
  if (filters.runId !== undefined && envelope.event.runId !== filters.runId) {
    return false;
  }
  if (filters.sessionId !== undefined && envelope.sessionId !== filters.sessionId) {
    return false;
  }
  return true;
}

function readEventSessionId(event: DragonEvent): string | undefined {
  if (event.type === "permission") {
    return event.payload.sessionId;
  }
  const metadataSessionId = event.type === "lifecycle" ? event.metadata?.sessionId : undefined;
  return typeof metadataSessionId === "string" ? metadataSessionId : undefined;
}

function resultStatusToRunState(status: DragonTurnResult["status"]): GatewayRunState {
  if (status === "ok") {
    return "completed";
  }
  return status;
}

function summarizeTurnResult(result: DragonTurnResult): GatewayRunResultSummary {
  const summary: GatewayRunResultSummary = {
    runId: result.runId,
    status: result.status,
    messageCount: result.messages.length,
  };
  const assistant = [...result.messages].reverse().find(message => message.role === "assistant");
  if (assistant?.content) {
    summary.assistantPreview = previewMessage(assistant.content);
  }
  if (result.usage !== undefined) {
    summary.usage = result.usage;
  }
  if (result.error !== undefined) {
    summary.error = result.error;
  }
  return summary;
}

function previewMessage(message: string): string {
  return message.length > 160 ? `${message.slice(0, 160)}... [${message.length} chars]` : message;
}

function badRequest(message: string): never {
  throw new GatewayHttpError(400, message);
}

async function resolveAgentParamsWithProfile(
  params: GatewayAgentParams,
  store: GatewayAgentConfigStore | undefined,
): Promise<GatewayAgentParams> {
  const profileId = params.profileId
    ?? (typeof params.metadata?.profileId === "string" ? params.metadata.profileId : undefined);
  if (!profileId || !store) {
    return params;
  }
  const config = await store.load();
  const profile = config.profiles.find(entry => entry.id === profileId);
  if (!profile) {
    return params;
  }
  return {
    ...params,
    ...(params.model === undefined && profile.defaultModel !== undefined ? { model: profile.defaultModel } : {}),
    ...(params.workspace === undefined && profile.workspace !== undefined ? { workspace: profile.workspace } : {}),
    ...(params.thinking === undefined && profile.thinking !== undefined ? { thinking: profile.thinking } : {}),
    ...(params.systemPrompt === undefined && profile.systemPrompt !== undefined ? { systemPrompt: profile.systemPrompt } : {}),
    ...(params.toolsEnabled === undefined && profile.toolsEnabled !== undefined ? { toolsEnabled: profile.toolsEnabled } : {}),
    ...(params.memoryEnabled === undefined && profile.memoryEnabled !== undefined ? { memoryEnabled: profile.memoryEnabled } : {}),
  };
}

function toTurnInput(params: GatewayAgentParams): DragonTurnInput {
  const input: DragonTurnInput = {
    sessionId: params.sessionId,
    source: params.source ?? "gateway",
    message: params.message,
  };
  if (params.workspace !== undefined) {
    input.workspace = params.workspace;
  }
  if (params.model !== undefined) {
    input.model = params.model;
  }
  if (params.thinking !== undefined) {
    input.thinking = params.thinking;
  }
  if (params.systemPrompt !== undefined) {
    input.systemPrompt = params.systemPrompt;
  }
  if (params.toolsEnabled !== undefined) {
    input.toolsEnabled = params.toolsEnabled;
  }
  if (params.memoryEnabled !== undefined) {
    input.memoryEnabled = params.memoryEnabled;
  }
  if (params.attachments !== undefined && params.attachments.length > 0) {
    input.attachments = params.attachments.map(a => ({
      kind: a.kind,
      mimeType: a.mimeType,
      data: a.data,
      ...(a.name !== undefined ? { name: a.name } : {}),
      ...(a.size !== undefined ? { size: a.size } : {}),
    }));
  }
  if (params.tier !== undefined) {
    input.tier = params.tier;
  }
  if (params.metadata !== undefined) {
    input.metadata = params.metadata;
  }
  return input;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      throw new GatewayHttpError(413, `Request body exceeds ${MAX_REQUEST_BYTES} bytes.`);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    throw new GatewayHttpError(400, "Request body cannot be empty.");
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new GatewayHttpError(400, `Invalid JSON request body: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function writeHtml(response: ServerResponse, statusCode: number, html: string): void {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
  });
  response.end(html);
}

function writeSse(response: ServerResponse, eventName: string, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.write(`event: ${eventName}\n`);
  for (const line of body.split(/\r?\n/)) {
    response.write(`data: ${line}\n`);
  }
  response.write("\n");
}

interface ParsedWebSocketFrame {
  opcode: number;
  payload: Buffer;
}

interface ParsedWebSocketFrames {
  frames: ParsedWebSocketFrame[];
  remaining: Buffer;
}

function isValidWebSocketUpgrade(request: IncomingMessage, key: string | undefined): key is string {
  if (request.method !== "GET") {
    return false;
  }
  const upgrade = readSingleHeader(request, "upgrade")?.toLowerCase();
  const connection = readSingleHeader(request, "connection")?.toLowerCase();
  const version = readSingleHeader(request, "sec-websocket-version");
  if (upgrade !== "websocket" || version !== "13" || !connection?.split(",").some(item => item.trim() === "upgrade")) {
    return false;
  }
  if (!key) {
    return false;
  }
  try {
    return Buffer.from(key, "base64").byteLength === 16;
  } catch {
    return false;
  }
}

function readSingleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function readWebSocketProtocols(request: IncomingMessage): string[] {
  const header = readSingleHeader(request, "sec-websocket-protocol");
  if (!header) {
    return [];
  }
  return header.split(",").map(item => item.trim()).filter(Boolean);
}

function rejectWebSocketUpgrade(socket: Duplex, statusCode: number, reason: string): void {
  const body = `${reason}\n`;
  socket.end([
    `HTTP/1.1 ${statusCode} ${reason}`,
    "Connection: close",
    "Content-Type: text/plain; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body, "utf8")}`,
    "",
    body,
  ].join("\r\n"));
}

function parseWebSocketFrames(buffer: Buffer): ParsedWebSocketFrames {
  const frames: ParsedWebSocketFrame[] = [];
  let offset = 0;
  while (buffer.byteLength - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    if (first === undefined || second === undefined) {
      break;
    }
    const fin = (first & 0x80) !== 0;
    const reserved = first & 0x70;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLength = second & 0x7f;
    let headerLength = 2;

    if (reserved !== 0) {
      throw new Error("WebSocket extensions are not supported.");
    }
    if (!fin) {
      throw new Error("Fragmented WebSocket messages are not supported.");
    }
    if (!masked) {
      throw new Error("Client WebSocket frames must be masked.");
    }
    if (opcode !== 0x1 && opcode !== 0x8 && opcode !== 0x9 && opcode !== 0xA) {
      throw new Error("Unsupported WebSocket opcode.");
    }
    if (payloadLength === 126) {
      if (buffer.byteLength - offset < headerLength + 2) {
        break;
      }
      payloadLength = buffer.readUInt16BE(offset + headerLength);
      headerLength += 2;
    } else if (payloadLength === 127) {
      if (buffer.byteLength - offset < headerLength + 8) {
        break;
      }
      const extendedLength = buffer.readBigUInt64BE(offset + headerLength);
      if (extendedLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("WebSocket frame is too large.");
      }
      payloadLength = Number(extendedLength);
      headerLength += 8;
    }
    if (opcode >= 0x8 && payloadLength > 125) {
      throw new Error("WebSocket control frames must be 125 bytes or fewer.");
    }
    if (payloadLength > MAX_REQUEST_BYTES) {
      throw new Error(`WebSocket message exceeds ${MAX_REQUEST_BYTES} bytes.`);
    }
    const frameLength = headerLength + 4 + payloadLength;
    if (buffer.byteLength - offset < frameLength) {
      break;
    }
    const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
    const payload = Buffer.from(buffer.subarray(offset + headerLength + 4, offset + frameLength));
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] = payload[index]! ^ mask[index % 4]!;
    }
    frames.push({ opcode, payload });
    offset += frameLength;
  }
  return {
    frames,
    remaining: offset === 0 ? buffer : buffer.subarray(offset),
  };
}

function sendWebSocketJson(client: WebSocketClient, payload: GatewayWebSocketEnvelope): boolean {
  if (client.closed) {
    return false;
  }
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > MAX_WEBSOCKET_MESSAGE_BYTES) {
    return false;
  }
  sendWebSocketFrame(client, 0x1, Buffer.from(body, "utf8"));
  return true;
}

function sendWebSocketFrame(client: WebSocketClient, opcode: number, payload: Buffer): void {
  if (client.closed) {
    return;
  }
  try {
    client.socket.write(createWebSocketFrame(opcode, payload));
  } catch {
    client.closed = true;
  }
}

function closeWebSocketClient(client: WebSocketClient, statusCode: number, reason: string): void {
  if (client.closed) {
    return;
  }
  const reasonBytes = Buffer.from(fitUtf8Text(reason, 120, "[truncated]"), "utf8");
  const payload = Buffer.alloc(2 + reasonBytes.byteLength);
  payload.writeUInt16BE(statusCode, 0);
  reasonBytes.copy(payload, 2);
  client.closed = true;
  client.socket.end(createWebSocketFrame(0x8, payload));
  setTimeout(() => {
    client.socket.destroy();
  }, 1000).unref();
}

function createWebSocketFrame(opcode: number, payload: Buffer): Buffer {
  const payloadLength = payload.byteLength;
  if (payloadLength < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, payloadLength]), payload]);
  }
  if (payloadLength <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payloadLength), 2);
  return Buffer.concat([header, payload]);
}

function applyCors(request: IncomingMessage, response: ServerResponse): void {
  const host = request.headers.host?.split(":")[0]?.toLowerCase();
  const origin = host === "127.0.0.1"
    ? "http://127.0.0.1"
    : "http://localhost";
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,authorization,x-dragon-secret");
}

function isDragonSource(value: unknown): value is DragonSource {
  return ["cli", "gateway", "web", "ide", "cron", "api"].includes(String(value));
}

function isDragonThinking(value: unknown): value is DragonThinkingLevel {
  return ["none", "low", "medium", "high"].includes(String(value));
}

function isTurnStatus(value: unknown): value is DragonTurnResult["status"] {
  return ["ok", "error", "cancelled", "timeout"].includes(String(value));
}

function isMemoryCandidateStatusFilter(value: unknown): value is NonNullable<GatewayMemoryCandidateListParams["status"]> {
  return ["pending", "promoted", "rejected", "all"].includes(String(value));
}

function isMemoryScope(value: unknown): value is NonNullable<GatewayMemoryCandidatePromoteParams["scope"]> {
  return ["user", "project", "session", "skill"].includes(String(value));
}

function isGatewayModelProviderType(value: unknown): value is GatewayModelProviderType {
  return value === "openai-compatible" || value === "anthropic";
}

function normalizeShortText(value: string, fieldName: string, maxChars: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    badRequest(`${fieldName} cannot be empty.`);
  }
  if (trimmed.length > maxChars) {
    badRequest(`${fieldName} must be ${maxChars} characters or fewer.`);
  }
  return trimmed;
}

function normalizeBoundedText(value: string, fieldName: string, maxChars: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    badRequest(`${fieldName} cannot be empty.`);
  }
  if (trimmed.length > maxChars) {
    badRequest(`${fieldName} must be ${maxChars} characters or fewer.`);
  }
  return trimmed;
}

function normalizeDate(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    badRequest(`${fieldName} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    badRequest(`${fieldName} must use YYYY-MM-DD.`);
  }
  return trimmed;
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const trimmed = value.trim();
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    badRequest(`${fieldName} must be a valid ISO timestamp.`);
  }
  return parsed.toISOString();
}

function sanitizeModelConfig(config: GatewayModelConfig): GatewayModelConfig {
  const sanitized: GatewayModelConfig = {
    providers: config.providers.map(provider => {
      const summary: GatewayModelProviderConfig = {
        id: trimBounded(provider.id, 120),
        type: provider.type,
        apiKeyConfigured: provider.apiKeyConfigured === true || Boolean(provider.apiKey),
      };
      if (provider.displayName !== undefined) {
        summary.displayName = trimBounded(provider.displayName, 160);
      }
      if (provider.baseUrl !== undefined) {
        summary.baseUrl = trimBounded(provider.baseUrl, 1000);
      }
      if (provider.defaultModel !== undefined) {
        summary.defaultModel = trimBounded(provider.defaultModel, 200);
      }
      if (provider.supportsToolCalling !== undefined) {
        summary.supportsToolCalling = provider.supportsToolCalling;
      }
      if (provider.enabled !== undefined) {
        summary.enabled = provider.enabled;
      }
      return summary;
    }),
    appliesOn: "restart",
  };
  if (config.configPath !== undefined) {
    sanitized.configPath = trimBounded(config.configPath, 1000);
  }
  return sanitized;
}

function sanitizeAgentConfig(config: GatewayAgentConfig): GatewayAgentConfig {
  const sanitized: GatewayAgentConfig = {
    profiles: config.profiles.map(profile => {
      const summary: GatewayAgentProfileConfig = {
        id: trimBounded(profile.id, 120),
        name: trimBounded(profile.name, 160),
      };
      if (profile.description !== undefined) {
        summary.description = trimBounded(profile.description, 1000);
      }
      if (profile.defaultModel !== undefined) {
        summary.defaultModel = trimBounded(profile.defaultModel, 200);
      }
      if (profile.workspace !== undefined) {
        summary.workspace = trimBounded(profile.workspace, 4000);
      }
      if (profile.thinking !== undefined) {
        summary.thinking = profile.thinking;
      }
      if (profile.memoryEnabled !== undefined) {
        summary.memoryEnabled = profile.memoryEnabled;
      }
      if (profile.toolsEnabled !== undefined) {
        summary.toolsEnabled = profile.toolsEnabled;
      }
      if (profile.systemPrompt !== undefined) {
        summary.systemPrompt = trimBounded(profile.systemPrompt, 16_000);
      }
      return summary;
    }),
  };
  if (config.defaultProfileId !== undefined) {
    sanitized.defaultProfileId = trimBounded(config.defaultProfileId, 120);
  }
  if (config.configPath !== undefined) {
    sanitized.configPath = trimBounded(config.configPath, 1000);
  }
  return sanitized;
}

function sanitizeTierConfig(config: GatewayTierConfig): GatewayTierConfig {
  const sanitized: GatewayTierConfig = {
    enabled: Boolean(config.enabled),
    tiers: {
      ...(config.tiers.fast !== undefined ? { fast: sanitizeTierSpec(config.tiers.fast) } : {}),
      ...(config.tiers.standard !== undefined ? { standard: sanitizeTierSpec(config.tiers.standard) } : {}),
      ...(config.tiers.deep !== undefined ? { deep: sanitizeTierSpec(config.tiers.deep) } : {}),
    },
    classifier: {
      mode: config.classifier.mode === "fixed" ? "fixed" : "heuristic",
      ...(config.classifier.fixedTier !== undefined ? { fixedTier: config.classifier.fixedTier } : {}),
      ...(config.classifier.keywordHints !== undefined && config.classifier.keywordHints.length > 0
        ? {
            keywordHints: config.classifier.keywordHints.map(hint => ({
              tier: hint.tier,
              words: hint.words.map(w => trimBounded(w, 80)),
            })),
          }
        : {}),
    },
    appliesOn: "next-turn",
  };
  if (config.configPath !== undefined) {
    sanitized.configPath = trimBounded(config.configPath, 1000);
  }
  return sanitized;
}

function sanitizeTierSpec(spec: GatewayTierSpec): GatewayTierSpec {
  const out: GatewayTierSpec = {};
  if (spec.model !== undefined) out.model = trimBounded(spec.model, 200);
  if (spec.modelFallbacks !== undefined && spec.modelFallbacks.length > 0) {
    out.modelFallbacks = spec.modelFallbacks.map(m => trimBounded(m, 200));
  }
  if (spec.thinking !== undefined) out.thinking = spec.thinking;
  if (spec.maxContextChars !== undefined && spec.maxContextChars > 0) {
    out.maxContextChars = Math.floor(Math.min(spec.maxContextChars, 200_000));
  }
  if (spec.toolsEnabled !== undefined) out.toolsEnabled = spec.toolsEnabled;
  if (spec.memoryEnabled !== undefined) out.memoryEnabled = spec.memoryEnabled;
  if (spec.systemPromptAddendum !== undefined) {
    out.systemPromptAddendum = trimBounded(spec.systemPromptAddendum, 16_000);
  }
  return out;
}

function classifyTierFromGatewayConfig(
  config: GatewayTierConfig,
  params: GatewayTierClassifyParams,
): GatewayTierClassifyResult {
  // Build a synthetic DragonTurnInput and reuse the core classifier (the
  // gateway types parallel the core types, but we avoid importing the core
  // classifier here to keep the dependency surface flat — instead we inline a
  // lightweight scoring that matches the core rules).
  if (!config.enabled) {
    const fallback: GatewayTierClassifyResult = {
      tier: "standard",
      source: "heuristic",
      score: 0,
      reason: "tier scheduling disabled (default=standard)",
    };
    const spec = config.tiers.standard;
    if (spec?.model !== undefined) fallback.resolvedModel = spec.model;
    if (spec?.thinking !== undefined) fallback.resolvedThinking = spec.thinking;
    if (spec?.maxContextChars !== undefined) fallback.resolvedMaxContextChars = spec.maxContextChars;
    if (spec?.toolsEnabled !== undefined) fallback.resolvedToolsEnabled = spec.toolsEnabled;
    if (spec?.memoryEnabled !== undefined) fallback.resolvedMemoryEnabled = spec.memoryEnabled;
    return fallback;
  }

  if (config.classifier.mode === "fixed" && config.classifier.fixedTier !== undefined) {
    const tier = config.classifier.fixedTier;
    const spec = config.tiers[tier];
    const out: GatewayTierClassifyResult = {
      tier,
      source: "fixed",
      score: 0,
      reason: `classifier.mode=fixed → ${tier}`,
    };
    if (spec?.model !== undefined) out.resolvedModel = spec.model;
    if (spec?.thinking !== undefined) out.resolvedThinking = spec.thinking;
    if (spec?.maxContextChars !== undefined) out.resolvedMaxContextChars = spec.maxContextChars;
    if (spec?.toolsEnabled !== undefined) out.resolvedToolsEnabled = spec.toolsEnabled;
    if (spec?.memoryEnabled !== undefined) out.resolvedMemoryEnabled = spec.memoryEnabled;
    return out;
  }

  const FAST_KEYWORDS = [
    "translate", "summarize", "one line", "tldr", "format ", "list ", "json only", "yes or no",
    "翻译", "总结一句", "一句话", "格式化", "列出", "罗列", "是或否",
  ];
  const DEEP_KEYWORDS = [
    "analyze deeply", "step by step", "step-by-step", "think carefully", "think hard",
    "design a", "architect", "plan the", "deep dive", "compare and contrast",
    "review the entire",
    "深入分析", "深度分析", "逐步", "一步步", "仔细思考", "全面分析", "深度思考",
    "架构", "规划", "深入研究", "对比分析", "复杂", "整体设计",
  ];

  let score = 0;
  const reasons: string[] = [];
  const message = params.message ?? "";
  const len = message.length;
  if (len > 2000) { score += 2; reasons.push(`msgLen=${len}>2000 (+2)`); }
  else if (len > 500) { score += 1; reasons.push(`msgLen=${len}>500 (+1)`); }
  const attachments = params.attachments ?? [];
  if (attachments.length > 2) { score += 2; reasons.push(`attach=${attachments.length}>2 (+2)`); }
  else if (attachments.length > 0) { score += 1; reasons.push(`attach=${attachments.length} (+1)`); }
  const heavy = attachments.find(a => a.kind === "document"
    && (a.mimeType === "application/pdf" || a.mimeType.includes("presentationml") || a.mimeType.includes("spreadsheetml")));
  if (heavy !== undefined) { score += 1; reasons.push(`heavyDoc=${heavy.mimeType} (+1)`); }
  if (params.hasSkillLoaded === true) { score += 2; reasons.push("skillLoaded (+2)"); }
  if (params.memoryRecallCount !== undefined && params.memoryRecallCount > 3) {
    score += 1; reasons.push(`memoryRecall=${params.memoryRecallCount}>3 (+1)`);
  }
  if (params.toolsEnabled !== false && params.workspace !== undefined) {
    score += 1; reasons.push("agentMode (+1)");
  }
  const lower = message.toLowerCase();
  const fastHits: string[] = [];
  const deepHits: string[] = [];
  for (const w of FAST_KEYWORDS) if (lower.includes(w.toLowerCase())) fastHits.push(w);
  for (const w of DEEP_KEYWORDS) if (lower.includes(w.toLowerCase())) deepHits.push(w);
  for (const hint of config.classifier.keywordHints ?? []) {
    for (const w of hint.words) {
      if (lower.includes(w.toLowerCase())) {
        if (hint.tier === "fast") fastHits.push(`*${w}`);
        else if (hint.tier === "deep") deepHits.push(`*${w}`);
      }
    }
  }
  if (deepHits.length > 0) { score += 3; reasons.push(`deepKeyword=${JSON.stringify(deepHits.slice(0, 3))} (+3)`); }
  if (fastHits.length > 0) { score -= 2; reasons.push(`fastKeyword=${JSON.stringify(fastHits.slice(0, 3))} (-2)`); }

  let tier: GatewayTierName;
  if (score >= 5) tier = "deep";
  else if (score >= 2) tier = "standard";
  else tier = "fast";

  const spec = config.tiers[tier];
  const out: GatewayTierClassifyResult = {
    tier,
    source: "heuristic",
    score,
    reason: reasons.length > 0 ? reasons.join("; ") : "no signals (score=0)",
  };
  if (spec?.model !== undefined) out.resolvedModel = spec.model;
  if (spec?.thinking !== undefined) out.resolvedThinking = spec.thinking;
  if (spec?.maxContextChars !== undefined) out.resolvedMaxContextChars = spec.maxContextChars;
  if (spec?.toolsEnabled !== undefined) out.resolvedToolsEnabled = spec.toolsEnabled;
  if (spec?.memoryEnabled !== undefined) out.resolvedMemoryEnabled = spec.memoryEnabled;
  return out;
}

function normalizeProviderSummaries(values: readonly GatewayProviderSummary[]): readonly GatewayProviderSummary[] {
  return Object.freeze(values.map(provider => {
    const summary: GatewayProviderSummary = {
      id: trimBounded(provider.id, 120),
      displayName: trimBounded(provider.displayName, 160),
      supportsToolCalling: Boolean(provider.supportsToolCalling),
    };
    if (provider.defaultModel !== undefined) {
      summary.defaultModel = trimBounded(provider.defaultModel, 200);
    }
    if (provider.models !== undefined) {
      summary.models = normalizeModelSummaries(provider.models);
    }
    return Object.freeze(summary);
  }));
}

function normalizePluginSummaries(values: readonly GatewayPluginSummary[]): readonly GatewayPluginSummary[] {
  return Object.freeze(values.map(plugin => {
    const summary: GatewayPluginSummary = {
      name: trimBounded(plugin.name, 120),
      version: trimBounded(plugin.version, 80),
      tools: Object.freeze(plugin.tools.map(tool => {
        const toolSummary: GatewayPluginToolSummary = {
          name: trimBounded(tool.name, 120),
        };
        if (tool.description !== undefined) {
          toolSummary.description = trimBounded(tool.description, 300);
        }
        if (tool.permission !== undefined) {
          toolSummary.permission = tool.permission;
        }
        if (tool.capabilities !== undefined) {
          toolSummary.capabilities = Object.freeze(tool.capabilities.map(capability => trimBounded(capability, 80)));
        }
        return Object.freeze(toolSummary);
      })),
      providers: Object.freeze(plugin.providers.map(provider => {
        const providerSummary: GatewayPluginProviderSummary = {
          id: trimBounded(provider.id, 120),
          displayName: trimBounded(provider.displayName, 160),
          supportsToolCalling: Boolean(provider.supportsToolCalling),
        };
        if (provider.defaultModel !== undefined) {
          providerSummary.defaultModel = trimBounded(provider.defaultModel, 200);
        }
        if (provider.models !== undefined) {
          providerSummary.models = normalizeModelSummaries(provider.models);
        }
        return Object.freeze(providerSummary);
      })),
    };
    if (plugin.memoryBackends !== undefined) {
      summary.memoryBackends = Object.freeze(plugin.memoryBackends.map(backend => Object.freeze({
        id: trimBounded(backend.id, 120),
        displayName: trimBounded(backend.displayName, 160),
      })));
    }
    if (plugin.lifecycleHooks !== undefined) {
      summary.lifecycleHooks = Object.freeze(plugin.lifecycleHooks.map(hook => trimBounded(hook, 120)));
    }
    if (plugin.description !== undefined) {
      summary.description = trimBounded(plugin.description, 500);
    }
    if (plugin.dragonVersion !== undefined) {
      summary.dragonVersion = trimBounded(plugin.dragonVersion, 80);
    }
    return Object.freeze(summary);
  }));
}

function normalizeModelSummaries(values: readonly GatewayModelSummary[]): readonly GatewayModelSummary[] {
  return Object.freeze(values.map(model => {
    const summary: GatewayModelSummary = {
      id: trimBounded(model.id, 200),
    };
    if (model.displayName !== undefined) {
      summary.displayName = trimBounded(model.displayName, 240);
    }
    if (model.aliases !== undefined) {
      summary.aliases = Object.freeze(model.aliases.map(alias => trimBounded(alias, 200)));
    }
    if (model.contextWindow !== undefined && Number.isSafeInteger(model.contextWindow) && model.contextWindow > 0) {
      summary.contextWindow = model.contextWindow;
    }
    if (model.maxOutputTokens !== undefined && Number.isSafeInteger(model.maxOutputTokens) && model.maxOutputTokens > 0) {
      summary.maxOutputTokens = model.maxOutputTokens;
    }
    if (model.capabilities !== undefined) {
      summary.capabilities = normalizeModelCapabilities(model.capabilities);
    }
    if (model.status !== undefined) {
      summary.status = model.status;
    }
    if (model.default !== undefined) {
      summary.default = Boolean(model.default);
    }
    return Object.freeze(summary);
  }));
}

function normalizeModelCapabilities(capabilities: DragonModelCapabilities): DragonModelCapabilities {
  const summary: DragonModelCapabilities = {};
  if (capabilities.toolCalling !== undefined) {
    summary.toolCalling = Boolean(capabilities.toolCalling);
  }
  if (capabilities.streaming !== undefined) {
    summary.streaming = Boolean(capabilities.streaming);
  }
  if (capabilities.vision !== undefined) {
    summary.vision = Boolean(capabilities.vision);
  }
  if (capabilities.reasoning !== undefined) {
    summary.reasoning = Boolean(capabilities.reasoning);
  }
  if (capabilities.jsonMode !== undefined) {
    summary.jsonMode = Boolean(capabilities.jsonMode);
  }
  return Object.freeze(summary);
}

function isDirectToolCandidate(tool: ToolDefinition, directToolNames: ReadonlySet<string>): boolean {
  if (!directToolNames.has(tool.name) || tool.permission !== "allow") {
    return false;
  }
  const capabilities = tool.capabilities ?? [];
  if (
    capabilities.includes("write")
    || capabilities.includes("custom")
    || capabilities.includes("network")
    || capabilities.includes("memory")
  ) {
    return false;
  }
  return true;
}

function sanitizeDirectToolResult(result: unknown, permission: ToolPermissionResult): unknown {
  const permissionSummary = {
    decision: permission.decision,
    reason: permission.reason,
  };
  try {
    const json = JSON.stringify({ result, permission: permissionSummary }, jsonSafeReplacer);
    if (!json) {
      return {
        result: { ok: false, error: "Tool result could not be serialized." },
        permission: permissionSummary,
      };
    }
    if (Buffer.byteLength(json, "utf8") <= MAX_DIRECT_TOOL_RESULT_BYTES) {
      return JSON.parse(json) as unknown;
    }
    return {
      result: {
        ok: readBooleanProperty(result, "ok") ?? false,
        truncated: true,
        preview: fitUtf8Text(json, MAX_DIRECT_TOOL_PREVIEW_BYTES, "[tool result truncated]"),
      },
      permission: permissionSummary,
    };
  } catch (error) {
    return {
      result: {
        ok: false,
        error: `Tool result could not be serialized: ${error instanceof Error ? error.message : String(error)}`,
      },
      permission: permissionSummary,
    };
  }
}

function sanitizeToolOutput(result: ToolResult, permission: ToolPermissionResult): unknown {
  if (!result.ok) {
    throw new Error(result.error ?? "Tool invocation failed.");
  }
  const permissionSummary = {
    decision: permission.decision,
    reason: permission.reason,
  };
  try {
    const json = JSON.stringify({ output: result.output, permission: permissionSummary }, jsonSafeReplacer);
    if (!json) {
      return {
        output: undefined,
        permission: permissionSummary,
      };
    }
    if (Buffer.byteLength(json, "utf8") <= MAX_DIRECT_TOOL_RESULT_BYTES) {
      return JSON.parse(json) as unknown;
    }
    return {
      output: {
        truncated: true,
        preview: fitUtf8Text(json, MAX_DIRECT_TOOL_PREVIEW_BYTES, "[tool output truncated]"),
      },
      permission: permissionSummary,
    };
  } catch (error) {
    return {
      output: {
        error: error instanceof Error ? error.message : String(error),
      },
      permission: permissionSummary,
    };
  }
}

function fitUtf8Text(value: string, maxBytes: number, suffix: string): string {
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  if (maxBytes <= suffixBytes) {
    return Buffer.from(suffix, "utf8").subarray(0, Math.max(0, maxBytes)).toString("utf8");
  }
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }
  const budget = maxBytes - suffixBytes;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, mid), "utf8") <= budget) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${value.slice(0, low)}${suffix}`;
}

function jsonSafeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

function readBooleanProperty(value: unknown, key: string): boolean | undefined {
  return isRecord(value) && typeof value[key] === "boolean" ? value[key] : undefined;
}

function trimBounded(value: string, maxChars: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, Math.max(0, maxChars - 14))}... [truncated]` : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class GatewayHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "GatewayHttpError";
  }
}
