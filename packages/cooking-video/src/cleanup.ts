import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { JobPaths } from "./paths.js";
import { resolveWithin } from "./paths.js";

function isTemporary(name: string): boolean {
  return name.endsWith(".tmp") || name.includes(".part.") || name.endsWith(".part");
}

async function collect(directory: string, root: string, files: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const candidate = resolveWithin(root, path.join(directory, entry.name));
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await collect(candidate, root, files);
    else if (entry.isFile() && isTemporary(entry.name)) files.push(candidate);
  }
}

export async function cleanupJobTemporaryFiles(paths: JobPaths): Promise<string[]> {
  const files: string[] = [];
  for (const directory of [paths.proxy, paths.frames, paths.analysis, paths.edit, paths.output, paths.state]) {
    await collect(directory, paths.root, files);
  }
  await Promise.all(files.map(file => rm(file, { force: true })));
  return files.map(file => path.relative(paths.root, file).replace(/\\/g, "/")).sort();
}
