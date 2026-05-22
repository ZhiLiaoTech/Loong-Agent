import { readFile } from "node:fs/promises";
import path from "node:path";

export interface McpServerConfig {
  id: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
}

export interface McpConfigFile {
  servers?: McpServerConfig[];
}

export async function loadMcpConfig(configPath: string): Promise<McpServerConfig[]> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as McpConfigFile;
    if (!Array.isArray(parsed.servers)) {
      return [];
    }
    return parsed.servers
      .map(server => normalizeMcpServerConfig(server))
      .filter((server): server is McpServerConfig => server !== undefined);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function defaultMcpConfigPath(cwd = process.cwd()): string {
  return path.join(cwd, ".dragon", "config", "mcp.json");
}

function normalizeMcpServerConfig(server: unknown): McpServerConfig | undefined {
  if (!server || typeof server !== "object" || Array.isArray(server)) {
    return undefined;
  }
  const raw = server as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id.trim() || raw.disabled === true) {
    return undefined;
  }
  const id = raw.id.trim();
  const url = typeof raw.url === "string" && raw.url.trim() ? raw.url.trim() : undefined;
  const command = typeof raw.command === "string" && raw.command.trim() ? raw.command.trim() : undefined;
  if (!url && !command) {
    return undefined;
  }
  const normalized: McpServerConfig = { id };
  if (url) {
    normalized.url = url;
    if (raw.headers && typeof raw.headers === "object") {
      normalized.headers = Object.fromEntries(
        Object.entries(raw.headers as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
  }
  if (command) {
    normalized.command = command;
    if (Array.isArray(raw.args)) {
      normalized.args = raw.args.map(String);
    }
    if (raw.env && typeof raw.env === "object") {
      normalized.env = raw.env as Record<string, string>;
    }
  }
  return normalized;
}
