import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveLoongDataRoot } from "./loong-paths.js";

export function defaultChannelConfigPath(): string {
  return path.join(resolveLoongDataRoot(), "config", "channels.json");
}

export async function loadChannelConfig(configPath = defaultChannelConfigPath()): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function saveChannelConfig(
  config: Record<string, unknown>,
  configPath = defaultChannelConfigPath(),
): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  const tempPath = path.join(path.dirname(configPath), `.channels.${randomUUID()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(tempPath, configPath);
}

/** Set a credential under a channel: config[channel][key] = value. */
export async function setChannelConfigValue(
  channel: string,
  key: string,
  value: string,
  configPath = defaultChannelConfigPath(),
): Promise<void> {
  const config = await loadChannelConfig(configPath);
  const existing = config[channel];
  const channelConfig: Record<string, unknown> = existing && typeof existing === "object" && !Array.isArray(existing)
    ? { ...(existing as Record<string, unknown>) }
    : {};
  channelConfig[key] = value;
  config[channel] = channelConfig;
  await saveChannelConfig(config, configPath);
}

/** Mask secret-bearing values for display (token/secret/key fields). */
export function maskChannelConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [channel, value] of Object.entries(config)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const masked: Record<string, unknown> = {};
      for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        masked[key] = /token|secret|key|password/i.test(key) && typeof raw === "string"
          ? maskSecret(raw)
          : raw;
      }
      out[channel] = masked;
    } else {
      out[channel] = value;
    }
  }
  return out;
}

function maskSecret(value: string): string {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}…${value.slice(-2)} (${value.length} chars)`;
}
