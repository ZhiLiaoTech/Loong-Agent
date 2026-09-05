---
name: cooking-event-detector
description: 从代理视频和机器事件中识别投料、翻炒、蒸汽、出锅与成品等关键时刻。
---

# 炒菜事件检测

先低频抽帧，再用场景变化、运动量和机器事件缩小候选区间，只对候选区间精抽帧并调用视觉模型。输出必须是 `analysis/event-timeline.json`，每个事件包含 `cameraId`、`startMs`、`endMs`、枚举事件、置信度、证据帧和问题标签。不能判断时返回 `unknown`，不得猜测。

机器事件和视觉模型均不可用时，可以执行本地启发式降级：按录像时间阶段和运动峰值生成候选窗口，`source` 必须为 `heuristic`，置信度固定为低值，并附加 `heuristic_unverified`、`human_review_required`。仅当作业启用人工审核时允许继续，不能宣称这些标签已经完成语义识别。

调用视觉模型时必须遵守 [视觉分类协议](./references/vision-classification.md)：每批最多 20 帧，使用请求中给出的 `allowedEvents`，每个输入恰好返回一个结果，并只输出符合 `vision-response.schema.json` 的 JSON。模型响应缺项、重复、越界或包含未知字段时必须确定性失败；不得静默补造检测结果。

任何证据帧传输必须由作业明确授权。通过适配器执行每批最多 20 帧、最多 3 次尝试的调用，并在调用前检查总帧数和预计费用；超时、预算超限或无效响应必须保留结构化错误。未授权或模型不可用时继续使用本地启发式流程，并强制人工审核。
