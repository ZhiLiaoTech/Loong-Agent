---
name: cooking-promo-editor
description: 将候选镜头装配进固定宣传模板，生成卖点文案、字幕和结构化 EDL。
---

# 宣传片编辑

读取客户 brief、模板和候选镜头。文本模型只生成短字幕、标题和 CTA；程序负责选择片段、满足槽位和时长约束。输出 `edit/edit-decision.json`、`edit/captions.srt` 和 `edit/render-props.json`。禁止无证据的效率、收益、营养、卫生或绝对化承诺。已被人工修改的 EDL 不得自动覆盖。

文本模型输出必须符合 `generated-copy.schema.json`，标题不超过 30 字、字幕不超过 24 字、CTA 不超过 20 字。每条字幕必须绑定当前作业实际存在的事件；含有节能、效率、营养、卫生、安全、收益、成本、稳定、标准化、自动或智能等主张时，必须来自已确认卖点或可直接观察的事件证据。模型失败时使用固定模板文案，不影响离线成片。
