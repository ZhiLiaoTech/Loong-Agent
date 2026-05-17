export type ToolPermissionDecision = "allow" | "ask" | "deny";

export type ToolCapability = "read" | "write" | "execute" | "network" | "memory" | "custom";

export interface ToolInvocation<TInput = unknown> {
  id: string;
  name: string;
  input: TInput;
  sessionId: string;
  workspace?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolJsonSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolResult<TOutput = unknown> {
  id: string;
  ok: boolean;
  output?: TOutput;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: unknown;
  capabilities?: readonly ToolCapability[];
  /**
   * Tool-provided baseline. External policy can always make this stricter.
   */
  permission?: ToolPermissionDecision;
  invoke(invocation: ToolInvocation<TInput>): Promise<ToolResult<TOutput>>;
}

export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  has(name: string): boolean;
  list(): ToolDefinition[];
}

export interface ToolPermissionRule {
  toolName?: string;
  capability?: ToolCapability;
  when?: (context: ToolPermissionContext) => boolean;
  decision: ToolPermissionDecision;
  reason?: string;
}

export interface ToolPermissionContext {
  tool: ToolDefinition;
  invocation: ToolInvocation;
}

export interface ToolPermissionPolicy {
  defaultDecision?: ToolPermissionDecision;
  rules?: ToolPermissionRule[];
}

export interface ToolPermissionResult {
  decision: ToolPermissionDecision;
  reason: string;
  matchedRule?: ToolPermissionRule;
}

export interface ToolPermissionEngine {
  decide(tool: ToolDefinition, invocation: ToolInvocation): ToolPermissionResult;
}

export type RegisteredToolDefinition = Readonly<ToolDefinition>;
