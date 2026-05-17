import { realpath } from "node:fs/promises";
import path from "node:path";

export async function resolveWorkspacePath(
  workspace: string | undefined,
  requestedPath: string,
): Promise<string> {
  if (!workspace) {
    throw new Error("Workspace is required for filesystem tools.");
  }

  const workspaceRoot = path.resolve(workspace);
  const absolutePath = path.resolve(workspaceRoot, requestedPath);
  if (!isPathInside(absolutePath, workspaceRoot)) {
    throw new Error(`Path escapes workspace: ${requestedPath}`);
  }

  const realWorkspaceRoot = await realpath(workspaceRoot);
  const realTargetPath = await realpath(absolutePath);
  if (!isPathInside(realTargetPath, realWorkspaceRoot)) {
    throw new Error(`Path escapes workspace through symlink or junction: ${requestedPath}`);
  }
  return realTargetPath;
}

export async function resolveWorkspaceRoot(workspace: string | undefined): Promise<string> {
  if (!workspace) {
    throw new Error("Workspace is required.");
  }
  return await realpath(path.resolve(workspace));
}

export function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

