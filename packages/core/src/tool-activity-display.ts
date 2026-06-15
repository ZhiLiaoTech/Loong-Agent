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

export interface ToolActivityDisplay {
  displayLabel: string;
  displayDetail?: string;
}

export function formatToolActivityDisplay(
  toolName: string,
  inputSummary: unknown,
  phase: "start" | "end" | "update" = "start",
): ToolActivityDisplay {
  const name = toolName.trim() || "tool";
  const path = readStringField(inputSummary, ["path", "file", "filePath", "target"]);
  const query = readStringField(inputSummary, ["query", "pattern", "search", "glob"]);
  const url = readStringField(inputSummary, ["url", "href", "pageUrl"]);
  const command = readStringField(inputSummary, ["command", "cmd", "script", "shell"]);

  if (name === "file_read" && path) {
    return { displayLabel: "阅读文件", displayDetail: basename(path) };
  }
  if (name === "skill_load") {
    const skillName = readStringField(inputSummary, ["name", "skill", "skillName"]);
    return skillName
      ? { displayLabel: "加载技能", displayDetail: skillName }
      : { displayLabel: "加载技能" };
  }
  if (name === "skill_improve") {
    const skillName = readStringField(inputSummary, ["name", "skill", "skillName"]);
    return skillName
      ? { displayLabel: "优化技能", displayDetail: skillName }
      : { displayLabel: "优化技能" };
  }
  if (name === "file_search" && (query || path)) {
    const detail = query ?? path;
    return detail
      ? { displayLabel: "搜索文件", displayDetail: detail }
      : { displayLabel: "搜索文件" };
  }
  if (name === "file_patch" && path) {
    return { displayLabel: "修改文件", displayDetail: basename(path) };
  }
  if ((name === "shell_exec" || name === "sandbox_exec") && command) {
    return { displayLabel: "执行命令", displayDetail: truncate(command) };
  }
  if (
    (name === "browser_snapshot"
      || name === "browser_playwright_snapshot"
      || name === "browser_form_submit")
    && url
  ) {
    const verb = name === "browser_form_submit" ? "提交表单" : "打开网页";
    return { displayLabel: verb, displayDetail: truncate(url, 120) };
  }
  if (name.startsWith("mcp_")) {
    const mcpName = name.slice(4) || name;
    return { displayLabel: "调用 MCP", displayDetail: mcpName };
  }

  if (phase === "end") {
    return { displayLabel: name };
  }
  return { displayLabel: name };
}
