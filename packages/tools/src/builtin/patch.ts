import { randomUUID } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import type { ToolDefinition, ToolInvocation, ToolJsonSchema, ToolResult } from "../types.js";
import { resolveScopedPath, resolveScopedRoot } from "./workspace.js";
import { readWorkspaceScopeFromMetadata } from "../workspace-scope.js";

export interface FilePatchInput {
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}

export interface FilePatchOutput {
  path: string;
  replacements: number;
  diff: string;
}

const MAX_PATCH_FILE_BYTES = 512_000;
const MAX_DIFF_CHARS = 64_000;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const filePatchSchema: ToolJsonSchema = {
  type: "object",
  properties: {
    path: { type: "string" },
    oldText: { type: "string" },
    newText: { type: "string" },
    replaceAll: { type: "boolean" },
  },
  required: ["path", "oldText", "newText"],
  additionalProperties: false,
};

export function createFilePatchTool(): ToolDefinition<FilePatchInput, FilePatchOutput> {
  return {
    name: "file_patch",
    description: "Patch a UTF-8 text file in the current workspace by replacing exact text and returning a diff.",
    inputSchema: filePatchSchema,
    capabilities: ["read", "write"],
    permission: "ask",
    async invoke(invocation) {
      return safelyInvoke(invocation, async () => {
        const input = parseFilePatchInput(invocation.input);
        const scope = readWorkspaceScopeFromMetadata(invocation.metadata);
        const absolutePath = await resolveScopedPath(invocation.workspace, input.path, scope);
        const workspaceRoot = await resolveScopedRoot(invocation.workspace, scope);
        const relativePath = path.relative(workspaceRoot, absolutePath);
        const fileStat = await stat(absolutePath);
        if (!fileStat.isFile()) {
          throw new Error(`Not a file: ${input.path}`);
        }
        if (fileStat.size > MAX_PATCH_FILE_BYTES) {
          throw new Error(`Refusing to patch file larger than ${MAX_PATCH_FILE_BYTES} bytes: ${input.path}`);
        }

        const before = await readTextFile(absolutePath);
        const matchCount = countOccurrences(before, input.oldText);
        if (matchCount === 0) {
          throw new Error(`Patch target text was not found in ${input.path}.`);
        }
        if (!input.replaceAll && matchCount !== 1) {
          throw new Error(
            `Patch target text matched ${matchCount} times in ${input.path}; provide a more specific oldText or set replaceAll.`,
          );
        }

        const after = input.replaceAll
          ? before.split(input.oldText).join(input.newText)
          : before.replace(input.oldText, input.newText);
        if (after === before) {
          throw new Error(`Patch made no changes to ${input.path}.`);
        }
        const afterBytes = Buffer.byteLength(after, "utf8");
        if (afterBytes > MAX_PATCH_FILE_BYTES) {
          throw new Error(`Refusing to write patched file larger than ${MAX_PATCH_FILE_BYTES} bytes: ${input.path}`);
        }

        await atomicWriteFile(absolutePath, after);
        return {
          path: relativePath,
          replacements: input.replaceAll ? matchCount : 1,
          diff: createUnifiedDiff(relativePath, before, after),
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

function parseFilePatchInput(input: unknown): FilePatchInput {
  if (!isRecord(input)) {
    throw new Error("file_patch requires an object input.");
  }
  if (typeof input.path !== "string" || !input.path.trim()) {
    throw new Error("file_patch requires a non-empty path.");
  }
  if (typeof input.oldText !== "string" || !input.oldText) {
    throw new Error("file_patch requires non-empty oldText.");
  }
  if (typeof input.newText !== "string") {
    throw new Error("file_patch requires newText.");
  }
  if (Buffer.byteLength(input.oldText, "utf8") > MAX_PATCH_FILE_BYTES) {
    throw new Error(`file_patch oldText cannot exceed ${MAX_PATCH_FILE_BYTES} bytes.`);
  }
  if (Buffer.byteLength(input.newText, "utf8") > MAX_PATCH_FILE_BYTES) {
    throw new Error(`file_patch newText cannot exceed ${MAX_PATCH_FILE_BYTES} bytes.`);
  }
  return {
    path: input.path,
    oldText: input.oldText,
    newText: input.newText,
    ...(typeof input.replaceAll === "boolean" ? { replaceAll: input.replaceAll } : {}),
  };
}

// Atomic write: write content to a sibling temp file, then rename over the
// destination. A crash mid-write leaves the original file intact instead of
// truncated, which plain writeFile would not guarantee.
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

async function readTextFile(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  if (buffer.includes(0)) {
    throw new Error(`Refusing to patch likely binary file: ${filePath}`);
  }
  try {
    return utf8Decoder.decode(buffer);
  } catch {
    throw new Error(`Refusing to patch invalid UTF-8 file: ${filePath}`);
  }
}

function countOccurrences(value: string, search: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    index = value.indexOf(search, index);
    if (index === -1) {
      return count;
    }
    count += 1;
    index += search.length;
  }
}

function createUnifiedDiff(relativePath: string, before: string, after: string): string {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  let prefix = 0;
  while (
    prefix < beforeLines.length
    && prefix < afterLines.length
    && beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix
    && suffix < afterLines.length - prefix
    && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const context = 3;
  const beforeStart = Math.max(0, prefix - context);
  const afterStart = Math.max(0, prefix - context);
  const beforeEnd = Math.min(beforeLines.length, beforeLines.length - suffix + context);
  const afterEnd = Math.min(afterLines.length, afterLines.length - suffix + context);
  const hunkBefore = beforeLines.slice(beforeStart, beforeEnd);
  const hunkAfter = afterLines.slice(afterStart, afterEnd);

  const beforeChangedStart = prefix - beforeStart;
  const beforeChangedEnd = hunkBefore.length - Math.max(0, suffix - (beforeLines.length - beforeEnd));
  const afterChangedStart = prefix - afterStart;
  const afterChangedEnd = hunkAfter.length - Math.max(0, suffix - (afterLines.length - afterEnd));

  const lines = [
    `--- a/${toPosixPath(relativePath)}`,
    `+++ b/${toPosixPath(relativePath)}`,
    `@@ -${beforeStart + 1},${hunkBefore.length} +${afterStart + 1},${hunkAfter.length} @@`,
  ];

  for (let index = 0; index < beforeChangedStart; index += 1) {
    lines.push(` ${hunkBefore[index] ?? ""}`);
  }
  for (let index = beforeChangedStart; index < beforeChangedEnd; index += 1) {
    lines.push(`-${hunkBefore[index] ?? ""}`);
  }
  for (let index = afterChangedStart; index < afterChangedEnd; index += 1) {
    lines.push(`+${hunkAfter[index] ?? ""}`);
  }
  for (let index = beforeChangedEnd; index < hunkBefore.length; index += 1) {
    lines.push(` ${hunkBefore[index] ?? ""}`);
  }

  const diff = lines.join("\n");
  return diff.length > MAX_DIFF_CHARS
    ? `${diff.slice(0, MAX_DIFF_CHARS)}\n[diff truncated]`
    : diff;
}

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").split("\n");
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
