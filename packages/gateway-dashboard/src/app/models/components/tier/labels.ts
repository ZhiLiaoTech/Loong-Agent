import type { TierName } from "../../types.js";

export const TIER_LABELS: Record<TierName, string> = {
  fast: "快速",
  standard: "标准",
  deep: "深度",
};

export const TIER_HINTS: Record<TierName, string> = {
  fast: "短提示、低开销，默认关闭工具与记忆。",
  standard: "默认档位，平衡上下文与推理。",
  deep: "长提示、附件与多步任务，更高推理强度。",
};

export const TIER_ORDER: readonly TierName[] = ["fast", "standard", "deep"];
