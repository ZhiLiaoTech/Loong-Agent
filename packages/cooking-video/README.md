# @loong/cooking-video

自动炒菜机多机位宣传视频的确定性媒体处理包。它提供安全作业目录、输入摘要、素材接入、多机位同步、机器事件或视觉证据导入、镜头评分、模板化 EDL、FFmpeg 渲染与质量门禁。

## 环境要求

- Node.js 20 或更高版本
- FFmpeg 与 ffprobe，且均在 `PATH` 中

Windows 可使用 Scoop：

```powershell
scoop install ffmpeg
```

## 快速开始

```powershell
corepack pnpm --filter @loong/cooking-video build

node packages/cli/dist/index.js cooking-video create `
  --job-file packages/cooking-video/tests/fixtures/job.json `
  --jobs-root data/jobs

# 将视频和 machine-events.jsonl 放入 data/jobs/<jobId>/input 后：
node packages/cli/dist/index.js cooking-video run `
  --job <jobId> `
  --jobs-root data/jobs `
  --reference front `
  --offset front=0 `
  --offset top=320 `
  --template 15s `
  --approved
```

需要人工审核的作业若没有 `--approved`，会停在 `awaiting_review`。输入未变化时重复 `run` 不会再次处理；失败后使用相同参数执行 `resume`。

## 无机器事件日志

```powershell
loong cooking-video prepare-vision --job <jobId> --jobs-root data/jobs
```

该命令生成 `analysis/vision-request.json` 和有限数量的 `frames/vision/*.jpg`。视觉模型必须根据 `allowedEvents` 输出符合 `vision-response.schema.json` 的响应，然后执行：

```powershell
loong cooking-video import-vision `
  --job <jobId> `
  --jobs-root data/jobs `
  --response analysis/vision-response.json
```

原始视频不会直接进入模型上下文。

## 测试

```powershell
corepack pnpm --filter @loong/cooking-video test
corepack pnpm --filter @loong/cooking-video test:e2e
```

`test:e2e` 会调用真实 FFmpeg，在系统临时目录生成合成多机位素材并完成整条 15 秒 draft 管线。
