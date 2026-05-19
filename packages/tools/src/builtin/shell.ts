import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, realpathSync } from "node:fs";
import path from "node:path";
import type { ToolDefinition, ToolInvocation, ToolJsonSchema, ToolResult } from "../types.js";

export interface ShellExecInput {
  command: string;
  timeoutMs?: number;
}

export type SandboxExecBackend = "local" | "docker" | "ssh";
export type SandboxPolicyProfile = "versions" | "inspect" | "git-read" | "search-read" | "repo-read";

export interface SandboxExecInput {
  command: string;
  backend?: SandboxExecBackend;
  profile?: SandboxPolicyProfile;
  timeoutMs?: number;
  docker?: {
    container: string;
    workspace?: string;
  };
  ssh?: {
    host: string;
    user?: string;
    port?: number;
    workspace?: string;
  };
}

export interface ShellExecOutput {
  command: string;
  executable: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface SandboxExecOutput extends ShellExecOutput {
  backend: SandboxExecBackend;
  profile: SandboxPolicyProfile;
  innerExecutable: string;
  innerArgs: string[];
  target?: string;
  workspace?: string;
}

interface ParsedCommand {
  executable: string;
  args: string[];
}

interface SandboxPolicy {
  profile: SandboxPolicyProfile;
  allowVersions: boolean;
  git: "none" | "status" | "read";
  allowSearch: boolean;
}

export interface SandboxExecPlan {
  backend: SandboxExecBackend;
  profile: SandboxPolicyProfile;
  command: string;
  executable: string;
  args: string[];
  innerExecutable: string;
  innerArgs: string[];
  cwd?: string;
  target?: string;
  workspace?: string;
}

const MAX_OUTPUT_CHARS = 64_000;
const MAX_TIMEOUT_MS = 15_000;

const shellExecSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    command: { type: "string" },
    timeoutMs: { type: "number" },
  },
  required: ["command"],
  additionalProperties: false,
};

const sandboxExecSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    command: { type: "string" },
    backend: { type: "string", enum: ["local", "docker", "ssh"] },
    profile: { type: "string", enum: ["versions", "inspect", "git-read", "search-read", "repo-read"] },
    timeoutMs: { type: "number" },
    docker: {
      type: "object",
      properties: {
        container: { type: "string" },
        workspace: { type: "string" },
      },
      required: ["container"],
      additionalProperties: false,
    },
    ssh: {
      type: "object",
      properties: {
        host: { type: "string" },
        user: { type: "string" },
        port: { type: "number" },
        workspace: { type: "string" },
      },
      required: ["host"],
      additionalProperties: false,
    },
  },
  required: ["command"],
  additionalProperties: false,
};

export function createShellExecTool(): ToolDefinition<ShellExecInput, ShellExecOutput> {
  return {
    name: "shell_exec",
    description: "Run a conservative read-only command in the current workspace without shell expansion.",
    inputSchema: shellExecSchema,
    capabilities: ["execute"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseShellExecInput(invocation.input);
        const parsed = parseAllowedReadOnlyCommand(input.command);
        if (!parsed) {
          throw new Error(`Command is not in the read-only allowlist: ${input.command}`);
        }
        if (!invocation.workspace) {
          throw new Error("Workspace is required for shell_exec.");
        }
        return await runCommand(parsed, input.command, invocation.workspace, input.timeoutMs ?? MAX_TIMEOUT_MS);
      });
    },
  };
}

export function createSandboxExecTool(): ToolDefinition<SandboxExecInput, SandboxExecOutput> {
  return {
    name: "sandbox_exec",
    description: "Run a conservative read-only command in a local, Docker, or SSH sandbox without broad shell access.",
    inputSchema: sandboxExecSchema,
    capabilities: ["execute", "network"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseSandboxExecInput(invocation.input);
        const plan = planSandboxExecCommand(input, invocation.workspace);
        const result = await runPlannedCommand(plan, input.timeoutMs ?? MAX_TIMEOUT_MS);
        return {
          ...result,
          backend: plan.backend,
          profile: plan.profile,
          innerExecutable: plan.innerExecutable,
          innerArgs: plan.innerArgs,
          ...(plan.target !== undefined ? { target: plan.target } : {}),
          ...(plan.workspace !== undefined ? { workspace: plan.workspace } : {}),
        };
      });
    },
  };
}

export function isAllowedReadOnlyCommand(command: string, profile: SandboxPolicyProfile = "inspect"): boolean {
  return parseAllowedReadOnlyCommand(command, profile) !== undefined;
}

export function parseAllowedReadOnlyCommand(command: string, profile: SandboxPolicyProfile = "inspect"): ParsedCommand | undefined {
  if (hasShellMetacharacters(command)) {
    return undefined;
  }
  const policy = resolveSandboxPolicy(profile);

  const tokens = splitCommand(command);
  const [executable, ...args] = tokens;
  if (!executable) {
    return undefined;
  }

  const name = executable.toLowerCase();
  if (policy.allowVersions && name === "node" && args.length === 1 && args[0] === "--version") {
    return { executable, args };
  }
  if (policy.allowVersions && (name === "npm" || name === "pnpm") && args.length === 1 && args[0] === "--version") {
    return { executable, args };
  }
  if (name === "git" && isAllowedGitArgs(args, policy.git)) {
    return { executable, args };
  }
  if (policy.allowSearch && name === "rg" && isAllowedRgArgs(args)) {
    return { executable, args };
  }

  return undefined;
}

export function planSandboxExecCommand(input: SandboxExecInput, defaultWorkspace?: string): SandboxExecPlan {
  const profile = input.profile ?? "inspect";
  const parsed = parseAllowedReadOnlyCommand(input.command, profile);
  if (!parsed) {
    throw new Error(`Command is not allowed by sandbox profile "${profile}": ${input.command}`);
  }
  const backend = input.backend ?? "local";
  if (backend === "local") {
    if (!defaultWorkspace) {
      throw new Error("Workspace is required for local sandbox_exec.");
    }
    return {
      backend,
      profile,
      command: input.command,
      executable: parsed.executable,
      args: parsed.args,
      innerExecutable: parsed.executable,
      innerArgs: parsed.args,
      cwd: defaultWorkspace,
      workspace: defaultWorkspace,
    };
  }
  if (backend === "docker") {
    const docker = input.docker;
    if (!docker) {
      throw new Error("docker sandbox_exec requires docker.container.");
    }
    const container = normalizeDockerContainer(docker.container);
    const workspace = normalizeSandboxWorkspace(docker.workspace ?? defaultWorkspace, "docker.workspace");
    return {
      backend,
      profile,
      command: input.command,
      executable: "docker",
      args: ["exec", "-i", "-w", workspace, container, parsed.executable, ...parsed.args],
      innerExecutable: parsed.executable,
      innerArgs: parsed.args,
      target: container,
      workspace,
    };
  }
  if (backend === "ssh") {
    const ssh = input.ssh;
    if (!ssh) {
      throw new Error("ssh sandbox_exec requires ssh.host.");
    }
    const target = normalizeSshTarget(ssh);
    const workspace = ssh.workspace !== undefined
      ? normalizeSandboxWorkspace(ssh.workspace, "ssh.workspace")
      : undefined;
    const remoteCommand = workspace !== undefined
      ? `cd ${quotePosix(workspace)} && exec ${quotePosix(parsed.executable)}${formatPosixArgs(parsed.args)}`
      : `exec ${quotePosix(parsed.executable)}${formatPosixArgs(parsed.args)}`;
    return {
      backend,
      profile,
      command: input.command,
      executable: "ssh",
      args: [
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
        ...(ssh.port !== undefined ? ["-p", String(normalizePort(ssh.port))] : []),
        target,
        "--",
        remoteCommand,
      ],
      innerExecutable: parsed.executable,
      innerArgs: parsed.args,
      target,
      ...(workspace !== undefined ? { workspace } : {}),
    };
  }
  throw new Error(`Unsupported sandbox backend: ${String(backend)}`);
}

function resolveSandboxPolicy(profile: SandboxPolicyProfile): SandboxPolicy {
  if (profile === "versions") {
    return { profile, allowVersions: true, git: "none", allowSearch: false };
  }
  if (profile === "git-read") {
    return { profile, allowVersions: true, git: "read", allowSearch: false };
  }
  if (profile === "search-read") {
    return { profile, allowVersions: true, git: "none", allowSearch: true };
  }
  if (profile === "repo-read") {
    return { profile, allowVersions: true, git: "read", allowSearch: true };
  }
  return { profile: "inspect", allowVersions: true, git: "status", allowSearch: true };
}

function isAllowedGitArgs(args: string[], mode: SandboxPolicy["git"]): boolean {
  if (mode === "none") {
    return false;
  }
  if (args.length === 1 && args[0] === "status") {
    return true;
  }
  if (mode !== "read") {
    return false;
  }
  if (args.length === 0) {
    return false;
  }
  const [subcommand, ...rest] = args;
  if (subcommand === "diff") {
    return rest.length <= 20 && rest.every(isSafeGitReadArg);
  }
  if (subcommand === "log") {
    return rest.length <= 20 && rest.every(isSafeGitReadArg);
  }
  if (subcommand === "show") {
    return rest.length <= 12 && rest.every(isSafeGitReadArg);
  }
  if (subcommand === "branch") {
    return rest.length <= 4 && rest.every(arg => ["-a", "--all", "-r", "--remotes", "--show-current"].includes(arg));
  }
  if (subcommand === "rev-parse") {
    return rest.length > 0 && rest.length <= 8 && rest.every(isSafeGitReadArg);
  }
  return false;
}

function isSafeGitReadArg(arg: string): boolean {
  if (!isSafeReadOnlyArg(arg)) {
    return false;
  }
  if (isUnsafePathArg(arg)) {
    return false;
  }
  if (arg.startsWith("--output") || arg === "-o") {
    return false;
  }
  if (isUnsafeGitReadFlag(arg)) {
    return false;
  }
  return true;
}

function isUnsafeGitReadFlag(arg: string): boolean {
  const normalized = arg.toLowerCase();
  // --pretty/--format and -p/--patch can surface unbounded patch content
  // or invoke format directives; disallow them under read-only profiles.
  // -c/--config can override git config inline (e.g. set core.sshCommand),
  // which is a sandbox bypass.
  return normalized === "--ext-diff"
    || normalized === "--textconv"
    || normalized === "--no-textconv"
    || normalized === "-p"
    || normalized === "--patch"
    || normalized.startsWith("--ext-diff=")
    || normalized.startsWith("--textconv=")
    || normalized.startsWith("--exec-path")
    || normalized.startsWith("--pretty")
    || normalized.startsWith("--format")
    || normalized.startsWith("--upload-pack")
    || normalized.startsWith("--receive-pack")
    || normalized.startsWith("--config")
    || normalized === "-c"
    || normalized.startsWith("-c=");
}

function isAllowedRgArgs(args: string[]): boolean {
  if (args.length === 0) {
    return false;
  }
  return args.every((arg, index) => {
    if (!isSafeRgArg(arg)) {
      return false;
    }
    if (arg === "-L" || arg === "--follow" || arg === "--pre" || arg.startsWith("--pre=")) {
      return false;
    }
    // Explicitly reject flags that can extend the sandbox: type injection,
    // ignore-file overrides, search-zip, engine, and ignore-policy escapes.
    if (
      arg === "--type-add" || arg.startsWith("--type-add=")
      || arg === "--type-clear" || arg.startsWith("--type-clear=")
      || arg === "--ignore-file" || arg.startsWith("--ignore-file=")
      || arg === "--no-ignore-vcs"
      || arg === "--no-ignore-parent"
      || arg === "--no-ignore-global"
      || arg === "--no-config"
      || arg === "--engine" || arg.startsWith("--engine=")
      || arg === "--search-zip" || arg === "-z"
    ) {
      return false;
    }
    if (isUnsafePathArg(arg)) {
      return false;
    }
    if (arg.startsWith("-") && !isAllowedRgFlag(arg)) {
      return false;
    }
    return index < 20;
  });
}

function isUnsafePathArg(arg: string): boolean {
  if (arg === ".") {
    return false;
  }
  if (/^[a-zA-Z]:[\\/]/.test(arg)) {
    return true;
  }
  if (arg.startsWith("/") || arg.startsWith("\\") || arg.startsWith("..")) {
    return true;
  }
  const parts = arg.split(/[\\/]+/);
  return parts.includes("..");
}

function isSafeRgArg(arg: string): boolean {
  return isSafeReadOnlyArg(arg) && !arg.includes(":");
}

function isAllowedRgFlag(arg: string): boolean {
  return [
    "--files",
    "--hidden",
    "--glob",
    "-g",
    "-n",
    "--line-number",
    "-i",
    "--ignore-case",
    "--no-ignore",
  ].includes(arg);
}

function isSafeReadOnlyArg(arg: string): boolean {
  if (!arg) {
    return false;
  }
  if (arg.includes("\0")) {
    return false;
  }
  if (arg.startsWith("--output") || arg.startsWith("-o")) {
    return false;
  }
  return !hasShellMetacharacters(arg);
}

async function runCommand(
  parsed: ParsedCommand,
  originalCommand: string,
  cwd: string | undefined,
  timeoutMs: number,
): Promise<ShellExecOutput> {
  // Resolve to an absolute path via a workspace-aware PATH search. Without
  // this, spawn(shell:false) still consults PATH at exec time, leaving room
  // for PATH-shadowing if the user's PATH starts with a writable directory.
  const resolvedExecutable = resolveExecutablePath(parsed.executable, cwd);
  return await new Promise((resolve, reject) => {
    const child = spawn(resolvedExecutable, parsed.args, {
      cwd,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", chunk => {
      stdout = appendBounded(stdout, chunk.toString());
    });
    child.stderr?.on("data", chunk => {
      stderr = appendBounded(stderr, chunk.toString());
    });
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        command: originalCommand,
        executable: parsed.executable,
        args: parsed.args,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

async function runPlannedCommand(
  plan: SandboxExecPlan,
  timeoutMs: number,
): Promise<ShellExecOutput> {
  return await runCommand(
    { executable: plan.executable, args: plan.args },
    plan.command,
    plan.cwd,
    timeoutMs,
  );
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

function parseSandboxExecInput(input: unknown): SandboxExecInput {
  if (!isRecord(input) || typeof input.command !== "string" || !input.command.trim()) {
    throw new Error("sandbox_exec requires a non-empty command.");
  }
  const parsed: SandboxExecInput = {
    command: input.command,
    ...(typeof input.timeoutMs === "number"
      ? { timeoutMs: Math.min(MAX_TIMEOUT_MS, Math.max(100, Math.floor(input.timeoutMs))) }
      : {}),
  };
  if (input.backend !== undefined) {
    if (input.backend !== "local" && input.backend !== "docker" && input.backend !== "ssh") {
      throw new Error("sandbox_exec backend must be local, docker, or ssh.");
    }
    parsed.backend = input.backend;
  }
  if (input.profile !== undefined) {
    if (!isSandboxPolicyProfile(input.profile)) {
      throw new Error("sandbox_exec profile must be versions, inspect, git-read, search-read, or repo-read.");
    }
    parsed.profile = input.profile;
  }
  if (input.docker !== undefined) {
    if (!isRecord(input.docker)) {
      throw new Error("sandbox_exec docker options must be an object.");
    }
    parsed.docker = {
      container: readRequiredString(input.docker.container, "docker.container"),
      ...(typeof input.docker.workspace === "string" ? { workspace: input.docker.workspace } : {}),
    };
  }
  if (input.ssh !== undefined) {
    if (!isRecord(input.ssh)) {
      throw new Error("sandbox_exec ssh options must be an object.");
    }
    parsed.ssh = {
      host: readRequiredString(input.ssh.host, "ssh.host"),
      ...(typeof input.ssh.user === "string" ? { user: input.ssh.user } : {}),
      ...(typeof input.ssh.port === "number" ? { port: input.ssh.port } : {}),
      ...(typeof input.ssh.workspace === "string" ? { workspace: input.ssh.workspace } : {}),
    };
  }
  return parsed;
}

function isSandboxPolicyProfile(value: unknown): value is SandboxPolicyProfile {
  return value === "versions"
    || value === "inspect"
    || value === "git-read"
    || value === "search-read"
    || value === "repo-read";
}

function parseShellExecInput(input: unknown): ShellExecInput {
  if (!isRecord(input) || typeof input.command !== "string" || !input.command.trim()) {
    throw new Error("shell_exec requires a non-empty command.");
  }
  return {
    command: input.command,
    ...(typeof input.timeoutMs === "number"
      ? { timeoutMs: Math.min(MAX_TIMEOUT_MS, Math.max(100, Math.floor(input.timeoutMs))) }
      : {}),
  };
}

function normalizeDockerContainer(value: string): string {
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/.test(trimmed)) {
    throw new Error("docker.container contains unsupported characters.");
  }
  return trimmed;
}

function normalizeSshTarget(value: NonNullable<SandboxExecInput["ssh"]>): string {
  const host = value.host.trim();
  if (!/^[a-zA-Z0-9_.:-]{1,255}$/.test(host)) {
    throw new Error("ssh.host contains unsupported characters.");
  }
  const user = value.user?.trim();
  if (user !== undefined) {
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(user)) {
      throw new Error("ssh.user contains unsupported characters.");
    }
    return `${user}@${host}`;
  }
  return host;
}

function normalizePort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error("ssh.port must be between 1 and 65535.");
  }
  return value;
}

function normalizeSandboxWorkspace(value: string | undefined, fieldName: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required.`);
  }
  if (trimmed.length > 500 || trimmed.includes("\0") || /[\r\n]/.test(trimmed)) {
    throw new Error(`${fieldName} contains unsupported characters.`);
  }
  return trimmed;
}

function formatPosixArgs(args: string[]): string {
  return args.length > 0 ? ` ${args.map(quotePosix).join(" ")}` : "";
}

function quotePosix(value: string): string {
  if (value.includes("\0") || /[\r\n]/.test(value)) {
    throw new Error("Cannot quote unsafe remote command argument.");
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`sandbox_exec requires ${fieldName}.`);
  }
  return value;
}

function splitCommand(command: string): string[] {
  const tokens = command.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  return tokens.map(token => {
    if ((token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function hasShellMetacharacters(value: string): boolean {
  // Standard shell metacharacters plus tab (re-parseable via unusual IFS) and
  // bash history expansion (`!`). All are blocked even though spawn runs
  // shell:false — defense in depth against rare quoting bypasses.
  return /[&|;<>()`$>{}\[\]\r\n\t!]/.test(value);
}

const RESOLVED_EXECUTABLES = new Map<string, string>();

// Resolve a bare executable name to an absolute path via PATH lookup. The
// workspace directory is removed from the search list so an attacker who can
// write files into the workspace cannot shadow `git`/`rg`/`node` even if the
// caller's PATH starts with `.` or the workspace itself.
function resolveExecutablePath(name: string, workspace: string | undefined): string {
  if (path.isAbsolute(name)) {
    return name;
  }
  const cacheKey = `${workspace ?? ""} ${name}`;
  const cached = RESOLVED_EXECUTABLES.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const workspaceReal = workspace ? safeRealpath(workspace) : undefined;
  const candidates = process.platform === "win32"
    ? expandWindowsCandidates(name, process.env.PATHEXT)
    : [name];
  for (const dir of pathEntries) {
    const realDir = safeRealpath(dir);
    if (workspaceReal && realDir !== undefined && (realDir === workspaceReal || isPathInsideDir(realDir, workspaceReal))) {
      continue;
    }
    for (const candidate of candidates) {
      const candidatePath = path.join(dir, candidate);
      if (isExecutableFile(candidatePath)) {
        const resolved = safeRealpath(candidatePath) ?? candidatePath;
        RESOLVED_EXECUTABLES.set(cacheKey, resolved);
        return resolved;
      }
    }
  }
  throw new Error(`Executable not found in PATH (or PATH entry shadowed by workspace): ${name}`);
}

function expandWindowsCandidates(name: string, pathext: string | undefined): string[] {
  if (path.extname(name)) {
    return [name];
  }
  const exts = (pathext ?? ".COM;.EXE;.BAT;.CMD").split(";").map(item => item.trim()).filter(Boolean);
  return [name, ...exts.map(ext => `${name}${ext}`)];
}

function safeRealpath(input: string): string | undefined {
  try {
    return realpathSync(input);
  } catch {
    return undefined;
  }
}

function isPathInsideDir(target: string, parent: string): boolean {
  const relative = path.relative(parent, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isExecutableFile(filePath: string): boolean {
  try {
    accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function appendBounded(current: string, next: string): string {
  if (current.length >= MAX_OUTPUT_CHARS) {
    return current;
  }
  const combined = current + next;
  return combined.length > MAX_OUTPUT_CHARS
    ? `${combined.slice(0, MAX_OUTPUT_CHARS)}\n[truncated]`
    : combined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
