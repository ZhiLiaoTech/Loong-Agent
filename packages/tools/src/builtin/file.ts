import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, ToolInvocation, ToolJsonSchema, ToolResult } from "../types.js";
import { isPathInside, resolveWorkspacePath, resolveWorkspaceRoot } from "./workspace.js";

export interface FileReadInput {
  path: string;
  maxBytes?: number;
}

export interface FileReadOutput {
  path: string;
  content: string;
  truncated: boolean;
  bytesRead: number;
}

export interface FileSearchInput {
  query: string;
  path?: string;
  maxResults?: number;
  maxFiles?: number;
  maxBytesPerFile?: number;
}

export interface FileSearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface FileSearchOutput {
  query: string;
  matches: FileSearchMatch[];
  truncated: boolean;
  filesScanned: number;
}

const DEFAULT_FILE_READ_MAX_BYTES = 128_000;
const DEFAULT_SEARCH_MAX_RESULTS = 100;
const DEFAULT_SEARCH_MAX_FILES = 1000;
const DEFAULT_SEARCH_MAX_BYTES_PER_FILE = 256_000;
const ABSOLUTE_MAX_BYTES_PER_FILE = 512_000;
const ABSOLUTE_MAX_SEARCH_RESULTS = 200;
const ABSOLUTE_MAX_SEARCH_FILES = 1000;
const ABSOLUTE_MAX_VISITED_ENTRIES = 5000;

const fileReadSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    path: { type: "string" },
    maxBytes: { type: "number" },
  },
  required: ["path"],
  additionalProperties: false,
};

const fileSearchSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    query: { type: "string" },
    path: { type: "string" },
    maxResults: { type: "number" },
    maxFiles: { type: "number" },
    maxBytesPerFile: { type: "number" },
  },
  required: ["query"],
  additionalProperties: false,
};

export function createFileReadTool(): ToolDefinition<FileReadInput, FileReadOutput> {
  return {
    name: "file_read",
    description: "Read a UTF-8 text file inside the current workspace.",
    inputSchema: fileReadSchema,
    capabilities: ["read"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseFileReadInput(invocation.input);
        const absolutePath = await resolveWorkspacePath(invocation.workspace, input.path);
        const workspaceRoot = await resolveWorkspaceRoot(invocation.workspace);
        const maxBytes = Math.min(input.maxBytes ?? DEFAULT_FILE_READ_MAX_BYTES, ABSOLUTE_MAX_BYTES_PER_FILE);
        const { content, bytesRead, truncated } = await readBoundedTextFile(absolutePath, maxBytes);
        return {
          path: path.relative(workspaceRoot, absolutePath),
          content,
          truncated,
          bytesRead,
        };
      });
    },
  };
}

export function createFileSearchTool(): ToolDefinition<FileSearchInput, FileSearchOutput> {
  return {
    name: "file_search",
    description: "Search UTF-8 text files inside the current workspace.",
    inputSchema: fileSearchSchema,
    capabilities: ["read"],
    permission: "allow",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseFileSearchInput(invocation.input);
        const absoluteRoot = await resolveWorkspacePath(invocation.workspace, input.path ?? ".");
        const workspaceRoot = await resolveWorkspaceRoot(invocation.workspace);
        const maxResults = Math.min(input.maxResults ?? DEFAULT_SEARCH_MAX_RESULTS, ABSOLUTE_MAX_SEARCH_RESULTS);
        const maxFiles = Math.min(input.maxFiles ?? DEFAULT_SEARCH_MAX_FILES, ABSOLUTE_MAX_SEARCH_FILES);
        const maxBytesPerFile = Math.min(
          input.maxBytesPerFile ?? DEFAULT_SEARCH_MAX_BYTES_PER_FILE,
          ABSOLUTE_MAX_BYTES_PER_FILE,
        );
        const matches: FileSearchMatch[] = [];
        let filesScanned = 0;

        for await (const filePath of walkTextFiles(absoluteRoot, workspaceRoot, maxFiles, ABSOLUTE_MAX_VISITED_ENTRIES)) {
          filesScanned += 1;
          const textFile = await readBoundedTextFile(filePath, maxBytesPerFile).catch(() => undefined);
          if (!textFile) {
            continue;
          }
          const lines = textFile.content.split(/\r?\n/);
          for (let index = 0; index < lines.length; index += 1) {
            const text = lines[index] ?? "";
            if (text.includes(input.query)) {
              matches.push({
                path: path.relative(workspaceRoot, filePath),
                line: index + 1,
                text,
              });
              if (matches.length >= maxResults) {
                return {
                  query: input.query,
                  matches,
                  truncated: true,
                  filesScanned,
                };
              }
            }
          }
        }

        return {
          query: input.query,
          matches,
          truncated: filesScanned >= maxFiles,
          filesScanned,
        };
      });
    },
  };
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

function parseFileReadInput(input: unknown): FileReadInput {
  if (!isRecord(input) || typeof input.path !== "string" || !input.path.trim()) {
    throw new Error("file_read requires a non-empty path.");
  }
  return {
    path: input.path,
    ...(typeof input.maxBytes === "number" ? { maxBytes: Math.max(1, Math.floor(input.maxBytes)) } : {}),
  };
}

function parseFileSearchInput(input: unknown): FileSearchInput {
  if (!isRecord(input) || typeof input.query !== "string" || !input.query) {
    throw new Error("file_search requires a non-empty query.");
  }
  return {
    query: input.query,
    ...(typeof input.path === "string" ? { path: input.path } : {}),
    ...(typeof input.maxResults === "number" ? { maxResults: Math.max(1, Math.floor(input.maxResults)) } : {}),
    ...(typeof input.maxFiles === "number" ? { maxFiles: Math.max(1, Math.floor(input.maxFiles)) } : {}),
    ...(typeof input.maxBytesPerFile === "number"
      ? { maxBytesPerFile: Math.max(1024, Math.floor(input.maxBytesPerFile)) }
      : {}),
  };
}

async function* walkTextFiles(
  root: string,
  workspaceRoot: string,
  maxFiles: number,
  maxVisitedEntries: number,
): AsyncGenerator<string> {
  let yielded = 0;
  let visited = 0;

  async function* walk(current: string): AsyncGenerator<string> {
    if (yielded >= maxFiles || visited >= maxVisitedEntries || !isPathInside(current, workspaceRoot)) {
      return;
    }

    visited += 1;
    const currentStat = await stat(current);
    if (currentStat.isFile()) {
      if (currentStat.size <= ABSOLUTE_MAX_BYTES_PER_FILE && isLikelyTextFile(current)) {
        yielded += 1;
        yield current;
      }
      return;
    }

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (yielded >= maxFiles) {
        return;
      }
      visited += 1;
      if (visited >= maxVisitedEntries) {
        return;
      }
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
        continue;
      }
      if (entry.isSymbolicLink()) {
        continue;
      }
      const childPath = path.join(current, entry.name);
      if (!isPathInside(childPath, workspaceRoot)) {
        continue;
      }
      if (entry.isDirectory()) {
        yield* walk(childPath);
      } else if (entry.isFile() && isLikelyTextFile(childPath)) {
        const childStat = await stat(childPath);
        if (childStat.size <= ABSOLUTE_MAX_BYTES_PER_FILE) {
          yielded += 1;
          yield childPath;
        }
      }
    }
  }

  yield* walk(root);
}

async function readBoundedTextFile(
  filePath: string,
  maxBytes: number,
): Promise<{ content: string; bytesRead: number; truncated: boolean }> {
  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const slice = buffer.subarray(0, Math.min(bytesRead, maxBytes));
    if (containsBinaryBytes(slice)) {
      throw new Error(`Refusing to read likely binary file: ${filePath}`);
    }
    return {
      content: slice.toString("utf8"),
      bytesRead: slice.byteLength,
      truncated: bytesRead > maxBytes,
    };
  } finally {
    await file.close();
  }
}

function isLikelyTextFile(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  if (basename === "readme" || basename === "license" || basename === ".gitignore") {
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  return [
    ".cjs",
    ".css",
    ".csv",
    ".cts",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".mts",
    ".sql",
    ".svg",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
  ].includes(ext);
}

function containsBinaryBytes(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
