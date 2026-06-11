import type { LoongAgentRuntime } from "@loong/core";
import {
  createBrowserFormSubmitTool,
  createBrowserPlaywrightSnapshotTool,
  createBrowserSnapshotTool,
  createFilePatchTool,
  createFileReadTool,
  createFileSearchTool,
  createFileWriteTool,
  createSandboxExecTool,
  createShellExecTool,
  createShellRunTool,
  createTodoTools,
  createToolRegistry,
  createWebSearchTool,
  defaultMcpConfigPath,
  loadMcpConfig,
  registerMcpTools,
  type ToolDefinition,
  type ToolRegistry,
} from "@loong/tools";
import { createRuntimeDelegationTool } from "@loong/delegation";
import {
  createGitDiffTool,
  createGitLogTool,
  createGitStatusTool,
} from "@loong/plugin-git-tools";
import {
  createMemoryCandidateTools,
  createMemoryTools,
  createTrajectoryTools,
  type MemoryStore,
  type TrajectoryStore,
} from "@loong/memory";
import { createFileSkillRuntime, createSkillTools } from "@loong/skills";

export interface BootstrapAgentToolRegistryOptions {
  skillRoots: readonly string[];
  memoryStore: MemoryStore;
  memoryDir: string;
  trajectoryStore?: TrajectoryStore;
  runtime?: (() => LoongAgentRuntime | undefined);
  /** When true, register the arbitrary-command shell_run tool. Default false. */
  allowExec?: boolean;
  /** When true (default), register MCP tools from config. */
  registerMcp?: boolean;
  mcpConfigPath?: string;
}

export interface BootstrapAgentToolRegistryResult {
  registry: ToolRegistry;
  mcpRegistered: readonly string[];
  mcpErrors: readonly string[];
}

export function createAgentToolDefinitions(options: BootstrapAgentToolRegistryOptions): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    createFileReadTool(),
    createFileSearchTool(),
    createBrowserSnapshotTool(),
    createBrowserFormSubmitTool(),
    createBrowserPlaywrightSnapshotTool(),
    createShellExecTool(),
    createSandboxExecTool(),
    createFilePatchTool(),
    createFileWriteTool(),
    createWebSearchTool(),
    // Session task checklist (Claude-Code-style plan/track-progress primitive).
    ...createTodoTools(options.memoryDir),
    // Read-only git inspection is always available by default (permission
    // "allow"); these are the same hardened tools the git-tools plugin ships,
    // surfaced without requiring a separate plugin install.
    createGitStatusTool(),
    createGitDiffTool(),
    createGitLogTool(),
    ...createMemoryTools(options.memoryStore),
    ...createMemoryCandidateTools({ rootDir: options.memoryDir, store: options.memoryStore }),
  ];
  if (options.allowExec) {
    // Arbitrary command execution is opt-in: only register when explicitly
    // enabled so the tool does not even exist by default. It stays permission
    // "ask", so each call is still approved.
    tools.push(createShellRunTool());
  }
  if (options.runtime !== undefined) {
    tools.push(createRuntimeDelegationTool({
      runtime: options.runtime,
      source: "api",
      maxTasks: 8,
      maxConcurrency: 3,
    }));
  }
  if (options.trajectoryStore) {
    tools.push(...createTrajectoryTools(options.trajectoryStore));
  }
  if (options.skillRoots.length > 0) {
    tools.push(...createSkillTools(createFileSkillRuntime({ roots: [...options.skillRoots] })));
  }
  return tools;
}

/**
 * Builds the agent ToolRegistry (builtin + skills + memory + optional MCP), shared by CLI and Gateway.
 */
export async function bootstrapAgentToolRegistry(
  options: BootstrapAgentToolRegistryOptions,
): Promise<BootstrapAgentToolRegistryResult> {
  const registry = createToolRegistry();
  for (const tool of createAgentToolDefinitions(options)) {
    registry.register(tool);
  }
  let mcpRegistered: readonly string[] = [];
  let mcpErrors: readonly string[] = [];
  if (options.registerMcp !== false) {
    const mcpResult = await registerMcpTools(registry, {
      servers: await loadMcpConfig(options.mcpConfigPath ?? defaultMcpConfigPath()),
    });
    mcpRegistered = mcpResult.registered;
    mcpErrors = mcpResult.errors;
  }
  return { registry, mcpRegistered, mcpErrors };
}
