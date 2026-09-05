# 自动炒菜机宣传视频助手

将一次炒菜任务的固定多机位录像处理为可审核、可重渲染的宣传视频。

MVP 流程为：素材接入 → 多机位同步 → 事件识别 → 镜头选择 → EDL 编辑 → 渲染 → 质检。

媒体处理通过受控的 `@loong/cooking-video` CLI 执行。原始视频不直接进入模型上下文；视觉分析使用从代理素材中抽取的有限证据帧。

黄金样本使用 `schemas/golden-annotation.schema.json`，并通过 `loong cooking-video validate-gold --annotation-file <path>` 执行结构和跨字段一致性校验。人工规范见仓库文档 `docs/COOKING_PROMO_VIDEO_GOLDEN_ANNOTATION.md`。
