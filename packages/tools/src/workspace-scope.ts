export type WorkspaceScopeKind = "global" | "workspace" | "custom";

const VALID_SCOPES = new Set<WorkspaceScopeKind>(["global", "workspace", "custom"]);

export function isWorkspaceScopeKind(value: unknown): value is WorkspaceScopeKind {
  return typeof value === "string" && VALID_SCOPES.has(value as WorkspaceScopeKind);
}

export function readWorkspaceScopeFromMetadata(
  metadata: Record<string, unknown> | undefined,
): WorkspaceScopeKind | undefined {
  if (!metadata) {
    return undefined;
  }
  const raw = metadata.workspaceScope;
  return isWorkspaceScopeKind(raw) ? raw : undefined;
}

export function isStudioScopedWebTurn(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) {
    return false;
  }
  const source = metadata.source;
  if (source !== "dashboard" && source !== "web") {
    return false;
  }
  return readWorkspaceScopeFromMetadata(metadata) !== undefined;
}

export function readWorkspaceScopePathFromMetadata(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  if (!metadata) {
    return undefined;
  }
  const raw = metadata.workspaceScopePath;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}
