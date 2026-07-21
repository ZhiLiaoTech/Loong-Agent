import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GatewayStepResult } from "./gateway-step-types.js";

export interface StepIdempotencyStore {
  get(key: string): Promise<GatewayStepResult | undefined>;
  put(key: string, result: GatewayStepResult): Promise<void>;
}

export function createInMemoryStepIdempotencyStore(): StepIdempotencyStore {
  const entries = new Map<string, GatewayStepResult>();
  return {
    async get(key) {
      return entries.get(key);
    },
    async put(key, result) {
      entries.set(key, structuredClone(result));
    },
  };
}

function idempotencyFilePath(dir: string, key: string): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return path.join(dir, `${digest}.json`);
}

export function createFileStepIdempotencyStore(dir: string): StepIdempotencyStore {
  return {
    async get(key) {
      try {
        const raw = await readFile(idempotencyFilePath(dir, key), "utf8");
        return JSON.parse(raw) as GatewayStepResult;
      } catch {
        return undefined;
      }
    },
    async put(key, result) {
      await mkdir(dir, { recursive: true });
      const payload = { ...result, replayed: undefined };
      await writeFile(idempotencyFilePath(dir, key), JSON.stringify(payload), "utf8");
    },
  };
}
