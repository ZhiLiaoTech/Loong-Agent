import type { TranslateFn } from "../../events/formatGatewayEvent.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(value: unknown, keys: readonly string[]): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "string" && field.trim()) {
      return field.trim();
    }
  }
  return undefined;
}

function truncate(value: string, max = 80): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

export function labelForToolActivity(
  toolName: string,
  inputSummary: unknown,
  t: TranslateFn,
  backendLabel?: string,
  backendDetail?: string,
): { label: string; detail?: string } {
  if (backendLabel) {
    return {
      label: backendLabel,
      ...(backendDetail ? { detail: backendDetail } : {}),
    };
  }

  const name = toolName.trim() || "tool";
  const path = readStringField(inputSummary, ["path", "file", "filePath", "target"]);
  const query = readStringField(inputSummary, ["query", "pattern", "search", "glob"]);
  const url = readStringField(inputSummary, ["url", "href", "pageUrl"]);
  const command = readStringField(inputSummary, ["command", "cmd", "script", "shell"]);

  if (name === "file_read" && path) {
    return {
      label: t("chat.activity.readingFile"),
      detail: basename(path),
    };
  }
  if (name === "file_search" && (query || path)) {
    const detail = query ?? path;
    return detail
      ? { label: t("chat.activity.searchingFile"), detail }
      : { label: t("chat.activity.searchingFile") };
  }
  if (name === "file_patch" && path) {
    return {
      label: t("chat.activity.patchingFile"),
      detail: basename(path),
    };
  }
  if ((name === "shell_exec" || name === "sandbox_exec") && command) {
    return {
      label: t("chat.activity.runningCommand"),
      detail: truncate(command),
    };
  }
  if (
    (name === "browser_snapshot"
      || name === "browser_playwright_snapshot"
      || name === "browser_form_submit")
    && url
  ) {
    return {
      label: name === "browser_form_submit"
        ? t("chat.activity.submittingForm")
        : t("chat.activity.openingPage"),
      detail: truncate(url, 120),
    };
  }
  if (name.startsWith("mcp_")) {
    return {
      label: t("chat.activity.callingMcp"),
      detail: name.slice(4) || name,
    };
  }

  return {
    label: t("chat.activity.toolCall").replace("{name}", name),
  };
}
