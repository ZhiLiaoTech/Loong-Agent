import path from "node:path";

export function defaultOrgRoot(cwd: string = process.cwd()): string {
  const configured = process.env.DRAGON_ORG_ROOT?.trim();
  return path.resolve(configured || path.join(cwd, ".dragon", "org"));
}

export function defaultOrgConfigPath(root: string = defaultOrgRoot()): string {
  const configured = process.env.DRAGON_ORG_CONFIG?.trim();
  return path.resolve(configured || path.join(root, "org.json"));
}

export function defaultEmployeeConfigPath(root: string = defaultOrgRoot()): string {
  const configured = process.env.DRAGON_EMPLOYEE_CONFIG?.trim();
  return path.resolve(configured || path.join(root, "employees.json"));
}

export function defaultToolPolicyConfigPath(root: string = defaultOrgRoot()): string {
  const configured = process.env.DRAGON_TOOL_POLICY_CONFIG?.trim();
  return path.resolve(configured || path.join(root, "policies", "tool-policies.json"));
}

export function defaultApprovalConfigPath(root: string = defaultOrgRoot()): string {
  const configured = process.env.DRAGON_APPROVAL_CONFIG?.trim();
  return path.resolve(configured || path.join(root, "approvals.json"));
}

export function defaultTicketConfigPath(root: string = defaultOrgRoot()): string {
  const configured = process.env.DRAGON_TICKET_CONFIG?.trim();
  return path.resolve(configured || path.join(root, "tickets.json"));
}

export function defaultKpiTemplateConfigPath(root: string = defaultOrgRoot()): string {
  const configured = process.env.DRAGON_KPI_TEMPLATE_CONFIG?.trim();
  return path.resolve(configured || path.join(root, "kpi-templates.json"));
}
