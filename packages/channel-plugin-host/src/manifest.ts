import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { OPENCLAW_PLUGIN_MANIFEST_FILE, type OpenClawPluginManifest } from "./types.js";

const MAX_MANIFEST_BYTES = 64_000;

export async function hasOpenClawPluginManifest(pluginRoot: string): Promise<boolean> {
  try {
    const manifestPath = path.join(pluginRoot, OPENCLAW_PLUGIN_MANIFEST_FILE);
    const manifestStat = await stat(manifestPath);
    return manifestStat.isFile();
  } catch {
    return false;
  }
}

export async function readOpenClawPluginManifest(pluginRoot: string): Promise<OpenClawPluginManifest> {
  const rootDir = await realpath(path.resolve(pluginRoot));
  const manifestPath = path.join(rootDir, OPENCLAW_PLUGIN_MANIFEST_FILE);
  const manifestStat = await stat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.size > MAX_MANIFEST_BYTES) {
    throw new Error(`Invalid OpenClaw plugin manifest: ${manifestPath}`);
  }
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OpenClaw plugin manifest must be a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) {
    throw new Error("OpenClaw plugin manifest requires a non-empty id.");
  }
  const channels = Array.isArray(record.channels)
    ? record.channels.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : undefined;
  const manifest: OpenClawPluginManifest = { id };
  if (typeof record.name === "string" && record.name.trim()) {
    manifest.name = record.name.trim();
  }
  if (typeof record.description === "string" && record.description.trim()) {
    manifest.description = record.description.trim();
  }
  if (typeof record.version === "string" && record.version.trim()) {
    manifest.version = record.version.trim();
  }
  if (channels && channels.length > 0) {
    manifest.channels = channels;
  }
  if (record.configSchema && typeof record.configSchema === "object" && !Array.isArray(record.configSchema)) {
    manifest.configSchema = record.configSchema as Record<string, unknown>;
  }
  if (typeof record.entry === "string" && record.entry.trim()) {
    manifest.entry = record.entry.trim();
  }
  return manifest;
}
