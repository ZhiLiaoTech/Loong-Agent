import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const indexPath = path.join(cliSrc, "index.ts");
const lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/);

const runGatewayStart = lines.findIndex(l => l === "async function runGateway(args: string[]): Promise<void> {");
const runGatewayEnd = lines.findIndex((l, i) => i > runGatewayStart && l === "}");
const parseGatewayStart = lines.findIndex(l => l === "interface ParsedGatewayArgs {");
const parseGatewayEnd = lines.findIndex((l, i) => i > parseGatewayStart && l === "}");

const header = `import path from "node:path";
import { normalizeTierConfig, type DragonAgentRuntime, type ModelTierConfig } from "@dragon/core";
import { createCronRunner, createFileCronJobStore, createGatewayWebhookCronTarget } from "@dragon/cron";
import {
  createFileApprovalStore,
  createFileEmployeeStore,
  createFileKpiTemplateStore,
  createFileOrgStore,
  createFileTicketStore,
  createFileToolPolicyStore,
  createGatewayApprovalService,
  createTicketLifecycleHook,
  defaultApprovalConfigPath,
  defaultEmployeeConfigPath,
  defaultKpiTemplateConfigPath,
  defaultOrgConfigPath,
  defaultTicketConfigPath,
  defaultToolPolicyConfigPath,
} from "@dragon/org";
import {
  createHttpGateway,
  type GatewayConfig,
} from "@dragon/gateway";
import { createFileTrajectoryStore } from "@dragon/memory";
import {
  loadGatewaySettingsFile,
  mergeGatewayConfigFromFile,
  parseModelTimeoutMsArg,
  parseModelTimeoutMsFromEnv,
  parseModelTimeoutSecArg,
  resolveModelTimeoutMs,
} from "../gateway-settings.js";
import { createBuiltinProviders } from "../builtin-providers.js";
import { gatewayUrlFromConfig } from "../gateway-url.js";
import { parsePort } from "../parse-cli-args.js";
import { configuredPluginRoots, configuredSkillRoots, resolveExistingPluginRoot, resolveSkillRoot, uniquePaths } from "../paths.js";
import { waitForShutdown } from "../shutdown.js";
import {
  configuredAgentConfigPath,
  configuredModelConfigPath,
  configuredTierConfigPath,
  createAgentConfigStore,
  createModelConfigStore,
  createTierConfigStore,
  loadPersistedTierConfig,
} from "../config-stores.js";
import { createRuntime } from "../runtime-factory.js";
import { deactivateLoadedPlugins, summarizeLoadedPlugins, summarizeProviders } from "../plugin-lifecycle.js";

export interface ParsedGatewayArgs {
  config: GatewayConfig;
  allowWrite: boolean;
  sessionDir: string;
  memoryDir: string;
  cronJobsFile: string;
  memoryBackendId?: string;
  skillRoots: string[];
  pluginRoots: string[];
  modelTimeoutMs: number;
}

`;

const runBody = lines.slice(runGatewayStart, runGatewayEnd + 1).join("\n").replace(/^async function runGateway/, "export async function runGateway");
const parseBody = lines.slice(parseGatewayStart + 1, parseGatewayEnd).join("\n");
const parseFn = lines.slice(parseGatewayEnd + 1, lines.findIndex((l, i) => i > parseGatewayEnd && l === "function configuredModelConfigPath()")).join("\n")
  .replace(/^async function parseGatewayArgs/, "export async function parseGatewayArgs");

fs.writeFileSync(path.join(cliSrc, "commands", "gateway.ts"), `${header}${runBody}\n\n${parseFn}\n`);

// Remove from index
const removals = [
  [runGatewayStart, runGatewayEnd + 1],
  [parseGatewayStart, lines.findIndex((l, i) => i > parseGatewayEnd && l === "function configuredModelConfigPath()")],
].sort((a, b) => b[0] - a[0]);

let newLines = [...lines];
for (const [s, e] of removals) newLines.splice(s, e - s);

newLines.splice(newLines.findIndex(l => l.includes('from "./commands/cron.js"')) + 1, 0, 'import { runGateway } from "./commands/gateway.js";');

fs.writeFileSync(indexPath, `${newLines.join("\n")}\n`);
console.log("cli index lines:", newLines.length);
