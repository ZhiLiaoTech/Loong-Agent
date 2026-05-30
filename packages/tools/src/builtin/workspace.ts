import { realpath } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceScopeKind } from "../workspace-scope.js";
import { readWorkspaceScopeFromMetadata } from "../workspace-scope.js";

export async function resolveScopedPath(
  workspace: string | undefined,
  requestedPath: string,
  scope: WorkspaceScopeKind | undefined,
): Promise<string> {
  if (scope === "global") {
    const absolutePath = path.isAbsolute(requestedPath)
      ? path.resolve(requestedPath)
      : path.resolve(process.cwd(), requestedPath);
    return await realpath(absolutePath);
  }

  if (!workspace) {
    throw new Error("Workspace is required for scoped filesystem tools.");
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

/**
 * Resolve a scoped path that may not exist yet (for create/write tools).
 *
 * `resolveScopedPath` calls `realpath` on the target, which throws when the
 * file is missing. Here we instead validate the nearest existing ancestor
 * (symlink-resolved) stays inside the workspace, so brand-new files and
 * not-yet-created parent directories are allowed without weakening the
 * symlink-escape guard. The returned `absolutePath` is the lexically resolved
 * target; `workspaceRoot` is the symlink-resolved workspace root.
 */
export async function resolveScopedPathForCreate(
  workspace: string | undefined,
  requestedPath: string,
  scope: WorkspaceScopeKind | undefined,
): Promise<{ absolutePath: string; workspaceRoot: string }> {
  if (scope === "global") {
    const absolutePath = path.isAbsolute(requestedPath)
      ? path.resolve(requestedPath)
      : path.resolve(process.cwd(), requestedPath);
    return { absolutePath, workspaceRoot: path.resolve(process.cwd()) };
  }

  if (!workspace) {
    throw new Error("Workspace is required for scoped filesystem tools.");
  }

  const workspaceRoot = path.resolve(workspace);
  const absolutePath = path.resolve(workspaceRoot, requestedPath);
  if (!isPathInside(absolutePath, workspaceRoot)) {
    throw new Error(`Path escapes workspace: ${requestedPath}`);
  }

  const realWorkspaceRoot = await realpath(workspaceRoot);
  const realAncestor = await realpathNearestExisting(absolutePath);
  if (!isPathInside(realAncestor, realWorkspaceRoot)) {
    throw new Error(`Path escapes workspace through symlink or junction: ${requestedPath}`);
  }
  return { absolutePath, workspaceRoot: realWorkspaceRoot };
}

async function realpathNearestExisting(target: string): Promise<string> {
  let current = target;
  while (true) {
    try {
      return await realpath(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`Cannot resolve path: ${target}`);
      }
      current = parent;
    }
  }
}

export async function resolveScopedRoot(
  workspace: string | undefined,
  scope: WorkspaceScopeKind | undefined,
): Promise<string> {
  if (scope === "global") {
    return await realpath(process.cwd());
  }
  return await resolveWorkspaceRoot(workspace);
}

export async function resolveWorkspacePath(
  workspace: string | undefined,
  requestedPath: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const scope = readWorkspaceScopeFromMetadata(metadata);
  return resolveScopedPath(workspace, requestedPath, scope ?? (workspace ? "workspace" : undefined));
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

