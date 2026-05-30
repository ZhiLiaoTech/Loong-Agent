import type { LoongContextProvider } from "@loong/core";
import { ABSOLUTE_MEMORY_SEARCH_LIMIT, summarizeMemoryResults } from "./memory-record-helpers.js";
import type { MemoryStore } from "./memory-record-types.js";
import { clampPositiveInteger } from "./memory-util.js";

const DEFAULT_MEMORY_CONTEXT_LIMIT = 5;
const DEFAULT_MEMORY_CONTEXT_CHARS = 4000;
const ABSOLUTE_MEMORY_CONTEXT_CHARS = 12_000;

export interface MemoryContextProviderOptions {
  store: MemoryStore;
  limit?: number;
  maxContentChars?: number;
}

export function createMemoryContextProvider(options: MemoryContextProviderOptions): LoongContextProvider {
  const limit = clampPositiveInteger(
    options.limit,
    DEFAULT_MEMORY_CONTEXT_LIMIT,
    ABSOLUTE_MEMORY_SEARCH_LIMIT,
  );
  const maxContentChars = clampPositiveInteger(
    options.maxContentChars,
    DEFAULT_MEMORY_CONTEXT_CHARS,
    ABSOLUTE_MEMORY_CONTEXT_CHARS,
  );

  return {
    name: "memory_recall",
    async buildContext(request) {
      const results = await options.store.search(request.input.message, limit);
      if (results.length === 0) {
        return [];
      }
      const content = summarizeMemoryResults(results, maxContentChars);
      return content
        ? [{
            title: "Relevant durable memory",
            content,
            priority: 10,
            metadata: { resultCount: results.length },
          }]
        : [];
    },
  };
}
