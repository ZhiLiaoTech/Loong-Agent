import { spawn } from "node:child_process";
import path from "node:path";
import type { DragonPlugin, DragonPluginManifest } from "@dragon/plugin-sdk";
import type { ToolDefinition, ToolInvocation, ToolJsonSchema, ToolResult } from "@dragon/tools";

interface GitStatusInput {
  porcelain?: boolean;
}

interface GitDiffInput {
  staged?: boolean;
  stat?: boolean;
  path?: string;
  maxChars?: number;
}

interface GitLogInput {
  limit?: number;
  maxChars?: number;
}

interface GitCommandOutput {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const manifest: DragonPluginManifest = {
  name: "dragon.git-tools",
  version: "0.0.0",
  entry: "dist/index.js",
  description: "Registers read-only Git inspection tools for Dragon agents.",
  dragonVersion: "0.x",
};

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_CHARS = 64_000;
const MAX_LOG_LIMIT = 100;
const TRUNCATED_MARKER = "\n[truncated]";

const gitStatusSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    porcelain: { type: "boolean" },
  },
  additionalProperties: false,
};

const gitDiffSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    staged: { type: "boolean" },
    stat: { type: "boolean" },
    path: { type: "string" },
    maxChars: { type: "number" },
  },
  additionalProperties: false,
};

const gitLogSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "number" },
    maxChars: { type: "number" },
  },
  additionalProperties: false,
};

const plugin: DragonPlugin = {
  manifest,
  activate(context) {
    context.registerTool(createGitStatusTool());
    context.registerTool(createGitDiffTool());
    context.registerTool(createGitLogTool());
  },
};

export default plugin;

function createGitStatusTool(): ToolDefinition<GitStatusInput, GitCommandOutput> {
  return {
    name: "git_status",
    description: "Inspect the current workspace Git status without modifying the repository.",
    inputSchema: gitStatusSchema,
    capabilities: ["read", "execute"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseGitStatusInput(invocation.input);
        const args = input.porcelain
          ? ["--no-optional-locks", "status", "--porcelain=v1", "--branch", "--no-renames"]
          : ["--no-optional-locks", "status", "--short", "--branch", "--no-renames"];
        return await runGit(invocation, args, MAX_OUTPUT_CHARS);
      });
    },
  };
}

function createGitDiffTool(): ToolDefinition<GitDiffInput, GitCommandOutput> {
  return {
    name: "git_diff",
    description: "Inspect unstaged or staged Git diffs without modifying the repository.",
    inputSchema: gitDiffSchema,
    capabilities: ["read", "execute"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseGitDiffInput(invocation.input);
        const args = [
          "--no-optional-locks",
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
        ];
        if (input.staged) {
          args.push("--cached");
        }
        if (input.stat) {
          args.push("--stat");
        }
        if (input.path !== undefined) {
          args.push("--", input.path);
        }
        return await runGit(invocation, args, input.maxChars ?? MAX_OUTPUT_CHARS);
      });
    },
  };
}

function createGitLogTool(): ToolDefinition<GitLogInput, GitCommandOutput> {
  return {
    name: "git_log",
    description: "Inspect recent Git commits without modifying the repository.",
    inputSchema: gitLogSchema,
    capabilities: ["read", "execute"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseGitLogInput(invocation.input);
        const args = [
          "--no-optional-locks",
          "-c",
          "core.fsmonitor=false",
          "-c",
          "core.untrackedCache=false",
          "log",
          "--oneline",
          "--decorate",
          "--no-ext-diff",
          `--max-count=${input.limit ?? 20}`,
        ];
        return await runGit(invocation, args, input.maxChars ?? MAX_OUTPUT_CHARS);
      });
    },
  };
}

async function runGit(
  invocation: ToolInvocation,
  args: string[],
  maxOutputChars: number,
): Promise<GitCommandOutput> {
  if (!invocation.workspace) {
    throw new Error("Workspace is required for Git tools.");
  }
  const cwd = path.resolve(invocation.workspace);
  return await new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: createSafeGitEnv(),
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, DEFAULT_TIMEOUT_MS);
    const forceKillTimer = setTimeout(() => {
      if (timedOut) {
        child.kill("SIGKILL");
      }
    }, DEFAULT_TIMEOUT_MS + 1000);

    child.stdout?.on("data", chunk => {
      stdout = appendBounded(stdout, chunk.toString(), maxOutputChars);
    });
    child.stderr?.on("data", chunk => {
      stderr = appendBounded(stderr, chunk.toString(), maxOutputChars);
    });
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      resolve({
        command: `git ${args.join(" ")}`,
        args,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

async function safelyInvoke<TInput, TOutput>(
  invocation: ToolInvocation<TInput>,
  fn: () => Promise<TOutput>,
): Promise<ToolResult<TOutput>> {
  try {
    return {
      id: invocation.id,
      ok: true,
      output: await fn(),
    };
  } catch (error) {
    return {
      id: invocation.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseGitStatusInput(input: unknown): GitStatusInput {
  if (input === undefined || input === null) {
    return {};
  }
  if (!isRecord(input)) {
    throw new Error("git_status input must be an object.");
  }
  return {
    ...(typeof input.porcelain === "boolean" ? { porcelain: input.porcelain } : {}),
  };
}

function parseGitDiffInput(input: unknown): GitDiffInput {
  if (input === undefined || input === null) {
    return {};
  }
  if (!isRecord(input)) {
    throw new Error("git_diff input must be an object.");
  }
  const parsed: GitDiffInput = {
    ...(typeof input.staged === "boolean" ? { staged: input.staged } : {}),
    ...(typeof input.stat === "boolean" ? { stat: input.stat } : {}),
  };
  if (typeof input.path === "string" && input.path.trim()) {
    parsed.path = normalizeRelativePath(input.path, "path");
  }
  if (typeof input.maxChars === "number") {
    parsed.maxChars = normalizeMaxChars(input.maxChars);
  }
  return parsed;
}

function parseGitLogInput(input: unknown): GitLogInput {
  if (input === undefined || input === null) {
    return {};
  }
  if (!isRecord(input)) {
    throw new Error("git_log input must be an object.");
  }
  const parsed: GitLogInput = {};
  if (typeof input.limit === "number") {
    parsed.limit = Math.min(MAX_LOG_LIMIT, Math.max(1, Math.floor(input.limit)));
  }
  if (typeof input.maxChars === "number") {
    parsed.maxChars = normalizeMaxChars(input.maxChars);
  }
  return parsed;
}

function normalizeMaxChars(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("maxChars must be a finite number.");
  }
  return Math.min(MAX_OUTPUT_CHARS, Math.max(1000, Math.floor(value)));
}

function createSafeGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    GIT_CONFIG_GLOBAL: gitNullDevice(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "6",
    GIT_CONFIG_KEY_0: "core.fsmonitor",
    GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_KEY_1: "core.untrackedCache",
    GIT_CONFIG_VALUE_1: "false",
    GIT_CONFIG_KEY_2: "core.pager",
    GIT_CONFIG_VALUE_2: "cat",
    GIT_CONFIG_KEY_3: "pager.status",
    GIT_CONFIG_VALUE_3: "cat",
    GIT_CONFIG_KEY_4: "pager.diff",
    GIT_CONFIG_VALUE_4: "cat",
    GIT_CONFIG_KEY_5: "diff.external",
    GIT_CONFIG_VALUE_5: "",
    GIT_EXTERNAL_DIFF: "",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
  if (process.env.PATH !== undefined) {
    env.PATH = process.env.PATH;
  }
  if (process.env.SystemRoot !== undefined) {
    env.SystemRoot = process.env.SystemRoot;
  }
  if (process.env.WINDIR !== undefined) {
    env.WINDIR = process.env.WINDIR;
  }
  if (process.env.COMSPEC !== undefined) {
    env.COMSPEC = process.env.COMSPEC;
  }
  if (process.env.PATHEXT !== undefined) {
    env.PATHEXT = process.env.PATHEXT;
  }
  return env;
}

function gitNullDevice(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

function normalizeRelativePath(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw new Error(`${fieldName} must be a non-empty relative path.`);
  }
  if (trimmed.startsWith("-")) {
    throw new Error(`${fieldName} must not start with "-".`);
  }
  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    throw new Error(`${fieldName} must be relative to the workspace.`);
  }
  const parts = trimmed.split(/[\\/]+/);
  if (parts.includes("..")) {
    throw new Error(`${fieldName} must stay inside the workspace.`);
  }
  return trimmed.replaceAll("\\", "/");
}

function appendBounded(current: string, next: string, maxChars: number): string {
  if (current.length >= maxChars) {
    return current;
  }
  const combined = current + next;
  return combined.length > maxChars
    ? `${combined.slice(0, Math.max(0, maxChars - TRUNCATED_MARKER.length))}${TRUNCATED_MARKER}`
    : combined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
