import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { describeAuthStartup, requiresSharedSecret } from "./auth-policy.js";
import {
  applyModelCatalogToAgentParams,
  createModelCatalogFromProviderSummaries,
} from "./model-catalog-bridge.js";
import type { LoongModelCapabilities, LoongModelCatalog, LoongModelStatus } from "@loong/model-catalog";
import { handleGatewayHttpRequest } from "./gateway-http-handler.js";
import { handleGatewayRpc, type GatewayRpcHandlerDeps } from "./gateway-rpc-handler.js";
import { readEventSessionId, type EventStreamFilters, type GatewayEventEnvelope } from "./gateway-event-stream.js";
export type { EventStreamFilters, GatewayEventEnvelope } from "./gateway-event-stream.js";
import { GatewayConnectionHub } from "./gateway-connection-hub.js";
import { fitUtf8Text } from "./gateway-text.js";
import { clientRateLimitKey, SlidingWindowRateLimiter } from "./rate-limit.js";
import { FilePairingStore, type PairingStore } from "./pairing.js";
import { parseAgentConfigSaveParams, sanitizeAgentConfig } from "./gateway-agent-config.js";
import {
  DEFAULT_DIRECT_TOOL_NAMES,
  normalizeConfig,
  type GatewayConfig,
  type NormalizedGatewayConfig,
} from "./gateway-config.js";
import {
  isDirectToolCandidate,
  summarizeGatewayTool,
  type GatewayToolSummary,
} from "./gateway-tools.js";
import {
  loadEmployeeWorkspaceSnapshot,
  listGatewaySkills,
  saveEmployeeWorkspaceSnapshot,
} from "./gateway-employee-workspace-rpc.js";
import { bootstrapOrgExample } from "./org-example-bootstrap.js";
import { seedMandatoryPresetSkills } from "./org-preset-skills.js";
import { LoongChannelPluginHost } from "@loong/channel-plugin-host";
import { toGatewayWebhookPayload } from "@loong/channels";
import { parseGatewayRequest } from "./gateway-rpc-parse.js";
import {
  isAgentTurnQueuedPayload,
  SessionTurnCoordinator,
  type AgentTurnResultPayload,
} from "./session-coordinator.js";
import { executeGatewayAgentTurn } from "./gateway-agent-turn.js";
import { browseGatewayDirectory } from "./gateway-fs-browse.js";
import {
  parseGatewayAgentParams,
  parseGatewayWebhookParams,
  resolveAgentParamsWithProfile,
  toTurnInput,
} from "./agent-params.js";
import type {
  GatewayAgentConfig,
  GatewayAgentConfigSaveParams,
  GatewayAgentConfigStore,
  GatewayAgentParams,
  GatewayAgentProfileConfig,
  GatewayTierName,
  GatewayWebhookParams,
} from "./gateway-agent-types.js";
import {
  badRequest,
  errorToStatusCode,
  GatewayHttpError,
  MAX_REQUEST_BYTES,
  readSingleHeader,
  writeJson,
} from "./gateway-http.js";
import {
  isLoongThinking,
  isRecord,
  normalizeBoundedText,
  normalizeShortText,
} from "./gateway-parse.js";
import type {
  LoongAgentRuntime,
  LoongEvent,
  LoongSource,
  LoongThinkingLevel,
  LoongTrajectoryRecord,
  LoongTurnInput,
  LoongTurnResult,
} from "@loong/core";
import { parseCronSchedule, type LoongCronJob, type LoongCronJobStore, type LoongCronRunner } from "@loong/cron";
import {
  buildKpiSnapshot,
  mergeEmployeeIntoAgentParams,
  readEmployeeId,
  resolveEmployeeForMessage,
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
} from "@loong/org";
import {
  createToolPermissionEngine,
  createToolRegistry,
  defaultMcpConfigPath,
  loadMcpConfig,
  type ToolDefinition,
  type ToolInvocation,
  type ToolPermissionEngine,
  type ToolPermissionResult,
  type ToolRegistry,
  type ToolResult,
} from "@loong/tools";

export type { GatewayConfig } from "./gateway-config.js";
export type { GatewayRequest, GatewayResponse } from "./gateway-rpc-types.js";
export type {
  GatewayApprovalListParams,
  GatewayApprovalResolveParams,
  GatewayCronJobRemoveParams,
  GatewayCronJobUpsertParams,
  GatewayEmployeeSaveParams,
  GatewayKpiSnapshotParams,
  GatewayMemoryCandidateListParams,
  GatewayMemoryCandidatePromoteParams,
  GatewayMemoryCandidateRejectParams,
  GatewayModelConfigSaveParams,
  GatewayModelProviderConfig,
  GatewayModelProviderType,
  GatewayTierClassifyParams,
  GatewayTierConfigSaveParams,
  GatewayTierKeywordHint,
  GatewayTierSpec,
  GatewayToolInvokeParams,
  GatewayTrajectoryGetParams,
  GatewayTrajectoryListParams,
} from "./gateway-rpc-params.js";
export type { GatewayToolSummary } from "./gateway-tools.js";
import type { GatewayRequest, GatewayResponse } from "./gateway-rpc-types.js";
import type {
  GatewayApprovalListParams,
  GatewayApprovalResolveParams,
  GatewayCronJobRemoveParams,
  GatewayCronJobUpsertParams,
  GatewayEmployeeSaveParams,
  GatewayKpiSnapshotParams,
  GatewayMemoryCandidateListParams,
  GatewayMemoryCandidatePromoteParams,
  GatewayMemoryCandidateRejectParams,
  GatewayModelConfigSaveParams,
  GatewayModelProviderConfig,
  GatewayTicketUpsertParams,
  GatewayTierClassifyParams,
  GatewayTierConfigSaveParams,
  GatewayTierKeywordHint,
  GatewayTierSpec,
  GatewayToolInvokeParams,
  GatewayToolPolicySaveParams,
  GatewayTrajectoryGetParams,
  GatewayTrajectoryListParams,
} from "./gateway-rpc-params.js";

export interface GatewayAddress {
  host: string;
  port: number;
  url: string;
}

export type {
  GatewayAgentAttachment,
  GatewayAgentConfig,
  GatewayAgentParams,
  GatewayAgentProfileConfig,
  GatewayAgentConfigSaveParams,
  GatewayAgentConfigStore,
  GatewayWebhookParams,
  GatewayTierName,
} from "./gateway-agent-types.js";

export type GatewayRunState = "running" | "cancelling" | "completed" | "cancelled" | "timeout" | "error";

export interface GatewayRunRecord {
  runId: string;
  sessionId?: string;
  state: GatewayRunState;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  source?: LoongSource;
  messagePreview?: string;
  error?: string;
  result?: GatewayRunResultSummary;
}

export interface GatewayRunResultSummary {
  runId: string;
  status: LoongTurnResult["status"];
  messageCount: number;
  assistantPreview?: string;
  usage?: LoongTurnResult["usage"];
  error?: string;
}

export interface GatewayTrajectoryStore {
  list(filter?: GatewayTrajectoryListParams): Promise<unknown>;
  get(
    runId: string,
    filter?: Pick<GatewayTrajectoryListParams, "sessionId" | "dateFrom" | "dateTo">,
  ): Promise<LoongTrajectoryRecord | undefined>;
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
  capabilities?: LoongModelCapabilities;
  status?: LoongModelStatus;
  default?: boolean;
}

export interface GatewayModelConfig {
  providers: readonly GatewayModelProviderConfig[];
  appliesOn: "next-turn";
  configPath?: string;
}

export interface GatewayModelConfigStore {
  load(): Promise<GatewayModelConfig>;
  save(config: GatewayModelConfigSaveParams): Promise<GatewayModelConfig>;
}

// --- Tier scheduling ---------------------------------------------------------

export type GatewayTierClassifierMode = "heuristic" | "fixed";

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

export interface GatewayTierConfigStore {
  load(): Promise<GatewayTierConfig>;
  save(config: GatewayTierConfigSaveParams): Promise<GatewayTierConfig>;
  /**
   * Subscribed by the gateway so a save can hot-swap the runtime's tier
   * decisions for the next turn without restart.
   */
  onChange?(listener: (config: GatewayTierConfig) => void): () => void;
}

export interface GatewayTierClassifyResult {
  tier: GatewayTierName;
  source: "fixed" | "heuristic" | "inherited" | "explicit-input";
  score: number;
  reason: string;
  resolvedModel?: string;
  resolvedThinking?: LoongThinkingLevel;
  resolvedMaxContextChars?: number;
  resolvedToolsEnabled?: boolean;
  resolvedMemoryEnabled?: boolean;
}

export interface GatewayPluginMemoryBackendSummary {
  id: string;
  displayName: string;
}

export interface GatewayPluginSummary {
  name: string;
  version: string;
  description?: string;
  loongVersion?: string;
  tools: readonly GatewayPluginToolSummary[];
  providers: readonly GatewayPluginProviderSummary[];
  memoryBackends?: readonly GatewayPluginMemoryBackendSummary[];
  lifecycleHooks?: readonly string[];
}

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

export interface LoongGateway {
  start(config?: GatewayConfig): Promise<void>;
  stop(): Promise<void>;
  address(): GatewayAddress | undefined;
}

export interface HttpLoongGatewayOptions {
  runtime: LoongAgentRuntime;
  cronStore?: LoongCronJobStore;
  cronRunner?: LoongCronRunner;
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
  /**
   * Notified when model.config.save completes. The CLI binds this to reload
   * providers from disk into the runtime registry for the next turn.
   */
  onModelConfigChange?: (config: GatewayModelConfig) => void | Promise<void>;
  tools?: readonly ToolDefinition[];
  toolRegistry?: ToolRegistry;
  permissionEngine?: ToolPermissionEngine;
  directToolNames?: readonly string[];
  skillRoots?: readonly string[];
  pluginRoots?: readonly string[];
  channelConfig?: Readonly<Record<string, unknown>>;
  name?: string;
  pairingStore?: PairingStore;
}

export { FilePairingStore, defaultPairingFilePath, type PairedDeviceRecord, type PairingStore } from "./pairing.js";

const MAX_RUN_RECORDS = 200;
const MAX_DIRECT_TOOL_RESULT_BYTES = 256_000;
const MAX_DIRECT_TOOL_PREVIEW_BYTES = 64_000;
const DEFAULT_TOOL_SESSION_ID = "gateway-tools";
const DEFAULT_MEMORY_REVIEW_SESSION_ID = "gateway-memory-review";
export function createHttpGateway(options: HttpLoongGatewayOptions): LoongGateway {
  return new HttpLoongGateway(options);
}

export class HttpLoongGateway implements LoongGateway {
  readonly #runtime: LoongAgentRuntime;
  readonly #cronStore: LoongCronJobStore | undefined;
  readonly #cronRunner: LoongCronRunner | undefined;
  readonly #trajectoryStore: GatewayTrajectoryStore | undefined;
  readonly #plugins: readonly GatewayPluginSummary[];
  #providers: GatewayProviderSummary[];
  #modelCatalog: LoongModelCatalog | undefined;
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
  readonly #onModelConfigChange: ((config: GatewayModelConfig) => void | Promise<void>) | undefined;
  readonly #toolRegistry: ToolRegistry;
  readonly #permissionEngine: ToolPermissionEngine;
  #directToolNames: Set<string>;
  readonly #skillRoots: readonly string[];
  readonly #channelPluginHost: LoongChannelPluginHost;
  readonly #name: string;
  readonly #pairingStore: PairingStore;
  readonly #lanes = new Map<string, Promise<void>>();
  readonly #sessionCoordinator = new SessionTurnCoordinator();
  readonly #rateLimiter = new SlidingWindowRateLimiter();
  readonly #connections: GatewayConnectionHub;
  readonly #runSessions = new Map<string, string>();
  readonly #runs = new Map<string, GatewayRunRecord>();
  readonly #runControllers = new Map<string, AbortController>();
  #server: Server | undefined;
  #config: NormalizedGatewayConfig | undefined;
  #startedAt: string | undefined;
  #address: GatewayAddress | undefined;
  #runtimeUnsubscribe: (() => void) | undefined;

  constructor(options: HttpLoongGatewayOptions) {
    this.#runtime = options.runtime;
    this.#cronStore = options.cronStore;
    this.#cronRunner = options.cronRunner;
    this.#trajectoryStore = options.trajectoryStore;
    this.#plugins = normalizePluginSummaries(options.pluginSummaries ?? []);
    this.#providers = [...normalizeProviderSummaries(options.providerSummaries ?? [])];
    this.#modelCatalog =
      this.#providers.length > 0
        ? createModelCatalogFromProviderSummaries(this.#providers)
        : undefined;
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
    this.#onModelConfigChange = options.onModelConfigChange;
    this.#toolRegistry = options.toolRegistry ?? createToolRegistry([...(options.tools ?? [])]);
    this.#permissionEngine = options.permissionEngine ?? createToolPermissionEngine({ defaultDecision: "deny" });
    this.#directToolNames = new Set(options.directToolNames ?? DEFAULT_DIRECT_TOOL_NAMES);
    this.#skillRoots = [...(options.skillRoots ?? [])];
    this.#channelPluginHost = new LoongChannelPluginHost({
      pluginRoots: [...(options.pluginRoots ?? [])],
      channelConfig: options.channelConfig ?? {},
      deliverInboundMessage: async message =>
        this.#runWebhook(
          toGatewayWebhookPayload({
            channel: message.channel,
            text: message.text,
            ...(message.userId !== undefined ? { userId: message.userId } : {}),
            ...(message.threadId !== undefined ? { threadId: message.threadId } : {}),
            ...(message.messageId !== undefined ? { messageId: message.messageId } : {}),
            ...(message.metadata !== undefined ? { metadata: message.metadata } : {}),
          }),
        ),
    });
    this.#name = options.name ?? "loong-gateway";
    this.#pairingStore = options.pairingStore ?? new FilePairingStore();
    this.#connections = new GatewayConnectionHub({
      isAuthorized: request => this.#isAuthorized(request),
      tryConsumeWebSocket: request => this.#rateLimiter.tryConsume("websocket", clientRateLimitKey(request)),
      handleRpc: request => this.#handleRpc(request),
      resolveSessionId: event => this.#runSessions.get(event.runId) ?? readEventSessionId(event),
    });
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
      this.#connections.handleUpgrade(request, socket, head);
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
    this.#directToolNames = new Set(normalized.toolInvokeAllowlist);
    this.#startedAt = new Date().toISOString();
    this.#address = {
      host: normalized.host,
      port: address.port,
      url: `http://${normalized.host}:${address.port}`,
    };
    this.#runtimeUnsubscribe = this.#runtime.subscribe(event => {
      this.#connections.broadcastRuntimeEvent(event);
    });
    void seedMandatoryPresetSkills(this.#skillRoots);
    try {
      await this.#channelPluginHost.start();
      const channelHost = this.#channelPluginHost.status;
      if (channelHost.warnings?.length) {
        for (const warning of channelHost.warnings) {
          console.error(`[${this.#name}] Loong Channel Plugin Host: ${warning}`);
        }
      }
      if (channelHost.loadedPlugins > 0) {
        console.error(
          `[${this.#name}] Loong Channel Plugin Host ready (${channelHost.loadedPlugins} channel plugin(s): ${channelHost.registeredChannels.join(", ")})`,
        );
      }
    } catch (error) {
      console.error(
        `[${this.#name}] Loong Channel Plugin Host failed to start: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const authNotice = describeAuthStartup(normalized);
    if (authNotice) {
      console.error(`[${this.#name}] ${authNotice.replace(/^\[loong-gateway\] /, "")}`);
    }
    if (normalized.authMode === "shared-secret" && normalized.sharedSecret && !config.sharedSecret && requiresSharedSecret(normalized.host)) {
      console.error(
        `[${this.#name}] Auto-generated shared secret for non-loopback bind (${normalized.host}): ${normalized.sharedSecret}`,
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
    this.#connections.closeEventStreams();
    this.#connections.closeWebSocketClients();
    await this.#channelPluginHost.stop();
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
    const explicitEmployeeId = params.employeeId?.trim() || readEmployeeId(params.metadata);
    let employeeId = explicitEmployeeId;

    if (!employeeId && this.#orgStore && this.#employeeStore) {
      const [org, registry] = await Promise.all([
        this.#orgStore.load(),
        this.#employeeStore.load(),
      ]);
      const routed = resolveEmployeeForMessage(params.message, org, registry, resolved.profileId);
      if (routed) {
        employeeId = routed.employeeId;
        resolved = mergeEmployeeIntoAgentParams(resolved, routed.employee, {
          employeeRoutingReason: routed.reason,
          ...(routed.ruleId ? { employeeRoutingRuleId: routed.ruleId } : {}),
        });
      }
    }

    if (explicitEmployeeId && this.#employeeStore) {
      const registry = await this.#employeeStore.load();
      const employee = registry.employees.find(entry => entry.id === explicitEmployeeId);
      if (!employee) {
        return applyModelCatalogToAgentParams(resolved, this.#modelCatalog);
      }
      if (employee.status !== "active") {
        throw new GatewayHttpError(400, `Employee "${explicitEmployeeId}" is inactive.`);
      }
      resolved = mergeEmployeeIntoAgentParams(resolved, employee);
    }

    // Profile fields (workspace, model, …) must merge after profileId is set by employee routing.
    const merged = await resolveAgentParamsWithProfile(resolved, this.#agentConfigStore);
    return applyModelCatalogToAgentParams(merged, this.#modelCatalog);
  }

  async #handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    await handleGatewayHttpRequest({
      rateLimiter: this.#rateLimiter,
      isAuthorized: request => this.#isAuthorized(request),
      healthPayload: () => this.#healthPayload(),
      openEventStream: (req, res, url) => this.#connections.openEventStream(req, res, url),
      runWebhook: body => this.#runWebhook(body),
      handleRpc: req => this.#handleRpc(req),
      dispatchChannelPluginHttp: (request, response, options) =>
        this.#channelPluginHost.dispatchHttp(request, response, options),
    }, request, response);
  }

  #isAuthorized(request: IncomingMessage): boolean {
    const config = this.#config;
    if (!config || config.authMode !== "shared-secret") {
      return true;
    }

    const authorization = request.headers.authorization;
    const bearer = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
    const headerSecret = request.headers["x-loong-secret"];
    return bearer === config.sharedSecret || headerSecret === config.sharedSecret;
  }

  #rpcCapabilities(): readonly string[] {
    return [
      "health",
      "connect",
      "agent.run",
      "agent.wait",
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
      ...(this.#employeeStore ? ["employee.list", "employee.save", "employee.workspace.get", "employee.workspace.save"] : []),
      "skills.list",
      ...(this.#orgStore && this.#employeeStore && this.#toolPolicyStore && this.#agentConfigStore
        ? ["org.bootstrap.example"]
        : []),
      ...(this.#toolPolicyStore ? ["policy.tool.get", "policy.tool.save"] : []),
      ...(this.#approvalService ? ["approval.list", "approval.approve", "approval.reject"] : []),
      ...(this.#ticketStore ? ["ticket.list", "ticket.upsert"] : []),
      ...(this.#kpiTemplateStore ? ["kpi.template.list", "kpi.snapshot.get"] : []),
      ...(this.#tierConfigStore ? ["tier.config.get", "tier.config.save", "tier.classify"] : []),
      "plugins.list",
      "mcp.servers.list",
      "pairing.token.create",
      "pairing.devices.list",
      "pairing.device.register",
      "pairing.device.revoke",
      "tools.catalog",
      "tool.invoke",
      ...(this.#toolRegistry.has("memory_candidates_list") ? ["memory.candidates.list"] : []),
      ...(this.#toolRegistry.has("memory_candidate_promote") ? ["memory.candidate.promote"] : []),
      ...(this.#toolRegistry.has("memory_candidate_reject") ? ["memory.candidate.reject"] : []),
      ...(this.#trajectoryStore ? ["trajectory.list", "trajectory.get"] : []),
      ...(this.#cronStore ? ["cron.jobs.list", "cron.job.upsert", "cron.job.remove"] : []),
      ...(this.#cronRunner ? ["cron.tick"] : []),
      "fs.directory.browse",
    ];
  }

  #rpcDeps(): import("./gateway-rpc-handler.js").GatewayRpcHandlerDeps {
    return {
      capabilities: this.#rpcCapabilities(),
      healthPayload: () => this.#healthPayload(),
      getRunStatus: runId => this.#getRunStatus(runId),
      cancelRun: (runId, reason) => this.#cancelRun(runId, reason),
      listRuns: params => this.#listRuns(params),
      listProviders: () => this.#listProviders(),
      loadModelConfig: () => this.#loadModelConfig(),
      saveModelConfig: params => this.#saveModelConfig(params as GatewayModelConfigSaveParams),
      loadAgentConfig: () => this.#loadAgentConfig(),
      saveAgentConfig: params => this.#saveAgentConfig(params as GatewayAgentConfigSaveParams),
      loadOrg: () => this.#loadOrg(),
      loadEmployees: () => this.#loadEmployees(),
      saveEmployees: params => this.#saveEmployees(params as EmployeeRegistry),
      loadEmployeeWorkspace: params => this.#loadEmployeeWorkspace(params),
      saveEmployeeWorkspace: params => this.#saveEmployeeWorkspace(params),
      listSkills: () => this.#listSkills(),
      bootstrapOrgExample: () => this.#bootstrapOrgExample(),
      loadToolPolicies: () => this.#loadToolPolicies(),
      saveToolPolicies: params => this.#saveToolPolicies(params as ToolPolicyDocument),
      listApprovals: params => this.#listApprovals(params as GatewayApprovalListParams | undefined),
      approveRequest: params => this.#approveRequest(params as GatewayApprovalResolveParams),
      rejectRequest: params => this.#rejectRequest(params as GatewayApprovalResolveParams),
      loadTickets: () => this.#loadTickets(),
      upsertTicket: params => this.#upsertTicket(params as OrgTicket),
      loadKpiTemplates: () => this.#loadKpiTemplates(),
      loadKpiSnapshot: params => this.#loadKpiSnapshot(params as GatewayKpiSnapshotParams),
      loadTierConfig: () => this.#loadTierConfig(),
      saveTierConfig: params => this.#saveTierConfig(params as GatewayTierConfigSaveParams),
      classifyTier: params => this.#classifyTier(params as GatewayTierClassifyParams),
      listPlugins: () => this.#listPlugins(),
      listMcpServers: () => this.#listMcpServers(),
      createPairingToken: params => this.#createPairingToken(params as { label?: string; ttlMs?: number } | undefined),
      listPairedDevices: () => this.#listPairedDevices(),
      registerPairedDevice: token => this.#registerPairedDevice(token),
      revokePairedDevice: deviceId => this.#revokePairedDevice(deviceId),
      listTools: params => this.#listTools(params as { includeSchemas?: boolean } | undefined),
      invokeTool: params => this.#invokeTool(params as GatewayToolInvokeParams),
      listMemoryCandidates: params => this.#listMemoryCandidates(params as GatewayMemoryCandidateListParams | undefined),
      promoteMemoryCandidate: params => this.#promoteMemoryCandidate(params as GatewayMemoryCandidatePromoteParams),
      rejectMemoryCandidate: params => this.#rejectMemoryCandidate(params as GatewayMemoryCandidateRejectParams),
      listTrajectories: params => this.#listTrajectories(params as GatewayTrajectoryListParams),
      getTrajectory: params => this.#getTrajectory(params as GatewayTrajectoryGetParams),
      listCronJobs: () => this.#listCronJobs(),
      upsertCronJob: params => this.#upsertCronJob(params as GatewayCronJobUpsertParams),
      removeCronJob: params => this.#removeCronJob(params as GatewayCronJobRemoveParams),
      tickCron: () => this.#tickCron(),
      waitForQueuedTurn: queueTurnId => this.#sessionCoordinator.waitForQueuedTurn(queueTurnId),
      runAgent: params => this.#runAgent(params as GatewayAgentParams),
      browseDirectory: params => browseGatewayDirectory(params),
    };
  }

  async #handleRpc(request: GatewayRequest): Promise<GatewayResponse> {
    return handleGatewayRpc(this.#rpcDeps(), request);
  }

  async #runAgent(params: GatewayAgentParams): Promise<AgentTurnResultPayload | { queued: true; queueTurnId: string; sessionId: string; position: number }> {
    const resolvedParams = await this.#resolveAgentParams(params);
    return await this.#sessionCoordinator.runOrEnqueue(
      resolvedParams.sessionId,
      resolvedParams,
      agentParams => this.#executeAgentTurn(agentParams),
    );
  }
  #agentTurnDeps(): import("./gateway-agent-turn.js").GatewayAgentTurnDeps {
    return {
      runtime: this.#runtime,
      runInLane: (sessionId, task) => this.#runInLane(sessionId, task),
      runs: {
        registerRunStart: (runId, input, controller) => this.#registerRunStart(runId, input, controller),
        completeRun: (runId, result) => this.#completeRun(runId, result),
        failRun: (runId, error, state) => this.#failRun(runId, error, state),
        deleteRunSession: runId => this.#runSessions.delete(runId),
      },
    };
  }

  async #executeAgentTurn(params: GatewayAgentParams): Promise<AgentTurnResultPayload> {
    return executeGatewayAgentTurn(this.#agentTurnDeps(), params);
  }
  async #runWebhook(value: unknown): Promise<{ channel: string; result: unknown; events: LoongEvent[] }> {
    const webhook = parseGatewayWebhookParams(value);
    const outcome = await this.#runAgent(webhook);
    const completed: AgentTurnResultPayload = isAgentTurnQueuedPayload(outcome)
      ? await this.#sessionCoordinator.waitForQueuedTurn(outcome.queueTurnId)
      : outcome;
    return {
      channel: webhook.channel,
      result: completed.result,
      events: completed.events,
    };
  }
  #registerRunStart(runId: string, input: LoongTurnInput, controller: AbortController): void {
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
  #completeRun(runId: string, result: LoongTurnResult): void {
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
  async #getTrajectory(params: GatewayTrajectoryGetParams): Promise<{ record: LoongTrajectoryRecord; eventsTruncated: boolean }> {
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
      channelPluginHost: this.#channelPluginHost.status,
    };
  }

  replaceLoadedProviders(summaries: readonly GatewayProviderSummary[]): void {
    this.#providers = [...normalizeProviderSummaries(summaries)];
    this.#modelCatalog =
      this.#providers.length > 0
        ? createModelCatalogFromProviderSummaries(this.#providers)
        : undefined;
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
    const saved = await this.#modelConfigStore.save(params);
    const sanitized = sanitizeModelConfig(saved);
    if (this.#onModelConfigChange) {
      try {
        await this.#onModelConfigChange(saved);
      } catch (error) {
        console.error(`[${this.#name}] onModelConfigChange listener threw:`, error);
      }
    }
    return sanitized;
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

  async #loadEmployeeWorkspace(params: unknown): Promise<unknown> {
    if (!this.#employeeStore || !this.#agentConfigStore) {
      throw new GatewayHttpError(404, "Employee workspace is not available.");
    }
    const agentConfig = await this.#loadAgentConfig();
    const employees = await this.#loadEmployees();
    return loadEmployeeWorkspaceSnapshot(
      agentConfig,
      employees,
      (params ?? {}) as import("./gateway-employee-workspace-rpc.js").EmployeeWorkspaceGetParams,
    );
  }

  async #saveEmployeeWorkspace(params: unknown): Promise<unknown> {
    if (!this.#employeeStore) {
      throw new GatewayHttpError(404, "Employee workspace is not available.");
    }
    return saveEmployeeWorkspaceSnapshot(
      params as import("./employee-workspace-files.js").EmployeeWorkspaceSaveInput,
    );
  }

  async #listSkills(): Promise<unknown> {
    return listGatewaySkills(this.#toolRegistry, { skillRoots: this.#skillRoots });
  }

  async #bootstrapOrgExample(): Promise<unknown> {
    if (!this.#orgStore || !this.#employeeStore || !this.#toolPolicyStore || !this.#agentConfigStore) {
      throw new GatewayHttpError(404, "Organization bootstrap is not available.");
    }
    const org = await this.#loadOrg();
    return bootstrapOrgExample({
      employeeStore: this.#employeeStore,
      toolPolicyStore: this.#toolPolicyStore,
      agentConfigStore: this.#agentConfigStore,
      orgAlreadyConfigured: (org.units?.length ?? 0) > 0,
    });
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
    return await this.#approvalService.list({
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.assignedApproverId ? { assignedApproverId: params.assignedApproverId } : {}),
    });
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

  async #listMcpServers(): Promise<{
    servers: Array<{
      id: string;
      transport: "stdio" | "http";
      toolCount: number;
      disabled?: boolean;
    }>;
  }> {
    const configured = await loadMcpConfig(defaultMcpConfigPath());
    const toolNames = this.#toolRegistry.list().map(tool => tool.name);
    return {
      servers: configured.map(server => ({
        id: server.id,
        transport: server.url ? "http" : "stdio",
        toolCount: toolNames.filter(name => name.startsWith(`mcp_${server.id}_`)).length,
        ...(server.disabled ? { disabled: true } : {}),
      })),
    };
  }

  async #createPairingToken(params: { label?: string; ttlMs?: number } | undefined): Promise<{ token: string; expiresAt: string }> {
    const label = typeof params?.label === "string" ? params.label : "device";
    const ttlMs = typeof params?.ttlMs === "number" && Number.isFinite(params.ttlMs) ? params.ttlMs : undefined;
    return await this.#pairingStore.createToken(label, ttlMs);
  }

  async #listPairedDevices(): Promise<{ devices: Awaited<ReturnType<PairingStore["listDevices"]>> }> {
    return { devices: await this.#pairingStore.listDevices() };
  }

  async #registerPairedDevice(token: string): Promise<{ device: Awaited<ReturnType<PairingStore["consumeToken"]>> }> {
    const device = await this.#pairingStore.consumeToken(token);
    if (!device) {
      badRequest("Invalid or expired pairing token.");
    }
    return { device };
  }

  async #revokePairedDevice(deviceId: string): Promise<{ revoked: boolean }> {
    return { revoked: await this.#pairingStore.revokeDevice(deviceId) };
  }

  #listTools(params: { includeSchemas?: boolean } | undefined): { tools: GatewayToolSummary[] } {
    const includeSchemas = params?.includeSchemas === true;
    return {
      tools: this.#toolRegistry.list().map(tool => summarizeGatewayTool(tool, this.#directToolNames, includeSchemas)),
    };
  }

  async #invokeTool(params: GatewayToolInvokeParams): Promise<unknown> {
    const config = this.#config;
    if (config?.authMode === "none" && config.host && requiresSharedSecret(config.host)) {
      throw new GatewayHttpError(
        403,
        "Direct tool.invoke requires shared-secret auth when Gateway is not bound to loopback.",
      );
    }
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
        ? " Restart loong gateway with --allow-write (or configure a permissionEngine that allows this tool) to enable memory candidate write RPCs."
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

function resultStatusToRunState(status: LoongTurnResult["status"]): GatewayRunState {
  if (status === "ok") {
    return "completed";
  }
  return status;
}

function summarizeTurnResult(result: LoongTurnResult): GatewayRunResultSummary {
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

function isTurnStatus(value: unknown): value is LoongTurnResult["status"] {
  return ["ok", "error", "cancelled", "timeout"].includes(String(value));
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
    appliesOn: "next-turn",
  };
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
  // Build a synthetic LoongTurnInput and reuse the core classifier (the
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
    if (plugin.loongVersion !== undefined) {
      summary.loongVersion = trimBounded(plugin.loongVersion, 80);
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

function normalizeModelCapabilities(capabilities: LoongModelCapabilities): LoongModelCapabilities {
  const summary: LoongModelCapabilities = {};
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

export { GatewayHttpError } from "./gateway-http.js";
export {
  applyModelCatalogToAgentParams,
  createModelCatalogFromProviderSummaries,
  type AgentParamsWithOptionalModel,
  type GatewayProviderCatalogSource,
  type GatewayProviderModelCatalogSource,
} from "./model-catalog-bridge.js";
export { assertLoongGatewayWebhookPayload, type LoongGatewayWebhookPayload } from "./channels-webhook.js";
export {
  QUERY_LOOP_CONTINUE_MESSAGE,
  DEFAULT_QUERY_LOOP_MAX_TURNS,
  resolveQueryLoopMaxTurns,
  shouldContinueQueryLoop,
} from "./query-loop.js";
export {
  parseGatewayAgentParams,
  parseGatewayWebhookParams,
  resolveAgentParamsWithProfile,
  toTurnInput,
} from "./agent-params.js";
export {
  getDashboardHtml,
  getDashboardRoot,
  readDashboardAsset,
  resetDashboardStaticCache,
} from "./dashboard.js";

