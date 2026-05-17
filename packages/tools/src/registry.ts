import type { ToolDefinition, ToolRegistry } from "./types.js";

export class DefaultToolRegistry implements ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: ToolDefinition): void {
    const name = normalizeToolName(tool.name);
    if (!name) {
      throw new Error("Tool name must not be empty.");
    }
    if (this.#tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered.`);
    }

    const registered: ToolDefinition = {
      ...tool,
      name,
    };
    if (tool.capabilities !== undefined) {
      registered.capabilities = Object.freeze([...tool.capabilities]);
    }

    this.#tools.set(name, Object.freeze(registered));
  }

  get(name: string): ToolDefinition | undefined {
    return this.#tools.get(normalizeToolName(name));
  }

  has(name: string): boolean {
    return this.#tools.has(normalizeToolName(name));
  }

  list(): ToolDefinition[] {
    return [...this.#tools.values()];
  }
}

export function createToolRegistry(tools: ToolDefinition[] = []): ToolRegistry {
  return new DefaultToolRegistry(tools);
}

export function normalizeToolName(name: string): string {
  return name.trim();
}
