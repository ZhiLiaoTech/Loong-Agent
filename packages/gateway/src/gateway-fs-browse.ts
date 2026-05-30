import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { badRequest } from "./gateway-http.js";

export interface DirectoryBrowseEntry {
  name: string;
  path: string;
}

export interface DirectoryBrowseResult {
  path: string;
  label: string;
  parent?: string;
  entries: DirectoryBrowseEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBrowsePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0")) {
    badRequest("Directory path is invalid.");
  }
  return path.resolve(trimmed);
}

async function assertDirectory(targetPath: string): Promise<string> {
  let resolved = normalizeBrowsePath(targetPath);
  try {
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      badRequest("Path is not a directory.");
    }
    return resolved;
  } catch {
    badRequest(`Directory not found: ${targetPath}`);
  }
}

async function listWindowsDrives(): Promise<DirectoryBrowseEntry[]> {
  const entries: DirectoryBrowseEntry[] = [];
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const drive = `${letter}:\\`;
    try {
      const info = await stat(drive);
      if (info.isDirectory()) {
        entries.push({ name: drive, path: drive });
      }
    } catch {
      // skip unavailable drives
    }
  }
  return entries;
}

function parentBrowsePath(currentPath: string): string | undefined {
  if (process.platform === "win32") {
    const normalized = path.win32.normalize(currentPath);
    const parsed = path.win32.parse(normalized);
    if (parsed.root && normalized.length <= parsed.root.length) {
      return "";
    }
    const parent = path.win32.dirname(normalized);
    return parent.endsWith(":") ? `${parent}\\` : parent;
  }
  const normalized = path.posix.normalize(currentPath);
  if (normalized === "/") {
    return undefined;
  }
  const parent = path.posix.dirname(normalized);
  return parent || "/";
}

function labelForBrowsePath(currentPath: string): string {
  if (!currentPath) {
    return process.platform === "win32" ? "This PC" : "/";
  }
  if (process.platform === "win32" && /^[A-Za-z]:\\?$/.test(currentPath)) {
    return currentPath.endsWith("\\") ? currentPath : `${currentPath}\\`;
  }
  return currentPath;
}

async function listDirectoryChildren(currentPath: string): Promise<DirectoryBrowseEntry[]> {
  const resolved = await assertDirectory(currentPath);
  const entries = await readdir(resolved, { withFileTypes: true });
  const directories = entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry => {
      const childPath = path.join(resolved, entry.name);
      return { name: entry.name, path: childPath };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return directories;
}

async function browseAt(currentPath: string): Promise<DirectoryBrowseResult> {
  const entries = await listDirectoryChildren(currentPath);
  const parent = parentBrowsePath(currentPath);
  return {
    path: currentPath,
    label: labelForBrowsePath(currentPath),
    ...(parent !== undefined ? { parent } : {}),
    entries,
  };
}

export async function browseGatewayDirectory(params: unknown): Promise<DirectoryBrowseResult> {
  const pathParam = isRecord(params) && typeof params.path === "string" ? params.path.trim() : "";

  if (!pathParam) {
    if (process.platform === "win32") {
      return {
        path: "",
        label: labelForBrowsePath(""),
        entries: await listWindowsDrives(),
      };
    }
    return browseAt(os.homedir());
  }

  if (process.platform === "win32" && pathParam === "__roots__") {
    return {
      path: "",
      label: labelForBrowsePath(""),
      entries: await listWindowsDrives(),
    };
  }

  return browseAt(pathParam);
}
