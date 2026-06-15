import type { ActivityCategory, ActivityStepKind, ChatActivityStep } from "./types.js";

function readToolName(step: ChatActivityStep): string {
  if (step.category !== "tool") {
    return "";
  }
  const prefix = "tool:";
  if (step.id.startsWith(prefix)) {
    return step.id.slice(prefix.length).split(":")[0] ?? "";
  }
  return step.detail ?? "";
}

export function inferActivityStepKind(
  category: ActivityCategory,
  label: string,
  toolName?: string,
): ActivityStepKind {
  if (category === "model") {
    return "thinking";
  }
  if (category === "permission") {
    return "permission";
  }
  if (category === "context") {
    return "context";
  }

  const name = (toolName ?? "").trim();
  if (name === "skill_load" || name === "skill_improve" || name === "skills_list") {
    return "skill";
  }
  if (name === "file_read") {
    return "read_file";
  }
  if (name === "file_patch" || name === "file_write") {
    return "write_file";
  }
  if (name === "file_search") {
    return "search_file";
  }
  if (
    name === "shell_exec"
    || name === "sandbox_exec"
    || label.includes("执行命令")
    || label.toLowerCase().includes("command")
  ) {
    return "command";
  }
  if (
    name.startsWith("browser_")
    || name === "browser_snapshot"
    || name === "browser_playwright_snapshot"
    || name === "browser_form_submit"
    || label.includes("网页")
    || label.includes("表单")
  ) {
    return "browser";
  }

  return "generic";
}

export function resolveActivityStepKind(step: ChatActivityStep): ActivityStepKind {
  if (step.kind) {
    return step.kind;
  }
  return inferActivityStepKind(step.category, step.label, readToolName(step));
}
