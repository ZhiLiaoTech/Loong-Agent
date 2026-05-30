import { spawn } from "node:child_process";
import path from "node:path";
import type { ToolDefinition, ToolInvocation, ToolJsonSchema, ToolResult } from "../types.js";
import { isPathInside, resolveScopedRoot } from "./workspace.js";
import { readWorkspaceScopeFromMetadata } from "../workspace-scope.js";

export interface ShellRunInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface ShellRunOutput {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const MAX_OUTPUT_CHARS = 64_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const KILL_GRACE_MS = 2_000;

const shellRunSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    command: { type: "string" },
    cwd: { type: "string" },
    timeoutMs: { type: "number" },
  },
  required: ["command"],
  additionalProperties: false,
};

/**
 * Run an arbitrary shell command in the workspace.
 *
 * Unlike `shell_exec` / `sandbox_exec` (read-only allowlist), this executes any
 * command through the system shell, confined to the workspace directory. It is
 * gated by an explicit opt-in at registration time (the host only wires this in
 * when execution is enabled) and is permission "ask" so each call is approved.
 */
export function createShellRunTool(): ToolDefinition<ShellRunInput, ShellRunOutput> {
  return {
    name: "shell_run",
    description:
      "Run an arbitrary shell command inside the current workspace (build, test, install, scripts). Confined to the workspace directory; requires approval per call.",
    inputSchema: shellRunSchema,
    capabilities: ["execute", "network"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseShellRunInput(invocation.input);
        const scope = readWorkspaceScopeFromMetadata(invocation.metadata);
        const workspaceRoot = await resolveScopedRoot(invocation.workspace, scope);
        const cwd = resolveRunCwd(workspaceRoot, input.cwd);
        const timeoutMs = clampTimeout(input.timeoutMs);
        return await runShellCommand(input.command, cwd, timeoutMs);
      });
    },
  };
}

function resolveRunCwd(workspaceRoot: string, requested: string | undefined): string {
  if (!requested) {
    return workspaceRoot;
  }
  const resolved = path.resolve(workspaceRoot, requested);
  if (!isPathInside(resolved, workspaceRoot)) {
    throw new Error(`cwd escapes workspace: ${requested}`);
  }
  return resolved;
}

function clampTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.floor(timeoutMs)));
}

async function runShellCommand(command: string, cwd: string, timeoutMs: number): Promise<ShellRunOutput> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Escalate to SIGKILL if the process ignores SIGTERM.
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      killTimer.unref?.();
    }, timeoutMs);

    child.stdout?.on("data", chunk => {
      stdout = appendBounded(stdout, chunk.toString());
    });
    child.stderr?.on("data", chunk => {
      stderr = appendBounded(stderr, chunk.toString());
    });
    child.on("error", error => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        command,
        cwd,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function appendBounded(current: string, addition: string): string {
  if (current.length >= MAX_OUTPUT_CHARS) {
    return current;
  }
  const next = current + addition;
  return next.length > MAX_OUTPUT_CHARS ? `${next.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]` : next;
}

async function safelyInvoke<TOutput>(
  invocation: ToolInvocation,
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

function parseShellRunInput(input: unknown): ShellRunInput {
  if (!isRecord(input) || typeof input.command !== "string" || !input.command.trim()) {
    throw new Error("shell_run requires a non-empty command.");
  }
  return {
    command: input.command,
    ...(typeof input.cwd === "string" && input.cwd.trim() ? { cwd: input.cwd } : {}),
    ...(typeof input.timeoutMs === "number" ? { timeoutMs: input.timeoutMs } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
