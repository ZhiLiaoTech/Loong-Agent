#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".turbo", "target"]);
const SKIP_FILES = new Set(["pnpm-lock.yaml", "rebrand-dragon-to-loong.mjs", "rebrand-dragon-pass2.mjs"]);

const REPLACEMENTS = [
  ["DragonPluginMemoryBackend", "LoongPluginMemoryBackend"],
  ["DragonProviderModelCatalogEntry", "LoongProviderModelCatalogEntry"],
  ["DragonPermissionEventPayload", "LoongPermissionEventPayload"],
  ["DragonLifecycleHookRequest", "LoongLifecycleHookRequest"],
  ["DragonLifecycleHookPhase", "LoongLifecycleHookPhase"],
  ["DragonModelCatalogEntry", "LoongModelCatalogEntry"],
  ["DragonDelegatedTaskExecutor", "LoongDelegatedTaskExecutor"],
  ["DragonDelegationRunResult", "LoongDelegationRunResult"],
  ["DragonRuntimeDelegationTool", "LoongRuntimeDelegationTool"],
  ["DragonChannelGatewayOptions", "LoongChannelGatewayOptions"],
  ["DragonPluginLoadOptions", "LoongPluginLoadOptions"],
  ["DragonPluginManifest", "LoongPluginManifest"],
  ["LoadedDragonPlugin", "LoadedLoongPlugin"],
  ["DragonModelCatalog", "LoongModelCatalog"],
  ["DragonContextProvider", "LoongContextProvider"],
  ["DragonCancelledError", "LoongCancelledError"],
  ["DragonPluginContext", "LoongPluginContext"],
  ["DragonWebhookPayload", "LoongWebhookPayload"],
  ["DragonTrajectoryRecord", "LoongTrajectoryRecord"],
  ["DragonTrajectoryStore", "LoongTrajectoryStore"],
  ["DragonMemoryCandidate", "LoongMemoryCandidate"],
  ["DragonMemoryBackend", "LoongMemoryBackend"],
  ["DragonPermissionHandler", "LoongPermissionHandler"],
  ["DragonPermissionRequest", "LoongPermissionRequest"],
  ["DragonPermissionResponse", "LoongPermissionResponse"],
  ["DragonLifecycleHook", "LoongLifecycleHook"],
  ["DragonChannelMessage", "LoongChannelMessage"],
  ["DragonChannelAdapter", "LoongChannelAdapter"],
  ["DragonCronJobStore", "LoongCronJobStore"],
  ["DragonCronSchedule", "LoongCronSchedule"],
  ["DragonDelegatedTask", "LoongDelegatedTask"],
  ["DragonAgentProfile", "LoongAgentProfile"],
  ["DragonThinkingLevel", "LoongThinkingLevel"],
  ["DragonProviderConfig", "LoongProviderConfig"],
  ["DragonProviderModel", "LoongProviderModel"],
  ["DragonGatewayClient", "LoongGatewayClient"],
  ["DragonPlugin", "LoongPlugin"],
  ["loadDragonPlugin", "loadLoongPlugin"],
  ["createDragonModelCatalog", "createLoongModelCatalog"],
  ["isDragonThinking", "isLoongThinking"],
  ["isDragonTurnStatus", "isLoongTurnStatus"],
  ["isDragonSource", "isLoongSource"],
  ["dragon.openrouter-compatible", "loong.openrouter-compatible"],
  ["dragon.openai-compatible", "loong.openai-compatible"],
  ["dragon.anthropic-compatible", "loong.anthropic-compatible"],
  ["dragon.git-tools", "loong.git-tools"],
  ["dragon-anthropic", "loong-anthropic"],
  ["dragon.event", "loong.event"],
  ["dragon.local", "loong.local"],
  ["[dragon-query-loop]", "[loong-query-loop]"],
  ["Dragon plugins", "Loong plugins"],
  ["Loaded Dragon plugins", "Loaded Loong plugins"],
  ["You are Dragon,", "You are Loong,"],
  ["configured Dragon skills", "configured Loong skills"],
  ["recent Dragon run", "recent Loong run"],
  ["Dragon plugin ", "Loong plugin "],
  ["Dragon's built-in", "Loong's built-in"],
  ["Dragon plugins are", "Loong plugins are"],
  ["Dragon process", "Loong process"],
  ["Dragon validates", "Loong validates"],
  ["Dragon rejects", "Loong rejects"],
  ["Dragon translates", "Loong translates"],
  ["into Dragon `", "into Loong `"],
  ["as Dragon `", "as Loong `"],
  ["Dragon only checks", "Loong only checks"],
  ["Dragon keeps", "Loong keeps"],
  ["DragonModelCatalog.resolve", "LoongModelCatalog.resolve"],
  ["would make Dragon messy", "would make Loong messy"],
  ["Dragon providers", "Loong providers"],
  ["Dragon Reuse", "Loong Reuse"],
  ["Dragon plugin", "Loong plugin"],
  ["Dragon Authors", "Loong Authors"],
  ["Dragon runtime", "Loong runtime"],
  ["Dragon 智能体", "Loong 智能体"],
  ["Dragon 标志", "Loong 标志"],
  ["Dragon —", "Loong —"],
  ["Dragon dashboard", "Loong dashboard"],
  ["Dragon Dashboard", "Loong Dashboard"],
  ["Dragon control", "Loong control"],
  ["Dragon 控制台", "Loong 控制台"],
  ["Dragon 默认", "Loong 默认"],
  ["Dragon 名称", "Loong 名称"],
  ["Dragon 是", "Loong 是"],
  ["Dragon（", "Loong（"],
  ["@dragon/", "@loong/"],
  ["dragon:", "loong:"],
  ["  dragon\n", "  loong\n"],
  ["service: \"dragon", "service: \"loong"],
  ["name: \"dragon", "name: \"loong"],
  ["dragon-data", "loong-data"],
  ["dragon-data:", "loong-data:"],
  ["DragonAgent", "LoongAgent"],
  ["DragonOrg", "LoongOrg"],
  ["DragonTicket", "LoongTicket"],
  ["DragonApproval", "LoongApproval"],
  ["DragonCron", "LoongCron"],
  ["DragonChannel", "LoongChannel"],
  ["DragonSkill", "LoongSkill"],
  ["DragonTool", "LoongTool"],
  ["DragonMemory", "LoongMemory"],
  ["DragonTier", "LoongTier"],
  ["DragonSession", "LoongSession"],
  ["DragonRun", "LoongRun"],
  ["DragonEvent", "LoongEvent"],
  ["DragonSource", "LoongSource"],
  ["DragonTurn", "LoongTurn"],
  ["DragonMessage", "LoongMessage"],
  ["DragonAgent", "LoongAgent"],
  ["DragonRuntime", "LoongRuntime"],
  ["DragonModel", "LoongModel"],
  ["DragonProvider", "LoongProvider"],
  ["DragonGateway", "LoongGateway"],
  ["DragonPermission", "LoongPermission"],
  ["DragonLifecycle", "LoongLifecycle"],
  ["DragonDelegated", "LoongDelegated"],
  ["DragonDelegation", "LoongDelegation"],
  ["DragonTrajectory", "LoongTrajectory"],
  ["DragonContext", "LoongContext"],
  ["DragonCancelled", "LoongCancelled"],
  ["DragonPlugin", "LoongPlugin"],
  ["DragonQuery", "LoongQuery"],
  ["DragonThinking", "LoongThinking"],
  ["DragonWebhook", "LoongWebhook"],
  ["DragonHttp", "LoongHttp"],
  ["DragonWs", "LoongWs"],
  ["DragonSse", "LoongSse"],
  ["DragonRpc", "LoongRpc"],
  ["DragonApi", "LoongApi"],
  ["DragonCli", "LoongCli"],
  ["DragonHost", "LoongHost"],
  ["DragonUi", "LoongUi"],
  ["DragonStudio", "LoongStudio"],
  ["DragonClient", "LoongClient"],
  ["DragonCore", "LoongCore"],
  ["DragonSecurity", "LoongSecurity"],
  ["DragonTools", "LoongTools"],
  ["DragonSkills", "LoongSkills"],
  ["DragonMemory", "LoongMemory"],
  ["DragonCron", "LoongCron"],
  ["DragonOrg", "LoongOrg"],
  ["DragonDelegation", "LoongDelegation"],
  ["DragonChannels", "LoongChannels"],
  ["DragonGateway", "LoongGateway"],
  ["DragonTest", "LoongTest"],
  ["DragonBrowser", "LoongBrowser"],
  ["DragonAuthors", "LoongAuthors"],
  ["DragonAuthors", "LoongAuthors"],
  ["Dragon ", "Loong "],
  ["dragon ", "loong "],
  ["dragon.", "loong."],
  ["dragon-", "loong-"],
  ["Dragon,", "Loong,"],
  ["Dragon.", "Loong."],
  ["Dragon'", "Loong'"],
  ["Dragon\"", "Loong\""],
  ["Dragon<", "Loong<"],
  ["Dragon>", "Loong>"],
  ["Dragon/", "Loong/"],
  ["Dragon)", "Loong)"],
  ["Dragon(", "Loong("],
  ["Dragon]", "Loong]"],
  ["Dragon[", "Loong["],
  ["Dragon:", "Loong:"],
  ["Dragon;", "Loong;"],
  ["Dragon\n", "Loong\n"],
  ["dragon\n", "loong\n"],
  ["dragon)", "loong)"],
  ["dragon(", "loong("],
  ["dragon]", "loong]"],
  ["dragon[", "loong["],
  ["dragon,", "loong,"],
  ["dragon;", "loong;"],
  ["dragon'", "loong'"],
  ["dragon\"", "loong\""],
];

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".html", ".css",
  ".yml", ".yaml", ".rs", ".toml", ".example", ".txt", ".sh",
]);

async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, files);
    } else {
      const ext = path.extname(entry.name);
      if (TEXT_EXTENSIONS.has(ext) || entry.name === ".env.example") {
        if (!SKIP_FILES.has(entry.name)) files.push(full);
      }
    }
  }
  return files;
}

async function main() {
  const files = await walk(ROOT);
  let changed = 0;
  for (const file of files) {
    let content = await readFile(file, "utf8");
    const before = content;
    for (const [from, to] of REPLACEMENTS) {
      content = content.split(from).join(to);
    }
    if (content !== before) {
      await writeFile(file, content, "utf8");
      changed++;
    }
  }
  console.log(`Pass 2 updated ${changed} files`);
}

main();
