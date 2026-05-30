#!/usr/bin/env node
/**
 * One-shot rebrand: Dragon → Loong across the monorepo (excludes node_modules, dist).
 */
import { readdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".turbo", "target"]);
const SKIP_FILES = new Set(["pnpm-lock.yaml", "rebrand-dragon-to-loong.mjs"]);

const TEXT_REPLACEMENTS = [
  // Package scope
  ["@dragon/", "@loong/"],
  // Longest identifiers first
  ["DragonRuntimeDelegationToolOutput", "LoongRuntimeDelegationToolOutput"],
  ["DragonRuntimeDelegationToolInput", "LoongRuntimeDelegationToolInput"],
  ["DragonRuntimeDelegationToolOptions", "LoongRuntimeDelegationToolOptions"],
  ["DragonRuntimeDelegationExecutorOptions", "LoongRuntimeDelegationExecutorOptions"],
  ["DragonRuntimeDelegatedTaskOutput", "LoongRuntimeDelegatedTaskOutput"],
  ["assertDragonGatewayWebhookPayload", "assertLoongGatewayWebhookPayload"],
  ["DragonPermissionEventPayload", "LoongPermissionEventPayload"],
  ["DragonLifecycleHookRequest", "LoongLifecycleHookRequest"],
  ["DragonLifecycleHookPhase", "LoongLifecycleHookPhase"],
  ["DefaultDragonAgentRuntime", "DefaultLoongAgentRuntime"],
  ["DragonAgentConfigSnapshot", "LoongAgentConfigSnapshot"],
  ["DragonChannelGatewayOptions", "LoongChannelGatewayOptions"],
  ["DragonPermissionHandler", "LoongPermissionHandler"],
  ["DragonPermissionRequest", "LoongPermissionRequest"],
  ["DragonPermissionResponse", "LoongPermissionResponse"],
  ["DragonEventStreamOptions", "LoongEventStreamOptions"],
  ["DragonEventStreamHandle", "LoongEventStreamHandle"],
  ["assertDragonVersionCompatible", "assertLoongVersionCompatible"],
  ["HOST_DRAGON_VERSION", "HOST_LOONG_VERSION"],
  ["openDragonEventStream", "openLoongEventStream"],
  ["DragonRuntimeOptions", "LoongRuntimeOptions"],
  ["DragonAgentRuntime", "LoongAgentRuntime"],
  ["DragonLifecycleHook", "LoongLifecycleHook"],
  ["DragonChannelMessage", "LoongChannelMessage"],
  ["DragonThinkingLevel", "LoongThinkingLevel"],
  ["DragonAgentProfile", "LoongAgentProfile"],
  ["createDragonRuntime", "createLoongRuntime"],
  ["resolveDragonDataRoot", "resolveLoongDataRoot"],
  ["dragonConfigDir", "loongConfigDir"],
  ["isDragonSource", "isLoongSource"],
  ["useDragonEvents", "useLoongEvents"],
  ["DragonTurnResult", "LoongTurnResult"],
  ["DragonTurnInput", "LoongTurnInput"],
  ["DragonSource", "LoongSource"],
  ["DragonMessage", "LoongMessage"],
  ["DragonEvent", "LoongEvent"],
  ["dragonVersion", "loongVersion"],
  ["dragon-paths", "loong-paths"],
  ["dragon.plugin.json", "loong.plugin.json"],
  ["dragon-agent-framework", "loong-agent-framework"],
  ["dragon.gateway.secret", "loong.gateway.secret"],
  ["dragon-channels-bridge", "loong-channels-bridge"],
  ["dragon-openai", "loong-openai"],
  ["DRAGON_", "LOONG_"],
  [".dragon", ".loong"],
  // CLI / commands (after .dragon to avoid breaking paths incorrectly)
  ['"dragon"', '"loong"'],
  ["Usage: dragon ", "Usage: loong "],
  ["dragon agent and loong gateway", "loong agent and loong gateway"],
  ["dragon agent and dragon gateway", "loong agent and loong gateway"],
  ["by dragon agent and dragon gateway", "by loong agent and loong gateway"],
  ["only supported by dragon agent", "only supported by loong agent"],
  ["dragon chat ", "loong chat "],
  ["dragon gateway", "loong gateway"],
  ["dragon cron", "loong cron"],
  ["dragon channels", "loong channels"],
  ["dragon agent", "loong agent"],
  ["`dragon ", "`loong "],
  ["node packages/cli/dist/index.js gateway", "node packages/cli/dist/index.js gateway"],
  // Brand strings
  ["Dragon Authors", "Loong Authors"],
  ["Dragon (Qianlong)", "Loong"],
  ["Dragon · 潜龙", "Loong"],
  ["Dragon ·", "Loong ·"],
  ["Dragon README Preview", "Loong README Preview"],
  ["Dragon Test", "Loong Test"],
  ["Dragon Browser", "Loong Browser"],
  ["Dragon & Browser", "Loong & Browser"],
  ["Dragon &amp; Browser", "Loong &amp; Browser"],
  ["Dragon OpenAI Compatible", "Loong OpenAI Compatible"],
  ["Dragon gateway listening", "Loong gateway listening"],
  ["Dragon is thinking", "Loong is thinking"],
  ["Dragon Reuse Plan", "Loong Reuse Plan"],
  ["Dragon has two goals", "Loong has two goals"],
  ["into Dragon runtime", "into Loong runtime"],
  ["Dragon action", "Loong action"],
  ["Dragon changes:", "Loong changes:"],
  ["Dragon package", "Loong package"],
  ["Dragon docs", "Loong docs"],
  ["Dragon requirements", "Loong requirements"],
  ["Plugin requires Dragon ", "Plugin requires Loong "],
  ["host is Dragon ", "host is Loong "],
  ["streamed Dragon turns", "streamed Loong turns"],
  ["become Dragon tool", "become Loong tool"],
  ["Dragon tool call", "Loong tool call"],
  ["Dragon event shape", "Loong event shape"],
  ["Dragon local deployment", "Loong local deployment"],
  ["https://dragon.local", "https://loong.local"],
  ["dragon-dev", "loong-dev"],
  ["loong-agent/dragon:", "loong-agent/loong:"],
  ["Dragon（潜龙）", "Loong"],
  ["Dragon（", "Loong（"],
  ["Dragon (", "Loong ("],
  ["# Dragon", "# Loong"],
  ["# @dragon/", "# @loong/"],
  ["@dragon/", "@loong/"],
  ["Dragon —", "Loong —"],
  ["Dragon 标志", "Loong 标志"],
  ["Dragon 中的对应", "Loong 中的对应"],
  ["Dragon 是", "Loong 是"],
  ["Dragon 智能体", "Loong 智能体"],
  ["Dragon 未提供", "Loong 未提供"],
  ["升级 Dragon", "升级 Loong"],
  ["Dragon Gateway", "Loong Gateway"],
  ["Dragon gateway", "Loong gateway"],
  ["Dragon 需要", "Loong 需要"],
  ["running Dragon Gateway", "running Loong Gateway"],
  ["Dragon 默认", "Loong 默认"],
  ["Copyright (c) 2026 Dragon", "Copyright (c) 2026 Loong"],
  ["dragon gateway --host", "loong gateway --host"],
  ["GATEWAY_SECRET_STORAGE_KEY", "GATEWAY_SECRET_STORAGE_KEY"],
];

const FILE_RENAMES = [
  ["packages/cli/src/dragon-paths.ts", "packages/cli/src/loong-paths.ts"],
  ["packages/plugin-openai-compatible/dragon.plugin.json", "packages/plugin-openai-compatible/loong.plugin.json"],
  ["packages/plugin-openrouter-compatible/dragon.plugin.json", "packages/plugin-openrouter-compatible/loong.plugin.json"],
  ["packages/plugin-anthropic-compatible/dragon.plugin.json", "packages/plugin-anthropic-compatible/loong.plugin.json"],
  ["packages/plugin-git-tools/dragon.plugin.json", "packages/plugin-git-tools/loong.plugin.json"],
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

function applyReplacements(content) {
  let out = content;
  for (const [from, to] of TEXT_REPLACEMENTS) {
    if (from === to) continue;
    out = out.split(from).join(to);
  }
  return out;
}

async function main() {
  const files = await walk(ROOT);
  let changed = 0;
  for (const file of files) {
    const before = await readFile(file, "utf8");
    const after = applyReplacements(before);
    if (after !== before) {
      await writeFile(file, after, "utf8");
      changed++;
    }
  }
  console.log(`Updated ${changed} files`);

  for (const [fromRel, toRel] of FILE_RENAMES) {
    const from = path.join(ROOT, fromRel);
    const to = path.join(ROOT, toRel);
    try {
      await stat(from);
      await rename(from, to);
      console.log(`Renamed ${fromRel} → ${toRel}`);
    } catch {
      console.warn(`Skip rename (missing): ${fromRel}`);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
