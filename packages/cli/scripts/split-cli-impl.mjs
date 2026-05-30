import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const implPath = path.join(src, "cli-impl.ts");
let lines = fs.readFileSync(implPath, "utf8").split(/\r?\n/);

// Remove shebang from impl
if (lines[0].startsWith("#!")) lines.shift();

const exportNames = [
  "isHelpArgs",
  "runChat",
  "createBuiltinProviders",
  "createRuntime",
  "configuredModelConfigPath",
  "configuredTierConfigPath",
  "configuredAgentConfigPath",
  "loadPersistedTierConfig",
  "createModelConfigStore",
  "createAgentConfigStore",
  "createTierConfigStore",
  "configuredSkillRoots",
  "configuredPluginRoots",
  "resolveSkillRoot",
  "resolveExistingPluginRoot",
  "uniquePaths",
  "deactivateLoadedPlugins",
  "summarizeLoadedPlugins",
  "summarizeProviders",
];

for (const name of exportNames) {
  lines = lines.map(l => {
    if (l === undefined) return l;
    if (l.startsWith(`async function ${name}(`)) return l.replace("async function", "export async function");
    if (l.startsWith(`function ${name}(`)) return l.replace(/^function /, "export function ");
    if (l === `interface ${name} {`) return `export ${l}`;
    return l;
  });
}
lines = lines.map(l => {
  if (l === "interface RuntimeFactoryOptions {") return "export interface RuntimeFactoryOptions {";
  if (l === "interface RuntimeFactoryResult {") return "export interface RuntimeFactoryResult {";
  return l;
});

// Remove runGateway block
const runStart = lines.findIndex(l => l === "async function runGateway(args: string[]): Promise<void> {" || l === "export async function runGateway(args: string[]): Promise<void> {");
const runEnd = lines.findIndex((l, i) => i > runStart && l === "}");
// find correct closing - runGateway ends at line 508 with single }
let depth = 0;
let runEndIdx = runStart;
for (let i = runStart; i < lines.length; i += 1) {
  for (const ch of lines[i]) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
  }
  if (i > runStart && depth === 0) {
    runEndIdx = i + 1;
    break;
  }
}

const parseStart = lines.findIndex(l => l.startsWith("interface ParsedGatewayArgs"));
const parseEnd = lines.findIndex((l, i) => i > parseStart && l === "}" && lines[i + 1]?.startsWith("function configuredModelConfigPath"));
const parseEndIdx = parseEnd > parseStart ? parseEnd + 1 : parseStart;

const removeRanges = [[runStart, runEndIdx], [parseStart, parseEndIdx]].sort((a, b) => b[0] - a[0]);
for (const [s, e] of removeRanges) {
  if (s >= 0 && e > s) lines.splice(s, e - s);
}

fs.writeFileSync(implPath, `${lines.join("\n")}\n`);

// Thin index.ts
const indexContent = `#!/usr/bin/env node

import { parseChannelsServeArgs, runChannelsServe } from "./channels-serve.js";
import { runCron } from "./commands/cron.js";
import { runGateway } from "./commands/gateway.js";
import { isHelpArgs, runChat } from "./cli-impl.js";
import { printHelp } from "./help.js";
import { waitForShutdown } from "./shutdown.js";

const [, , command = "help", ...args] = process.argv;

try {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    process.exitCode = 0;
  } else if (command === "chat") {
    if (isHelpArgs(args)) {
      printHelp();
    } else {
      await runChat("chat", args);
    }
    process.exitCode = 0;
  } else if (command === "agent") {
    if (isHelpArgs(args)) {
      printHelp();
    } else {
      await runChat("agent", args);
    }
    process.exitCode = 0;
  } else if (command === "gateway") {
    if (isHelpArgs(args)) {
      printHelp();
    } else {
      await runGateway(args);
    }
    process.exitCode = 0;
  } else if (command === "cron") {
    if (isHelpArgs(args)) {
      printHelp();
    } else {
      await runCron(args);
    }
    process.exitCode = 0;
  } else if (command === "channels") {
    const sub = args[0];
    if (sub === "serve") {
      const serveArgs = args.slice(1);
      if (isHelpArgs(serveArgs)) {
        printHelp();
      } else {
        const options = await parseChannelsServeArgs(serveArgs);
        const bridge = await runChannelsServe(options);
        process.stderr.write(\`Loong channels bridge listening on \${bridge.url}\\n\`);
        process.stderr.write(\`Forwarding to \${options.gatewayUrl}/channels/webhook\\n\`);
        await waitForShutdown();
        await bridge.stop();
      }
    } else {
      console.error("Usage: loong channels serve [--port <port>] [--gateway-url <url>]");
      process.exitCode = 2;
    }
    process.exitCode = 0;
  } else {
    console.error(\`Unknown command: \${command}\`);
    printHelp();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
`;

fs.writeFileSync(path.join(src, "index.ts"), indexContent);
console.log("cli-impl lines:", lines.length);
