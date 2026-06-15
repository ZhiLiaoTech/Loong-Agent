export type WorkspaceScopeKind = "global" | "workspace" | "custom";

export interface WorkspaceScopeSelection {
  kind: WorkspaceScopeKind;
  /** Effective root path for workspace/custom scopes. */
  path?: string;
}

export function scopeMenuValue(selection: WorkspaceScopeSelection): string {
  if (selection.kind === "custom" && selection.path) {
    return `custom:${selection.path}`;
  }
  return selection.kind;
}

export function parseScopeMenuValue(value: string): WorkspaceScopeSelection | undefined {
  if (value === "global" || value === "workspace") {
    return { kind: value };
  }
  if (value.startsWith("custom:")) {
    const path = value.slice("custom:".length).trim();
    return path ? { kind: "custom", path } : undefined;
  }
  return undefined;
}

export function resolveEffectiveWorkspace(
  selection: WorkspaceScopeSelection,
  profileWorkspace?: string,
): { workspace?: string; scope: WorkspaceScopeKind; scopePath?: string } {
  if (selection.kind === "global") {
    return { scope: "global" };
  }
  if (selection.kind === "workspace") {
    const path = selection.path?.trim() || profileWorkspace?.trim() || "";
    return path
      ? { workspace: path, scope: "workspace", scopePath: path }
      : { scope: "workspace" };
  }
  const path = selection.path?.trim() || "";
  return path
    ? { workspace: path, scope: "custom", scopePath: path }
    : { scope: "custom" };
}

const SCOPE_STORAGE_KEY = "loong.chat.workspaceScope.v1";
const CUSTOM_PATHS_KEY = "loong.chat.customScopePaths.v1";

export function loadWorkspaceScopeSelection(): WorkspaceScopeSelection {
  if (typeof globalThis.localStorage === "undefined") {
    return { kind: "workspace" };
  }
  try {
    const raw = globalThis.localStorage.getItem(SCOPE_STORAGE_KEY);
    if (!raw) {
      return { kind: "workspace" };
    }
    const parsed = JSON.parse(raw) as Partial<WorkspaceScopeSelection>;
    if (parsed.kind === "workspace" || parsed.kind === "custom" || parsed.kind === "global") {
      return {
        kind: parsed.kind,
        ...(typeof parsed.path === "string" && parsed.path.trim() ? { path: parsed.path.trim() } : {}),
      };
    }
  } catch {
    // ignore
  }
  return { kind: "workspace" };
}

export function saveWorkspaceScopeSelection(selection: WorkspaceScopeSelection): void {
  if (typeof globalThis.localStorage === "undefined") {
    return;
  }
  try {
    globalThis.localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // ignore
  }
}

export function loadCustomScopePaths(): string[] {
  if (typeof globalThis.localStorage === "undefined") {
    return [];
  }
  try {
    const raw = globalThis.localStorage.getItem(CUSTOM_PATHS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  } catch {
    return [];
  }
}

export function addCustomScopePath(path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed) {
    return loadCustomScopePaths();
  }
  const next = [trimmed, ...loadCustomScopePaths().filter(entry => entry !== trimmed)].slice(0, 8);
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      globalThis.localStorage.setItem(CUSTOM_PATHS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  return next;
}

export function basenameScopePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}
