/**
 * Extract named test functions from src/index.ts into src/suites/<name>.tests.ts
 * Usage: node scripts/extract-suite.mjs <suiteName> <fn1> <fn2> ...
 * Cases file: scripts/suites/<suiteName>.cases.json — [["label", "fnName"], ...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const suiteName = process.argv[2];
const functionNames = process.argv.slice(3);
if (!suiteName || functionNames.length === 0) {
  console.error("Usage: node extract-suite.mjs <suiteName> <functionName> ...");
  process.exit(1);
}

const casesPath = path.join(root, "scripts", "suites", `${suiteName}.cases.json`);
const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));
const exportName = `${suiteName}TestCases`;

const indexPath = path.join(root, "src", "index.ts");
const suitePath = path.join(root, "src", "suites", `${suiteName}.tests.ts`);
const lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/);

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
for (const name of functionNames) {
  const { start, end, body } = extractFunction(name);
  chunks.push(...body, "");
  toRemove.push({ start, end });
}

const importEnd = lines.findIndex(line => line.startsWith("async function main"));
const importBlock = lines.slice(0, importEnd).filter(line =>
  !line.includes('from "./runner.js"')
  && !line.includes('from "./lib/test-helpers.js"')
  && !line.includes('from "./suites/')
  && !line.includes('mergeAllTestCases'));

const suiteFile = `${importBlock.join("\n")}
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

${chunks.join("\n")}
export const ${exportName}: TestCase[] = [
${cases.map(([label, fn]) => `  ["${label}", ${fn}],`).join("\n")}
];
`;

fs.mkdirSync(path.dirname(suitePath), { recursive: true });
fs.writeFileSync(suitePath, suiteFile);

const sorted = toRemove.sort((a, b) => b.start - a.start);
let newLines = [...lines];
for (const { start, end } of sorted) {
  newLines.splice(start, end - start);
}

const caseLabels = new Set(cases.map(([label]) => label));
const importLine = `import { ${exportName} } from "./suites/${suiteName}.tests.js";`;
if (!newLines.some(line => line.includes(importLine))) {
  const helperImport = newLines.findIndex(line => line.includes('from "./lib/test-helpers.js"'));
  newLines.splice(helperImport + 1, 0, importLine);
}

const mainStart = newLines.findIndex(line => line.startsWith("async function main"));
const testsEnd = newLines.findIndex((line, i) => i > mainStart && line.trim() === "];");
const testLines = newLines.slice(mainStart, testsEnd + 1);
const filteredMain = testLines.filter(line => {
  const match = line.match(/\["([^"]+)"/);
  if (!match) return true;
  return !caseLabels.has(match[1]);
});
const closeIdx = filteredMain.findIndex(line => line.trim() === "];");
if (closeIdx >= 0 && !filteredMain[closeIdx - 1]?.includes(`...${exportName}`)) {
  filteredMain.splice(closeIdx, 0, `    ...${exportName},`);
}
newLines.splice(mainStart, testsEnd - mainStart + 1, ...filteredMain);

fs.writeFileSync(indexPath, `${newLines.join("\n")}\n`);
console.log(`extracted ${suiteName}, suite lines:`, suiteFile.split("\n").length, "index lines:", newLines.length);
