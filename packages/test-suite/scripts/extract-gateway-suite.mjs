import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(root, "src", "index.ts");
const suitePath = path.join(root, "src", "suites", "gateway.tests.ts");
const lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/);

const gatewayFunctions = [
  "testGatewayDirectToolRpc",
  "testGatewayPairingRpc",
  "testGatewayMcpCatalogAndAgent",
  "testGatewayProductionConfigGuards",
  "testGatewayWebSocket",
  "testGatewayWebhookChannel",
  "testChannelsServeBridge",
  "testChannelAdapters",
  "testGatewayCronRpc",
  "testGatewayMemoryCandidateRpc",
  "testTrajectoryPersistenceAndGatewayRpc",
  "testGatewayTierRpc",
  "testGatewaySessionTurnQueue",
  "testGatewayQueryLoop",
  "testGatewayModelCatalogBridge",
];

const gatewayCases = [
  ["gateway direct tool RPC", "testGatewayDirectToolRpc"],
  ["gateway pairing RPC", "testGatewayPairingRpc"],
  ["gateway MCP catalog and agent tool", "testGatewayMcpCatalogAndAgent"],
  ["gateway production config guards", "testGatewayProductionConfigGuards"],
  ["gateway websocket RPC and events", "testGatewayWebSocket"],
  ["gateway webhook channel", "testGatewayWebhookChannel"],
  ["gateway cron RPC", "testGatewayCronRpc"],
  ["channels serve bridge", "testChannelsServeBridge"],
  ["channel adapters", "testChannelAdapters"],
  ["gateway memory candidate review RPC", "testGatewayMemoryCandidateRpc"],
  ["trajectory persistence and gateway RPC", "testTrajectoryPersistenceAndGatewayRpc"],
  ["gateway tier RPC", "testGatewayTierRpc"],
  ["gateway session turn queue", "testGatewaySessionTurnQueue"],
  ["gateway query loop continuation", "testGatewayQueryLoop"],
  ["gateway model catalog bridge", "testGatewayModelCatalogBridge"],
];

function extractFunction(name) {
  const start = lines.findIndex(line => line.startsWith(`async function ${name}`));
  if (start < 0) throw new Error(`Missing function ${name}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].match(/^async function test/)) {
      end = i;
      break;
    }
  }
  return { start, end, body: lines.slice(start, end) };
}

const chunks = [];
const toRemove = [];
for (const name of gatewayFunctions) {
  const { start, end, body } = extractFunction(name);
  chunks.push(...body, "");
  toRemove.push({ start, end });
}

const importEnd = lines.findIndex(line => line.startsWith("async function main"));
const importBlock = lines.slice(0, importEnd).filter(line => !line.includes('from "./runner.js"') && !line.includes('from "./lib/test-helpers.js"'));

const suiteHeader = `${importBlock.join("\n")}
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
`;

const exports = gatewayCases.map(([label, fn]) => `  ["${label}", ${fn}],`).join("\n");

const suiteFile = `${suiteHeader}
${chunks.join("\n")}
export const gatewayTestCases: TestCase[] = [
${exports}
];
`;

fs.mkdirSync(path.dirname(suitePath), { recursive: true });
fs.writeFileSync(suitePath, suiteFile);

// Remove functions from index (reverse order to preserve indices)
const sorted = toRemove.sort((a, b) => b.start - a.start);
let newLines = [...lines];
for (const { start, end } of sorted) {
  newLines.splice(start, end - start);
}

// Update main() test list - remove gateway entries, add import
const mainStart = newLines.findIndex(line => line.startsWith("async function main"));
const testsEnd = newLines.findIndex((line, i) => i > mainStart && line.trim() === "];");
const gatewayLabels = new Set(gatewayCases.map(([label]) => label));
const testLines = newLines.slice(mainStart, testsEnd + 1);
const filteredMain = testLines.filter(line => {
  const match = line.match(/\["([^"]+)"/);
  if (!match) return true;
  return !gatewayLabels.has(match[1]);
});

const importSuite = 'import { gatewayTestCases } from "./suites/gateway.tests.js";';
const helperImport = newLines.findIndex(line => line.includes('from "./lib/test-helpers.js"'));
newLines.splice(helperImport + 1, 0, importSuite);

// Replace main tests array closing with spread
const closeIdx = newLines.findIndex((line, i) => i > mainStart && line.trim() === "];");
newLines.splice(mainStart, closeIdx - mainStart + 1, ...filteredMain);
// inject spread before ];
const close2 = newLines.findIndex((line, i) => i > mainStart && line.trim() === "];");
newLines.splice(close2, 0, "    ...gatewayTestCases,");

fs.writeFileSync(indexPath, `${newLines.join("\n")}\n`);
console.log("gateway suite lines:", suiteFile.split("\n").length);
console.log("index lines:", newLines.length);
