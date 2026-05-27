import { lstat, stat } from "node:fs/promises";
import { MemoryToolError } from "./memory-tool-error.js";
import { isNodeError } from "./memory-util.js";

export async function assertCanAppendFile(
  filePath: string,
  bytesToAppend: number,
  maxFileBytes: number,
  label: string,
): Promise<void> {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.size + bytesToAppend > maxFileBytes) {
      throw new MemoryToolError(`${label} would exceed ${maxFileBytes} bytes.`);
    }
  } catch (error) {
    if (error instanceof MemoryToolError) {
      throw error;
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      if (bytesToAppend > maxFileBytes) {
        throw new MemoryToolError(`${label} would exceed ${maxFileBytes} bytes.`);
      }
      return;
    }
    throw new MemoryToolError(`${label} is unavailable.`);
  }
}

export async function assertCanAppendRegularFile(
  filePath: string,
  bytesToAppend: number,
  maxFileBytes: number,
  label: string,
): Promise<void> {
  try {
    const fileStat = await lstat(filePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new MemoryToolError(`${label} must be a regular file.`);
    }
    if (fileStat.size + bytesToAppend > maxFileBytes) {
      throw new MemoryToolError(`${label} would exceed ${maxFileBytes} bytes.`);
    }
  } catch (error) {
    if (error instanceof MemoryToolError) {
      throw error;
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      if (bytesToAppend > maxFileBytes) {
        throw new MemoryToolError(`${label} would exceed ${maxFileBytes} bytes.`);
      }
      return;
    }
    throw new MemoryToolError(`${label} is unavailable.`);
  }
}
