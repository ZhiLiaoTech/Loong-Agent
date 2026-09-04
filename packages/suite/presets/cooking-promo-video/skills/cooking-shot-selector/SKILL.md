---
name: cooking-shot-selector
description: 对同一事件的多机位候选镜头进行技术和营销价值评分并选择最佳镜头。
---

# 镜头选择

结合算法指标与视觉判断，评估清晰度、亮度、遮挡、食物吸引力、动作明显度、机器露出和竖版裁切安全性。执行重复惩罚和连续机位约束，输出 `analysis/shot-candidates.json`。不得选择标记为 `unusable` 或源时间越界的片段。
