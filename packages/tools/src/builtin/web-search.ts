import type { ToolDefinition, ToolInvocation, ToolJsonSchema, ToolResult } from "../types.js";

export type WebSearchProvider = "searxng" | "tavily" | "brave";

export interface WebSearchConfig {
  provider?: WebSearchProvider;
  searxngUrl?: string;
  tavilyApiKey?: string;
  braveApiKey?: string;
}

export interface WebSearchInput {
  query: string;
  maxResults?: number;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutput {
  query: string;
  provider: WebSearchProvider;
  results: WebSearchResult[];
}

const DEFAULT_MAX_RESULTS = 5;
const ABSOLUTE_MAX_RESULTS = 10;
const MAX_SNIPPET_CHARS = 600;
const REQUEST_TIMEOUT_MS = 15_000;

const webSearchSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    query: { type: "string" },
    maxResults: { type: "number" },
  },
  required: ["query"],
  additionalProperties: false,
};

export type WebSearchConfigResolver = WebSearchConfig | (() => WebSearchConfig);

/**
 * Pluggable web search. Resolves its backend from explicit config or, by
 * default, from the environment (LOONG_WEB_SEARCH_PROVIDER, LOONG_SEARXNG_URL,
 * LOONG_TAVILY_API_KEY, LOONG_BRAVE_API_KEY). SearXNG (self-hosted) fits the
 * local-first stance; Tavily/Brave are hosted API options. Always registered;
 * returns a clear error when no backend is configured.
 */
export function createWebSearchTool(config?: WebSearchConfigResolver): ToolDefinition<WebSearchInput, WebSearchOutput> {
  return {
    name: "web_search",
    description:
      "Search the web and return title/url/snippet results. Backend is SearXNG, Tavily, or Brave depending on configuration.",
    inputSchema: webSearchSchema,
    capabilities: ["network"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseWebSearchInput(invocation.input);
        const resolved = resolveConfig(typeof config === "function" ? config() : config);
        const provider = resolved.provider;
        const maxResults = Math.min(input.maxResults ?? DEFAULT_MAX_RESULTS, ABSOLUTE_MAX_RESULTS);
        const results = await runProviderSearch(resolved, provider, input.query, maxResults);
        return { query: input.query, provider, results: results.slice(0, maxResults) };
      });
    },
  };
}

interface ResolvedWebSearchConfig {
  provider: WebSearchProvider;
  searxngUrl?: string;
  tavilyApiKey?: string;
  braveApiKey?: string;
}

function resolveConfig(config: WebSearchConfig | undefined): ResolvedWebSearchConfig {
  const env = config ?? readEnvConfig();
  const searxngUrl = env.searxngUrl?.trim() || undefined;
  const tavilyApiKey = env.tavilyApiKey?.trim() || undefined;
  const braveApiKey = env.braveApiKey?.trim() || undefined;

  let provider = env.provider;
  if (!provider) {
    if (searxngUrl) provider = "searxng";
    else if (tavilyApiKey) provider = "tavily";
    else if (braveApiKey) provider = "brave";
  }
  if (!provider) {
    throw new Error(
      "web_search is not configured. Set LOONG_SEARXNG_URL (self-hosted), LOONG_TAVILY_API_KEY, or LOONG_BRAVE_API_KEY.",
    );
  }
  if (provider === "searxng" && !searxngUrl) {
    throw new Error("web_search provider 'searxng' requires LOONG_SEARXNG_URL.");
  }
  if (provider === "tavily" && !tavilyApiKey) {
    throw new Error("web_search provider 'tavily' requires LOONG_TAVILY_API_KEY.");
  }
  if (provider === "brave" && !braveApiKey) {
    throw new Error("web_search provider 'brave' requires LOONG_BRAVE_API_KEY.");
  }
  return {
    provider,
    ...(searxngUrl ? { searxngUrl } : {}),
    ...(tavilyApiKey ? { tavilyApiKey } : {}),
    ...(braveApiKey ? { braveApiKey } : {}),
  };
}

function readEnvConfig(): WebSearchConfig {
  const provider = process.env.LOONG_WEB_SEARCH_PROVIDER?.trim().toLowerCase();
  return {
    ...(provider === "searxng" || provider === "tavily" || provider === "brave" ? { provider } : {}),
    ...(process.env.LOONG_SEARXNG_URL ? { searxngUrl: process.env.LOONG_SEARXNG_URL } : {}),
    ...(process.env.LOONG_TAVILY_API_KEY ? { tavilyApiKey: process.env.LOONG_TAVILY_API_KEY } : {}),
    ...(process.env.LOONG_BRAVE_API_KEY ? { braveApiKey: process.env.LOONG_BRAVE_API_KEY } : {}),
  };
}

async function runProviderSearch(
  config: ResolvedWebSearchConfig,
  provider: WebSearchProvider,
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  if (provider === "searxng") {
    return await searchSearxng(config.searxngUrl!, query, maxResults);
  }
  if (provider === "tavily") {
    return await searchTavily(config.tavilyApiKey!, query, maxResults);
  }
  return await searchBrave(config.braveApiKey!, query, maxResults);
}

async function searchSearxng(baseUrl: string, query: string, maxResults: number): Promise<WebSearchResult[]> {
  const url = new URL("/search", ensureTrailingSlash(baseUrl));
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const body = await fetchJson(url.toString());
  const items = Array.isArray((body as { results?: unknown }).results)
    ? (body as { results: unknown[] }).results
    : [];
  return items.slice(0, maxResults).map(item => {
    const record = isRecord(item) ? item : {};
    return toResult(record.title, record.url, record.content);
  });
}

async function searchTavily(apiKey: string, query: string, maxResults: number): Promise<WebSearchResult[]> {
  const body = await fetchJson("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
  });
  const items = Array.isArray((body as { results?: unknown }).results)
    ? (body as { results: unknown[] }).results
    : [];
  return items.slice(0, maxResults).map(item => {
    const record = isRecord(item) ? item : {};
    return toResult(record.title, record.url, record.content);
  });
}

async function searchBrave(apiKey: string, query: string, maxResults: number): Promise<WebSearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));
  const body = await fetchJson(url.toString(), {
    headers: { "x-subscription-token": apiKey, accept: "application/json" },
  });
  const web = isRecord(body) && isRecord(body.web) ? body.web : {};
  const items = Array.isArray((web as { results?: unknown }).results)
    ? (web as { results: unknown[] }).results
    : [];
  return items.slice(0, maxResults).map(item => {
    const record = isRecord(item) ? item : {};
    return toResult(record.title, record.url, record.description);
  });
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`web_search request failed with status ${response.status}.`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("web_search request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function toResult(title: unknown, url: unknown, snippet: unknown): WebSearchResult {
  return {
    title: asText(title, 200),
    url: typeof url === "string" ? url : "",
    snippet: asText(snippet, MAX_SNIPPET_CHARS),
  };
}

function asText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
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

function parseWebSearchInput(input: unknown): WebSearchInput {
  if (!isRecord(input) || typeof input.query !== "string" || !input.query.trim()) {
    throw new Error("web_search requires a non-empty query.");
  }
  return {
    query: input.query.trim(),
    ...(typeof input.maxResults === "number" ? { maxResults: Math.max(1, Math.floor(input.maxResults)) } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
