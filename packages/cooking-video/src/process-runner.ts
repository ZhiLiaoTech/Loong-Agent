import { spawn } from "node:child_process";
import { CookingVideoError } from "./errors.js";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string; signal?: AbortSignal; maxOutputBytes?: number },
) => Promise<ProcessResult>;

export const runProcess: ProcessRunner = async (command, args, options = {}) =>
  await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    const maxOutputBytes = options.maxOutputBytes ?? 16 * 1024 * 1024;
    const append = (target: "stdout" | "stderr", chunk: string): void => {
      if (settled) return;
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > maxOutputBytes) {
        settled = true;
        child.kill();
        reject(new CookingVideoError("PROCESS_FAILED", `${command} output exceeded ${maxOutputBytes} bytes.`));
        return;
      }
      if (target === "stdout") stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => append("stdout", chunk));
    child.stderr.on("data", chunk => append("stderr", chunk));
    child.on("error", error => {
      if (settled) return;
      settled = true;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new CookingVideoError("MEDIA_TOOL_MISSING", `${command} was not found on PATH.`));
      } else {
        reject(error);
      }
    });
    child.on("close", exitCode => {
      if (settled) return;
      settled = true;
      resolve({ stdout, stderr, exitCode: exitCode ?? -1 });
    });
  });

export async function runChecked(
  runner: ProcessRunner,
  command: string,
  args: readonly string[],
  options?: { cwd?: string; signal?: AbortSignal },
): Promise<ProcessResult> {
  const result = await runner(command, args, options);
  if (result.exitCode !== 0) {
    throw new CookingVideoError("PROCESS_FAILED", `${command} exited with code ${result.exitCode}.`, {
      stderr: result.stderr.slice(-4000),
    });
  }
  return result;
}
