import type { ToolDefinition, ToolJsonSchema } from "@loong/tools";
import {
  parseMemoryRememberInput,
  parseMemorySearchInput,
} from "./memory-record-helpers.js";
import type {
  MemoryRememberInput,
  MemoryRememberOutput,
  MemorySearchInput,
  MemorySearchOutput,
  MemoryStore,
} from "./memory-record-types.js";
import { safelyInvokeMemoryTool } from "./memory-tool-invoke.js";

const memorySearchSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    query: { type: "string" },
    limit: { type: "number" },
  },
  required: ["query"],
  additionalProperties: false,
};

const memoryRememberSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    scope: { type: "string", enum: ["user", "project", "session", "skill"] },
    content: { type: "string" },
    source: { type: "string" },
    metadata: { type: "object" },
  },
  required: ["scope", "content"],
  additionalProperties: false,
};

export function createMemoryTools(store: MemoryStore): ToolDefinition[] {
  return [
    createMemorySearchTool(store),
    createMemoryRememberTool(store),
  ];
}

export function createMemorySearchTool(store: MemoryStore): ToolDefinition<MemorySearchInput, MemorySearchOutput> {
  return {
    name: "memory_search",
    description: "Search Loong's durable local memory for relevant prior facts or project context.",
    inputSchema: memorySearchSchema,
    capabilities: ["read", "memory"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const input = parseMemorySearchInput(invocation.input);
        const results = await store.search(input.query, input.limit);
        return {
          query: input.query,
          results,
        };
      });
    },
  };
}

export function createMemoryRememberTool(store: MemoryStore): ToolDefinition<MemoryRememberInput, MemoryRememberOutput> {
  return {
    name: "memory_remember",
    description: "Store a durable Loong memory record when the user asks to remember a stable fact or project note.",
    inputSchema: memoryRememberSchema,
    capabilities: ["write", "memory"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvokeMemoryTool(invocation, async () => {
        const input = parseMemoryRememberInput(invocation.input);
        const record = await store.remember(input);
        return { record };
      });
    },
  };
}
