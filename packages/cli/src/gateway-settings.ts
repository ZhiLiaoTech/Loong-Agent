import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MODEL_TIMEOUT_MS } from "@dragon/core";
import type { GatewayConfig } from "@dragon/gateway";

export interface GatewaySettingsFile {
  modelTimeoutMs?: number;
  host?: string;
  port?: number;
  authMode?: "none" | "shared-secret";
  sharedSecret?: string;
  requireExplicitSecret?: boolean;
  toolInvokeAllowlist?: string[];
}

export function gatewaySettingsPath(cwd = process.cwd()): string {
  const fromEnv = process.env.DRAGON_GATEWAY_CONFIG?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.join(cwd, ".dragon", "config", "gateway.json");
}

export async function loadGatewaySettingsFile(cwd = process.cwd()): Promise<GatewaySettingsFile> {
  const filePath = gatewaySettingsPath(cwd);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const out: GatewaySettingsFile = {};
    const modelTimeoutMs = parseOptionalPositiveMs(record.modelTimeoutMs, "gateway.json modelTimeoutMs");
    if (modelTimeoutMs !== undefined) {
      out.modelTimeoutMs = modelTimeoutMs;
    }
    if (typeof record.host === "string" && record.host.trim()) {
      out.host = record.host.trim();
    }
    if (typeof record.port === "number" && Number.isFinite(record.port)) {
      out.port = Math.floor(record.port);
    }
    if (record.authMode === "none" || record.authMode === "shared-secret") {
      out.authMode = record.authMode;
    }
    if (typeof record.sharedSecret === "string" && record.sharedSecret.trim()) {
      out.sharedSecret = record.sharedSecret.trim();
    }
    if (record.requireExplicitSecret === true) {
      out.requireExplicitSecret = true;
    }
    if (Array.isArray(record.toolInvokeAllowlist)) {
      out.toolInvokeAllowlist = record.toolInvokeAllowlist
        .map(item => String(item).trim())
        .filter(Boolean);
    }
    return out;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export function mergeGatewayConfigFromFile(
  config: GatewayConfig,
  file: GatewaySettingsFile,
): GatewayConfig {
  const merged: GatewayConfig = { ...config };
  if (file.host !== undefined && merged.host === undefined) {
    merged.host = file.host;
  }
  if (file.port !== undefined && merged.port === undefined) {
    merged.port = file.port;
  }
  if (file.authMode !== undefined && merged.authMode === undefined) {
    merged.authMode = file.authMode;
  }
  if (file.sharedSecret !== undefined && merged.sharedSecret === undefined) {
    merged.sharedSecret = file.sharedSecret;
    if (merged.authMode === undefined) {
      merged.authMode = "shared-secret";
    }
  }
  if (file.requireExplicitSecret === true) {
    merged.requireExplicitSecret = true;
  }
  if (file.toolInvokeAllowlist !== undefined && merged.toolInvokeAllowlist === undefined) {
    merged.toolInvokeAllowlist = file.toolInvokeAllowlist;
  }
  return merged;
}

export function parseModelTimeoutMsFromEnv(): number | undefined {
  const raw = process.env.DRAGON_MODEL_TIMEOUT_MS?.trim();
  if (!raw) {
    return undefined;
  }
  return parsePositiveMs(raw, "DRAGON_MODEL_TIMEOUT_MS");
}

export function parseModelTimeoutMsArg(value: string, label: string): number {
  return parsePositiveMs(value, label);
}

export function parseModelTimeoutSecArg(value: string, label: string): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`${label} must be a positive number of seconds.`);
  }
  return Math.floor(seconds * 1000);
}

export function resolveModelTimeoutMs(options: {
  cliMs?: number | undefined;
  fileMs?: number | undefined;
  envMs?: number | undefined;
}): number {
  return options.cliMs ?? options.envMs ?? options.fileMs ?? DEFAULT_MODEL_TIMEOUT_MS;
}

function parseOptionalPositiveMs(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${label} must be a positive number of milliseconds.`);
    }
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    return parsePositiveMs(value.trim(), label);
  }
  throw new Error(`${label} must be a positive number of milliseconds.`);
}

function parsePositiveMs(value: string, label: string): number {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`${label} must be a positive number of milliseconds.`);
  }
  return Math.floor(ms);
}
