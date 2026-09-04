---
name: cooking-video-reviewer
description: 检查宣传成片的解码、画面、音频、字幕、卖点覆盖和合规风险。
---

# 视频质检

检查输出可解码性、音视频时长、黑屏、冻结、过曝、音量、字幕安全区、Logo 重叠、成品镜头、设备露出、卖点覆盖、隐私和无依据宣传语。输出 `output/quality-report.json`，每条规则必须包含 `pass`、`warn` 或 `fail`、证据时间点和返修建议。任何硬失败都阻止作业进入 `completed`。
