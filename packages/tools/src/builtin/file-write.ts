import { randomUUID } from "node:crypto";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, ToolInvocation, ToolJsonSchema, ToolResult } from "../types.js";
import { resolveScopedPathForCreate } from "./workspace.js";
import { readWorkspaceScopeFromMetadata } from "../workspace-scope.js";

export interface FileWriteInput {
  path: string;
  content: string;
  overwrite?: boolean;
  createDirs?: boolean;
}

export interface FileWriteOutput {
  path: string;
  bytesWritten: number;
  created: boolean;
}

const MAX_WRITE_BYTES = 512_000;

const fileWriteSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    path: { type: "string" },
    content: { type: "string" },
    overwrite: { type: "boolean" },
    createDirs: { type: "boolean" },
  },
  required: ["path", "content"],
  additionalProperties: false,
};

export function createFileWriteTool(): ToolDefinition<FileWriteInput, FileWriteOutput> {
  return {
    name: "file_write",
    description:
      "Create or overwrite a UTF-8 text file in the current workspace. Creates parent directories by default; refuses to overwrite when overwrite is false.",
    inputSchema: fileWriteSchema,
    capabilities: ["write"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseFileWriteInput(invocation.input);
        const scope = readWorkspaceScopeFromMetadata(invocation.metadata);
        const { absolutePath, workspaceRoot } = await resolveScopedPathForCreate(
          invocation.workspace,
          input.path,
          scope,
        );
        const relativePath = path.relative(workspaceRoot, absolutePath) || path.basename(absolutePath);

        const existing = await stat(absolutePath).catch(() => undefined);
        if (existing?.isDirectory()) {
          throw new Error(`Refusing to write over a directory: ${input.path}`);
        }
        const created = existing === undefined;
        if (!created && input.overwrite === false) {
          throw new Error(`File already exists and overwrite is false: ${input.path}`);
        }

        if (input.createDirs !== false) {
          await mkdir(path.dirname(absolutePath), { recursive: true });
        }
        await atomicWriteFile(absolutePath, input.content);
        return {
          path: relativePath,
          bytesWritten: Buffer.byteLength(input.content, "utf8"),
          created,
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

function parseFileWriteInput(input: unknown): FileWriteInput {
  if (!isRecord(input)) {
    throw new Error("file_write requires an object input.");
  }
  if (typeof input.path !== "string" || !input.path.trim()) {
    throw new Error("file_write requires a non-empty path.");
  }
  if (typeof input.content !== "string") {
    throw new Error("file_write requires string content.");
  }
  if (Buffer.byteLength(input.content, "utf8") > MAX_WRITE_BYTES) {
    throw new Error(`file_write content cannot exceed ${MAX_WRITE_BYTES} bytes.`);
  }
  return {
    path: input.path,
    content: input.content,
    ...(typeof input.overwrite === "boolean" ? { overwrite: input.overwrite } : {}),
    ...(typeof input.createDirs === "boolean" ? { createDirs: input.createDirs } : {}),
  };
}

// Atomic write: write to a sibling temp file, then rename over the destination.
// A crash mid-write leaves any existing file intact instead of truncated.
async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, filePath);
  } catch (error) {
    try { await unlink(tempPath); } catch { /* best-effort */ }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
