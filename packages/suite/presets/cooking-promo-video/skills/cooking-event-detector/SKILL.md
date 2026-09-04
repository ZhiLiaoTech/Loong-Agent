---
name: cooking-event-detector
description: 从代理视频和机器事件中识别投料、翻炒、蒸汽、出锅与成品等关键时刻。
---

# 炒菜事件检测

先低频抽帧，再用场景变化、运动量和机器事件缩小候选区间，只对候选区间精抽帧并调用视觉模型。输出必须是 `analysis/event-timeline.json`，每个事件包含 `cameraId`、`startMs`、`endMs`、枚举事件、置信度、证据帧和问题标签。不能判断时返回 `unknown`，不得猜测。

调用视觉模型时必须遵守 [视觉分类协议](./references/vision-classification.md)：每批最多 20 帧，使用请求中给出的 `allowedEvents`，每个输入恰好返回一个结果，并只输出符合 `vision-response.schema.json` 的 JSON。模型响应缺项、重复、越界或包含未知字段时必须确定性失败；不得静默补造检测结果。
