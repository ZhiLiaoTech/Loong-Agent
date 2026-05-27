import { lstat, open, opendir } from "node:fs/promises";
import path from "node:path";
import type { DragonContextProvider } from "@dragon/core";
import { isRealCalendarDate } from "./memory-candidate-store.js";
import { fitText } from "./memory-text.js";
import { clampPositiveInteger, isNodeError, isPathInside, sameFileStat } from "./memory-util.js";

const DEFAULT_MARKDOWN_MEMORY_CONTEXT_CHARS = 6000;
const ABSOLUTE_MARKDOWN_MEMORY_CONTEXT_CHARS = 20_000;
const DEFAULT_MARKDOWN_MEMORY_FILE_BYTES = 64 * 1024;
const ABSOLUTE_MARKDOWN_MEMORY_FILE_BYTES = 1024 * 1024;
const DEFAULT_MARKDOWN_DAILY_NOTES = 3;
const ABSOLUTE_MARKDOWN_DAILY_NOTES = 30;
const MARKDOWN_DAILY_NOTE_SCAN_LIMIT = 1000;

export interface MarkdownMemoryContextProviderOptions {
  rootDir?: string;
  maxContentChars?: number;
  maxFileBytes?: number;
  maxDailyNotes?: number;
}

export function createMarkdownMemoryContextProvider(
  options: MarkdownMemoryContextProviderOptions = {},
): DragonContextProvider {
  const rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), ".dragon", "memory"));
  const maxContentChars = clampPositiveInteger(
    options.maxContentChars,
    DEFAULT_MARKDOWN_MEMORY_CONTEXT_CHARS,
    ABSOLUTE_MARKDOWN_MEMORY_CONTEXT_CHARS,
  );
  const maxFileBytes = clampPositiveInteger(
    options.maxFileBytes,
    DEFAULT_MARKDOWN_MEMORY_FILE_BYTES,
    ABSOLUTE_MARKDOWN_MEMORY_FILE_BYTES,
  );
  const maxDailyNotes = clampPositiveInteger(
    options.maxDailyNotes,
    DEFAULT_MARKDOWN_DAILY_NOTES,
    ABSOLUTE_MARKDOWN_DAILY_NOTES,
  );

  return {
    name: "markdown_memory",
    async buildContext() {
      const sections = await loadMarkdownMemorySections(rootDir, maxFileBytes, maxDailyNotes);
      if (sections.length === 0) {
        return [];
      }
      const content = fitText(
        sections.map(section => `## ${section.label}\n${section.content}`).join("\n\n"),
        maxContentChars,
        "[markdown memory truncated]",
      );
      return content
        ? [{
            title: "Human-readable memory",
            content,
            priority: 20,
            metadata: { rootDir, sectionCount: sections.length },
          }]
        : [];
    },
  };
}

interface MarkdownMemorySection {
  label: string;
  content: string;
}

interface SafeMarkdownDirectory {
  path: string;
  stat: Awaited<ReturnType<typeof lstat>>;
}

async function loadMarkdownMemorySections(
  rootDir: string,
  maxFileBytes: number,
  maxDailyNotes: number,
): Promise<MarkdownMemorySection[]> {
  const memoryRoot = await resolveSafeMarkdownDirectory(rootDir);
  if (memoryRoot === undefined) {
    return [];
  }

  const sections: MarkdownMemorySection[] = [];
  for (const fileName of ["USER.md", "PROJECT.md", "MEMORY.md"]) {
    const content = await readMarkdownMemoryFile(memoryRoot, fileName, maxFileBytes);
    if (content !== undefined) {
      sections.push({ label: fileName, content });
    }
  }
  const notesRoot = await resolveSafeMarkdownDirectory(path.join(memoryRoot.path, "notes"), memoryRoot);
  const dailyNoteNames = notesRoot === undefined
    ? []
    : await listDailyMarkdownNotes(notesRoot, maxDailyNotes);
  for (const fileName of dailyNoteNames) {
    const content = notesRoot === undefined
      ? undefined
      : await readMarkdownMemoryFile(notesRoot, fileName, maxFileBytes);
    if (content !== undefined) {
      sections.push({ label: `notes/${fileName}`, content });
    }
  }
  return sections;
}

async function resolveSafeMarkdownDirectory(
  directoryPath: string,
  parent?: SafeMarkdownDirectory,
): Promise<SafeMarkdownDirectory | undefined> {
  const resolvedPath = path.resolve(directoryPath);
  if (parent !== undefined && !isPathInside(resolvedPath, parent.path)) {
    return undefined;
  }
  if (parent !== undefined && !await sameDirectoryRef(parent)) {
    return undefined;
  }

  let directoryStat: Awaited<ReturnType<typeof lstat>>;
  try {
    directoryStat = await lstat(resolvedPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    return undefined;
  }
  return { path: resolvedPath, stat: directoryStat };
}

async function sameDirectoryRef(directory: SafeMarkdownDirectory): Promise<boolean> {
  try {
    const current = await lstat(directory.path);
    return current.isDirectory() && !current.isSymbolicLink() && sameFileStat(directory.stat, current);
  } catch {
    return false;
  }
}

async function listDailyMarkdownNotes(notesDir: SafeMarkdownDirectory, maxDailyNotes: number): Promise<string[]> {
  const names: string[] = [];
  let directory: Awaited<ReturnType<typeof opendir>>;
  try {
    if (!await sameDirectoryRef(notesDir)) {
      return [];
    }
    directory = await opendir(notesDir.path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    return [];
  }

  let scanned = 0;
  for await (const entry of directory) {
    scanned += 1;
    if (scanned > MARKDOWN_DAILY_NOTE_SCAN_LIMIT) {
      break;
    }
    if (entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/i.test(entry.name) && isRealCalendarDate(entry.name.slice(0, 10))) {
      names.push(entry.name);
    }
  }
  return names.sort((a, b) => b.localeCompare(a)).slice(0, maxDailyNotes);
}

async function readMarkdownMemoryFile(
  rootDir: SafeMarkdownDirectory,
  fileName: string,
  maxFileBytes: number,
): Promise<string | undefined> {
  if (path.isAbsolute(fileName) || fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    return undefined;
  }
  if (!await sameDirectoryRef(rootDir)) {
    return undefined;
  }
  const rootPath = rootDir.path;
  const filePath = path.resolve(rootPath, fileName);
  if (!isPathInside(filePath, rootPath)) {
    return undefined;
  }

  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    return undefined;
  }
  if (before.size > maxFileBytes) {
    return `[omitted: file exceeds ${maxFileBytes} bytes]`;
  }

  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, "r");
  } catch {
    return undefined;
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileStat(before, opened)) {
      return undefined;
    }
    if (opened.size > maxFileBytes) {
      return `[omitted: file exceeds ${maxFileBytes} bytes]`;
    }
    const after = await lstat(filePath);
    if (!after.isFile() || after.isSymbolicLink() || !sameFileStat(opened, after)) {
      return undefined;
    }
    if (!await sameDirectoryRef(rootDir)) {
      return undefined;
    }
    const buffer = Buffer.alloc(maxFileBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxFileBytes) {
      return `[omitted: file exceeds ${maxFileBytes} bytes]`;
    }
    const content = buffer.subarray(0, bytesRead).toString("utf8");
    return content.trim() ? content.trim() : undefined;
  } finally {
    await handle.close();
  }
}
