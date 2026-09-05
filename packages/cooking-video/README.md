# @loong/cooking-video

自动炒菜机多机位宣传视频的确定性媒体处理包。它提供安全作业目录、输入摘要、素材接入、多机位同步、机器事件或视觉证据导入、镜头评分、模板化 EDL、FFmpeg 渲染与质量门禁。

## 环境要求

- Node.js 20 或更高版本
- FFmpeg 与 ffprobe，且均在 `PATH` 中

Windows 可使用 Scoop：

```powershell
scoop install ffmpeg
```

## 指定目录消费

普通网络摄像头可以先通过摄像头自带录像程序、NVR 或 RTSP 录制工具把文件写入 inbox；用户拍摄好的视频也使用同一目录结构。每次炒菜对应一个批次目录，目录名会成为 `jobId`：

```text
data/inbox/
└── cook-20260904-001/
    ├── top.mp4
    ├── front.mp4
    └── _READY
```

文件名（不含扩展名）默认作为 `cameraId`。支持 MP4、MOV、MKV、AVI 和 M4V，每批必须包含 2–4 路视频。录像完成后创建空的 `_READY` 文件可立即消费；没有标记时，所有输入必须保持默认 60 秒未修改：

```powershell
loong cooking-video scan-inbox --inbox data/inbox --jobs-root data/jobs
loong cooking-video consume-inbox --inbox data/inbox --jobs-root data/jobs
```

也可以周期执行一条命令完成“扫描、消费、分析、生成 EDL”：

```powershell
loong cooking-video process-inbox `
  --inbox data/inbox `
  --jobs-root data/jobs `
  --allow-aligned-start `
  --draft
```

未传 `--approved` 时，启发式作业会停在 `awaiting_review`；人工确认 EDL 后再用带 `--approved` 的 `run` 或 `process-inbox` 继续渲染。

消费过程把视频复制到隔离的作业目录，不删除 inbox 原文件；`state/intake-receipt.json` 保证重复扫描不会重复创建作业。需要自定义机位角色、菜名或输出格式时，可在批次目录放置符合 `intake.schema.json` 的 `intake.json`。

如果批次没有机器事件日志，`detect`/`run` 会使用本地场景变化和运动量生成低置信度候选，所有事件写入 `heuristic_unverified` 与 `human_review_required` 标签，并强制要求人审。该模式用于在客户协议和云视觉授权缺失时继续打通流程，不代表已经准确识别投料、翻炒或成品语义。

若摄像头文件既没有统一时间码也没有可用音轨，可在确认各路录像大致同时启动后显式增加 `--allow-aligned-start`。系统会以零偏移继续处理，并把同步方式记录为低置信度 `aligned_start`；默认情况下不会自动采用该降级。

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

## Studio 审核工作台

启动 Gateway 与 Studio 后，打开侧栏“视频审核”，作业目录填写与消费命令一致的 `data/jobs`。页面会列出已生成 EDL 的作业，并提供同步结果、事件列表和成片预览。

时间线支持切换机位、修改入点/出点、删除片段和编辑字幕。保存时服务端重新检查素材边界、时间线连续性、总时长与宣传证据，并使用修订号阻止旧页面覆盖新修改。驳回和要求返修必须填写意见；只有批准当前修订后才能触发再次渲染。

重渲染会进入 Gateway 进程内队列，默认并发数为 1。相同作业重复提交会复用现有排队项，等待中或运行中的任务均可取消；阶段变化通过 SSE/WebSocket 推送到 Studio。并发数可在启动 Gateway 时配置：

```powershell
loong gateway --cooking-video-concurrency 2
```

允许范围为 1-8，也可设置 `LOONG_COOKING_VIDEO_CONCURRENCY`。生产队列持久化、Worker 接管、自动重试和死信处理属于后续生产化任务。

## 模型调用指标

视觉与文案模型适配器可通过 `onMetric` 接收逐次调用指标。将 `new CookingVideoMetricsStore(jobsRoot).record` 作为回调后，指标会追加写入作业的 `state/model-metrics.jsonl`。Studio 通过 `cooking.video.metrics.get` 显示调用量、估算费用、平均耗时、失败/超时和流水线耗时。视觉输入输出以关键帧/检测数计量，文案以字符数计量；费用使用适配器配置的估算单价，不等同于供应商最终账单。

人工在 Studio 保存 EDL 或提交审核后，系统会自动向 `state/human-feedback.jsonl` 写入结构化计数，不记录字幕或审核意见正文。`cooking.video.feedback.summary` 可按 `jobId` 查询单作业，也可省略 `jobId` 聚合 jobsRoot，用于计算换机位率、编辑类型、审核结果、返修原因和质检失败分布。

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
