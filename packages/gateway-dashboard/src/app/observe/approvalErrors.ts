export function isStaleApprovalError(message: string): boolean {
  return message.includes("no longer awaiting a live run");
}
