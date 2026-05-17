import { TextDecoder } from "node:util";
import type { ToolDefinition, ToolInvocation, ToolJsonSchema, ToolResult } from "../types.js";

export interface BrowserSnapshotInput {
  url: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface BrowserSnapshotLink {
  href: string;
  text?: string;
}

export interface BrowserSnapshotOutput {
  url: string;
  finalUrl: string;
  status: number;
  contentType?: string;
  title?: string;
  text: string;
  links: BrowserSnapshotLink[];
  truncated: boolean;
}

export interface BrowserSnapshotToolOptions {
  fetchImpl?: typeof fetch;
}

interface ParsedBrowserSnapshot {
  title?: string;
  text: string;
  links: BrowserSnapshotLink[];
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const MAX_BYTES = 4_000_000;
const MAX_TEXT_CHARS = 12_000;
const MAX_LINKS = 80;

const browserSnapshotSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    url: { type: "string" },
    timeoutMs: { type: "number" },
    maxBytes: { type: "number" },
  },
  required: ["url"],
  additionalProperties: false,
};

export function createBrowserSnapshotTool(
  options: BrowserSnapshotToolOptions = {},
): ToolDefinition<BrowserSnapshotInput, BrowserSnapshotOutput> {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    name: "browser_snapshot",
    description: "Fetch an HTTP(S) page and return a bounded text and link snapshot for lightweight browser-style inspection.",
    inputSchema: browserSnapshotSchema,
    capabilities: ["read", "network"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseBrowserSnapshotInput(invocation.input);
        return await fetchBrowserSnapshot(fetchImpl, input);
      });
    },
  };
}

async function fetchBrowserSnapshot(
  fetchImpl: typeof fetch,
  input: Required<BrowserSnapshotInput>,
): Promise<BrowserSnapshotOutput> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetchImpl(input.url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html, text/plain;q=0.9, */*;q=0.1",
        "user-agent": "Dragon/0.0 browser_snapshot",
      },
    });
    const contentType = response.headers.get("content-type") ?? undefined;
    const body = await readBoundedText(response, input.maxBytes);
    const finalUrl = response.url || input.url;
    const snapshot = contentType?.toLowerCase().includes("html")
      ? htmlToSnapshot(body.text, finalUrl)
      : textToSnapshot(body.text);
    return {
      url: input.url,
      finalUrl,
      status: response.status,
      ...(contentType !== undefined ? { contentType } : {}),
      ...(snapshot.title !== undefined ? { title: snapshot.title } : {}),
      text: fitText(snapshot.text, MAX_TEXT_CHARS),
      links: snapshot.links.slice(0, MAX_LINKS),
      truncated: body.truncated || snapshot.text.length > MAX_TEXT_CHARS || snapshot.links.length > MAX_LINKS,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const fallback = await response.text();
    return {
      text: fallback.length > maxBytes ? fallback.slice(0, maxBytes) : fallback,
      truncated: fallback.length > maxBytes,
    };
  }

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    const remaining = maxBytes - bytes;
    if (remaining <= 0) {
      truncated = true;
      await reader.cancel();
      break;
    }
    if (value.byteLength > remaining) {
      chunks.push(value.slice(0, remaining));
      bytes += remaining;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    bytes += value.byteLength;
  }

  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(merged),
    truncated,
  };
}

function htmlToSnapshot(html: string, baseUrl: string): ParsedBrowserSnapshot {
  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  const title = extractTitle(withoutNoise);
  const links = extractLinks(withoutNoise, baseUrl);
  const text = decodeHtmlEntities(withoutNoise
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
  return {
    ...(title !== undefined ? { title } : {}),
    text,
    links,
  };
}

function textToSnapshot(text: string): ParsedBrowserSnapshot {
  return {
    text: text.replace(/\s+/g, " ").trim(),
    links: [],
  };
}

function extractTitle(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = decodeHtmlEntities(match?.[1]?.replace(/\s+/g, " ").trim() ?? "");
  return title || undefined;
}

function extractLinks(html: string, baseUrl: string): BrowserSnapshotLink[] {
  const links: BrowserSnapshotLink[] = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null && links.length < MAX_LINKS + 1) {
    const attrs = match[1] ?? "";
    const href = readAttribute(attrs, "href");
    if (!href || href.startsWith("#") || /^javascript:/i.test(href)) {
      continue;
    }
    let resolved: string;
    try {
      resolved = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    const text = decodeHtmlEntities((match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    links.push({
      href: resolved,
      ...(text ? { text: fitText(text, 200) } : {}),
    });
  }
  return links;
}

function readAttribute(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'=<>` + "`" + `]+))`, "i");
  const match = pattern.exec(attrs);
  return match?.[2] ?? match?.[3] ?? match?.[4] ?? undefined;
}

function parseBrowserSnapshotInput(input: unknown): Required<BrowserSnapshotInput> {
  if (!isRecord(input) || typeof input.url !== "string" || !input.url.trim()) {
    throw new Error("browser_snapshot requires a non-empty url.");
  }
  return {
    url: normalizeBrowserUrl(input.url),
    timeoutMs: typeof input.timeoutMs === "number"
      ? Math.min(MAX_TIMEOUT_MS, Math.max(100, Math.floor(input.timeoutMs)))
      : DEFAULT_TIMEOUT_MS,
    maxBytes: typeof input.maxBytes === "number"
      ? Math.min(MAX_BYTES, Math.max(1024, Math.floor(input.maxBytes)))
      : DEFAULT_MAX_BYTES,
  };
}

function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("browser_snapshot only supports HTTP(S) URLs.");
  }
  if (url.username || url.password) {
    throw new Error("browser_snapshot URL must not include credentials.");
  }
  return url.toString();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const valueCode = Number(code);
      return Number.isFinite(valueCode) ? String.fromCodePoint(valueCode) : "";
    });
}

function fitText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}... [truncated]` : value;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
