import type { DragonAgentRuntime } from "@dragon/core";
import {
  createBrowserFormSubmitTool,
  createBrowserPlaywrightSnapshotTool,
  createBrowserSnapshotTool,
  createFilePatchTool,
  createFileReadTool,
  createFileSearchTool,
  createSandboxExecTool,
  createShellExecTool,
  createToolRegistry,
  defaultMcpConfigPath,
  loadMcpConfig,
  registerMcpTools,
  type ToolDefinition,
  type ToolRegistry,
} from "@dragon/tools";
import { createRuntimeDelegationTool } from "@dragon/delegation";
import {
  createMemoryCandidateTools,
  createMemoryTools,
  createTrajectoryTools,
  type MemoryStore,
  type TrajectoryStore,
} from "@dragon/memory";
import { createFileSkillRuntime, createSkillTools } from "@dragon/skills";

export interface BootstrapAgentToolRegistryOptions {
  skillRoots: readonly string[];
  memoryStore: MemoryStore;
  memoryDir: string;
  trajectoryStore?: TrajectoryStore;
  runtime?: (() => DragonAgentRuntime | undefined);
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
    ...createMemoryTools(options.memoryStore),
    ...createMemoryCandidateTools({ rootDir: options.memoryDir, store: options.memoryStore }),
  ];
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
