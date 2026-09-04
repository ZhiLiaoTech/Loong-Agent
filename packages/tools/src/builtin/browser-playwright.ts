import type { ToolDefinition, ToolInvocation, ToolJsonSchema, ToolResult } from "../types.js";
import { validateBrowserTargetUrl } from "./browser.js";

export interface BrowserPlaywrightSnapshotInput {
  url: string;
  timeoutMs?: number;
  waitUntil?: "domcontentloaded" | "load" | "networkidle";
}

export interface BrowserPlaywrightSnapshotOutput {
  url: string;
  finalUrl: string;
  title?: string;
  text: string;
  rendered: true;
  engine: "playwright-chromium";
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_TEXT_CHARS = 16_000;

const schema: ToolJsonSchema = {
  type: "object",
  properties: {
    url: { type: "string" },
    timeoutMs: { type: "number" },
    waitUntil: {
      type: "string",
      enum: ["domcontentloaded", "load", "networkidle"],
    },
  },
  required: ["url"],
  additionalProperties: false,
};

type PlaywrightModule = typeof import("playwright");

let cachedPlaywright: PlaywrightModule | null | undefined;

async function loadPlaywright(): Promise<PlaywrightModule | null> {
  if (cachedPlaywright !== undefined) {
    return cachedPlaywright;
  }
  try {
    cachedPlaywright = await import("playwright");
    return cachedPlaywright;
  } catch {
    cachedPlaywright = null;
    return null;
  }
}

export function createBrowserPlaywrightSnapshotTool(): ToolDefinition<
  BrowserPlaywrightSnapshotInput,
  BrowserPlaywrightSnapshotOutput
> {
  return {
    name: "browser_playwright_snapshot",
    description:
      "Render a page in headless Chromium via Playwright and return visible text (for SPAs). "
      + "Requires the optional `playwright` package and browser binaries (`npx playwright install chromium`).",
    inputSchema: schema,
    capabilities: ["read", "network"],
    permission: "ask",
    async invoke(invocation): Promise<ToolResult<BrowserPlaywrightSnapshotOutput>> {
      const playwright = await loadPlaywright();
      if (!playwright) {
        return {
          id: invocation.id,
          ok: false,
          error:
            "Playwright is not installed. Add `playwright` to the project and run `npx playwright install chromium`.",
        };
      }
      try {
        const input = parseInput(invocation);
        const browser = await playwright.chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          await page.goto(input.url, {
            timeout: input.timeoutMs,
            waitUntil: input.waitUntil,
          });
          const title = await page.title();
          const bodyText = await page.locator("body").innerText();
          const text = bodyText.length > MAX_TEXT_CHARS
            ? `${bodyText.slice(0, MAX_TEXT_CHARS)}... [truncated]`
            : bodyText;
          return {
            id: invocation.id,
            ok: true,
            output: {
              url: input.url,
              finalUrl: page.url(),
              ...(title ? { title } : {}),
              text,
              rendered: true,
              engine: "playwright-chromium",
            },
          };
        } finally {
          await browser.close();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          id: invocation.id,
          ok: false,
          error: `Playwright snapshot failed: ${message} If Chromium is missing, run \`npx playwright install chromium\`.`,
        };
      }
    },
  };
}

function parseInput(invocation: ToolInvocation): {
  url: string;
  timeoutMs: number;
  waitUntil: "domcontentloaded" | "load" | "networkidle";
} {
  const raw = invocation.input;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("browser_playwright_snapshot input must be an object.");
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.url !== "string" || !value.url.trim()) {
    throw new Error("browser_playwright_snapshot requires a non-empty url.");
  }
  const url = validateBrowserTargetUrl(value.url.trim());
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== "number" || !Number.isFinite(value.timeoutMs) || value.timeoutMs <= 0) {
      throw new Error("browser_playwright_snapshot timeoutMs must be a positive number.");
    }
    timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.floor(value.timeoutMs));
  }
  let waitUntil: "domcontentloaded" | "load" | "networkidle" = "domcontentloaded";
  if (value.waitUntil !== undefined) {
    if (value.waitUntil !== "domcontentloaded" && value.waitUntil !== "load" && value.waitUntil !== "networkidle") {
      throw new Error("browser_playwright_snapshot waitUntil is invalid.");
    }
    waitUntil = value.waitUntil;
  }
  return { url, timeoutMs, waitUntil };
}
