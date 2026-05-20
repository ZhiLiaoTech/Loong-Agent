const APPROVAL_PREFIX = /^\[approval:([^\]]+)\]\s*/;

export function isOrgApprovalReason(reason: string): boolean {
  return APPROVAL_PREFIX.test(reason.trim());
}

export function parseApprovalChainId(reason: string): string | undefined {
  const match = reason.trim().match(APPROVAL_PREFIX);
  return match?.[1]?.trim() || undefined;
}

export function stripApprovalPrefix(reason: string): string {
  return reason.trim().replace(APPROVAL_PREFIX, "").trim();
}
