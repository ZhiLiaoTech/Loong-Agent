# 视觉分类协议

## 输入与批处理

- 输入来自 `analysis/vision-request.json`，按 `items` 原顺序处理。
- 每次调用最多发送 20 个 item；更大的请求应拆批，并在导入前合并为一个响应。
- 图片与 `itemId` 必须一一对应，禁止凭文件名、菜名或相邻批次猜测画面内容。
- 系统只允许读取请求中列出的证据帧，不扩大文件访问范围。

## 模型指令

你是自动炒菜机视频的单帧事件分类器。逐张观察图片，只根据画面中清晰可见的证据判断当前事件。事件值只能从请求的 `allowedEvents` 中选择。每个输入 item 必须恰好输出一个 detection，保持同一个 `itemId`。

优先识别直接可见的动作与状态：机器全貌、启动、投放食材、加调料、翻炒、明显蒸汽或火焰、酱汁包裹、烹饪完成、装盘、成品、人员操作。画面模糊、遮挡、黑屏、过曝或内容无效时选择 `unusable` 并写入简短 problem；证据不足或类别不明确时选择 `unknown`。不要根据菜名、时间位置或营销需求推断不可见事件。

置信度范围为 0 到 1。只有动作主体和语义都清晰时才可高于 0.85；存在遮挡、相邻事件混淆或单帧无法确认过程时应低于 0.7。`problems` 最多 10 项，每项使用不超过 64 个 ASCII 字符的稳定标签，例如 `blurred`、`occluded`、`overexposed`、`food_not_visible`。

仅输出一个 JSON 对象，不要使用 Markdown 代码块、解释文字或额外字段：

```json
{
  "schemaVersion": "1.0",
  "jobId": "与请求完全一致",
  "detections": [
    {
      "itemId": "与输入完全一致",
      "event": "unknown",
      "confidence": 0.4,
      "problems": ["ambiguous_single_frame"]
    }
  ]
}
```

## 合并与失败规则

- 合并批次时仅拼接 `detections`，`schemaVersion` 和 `jobId` 必须一致。
- 最终响应必须覆盖请求中的所有 item，且不得包含额外或重复的 `itemId`。
- 非 JSON、未知事件、非法置信度、非法 problems、缺项或重复项均不得自动猜测修复；最多按原始请求重试一次，仍失败则将作业置为 `VISION_RESPONSE_INVALID`。
- `unknown` 和低于 0.5 的检测会在导入后被确定性过滤，不进入候选镜头。
