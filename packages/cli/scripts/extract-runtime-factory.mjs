import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const implPath = path.join(srcDir, "cli-impl.ts");
const lines = fs.readFileSync(implPath, "utf8").split(/\r?\n/);

const constStart = lines.findIndex(l => l.startsWith("const MAX_PLUGIN_MEMORY_RESULTS"));
const constEnd = lines.findIndex((l, i) => i > constStart && l === "");
const optsStart = lines.findIndex(l => l === "export interface RuntimeFactoryOptions {");
const createEnd = lines.findIndex((l, i) => i > optsStart && l === "}");
// closing brace of createRuntime - find after export async function createRuntime
const createStart = lines.findIndex(l => l.startsWith("export async function createRuntime"));
let depth = 0;
let createEndIdx = createStart;
for (let i = createStart; i < lines.length; i += 1) {
  for (const ch of lines[i]) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
  }
  if (i > createStart && depth === 0) {
    createEndIdx = i + 1;
    break;
  }
}
const pluginStart = lines.findIndex(l => l.startsWith("async function loadConfiguredPlugins"));
const deactivateStart = lines.findIndex(l => l.startsWith("export async function deactivateLoadedPlugins"));
let deactivateEndIdx = deactivateStart;
depth = 0;
for (let i = deactivateStart; i < lines.length; i += 1) {
  for (const ch of lines[i]) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
  }
  if (i > deactivateStart && depth === 0) {
    deactivateEndIdx = i + 1;
    break;
  }
}
const pathInsideStart = lines.findIndex(l => l.startsWith("function isPathInside"));
let pathInsideEndIdx = pathInsideStart + 4;
const isRecordStart = lines.findIndex(l => l.startsWith("function isRecord("));
let isRecordEndIdx = isRecordStart + 3;

const bodyParts = [
  lines.slice(constStart, constEnd).join("\n"),
  lines.slice(optsStart, createEndIdx).join("\n"),
  lines.slice(pluginStart, deactivateEndIdx).join("\n"),
  lines.slice(pathInsideStart, pathInsideEndIdx).join("\n"),
  lines.slice(isRecordStart, isRecordEndIdx).join("\n"),
];

const header = `import path from "node:path";
import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import {
  createDragonRuntime,
  mergeSessionCompactionLayers,
  type DragonAgentRuntime,
  type DragonLifecycleHook,
  type DragonPermissionHandler,
  type ModelTierConfig,
} from "@dragon/core";
import { loadContextConfig } from "./context-config.js";
import { bootstrapAgentToolRegistry } from "./bootstrap-agent-tool-registry.js";
import {
  createFileMemoryStore,
  createFileSessionStore,
  createFileTrajectoryStore,
  createMemoryCandidateLifecycleHook,
  createMarkdownMemoryContextProvider,
  createMemoryContextProvider,
  createSessionCompactionContextProvider,
  createSqliteMemoryStore,
  type MemoryRecord,
  type MemorySearchResult,
  type MemoryStore,
  type TrajectoryStore,
} from "@dragon/memory";
import { loadDragonPlugin, type DragonPluginMemoryBackend, type LoadedDragonPlugin } from "@dragon/plugin-sdk";
import {
  catalogEntriesFromProviders,
  createModelCatalog,
  type DragonModelCatalog,
} from "@dragon/model-catalog";
import { createProviderRegistry, type ModelProvider } from "@dragon/providers";
import {
  createToolPermissionEngine,
  createToolRegistry,
  type ToolDefinition,
  type ToolPermissionEngine,
  type ToolPermissionRule,
  type ToolRegistry,
} from "@dragon/tools";
import { evaluateOrgAwarePermission, type EmployeeStore, type ToolPolicyStore } from "@dragon/org";
import { configuredAgentConfigPath, loadPersistedAgentConfig } from "./cli-impl.js";

`;

fs.writeFileSync(path.join(srcDir, "runtime-factory.ts"), `${header}${bodyParts.join("\n\n")}\n`);

// Remove from cli-impl (bottom to top)
const ranges = [
  [isRecordStart, isRecordEndIdx],
  [pathInsideStart, pathInsideEndIdx],
  [pluginStart, deactivateEndIdx],
  [constStart, createEndIdx],
].sort((a, b) => b[0] - a[0]);

let impl = [...lines];
for (const [s, e] of ranges) {
  if (s >= 0 && e > s) impl.splice(s, e - s);
}

const reexport = `
export {
  createRuntime,
  deactivateLoadedPlugins,
  type RuntimeFactoryOptions,
  type RuntimeFactoryResult,
} from "./runtime-factory.js";
`;

// Insert reexport after isHelpArgs block
const helpEnd = impl.findIndex((l, i) => l.startsWith("export function isHelpArgs") && impl[i + 4]?.startsWith("}")) ;
const insertAt = impl.findIndex((l, i) => i > 0 && l === "}" && impl[i - 1]?.includes("arg === \"-h\"")) + 1;
impl.splice(insertAt, 0, ...reexport.trim().split("\n"), "");

fs.writeFileSync(implPath, `${impl.join("\n")}\n`);
console.log("runtime-factory.ts lines:", bodyParts.join("\n").split("\n").length);
console.log("cli-impl.ts lines:", impl.length);
