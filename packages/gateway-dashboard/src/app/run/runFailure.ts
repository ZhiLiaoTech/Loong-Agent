export type RunFailurePhase = "error" | "cancelled";

export interface RunFailureInfo {
  phase: RunFailurePhase;
  message?: string;
}

export function buildErrorDetail(failure: RunFailureInfo): {
  outcome: RunFailurePhase;
  errorDetail: string;
} {
  const outcome = failure.phase;
  const label = outcome === "cancelled" ? "运行已取消" : "运行失败";
  const detail = failure.message?.trim()
    || (outcome === "cancelled" ? "本次运行已被取消。" : "本次运行异常结束，请查看 Run inspector 或重试。");
  return { outcome, errorDetail: `${label}: ${detail}` };
}
