import path from "node:path";
import { resolveDragonDataRoot } from "../dragon-paths.js";
import { createCronRunner, createFileCronJobStore, createGatewayWebhookCronTarget } from "@dragon/cron";
import { parseIntervalMs } from "../parse-cli-args.js";
import { waitForShutdown } from "../shutdown.js";

export interface ParsedCronArgs {
  jobsFile: string;
  gatewayUrl: string;
  secret?: string;
  once: boolean;
  intervalMs?: number;
}

export function parseCronArgs(args: string[]): ParsedCronArgs {
  const dataRoot = resolveDragonDataRoot();
  let jobsFile = process.env.DRAGON_CRON_JOBS?.trim() || path.join(dataRoot, "cron", "jobs.json");
  let gatewayUrl = process.env.DRAGON_GATEWAY_URL?.trim() || "http://127.0.0.1:17357";
  let secret = process.env.DRAGON_GATEWAY_SECRET?.trim() || undefined;
  let once = false;
  let intervalMs: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--once") {
      once = true;
      continue;
    }
    if (arg === "--jobs") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon cron --jobs <path>");
      }
      jobsFile = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--jobs=")) {
      const value = arg.slice("--jobs=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon cron --jobs=<path>");
      }
      jobsFile = path.resolve(value);
      continue;
    }
    if (arg === "--gateway-url") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon cron --gateway-url <url>");
      }
      gatewayUrl = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--gateway-url=")) {
      const value = arg.slice("--gateway-url=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon cron --gateway-url=<url>");
      }
      gatewayUrl = value;
      continue;
    }
    if (arg === "--secret") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon cron --secret <value>");
      }
      secret = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--secret=")) {
      const value = arg.slice("--secret=".length).trim();
      if (!value) {
        throw new Error("Usage: dragon cron --secret=<value>");
      }
      secret = value;
      continue;
    }
    if (arg === "--interval-ms") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("Usage: dragon cron --interval-ms <ms>");
      }
      intervalMs = parseIntervalMs(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--interval-ms=")) {
      intervalMs = parseIntervalMs(arg.slice("--interval-ms=".length).trim());
      continue;
    }
    throw new Error(`Unknown cron option: ${arg}`);
  }

  return {
    jobsFile: path.resolve(jobsFile),
    gatewayUrl,
    once,
    ...(secret !== undefined ? { secret } : {}),
    ...(intervalMs !== undefined ? { intervalMs } : {}),
  };
}

export async function runCron(args: string[]): Promise<void> {
  const parsed = parseCronArgs(args);
  const store = createFileCronJobStore({ filePath: parsed.jobsFile });
  const target = createGatewayWebhookCronTarget({
    gatewayUrl: parsed.gatewayUrl,
    ...(parsed.secret !== undefined ? { sharedSecret: parsed.secret } : {}),
  });
  const runner = createCronRunner({ store, target });

  if (parsed.once) {
    const result = await runner.tick();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const initial = await runner.tick();
  runner.start(parsed.intervalMs !== undefined ? { intervalMs: parsed.intervalMs } : {});
  process.stderr.write(`Dragon cron runner using ${parsed.jobsFile} -> ${parsed.gatewayUrl}\n`);
  if (initial.delivered.length > 0) {
    process.stderr.write(`Dragon cron delivered ${initial.delivered.length} due job(s) on startup.\n`);
  }
  try {
    await waitForShutdown();
  } finally {
    runner.stop();
  }
}
