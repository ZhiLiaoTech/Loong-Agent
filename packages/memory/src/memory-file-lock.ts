import { mkdir, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { MemoryToolError } from "./memory-tool-error.js";
import { isNodeError } from "./memory-util.js";

const MEMORY_FILE_LOCK_TIMEOUT_MS = 15_000;
const MEMORY_FILE_LOCK_RETRY_MS = 50;
const MEMORY_FILE_LOCK_STALE_MS = 60_000;

/** Cross-process advisory lock per JSONL file (mkdir-based). */
export async function withMemoryFileLock<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const release = await acquireMemoryFileLock(filePath);
  try {
    return await task();
  } finally {
    await release();
  }
}

async function acquireMemoryFileLock(filePath: string): Promise<() => Promise<void>> {
  const lockDir = `${filePath}.lock`;
  const deadline = Date.now() + MEMORY_FILE_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      await mkdir(lockDir, { recursive: false });
      try {
        await writeFile(path.join(lockDir, "owner"), String(process.pid), "utf8");
      } catch {
        // owner marker is best-effort
      }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try { await unlink(path.join(lockDir, "owner")); } catch { /* ignore */ }
        try { await rmdir(lockDir); } catch { /* may have been cleaned by stale handler */ }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      try {
        const lockStat = await stat(lockDir);
        if (Date.now() - lockStat.mtimeMs > MEMORY_FILE_LOCK_STALE_MS) {
          try { await unlink(path.join(lockDir, "owner")); } catch { /* ignore */ }
          try { await rmdir(lockDir); } catch { /* ignore */ }
        }
      } catch {
        // stale check best-effort
      }
      if (Date.now() >= deadline) {
        throw new MemoryToolError(
          `Timed out acquiring memory candidate lock on ${path.basename(filePath)} after ${MEMORY_FILE_LOCK_TIMEOUT_MS}ms.`,
        );
      }
      await new Promise(resolve => setTimeout(resolve, MEMORY_FILE_LOCK_RETRY_MS));
    }
  }
}
