---
name: cooking-media-ingest
description: 校验自动炒菜机多机位视频，生成媒体清单、代理视频和分析缩略图。
---

# 素材接入

## 输入

- 明确的 `jobId`。
- 作业目录中的 `job.json` 和 `input/` 视频。

## 执行

1. 调用受控的 `loong-cooking-video ingest --job <jobId>`。
2. 检查每路视频的编码、时长、分辨率、帧率、音轨和旋转信息。
3. 生成代理素材与 `analysis/media-manifest.json`。
4. 汇报缺失、损坏或时长异常的视频，不自行替换输入。

## 输出

只接受通过 schema 校验的 `media-manifest.json`。至少两路素材有效才能进入同步阶段。

## 禁止

- 不直接将原视频发送给模型。
- 不执行用户提供的 Shell 片段或 FFmpeg filter。
- 不访问当前作业和批准品牌资产目录之外的路径。
