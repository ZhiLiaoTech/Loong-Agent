import path from "node:path";
import { resolveLoongDataRoot } from "./loong-paths.js";
import type { LoongTierHint } from "@loong/core";
import { configuredPluginRoots, configuredSkillRoots, resolveExistingPluginRoot, resolveSkillRoot, uniquePaths } from "./cli-impl.js";
export interface ParsedChatArgs {
  message: string;
  sessionId: string;
  sessionDir: string;
  memoryDir: string;
  memoryBackendId?: string;
  model?: string;
  modelFallbacks?: string[];
  noSession: boolean;
  allowWrite: boolean;
  allowExec: boolean;
  failOnAsk: boolean;
  skillRoots?: string[];
  pluginRoots: string[];
  attachments?: ParsedAttachmentSpec[];
  tier?: LoongTierHint;
  queryLoop?: boolean;
  queryLoopMaxTurns?: number;
  forceQueryLoop?: boolean;
  profileId?: string;
}

interface ParsedAttachmentSpec {
  filePath: string;
}

export function parseChatArgs(mode: "chat" | "agent", args: string[]): ParsedChatArgs {
  const messageParts: string[] = [];
  let sessionId = process.env.LOONG_SESSION_ID?.trim() || "cli";
  const dataRoot = resolveLoongDataRoot();
  let sessionDir = process.env.LOONG_SESSION_DIR?.trim() || path.join(dataRoot, "sessions");
  let memoryDir = process.env.LOONG_MEMORY_DIR?.trim() || path.join(dataRoot, "memory");
  let memoryBackendId = mode === "agent" ? process.env.LOONG_MEMORY_BACKEND?.trim() || undefined : undefined;
  let model = process.env.LOONG_MODEL?.trim() || undefined;
  const modelFallbacks = parseListEnv(process.env.LOONG_MODEL_FALLBACKS);
  let tier: LoongTierHint | undefined = parseTierName(process.env.LOONG_TIER);
  let queryLoop = mode === "agent" && process.env.LOONG_QUERY_LOOP?.trim() === "1";
  let queryLoopMaxTurns: number | undefined;
  let forceQueryLoop = mode === "agent" && process.env.LOONG_FORCE_QUERY_LOOP?.trim() === "1";
  let profileId = mode === "agent" ? process.env.LOONG_AGENT_PROFILE?.trim() || undefined : undefined;
  let noSession = false;
  let allowWrite = false;
  let allowExec = mode === "agent" && process.env.LOONG_ALLOW_EXEC?.trim() === "1";
  let failOnAsk = false;
  const defaultSkillRoots = mode === "agent" ? configuredSkillRoots() : [];
  const skillRoots: string[] = [];
  const pluginRoots = configuredPluginRoots();
  const attachments: ParsedAttachmentSpec[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-session") {
      noSession = true;
      continue;
    }
    if (arg === "--allow-write") {
      allowWrite = true;
      continue;
    }
    if (mode === "agent" && arg === "--allow-exec") {
      allowExec = true;
      continue;
    }
    if (arg === "--fail-on-ask") {
      failOnAsk = true;
      continue;
    }
    if (mode === "agent" && arg === "--query-loop") {
      queryLoop = true;
      continue;
    }
    if (mode === "agent" && arg === "--finish-task") {
      queryLoop = true;
      forceQueryLoop = true;
      continue;
    }
    if (mode === "agent" && arg === "--profile") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --profile <id> <message>`);
      }
      profileId = value;
      index += 1;
      continue;
    }
    if (mode === "agent" && arg?.startsWith("--profile=")) {
      const value = arg.slice("--profile=".length).trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --profile=<id> <message>`);
      }
      profileId = value;
      continue;
    }
    if (mode === "agent" && arg === "--query-loop-max-turns") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --query-loop-max-turns <n> <message>`);
      }
      queryLoopMaxTurns = parseQueryLoopMaxTurns(value);
      index += 1;
      continue;
    }
    if (mode === "agent" && arg?.startsWith("--query-loop-max-turns=")) {
      queryLoopMaxTurns = parseQueryLoopMaxTurns(arg.slice("--query-loop-max-turns=".length).trim());
      continue;
    }
    if (arg === "--attach") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --attach <path> <message>`);
      }
      attachments.push({ filePath: path.resolve(value) });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--attach=")) {
      const value = arg.slice("--attach=".length).trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --attach=<path> <message>`);
      }
      attachments.push({ filePath: path.resolve(value) });
      continue;
    }
    if (arg === "--model") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --model <provider:model> <message>`);
      }
      model = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--model=")) {
      const value = arg.slice("--model=".length).trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --model=<provider:model> <message>`);
      }
      model = value;
      continue;
    }
    if (arg === "--model-fallback") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --model-fallback <provider:model> <message>`);
      }
      modelFallbacks.push(value);
      index += 1;
      continue;
    }
    if (arg === "--tier") {
      const value = args[index + 1]?.trim();
      const parsed = parseTierName(value);
      if (!parsed) {
        throw new Error(`Usage: loong ${mode} --tier <fast|standard|deep> <message>`);
      }
      tier = parsed;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--tier=")) {
      const value = arg.slice("--tier=".length).trim();
      const parsed = parseTierName(value);
      if (!parsed) {
        throw new Error(`Usage: loong ${mode} --tier=<fast|standard|deep> <message>`);
      }
      tier = parsed;
      continue;
    }
    if (arg?.startsWith("--model-fallback=")) {
      const value = arg.slice("--model-fallback=".length).trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --model-fallback=<provider:model> <message>`);
      }
      modelFallbacks.push(value);
      continue;
    }
    if (arg === "--session") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --session <id> <message>`);
      }
      sessionId = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--session=")) {
      const value = arg.slice("--session=".length).trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --session=<id> <message>`);
      }
      sessionId = value;
      continue;
    }
    if (arg === "--session-dir") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --session-dir <path> <message>`);
      }
      sessionDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--session-dir=")) {
      const value = arg.slice("--session-dir=".length).trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --session-dir=<path> <message>`);
      }
      sessionDir = path.resolve(value);
      continue;
    }
    if (arg === "--memory-dir") {
      if (mode !== "agent") {
        throw new Error("--memory-dir is only supported by loong agent and loong gateway.");
      }
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --memory-dir <path> <message>`);
      }
      memoryDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--memory-dir=")) {
      if (mode !== "agent") {
        throw new Error("--memory-dir is only supported by loong agent and loong gateway.");
      }
      const value = arg.slice("--memory-dir=".length).trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --memory-dir=<path> <message>`);
      }
      memoryDir = path.resolve(value);
      continue;
    }
    if (arg === "--memory-backend") {
      if (mode !== "agent") {
        throw new Error("--memory-backend is only supported by loong agent and loong gateway.");
      }
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --memory-backend <id> <message>`);
      }
      memoryBackendId = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--memory-backend=")) {
      if (mode !== "agent") {
        throw new Error("--memory-backend is only supported by loong agent and loong gateway.");
      }
      const value = arg.slice("--memory-backend=".length).trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --memory-backend=<id> <message>`);
      }
      memoryBackendId = value;
      continue;
    }
    if (arg === "--skill-root") {
      if (mode !== "agent") {
        throw new Error("--skill-root is only supported by loong agent and loong gateway.");
      }
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --skill-root <path> <message>`);
      }
      skillRoots.push(resolveSkillRoot(value));
      index += 1;
      continue;
    }
    if (arg?.startsWith("--skill-root=")) {
      if (mode !== "agent") {
        throw new Error("--skill-root is only supported by loong agent and loong gateway.");
      }
      const value = arg.slice("--skill-root=".length).trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --skill-root=<path> <message>`);
      }
      skillRoots.push(resolveSkillRoot(value));
      continue;
    }
    if (arg === "--plugin-root") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --plugin-root <path> <message>`);
      }
      pluginRoots.push(resolveExistingPluginRoot(value));
      index += 1;
      continue;
    }
    if (arg?.startsWith("--plugin-root=")) {
      const value = arg.slice("--plugin-root=".length).trim();
      if (!value) {
        throw new Error(`Usage: loong ${mode} --plugin-root=<path> <message>`);
      }
      pluginRoots.push(resolveExistingPluginRoot(value));
      continue;
    }
    messageParts.push(arg ?? "");
  }

  const message = messageParts.join(" ").trim();
  if (!message && attachments.length === 0) {
    throw new Error(`Usage: loong ${mode} [--session <id>] [--no-session] [--attach <path>] <message>`);
  }

  return {
    message,
    sessionId,
    sessionDir: path.resolve(sessionDir),
    memoryDir: path.resolve(memoryDir),
    ...(memoryBackendId !== undefined ? { memoryBackendId } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(modelFallbacks.length > 0 ? { modelFallbacks } : {}),
    noSession,
    allowWrite,
    allowExec,
    failOnAsk,
    pluginRoots: uniquePaths(pluginRoots),
    ...(mode === "agent" ? { skillRoots: uniquePaths([...skillRoots, ...defaultSkillRoots]) } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(tier !== undefined ? { tier } : {}),
    ...(queryLoop ? { queryLoop: true } : {}),
    ...(queryLoopMaxTurns !== undefined ? { queryLoopMaxTurns } : {}),
    ...(forceQueryLoop ? { forceQueryLoop: true } : {}),
    ...(profileId !== undefined ? { profileId } : {}),
  };
}

function parseQueryLoopMaxTurns(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("--query-loop-max-turns must be a positive integer.");
  }
  return Math.min(10, Math.floor(parsed));
}

function parseTierName(value: string | undefined): LoongTierHint | undefined {
  const trimmed = value?.trim();
  if (trimmed === "fast" || trimmed === "standard" || trimmed === "deep") {
    return trimmed;
  }
  return undefined;
}

function parseListEnv(value: string | undefined): string[] {
  return value === undefined
    ? []
    : value.split(",").map(item => item.trim()).filter(Boolean);
}

