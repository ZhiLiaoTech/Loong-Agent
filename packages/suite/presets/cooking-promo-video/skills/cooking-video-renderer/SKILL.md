---
name: cooking-video-renderer
description: 根据经过校验的 EDL 使用 FFmpeg 和 Remotion 确定性渲染宣传视频。
---

# 视频渲染

渲染前校验所有源文件、时间边界、画幅、时长、字幕和品牌资产。FFmpeg 只负责受控裁剪、转码和混音；Remotion 负责时间线与品牌包装。相同 EDL、素材摘要、模板版本和渲染器版本必须可复现。渲染失败时保留日志和中间状态，不输出伪成功文件。
