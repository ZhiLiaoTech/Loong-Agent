import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_PORT = 18787;
const DEFAULT_SECRET = "dragon-smoke-secret";
const START_TIMEOUT_MS = 15_000;

interface SmokeTarget {
  url: string;
  secret?: string;
  spawned?: ChildProcessWithoutNullStreams;
  logs?: string[];
  cleanupDir?: string;
}

async function main(): Promise<void> {
  const target = await resolveTarget();
  try {
    await waitForGateway(target);
    await assertDashboard(target);
    await assertHealth(target);
    await assertRpc(target, "connect");
    await assertRpc(target, "providers.list");
    process.stdout.write(`ok - Dragon Gateway smoke ${target.url}\n`);
  } finally {
    await stopTarget(target);
  }
}

async function resolveTarget(): Promise<SmokeTarget> {
  const existingUrl = process.env.DRAGON_SMOKE_GATEWAY_URL?.trim();
  const secret = firstNonEmpty(process.env.DRAGON_SMOKE_GATEWAY_SECRET, process.env.DRAGON_GATEWAY_SECRET);
  if (existingUrl) {
    return {
      url: trimTrailingSlash(existingUrl),
      ...(secret !== undefined ? { secret } : {}),
    };
  }

  const port = readPort(process.env.DRAGON_SMOKE_GATEWAY_PORT, DEFAULT_PORT);
  const cleanupDir = await mkdtemp(path.join(os.tmpdir(), "dragon-smoke-"));
  const spawned = spawn(process.execPath, [
    "packages/cli/dist/index.js",
    "gateway",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--secret",
    secret ?? DEFAULT_SECRET,
    "--session-dir",
    path.join(cleanupDir, "sessions"),
    "--memory-dir",
    path.join(cleanupDir, "memory"),
    "--cron-jobs",
    path.join(cleanupDir, "cron", "jobs.json"),
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DRAGON_OPENAI_API_KEY: "",
      OPENAI_API_KEY: "",
      DRAGON_ANTHROPIC_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      DRAGON_OPENROUTER_API_KEY: "",
      OPENROUTER_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs: string[] = [];
  spawned.stdout.on("data", chunk => logs.push(String(chunk)));
  spawned.stderr.on("data", chunk => logs.push(String(chunk)));
  spawned.on("exit", code => {
    if (code !== null && code !== 0) {
      logs.push(`gateway exited with code ${code}`);
    }
  });

  return {
    url: `http://127.0.0.1:${port}`,
    secret: secret ?? DEFAULT_SECRET,
    spawned,
    logs,
    cleanupDir,
  };
}

async function waitForGateway(target: SmokeTarget): Promise<void> {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (target.spawned !== undefined && target.spawned.exitCode !== null) {
      throw new Error(`Gateway exited before smoke checks completed.${lastError ? ` Last error: ${lastError}` : ""}${formatLogs(target)}`);
    }
    try {
      const response = await fetch(`${target.url}/health`, {
        headers: authHeaders(target),
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  throw new Error(`Gateway did not become healthy within ${START_TIMEOUT_MS}ms. ${lastError}${formatLogs(target)}`);
}

async function assertDashboard(target: SmokeTarget): Promise<void> {
  const response = await fetch(`${target.url}/`, { signal: AbortSignal.timeout(3000) });
  const html = await response.text();
  assert(response.ok, `Dashboard returned HTTP ${response.status}`);
  assert(html.includes("<title>Dragon</title>"), "Dashboard title was not rendered.");
  assert(html.includes('data-tab="run"'), "Dashboard Run workspace was not rendered.");
  assert(html.includes('data-tab="models"'), "Dashboard Models workspace was not rendered.");
  assert(html.includes('data-tab="agents"'), "Dashboard Agents workspace was not rendered.");
  assert(html.includes('data-tab="observe"'), "Dashboard Observe workspace was not rendered.");
  assert(html.includes('data-tab="system"'), "Dashboard System workspace was not rendered.");
  assert(!html.includes("localStorage") && !html.includes("sessionStorage"), "Dashboard must not persist secrets in browser storage.");
}

async function assertHealth(target: SmokeTarget): Promise<void> {
  const response = await fetch(`${target.url}/health`, {
    headers: authHeaders(target),
    signal: AbortSignal.timeout(3000),
  });
  const json = await response.json() as Record<string, unknown>;
  assert(response.ok, `Health returned HTTP ${response.status}`);
  assert(json.ok === true, "Health payload did not report ok.");
  assert(json.name === "dragon-gateway", "Health payload did not identify Dragon Gateway.");
}

async function assertRpc(target: SmokeTarget, type: string): Promise<void> {
  const response = await fetch(`${target.url}/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(target),
    },
    body: JSON.stringify({ type, id: `smoke-${type}` }),
    signal: AbortSignal.timeout(3000),
  });
  const json = await response.json() as Record<string, unknown>;
  assert(response.ok, `${type} RPC returned HTTP ${response.status}`);
  assert(json.ok === true, `${type} RPC did not return ok.`);
}

async function stopTarget(target: SmokeTarget): Promise<void> {
  if (target.spawned !== undefined && target.spawned.exitCode === null) {
    target.spawned.kill("SIGTERM");
    await new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 3000);
      target.spawned?.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  if (target.cleanupDir !== undefined) {
    await rm(target.cleanupDir, { recursive: true, force: true });
  }
}

function authHeaders(target: SmokeTarget): Record<string, string> {
  return target.secret ? { authorization: `Bearer ${target.secret}` } : {};
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function readPort(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid DRAGON_SMOKE_GATEWAY_PORT: ${value}`);
  }
  return parsed;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function formatLogs(target: SmokeTarget): string {
  const logs = target.logs?.join("").trim();
  return logs ? `\nGateway logs:\n${logs.slice(-4000)}` : "";
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
