const WORKFLOW_DELIMITER = "\n\n<!-- loong:workflow -->\n";

export function mergeRoleAndWorkflow(role: string, workflow: string): string {
  const roleText = role.trim();
  const workflowText = workflow.trim();
  if (!workflowText) {
    return roleText;
  }
  if (!roleText) {
    return workflowText;
  }
  return `${roleText}${WORKFLOW_DELIMITER}${workflowText}`;
}

export function splitRoleAndWorkflow(systemPrompt: string | undefined): {
  role: string;
  workflow: string;
} {
  const raw = systemPrompt ?? "";
  const index = raw.indexOf(WORKFLOW_DELIMITER);
  if (index === -1) {
    return { role: raw, workflow: "" };
  }
  return {
    role: raw.slice(0, index),
    workflow: raw.slice(index + WORKFLOW_DELIMITER.length),
  };
}
