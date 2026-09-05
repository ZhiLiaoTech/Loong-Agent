# 自动炒菜机多机位宣传视频 Suite 实施方案

> 文档状态：实施基线
> 目标版本：MVP `0.1.0` / 试点 `0.2.0` / 生产 `1.0.0`
> 适用仓库：Loong
> 配套任务清单：[COOKING_PROMO_VIDEO_SUITE_TASKS.md](./COOKING_PROMO_VIDEO_SUITE_TASKS.md)

## 1. 项目背景

客户在自动炒菜机上方及周围部署多个固定摄像头。每次炒菜会产生多路、时长基本一致的视频，希望系统自动完成素材抽取、关键事件识别、最佳机位选择、宣传文案生成、剪辑合成和质量检查，最终输出适合抖音、视频号、B 站等渠道的宣传视频。

本项目将该能力封装为 Loong Suite。Suite 负责岗位定义、Skill 组织、权限声明、工作流编排和结果归档；FFmpeg、视觉模型与 Remotion 负责具体的视频理解及渲染。

## 2. 建设目标

### 2.1 业务目标

- 输入一次炒菜任务的 3～4 路视频，自动输出 15 秒或 30 秒宣传片。
- 自动呈现开机、投料、翻炒、蒸汽、调味、出锅、成品等关键环节。
- 同一事件能从多个机位中选择清晰、无遮挡、构图更好的镜头。
- 支持固定品牌模板、产品卖点、字幕、片尾和背景音乐。
- 同一份剪辑决策可生成 9:16 和 16:9 两种画幅。
- 保留可审核、可解释、可重渲染的剪辑决策表，而非只保留成片。

### 2.2 工程目标

- 原始视频不直接进入大模型上下文，使用代理视频和分层抽帧控制成本。
- 分析产物全部结构化、可校验、可恢复，失败后可从最近阶段继续。
- 渲染过程确定性执行；相同素材、配置和 EDL 应产生内容一致的成片。
- 每个作业隔离目录，禁止 Skill 访问作业目录之外的客户素材。
- 可观察每个阶段的状态、耗时、模型用量和失败原因。

### 2.3 MVP 不包含

- 非固定机位或手持镜头的高级稳定与重建。
- 无人审核直接发布到外部内容平台。
- 端到端训练专用视频理解模型。
- 复杂三维特效、数字人主持、实时直播导播。
- 一次作业包含多道菜的自动拆分。

## 3. 当前 Loong 能力与差距

### 3.1 可直接复用

- `@loong/suite` 已支持解析和安装 `suite.json`、复制 Skill、注册 agent profile、导入权限及生成 pipeline plan。
- Suite manifest 已支持 `required_models`、`default_model_routing`、`pipeline.stages`、`permissions.filesystem` 和 `permissions.shell`。
- `@loong/delegation` 已支持任务依赖、并发执行、超时、失败跳过和取消信号。
- Gateway 已能识别视觉模型能力，运行时支持图片附件作为多模态输入。
- 仓库已有 `remotion-best-practices` Skill，可复用其视频、字幕、转场、音频及 FFmpeg 规范。

### 3.2 必须新增或补齐

- Loong 附件目前没有可直接交给模型的视频类型；需要本地视频作业执行器先使用 FFmpeg/ffprobe 处理视频并输出图片帧和结构化元数据。
- 当前 Suite pipeline 会把 `pipeline.stages` 转换为严格串行计划；多摄像头分析并发需要在单个 Skill/执行器内部实现，或扩展 Suite pipeline schema 支持 `depends_on`。
- 需要受控的 FFmpeg/ffprobe/Remotion 命令执行接口，不能依赖模型自由拼接任意 Shell 命令。
- 需要视频作业状态、阶段缓存、结构化产物校验和断点恢复机制。
- 需要上传/导入大体积文件的产品入口；不建议把视频作为普通聊天附件传入。

## 4. 总体架构

```text
摄像头/对象存储/本地导入
          │
          ▼
   作业接入与素材清单
          │
          ▼
 FFprobe 校验 ──► 代理视频、缩略图、波形
          │
          ▼
 多机位同步 ──► sync-map.json
          │
          ▼
 粗粒度抽帧与场景检测
          │
          ▼
 设备事件融合 + 视觉事件识别
          │
          ▼
 候选镜头评分、去重、连续性约束
          │
          ▼
 故事模板 + 卖点文案 ──► edit-decision.json
          │
          ▼
 FFmpeg 裁剪 + Remotion 品牌包装
          │
          ▼
 技术质检 + 视觉质检 + 人工审核
          │
          ▼
     多画幅宣传成片
```

建议分为四层：

1. **Suite 编排层**：定义数字员工、Skill、流程、权限和输出契约。
2. **媒体执行层**：封装 ffprobe、FFmpeg、代理生成、抽帧、裁剪和音频处理。
3. **智能分析层**：事件识别、镜头评分、营销脚本与 EDL 生成。
4. **模板渲染层**：Remotion 组件、品牌素材、字幕、音乐和多画幅输出。

## 5. Suite 包结构

建议新增目录：

```text
packages/suite/presets/cooking-promo-video/
├── suite.json
├── README.md
├── AGENTS.md
├── SOUL.md
├── IDENTITY.md
├── MEMORY.md
├── HEARTBEAT.md
├── soul/
│   └── USER.md.template
├── schemas/
│   ├── job.schema.json
│   ├── media-manifest.schema.json
│   ├── sync-map.schema.json
│   ├── event-timeline.schema.json
│   ├── shot-candidates.schema.json
│   ├── edit-decision.schema.json
│   └── quality-report.schema.json
├── templates/
│   ├── story-15s.json
│   ├── story-30s.json
│   └── story-60s.json
├── skills/
│   ├── cooking-media-ingest/SKILL.md
│   ├── cooking-multicam-sync/SKILL.md
│   ├── cooking-event-detector/SKILL.md
│   ├── cooking-shot-selector/SKILL.md
│   ├── cooking-promo-editor/SKILL.md
│   ├── cooking-video-renderer/SKILL.md
│   └── cooking-video-reviewer/SKILL.md
└── assets/
    └── README.md
```

渲染代码建议放在独立包中，而不是塞入 Skill 文本目录：

```text
packages/cooking-video/
├── src/
│   ├── cli.ts
│   ├── job-runner.ts
│   ├── media/
│   ├── analysis/
│   ├── editing/
│   ├── render/
│   └── quality/
├── remotion/
│   ├── Root.tsx
│   ├── compositions/
│   └── components/
└── tests/
```

## 6. Suite Manifest 设计

MVP 使用当前仓库兼容的串行 pipeline。摄像头级别的并行处理由 `packages/cooking-video` 内部完成。

```json
{
  "id": "cooking-promo-video",
  "name": "自动炒菜机宣传视频助手",
  "version": "0.1.0",
  "icon": "video",
  "color": "#E75B2A",
  "description": "从自动炒菜机多机位录像中识别关键片段并生成宣传视频",
  "author": "ClawWorks",
  "skills": [
    "cooking-media-ingest",
    "cooking-multicam-sync",
    "cooking-event-detector",
    "cooking-shot-selector",
    "cooking-promo-editor",
    "cooking-video-renderer",
    "cooking-video-reviewer"
  ],
  "required_models": ["vision", "text"],
  "default_model_routing": {
    "video_analysis": "vision",
    "copywriting": "text"
  },
  "pipeline": {
    "description": "多机位炒菜录像自动剪辑与宣传视频生成",
    "stages": [
      { "stage": "ingest", "skill": "cooking-media-ingest", "description": "创建素材清单并生成代理素材" },
      { "stage": "sync", "skill": "cooking-multicam-sync", "description": "同步多机位时间轴" },
      { "stage": "detect", "skill": "cooking-event-detector", "description": "识别炒菜事件与精彩时刻" },
      { "stage": "select", "skill": "cooking-shot-selector", "description": "选择每个事件的最佳机位" },
      { "stage": "edit", "skill": "cooking-promo-editor", "description": "生成文案和结构化剪辑决策表" },
      { "stage": "render", "skill": "cooking-video-renderer", "description": "渲染目标画幅宣传视频" },
      { "stage": "review", "skill": "cooking-video-reviewer", "description": "执行技术与内容质量检查" }
    ]
  },
  "permissions": {
    "filesystem": ["./data/jobs/", "./assets/brand/", "./output/"],
    "shell": true,
    "mcp_servers": []
  },
  "onboarding": {
    "enabled": true,
    "template": "soul/USER.md.template",
    "first_task_after_onboarding": true
  }
}
```

生产环境不应因为 manifest 声明了 `shell: true` 就开放任意命令。实际 tool policy 应只允许调用受控的 `cooking-video` CLI，并由 CLI 内部以参数数组启动 FFmpeg，禁止字符串拼接和任意输出路径。

## 7. 作业目录与生命周期

### 7.0 指定目录入口

普通网络摄像头不与 Suite 直接耦合。摄像头自带录像软件、NVR、RTSP 录制程序和用户上传均先将一次炒菜的 2～4 路视频写入 `data/inbox/{batchId}/`。文件名默认作为机位 ID，也可以通过 `intake.json` 显式映射。

批次包含 `_READY` 标记时可立即消费；没有标记时，所有视频及可选机器事件文件必须保持默认 60 秒未修改。`scan-inbox` 只读检查批次，`consume-inbox` 将文件复制进 `data/jobs/{jobId}/input/`，不删除原素材。作业侧的 claim 防止接管同名手工作业，receipt 保证重复扫描幂等。

机器事件和云端视觉均不可用时，离线模式使用场景变化、运动峰值和时间阶段生成低置信度候选。结果必须标记为 `heuristic` 且强制人工审核；它仅用于打通工程流程，不能作为真实语义识别准确率的验收依据。

摄像头文件没有统一时间码和音轨时，默认仍阻断同步。只有操作方确认各路录像近似同时启动并显式传入 `--allow-aligned-start`，才允许按零偏移降级，`sync-map.json` 记录 `method=aligned_start` 和低置信度，供人工复核。

### 7.1 目录结构

```text
data/jobs/{jobId}/
├── job.json
├── input/
│   ├── camera-top.mp4
│   ├── camera-front.mp4
│   ├── camera-left.mp4
│   ├── camera-right.mp4
│   ├── recipe.json
│   └── machine-events.jsonl
├── proxy/
├── frames/
├── analysis/
│   ├── media-manifest.json
│   ├── sync-map.json
│   ├── scene-cuts.json
│   ├── event-timeline.json
│   └── shot-candidates.json
├── edit/
│   ├── brief.json
│   ├── edit-decision.json
│   ├── captions.srt
│   └── render-props.json
├── output/
│   ├── promo-vertical-15s.mp4
│   ├── promo-vertical-30s.mp4
│   ├── promo-landscape-30s.mp4
│   ├── cover.jpg
│   └── quality-report.json
└── state/
    ├── job-state.json
    └── events.jsonl
```

### 7.2 状态机

```text
created → ingesting → synced → analyzing → selecting → editing
        → awaiting_review（可选）→ rendering → validating → completed
                                                       └→ failed
```

任何阶段都应记录：`status`、`startedAt`、`completedAt`、`attempt`、`inputDigest`、`outputFiles`、`errorCode` 和 `errorMessage`。当输入摘要未变化且输出通过 schema 校验时允许跳过已完成阶段。

## 8. 输入与输出契约

### 8.1 作业输入 `job.json`

```json
{
  "schemaVersion": "1.0",
  "jobId": "cook-20260904-001",
  "dish": {
    "name": "宫保鸡丁",
    "ingredients": ["鸡丁", "花生", "辣椒"]
  },
  "machine": {
    "model": "CookBot X1",
    "serialNumber": "CBX1-001"
  },
  "sources": [
    { "cameraId": "top", "path": "input/camera-top.mp4", "role": "food_closeup" },
    { "cameraId": "front", "path": "input/camera-front.mp4", "role": "machine_full" },
    { "cameraId": "left", "path": "input/camera-left.mp4", "role": "action_side" }
  ],
  "brief": {
    "audience": "连锁餐饮经营者",
    "objective": "突出标准化和高效率",
    "sellingPoints": ["自动投料", "精准控温", "稳定出品"],
    "formats": [
      { "aspectRatio": "9:16", "durationSec": 30 },
      { "aspectRatio": "16:9", "durationSec": 30 }
    ],
    "language": "zh-CN",
    "requireHumanApproval": true
  },
  "brand": {
    "logo": "../../assets/brand/logo.png",
    "primaryColor": "#E75B2A",
    "endCardText": "让每一道菜都稳定出品"
  }
}
```

所有输入路径必须在当前作业目录或批准的品牌资产目录内。`jobId` 应为服务端生成的不可猜测 ID，外部传入值需要净化。

### 8.2 剪辑决策表 `edit-decision.json`

```json
{
  "schemaVersion": "1.0",
  "jobId": "cook-20260904-001",
  "templateId": "promo-process-30s-v1",
  "fps": 30,
  "aspectRatio": "9:16",
  "durationTargetMs": 30000,
  "segments": [
    {
      "id": "seg-001",
      "cameraId": "front",
      "sourceStartMs": 1000,
      "sourceEndMs": 4000,
      "timelineStartMs": 0,
      "event": "machine_intro",
      "caption": "一键启动，自动烹饪",
      "transition": "cut",
      "crop": { "mode": "cover", "focusX": 0.5, "focusY": 0.5 }
    }
  ],
  "audio": {
    "music": "assets/music/clean-tech-01.mp3",
    "musicGainDb": -14,
    "retainSourceAudio": true,
    "sourceGainDb": -8
  },
  "endCard": {
    "durationMs": 2000,
    "headline": "标准化烹饪，从此更简单"
  }
}
```

渲染前必须校验：片段边界合法、镜头不重叠、总时长误差在阈值内、引用文件存在、字幕长度合理、所有枚举值受支持。

## 9. 各阶段详细设计

### 9.1 素材接入 `ingest`

职责：

- 用 ffprobe 读取容器、编码、分辨率、帧率、时长、音轨、旋转信息和 creation time。
- 计算文件摘要；检测空文件、损坏文件、时长严重不一致和不支持的编码。
- 生成 720p 或更低分辨率代理视频、联系表缩略图和可选音频 WAV。
- 输出 `media-manifest.json`。

验收规则：

- 至少两路有效视频；MVP 上限四路。
- 主体时长差小于配置阈值，默认 10 秒；否则给出告警而不是直接失败。
- 代理文件可被 ffprobe 再次读取，且时间基准与原素材可映射。

### 9.2 多机位同步 `sync`

同步策略按优先级执行：

1. 统一硬件时间码或摄像头 PTS。
2. 炒菜机任务开始时间与机器事件日志。
3. 音频互相关，识别锅体碰撞、提示音等共同峰值。
4. 视觉共同事件，如灯光变化、锅体启动或第一次投料。
5. 人工配置偏移。

输出 `sync-map.json`：

```json
{
  "referenceCameraId": "front",
  "method": "audio_cross_correlation",
  "confidence": 0.91,
  "cameras": {
    "front": { "offsetMs": 0 },
    "top": { "offsetMs": 320 },
    "left": { "offsetMs": -180 }
  }
}
```

置信度低于 `0.70` 时进入人工确认；不得静默使用低置信度结果。

### 9.3 事件检测 `detect`

采用分层分析，避免全量高频抽帧：

1. 每 1～2 秒抽取一帧，建立全程视觉概览。
2. 使用 FFmpeg 场景变化、运动量、亮度和音频峰值生成候选区间。
3. 融合机器事件日志，把事件时间前后各扩展 2～5 秒。
4. 对候选区间以每秒 4～8 帧精抽。
5. 将有限数量的拼图或独立帧交给视觉模型分类。
6. 合并连续事件并输出置信度和证据帧。

事件词表第一版固定为：

- `machine_intro`
- `cooking_started`
- `ingredient_added`
- `seasoning_added`
- `stir_fry`
- `steam_or_flame`
- `sauce_coating`
- `dish_completed`
- `plating`
- `finished_dish`
- `operator_interaction`
- `unusable`

不得只存模型自然语言。每个判断必须带 `cameraId`、起止时间、置信度、证据帧和问题标签。

### 9.4 镜头选择 `select`

对同一同步时间段的不同机位进行评分：

```text
总分 =
  清晰度       × 0.20 +
  食物吸引力   × 0.25 +
  动作明显度   × 0.20 +
  产品露出度   × 0.20 +
  构图质量     × 0.15 -
  遮挡惩罚 - 过曝惩罚 - 重复惩罚
```

算法性指标（清晰度、亮度、黑屏、抖动）优先使用 OpenCV/FFmpeg 计算；主观指标（食物吸引力、卖点表达）由视觉模型评分。镜头选择还需满足：

- 默认单镜头 1.5～5 秒。
- 避免连续三个片段使用同一机位。
- 同一动作不重复表达，除非使用明确的正反打模板。
- 切点避开动作中间的突兀状态。
- 竖版输出必须评估主体是否能在安全区内裁切。

### 9.5 故事与 EDL `edit`

MVP 提供约束明确的模板，不允许模型任意创造时间轴：

| 模板 | 推荐结构 |
|---|---|
| 15 秒亮点版 | 成品钩子 → 一键启动 → 投料 → 翻炒 → 出锅 → Logo/CTA |
| 30 秒流程版 | 业务痛点 → 设备全景 → 自动流程 → 核心卖点 → 成品 → CTA |
| 60 秒客户版 | 场景痛点 → 操作流程 → 标准化能力 → 效率证据 → 成品 → 商业价值 |

文本模型只负责：从客户 brief 中选择卖点、生成短字幕、旁白和镜头意图。程序负责把候选片段装配到模板槽位、裁剪到目标时长并校验时间线。

默认字幕规范：

- 单条不超过两行。
- 9:16 每行建议不超过 14 个中文字符。
- 重要卖点不超过 12 个中文字符。
- 字幕不得遮挡锅体、食物主体和品牌 Logo。
- 禁止生成无数据依据的效率、节能或收益承诺。

### 9.6 渲染 `render`

FFmpeg 负责：

- 精确裁剪与转码。
- 音轨抽取、降噪、响度标准化、混音。
- 必要的缩放、代理和中间文件生成。

Remotion 负责：

- 时间线组合和可复用品牌模板。
- 标题、字幕、卖点卡片、角标、Logo、进度动画和片尾。
- 9:16、16:9、1:1 等多画幅布局。
- 根据 `render-props.json` 确定时长和内容。

建议输出编码：H.264 High Profile、AAC、`yuv420p`、30 fps；码率和分辨率按平台预设，不在 Skill 提示词中硬编码。

### 9.7 质量检查 `review`

自动技术质检：

- 输出文件可解码，音视频时长一致。
- 无黑屏、冻结、绿帧、严重过曝和空音轨。
- 音频峰值不过载，综合响度满足配置。
- 字幕没有超出安全区或与 Logo 重叠。
- EDL 中所有片段都在原视频有效范围内。
- 成片时长在目标值允许误差内。

内容质检：

- 关键卖点至少出现一次。
- 有清晰的食物成品镜头和设备露出。
- 字幕与画面事件基本一致。
- 不包含人员隐私、无关画面或明显卫生风险画面。
- 未出现未经证实的绝对化宣传语。

`quality-report.json` 应输出每条规则的 `pass/warn/fail`、证据时间点和返修建议。任何硬失败都不得把作业标记为 `completed`。

## 10. 模型调用策略

### 10.1 模型分工

- 视觉模型：事件分类、主体定位、遮挡判断、食物吸引力和镜头语义评分。
- 文本模型：宣传结构、标题、字幕、旁白和 CTA。
- 确定性程序：同步、时间映射、特征计算、模板装配、约束校验和渲染。

### 10.2 成本控制

- 优先分析低分辨率代理和拼图，不上传原始视频。
- 先用设备日志和传统算法缩小候选区间，再调用视觉模型。
- 使用文件摘要缓存分析结果。
- 同一帧只分析一次，跨模板复用事件和镜头评分。
- 为每个作业设置最大帧数、模型请求数、Token 和费用预算。
- 模型失败时降级为设备事件 + 算法评分，而不是无限重试。

### 10.3 Prompt 输出约束

- 所有模型输出使用 JSON Schema 校验。
- 温度使用低值；分类与评分阶段不要求创意表达。
- 每次输入附带摄像头角色、相对时间和允许的事件枚举。
- 无法判断时必须返回 `unknown`，不能猜测。
- 对涉及效率、营养、卫生、节能等陈述要求证据字段。

## 11. CLI 与服务接口

建议先实现本地 CLI，再由 Gateway/RPC 包装：

```text
loong cooking-video create --job-file <path>
loong cooking-video ingest --job <jobId>
loong cooking-video sync --job <jobId>
loong cooking-video analyze --job <jobId>
loong cooking-video edit --job <jobId> --template promo-process-30s-v1
loong cooking-video render --job <jobId> --format vertical-30s
loong cooking-video review --job <jobId>
loong cooking-video run --job <jobId> --until awaiting_review
loong cooking-video resume --job <jobId>
loong cooking-video status --job <jobId> --json
```

建议的服务 API：

```text
POST   /api/cooking-video/jobs
POST   /api/cooking-video/jobs/{id}/sources
POST   /api/cooking-video/jobs/{id}/run
POST   /api/cooking-video/jobs/{id}/approve
POST   /api/cooking-video/jobs/{id}/render
GET    /api/cooking-video/jobs/{id}
GET    /api/cooking-video/jobs/{id}/events
GET    /api/cooking-video/jobs/{id}/artifacts
PATCH  /api/cooking-video/jobs/{id}/edit-decision
DELETE /api/cooking-video/jobs/{id}
```

大文件上传建议使用对象存储直传或分片上传；Gateway 只接收对象键和已完成凭证，不中转整个视频文件。

## 12. 人工审核界面

MVP 至少需要以下能力：

- 同步预览多机位并调整偏移量。
- 展示检测到的事件、证据帧和置信度。
- 时间线上预览自动 EDL。
- 对某个片段执行“换机位”“前后微调”“删除”“替换”。
- 修改字幕、卖点顺序、背景音乐和片尾 CTA。
- 审批后渲染，以及基于同一 EDL 重新生成不同画幅。
- 查看质检问题并跳转到具体时间点。

第一阶段可用 JSON/命令行完成端到端验证，第二阶段再开发可视化时间线。

当前实现已在 Studio 增加“视频审核”工作台：通过受 Gateway 鉴权保护的 RPC 读取本地作业，确认同步结果、浏览事件、按需加载成片，并修改机位、入点、出点、字幕或删除片段。EDL 保存采用乐观修订号并重新执行边界、连续性、时长和宣传证据校验；审核记录持久化到 `edit/review-state.json`，驳回/返修要求填写原因，批准当前修订后才允许再次渲染。

`CVS-807` 已将渲染改为 Gateway 进程内全局队列。默认并发数为 1，可通过 `--cooking-video-concurrency` 或 `LOONG_COOKING_VIDEO_CONCURRENCY` 设置为 1-8；队列对同一作业去重，并使用 AbortController 取消运行任务。作业状态机的每次 transition 会发布 `cooking_video` 事件，经现有 SSE/WebSocket 通道送达 Studio。进入 `awaiting_review` 表示本次分析执行正常暂停等待人工批准，不代表成片已经完成。队列持久化、重启恢复、Worker 接管和死信处理仍归入 `CVS-906`。

## 13. 安全、隐私与合规

- 每个租户、客户和作业必须隔离目录或对象存储前缀。
- 所有文件路径执行规范化并验证仍位于批准根目录内，防止路径穿越。
- FFmpeg 使用参数数组启动，不执行用户提供的 filter/script 字符串。
- 上传时校验扩展名、MIME、文件头、大小、时长和解码能力。
- 临时帧、代理视频和原始素材设置可配置保留期并记录删除审计。
- 调用外部模型前必须明确客户对视频/图片外传的授权；不允许时应支持本地视觉模型。
- 检测人脸、员工胸牌、订单信息等隐私元素，可配置打码或排除镜头。
- 音乐、字体、Logo 和图片必须保存授权来源与许可范围。
- 宣传文案禁用“绝对安全”“百分百节省”等无证据表述。

## 14. 可观察性与错误处理

建议指标：

- 作业成功率、阶段成功率和端到端耗时。
- 每分钟素材的处理耗时。
- 代理生成、抽帧、模型分析和渲染耗时。
- 每个作业的视觉模型调用数、Token 和估算费用。
- 同步置信度、事件召回率、人工换镜率、一次审核通过率。
- FFmpeg/Remotion 失败类型和重试次数。

错误码至少包含：

- `MEDIA_UNREADABLE`
- `MEDIA_DURATION_MISMATCH`
- `SYNC_LOW_CONFIDENCE`
- `NO_USABLE_SHOTS`
- `MODEL_OUTPUT_INVALID`
- `EDIT_CONSTRAINT_VIOLATION`
- `RENDER_FAILED`
- `QUALITY_GATE_FAILED`
- `JOB_CANCELLED`
- `BUDGET_EXCEEDED`

模型网络错误可指数退避重试 2～3 次；输入损坏、schema 不合法和低同步置信度不应盲目重试。

## 15. 测试方案

### 15.1 单元测试

- ffprobe 输出解析和异常容器处理。
- 时间码、offset 和源时间/成片时间映射。
- JSON Schema 校验、路径安全和状态机转移。
- 镜头评分公式、去重、模板槽位装配和时长约束。
- 横竖版裁切安全区和字幕行数计算。

### 15.2 集成测试

- 用 2～4 路短视频执行 ingest → sync → detect → select → edit。
- 模拟视觉模型成功、超时、无效 JSON 和部分失败。
- 根据固定 EDL 渲染视频并验证 ffprobe 元数据。
- 中断后从每个阶段恢复，确保不会重复付费分析。
- 验证两个租户作业不能互相读取素材。

### 15.3 黄金样本测试

准备至少 20 次真实炒菜素材，覆盖：

- 不同菜品、颜色、蒸汽和油烟程度。
- 白天/夜间、逆光、局部过曝和镜头轻微污渍。
- 某个摄像头缺失、音轨缺失、时长不一致。
- 操作员遮挡、错误投料、暂停和中途开盖。

由剪辑人员标注关键事件、可用片段和最佳机位，持续衡量：

- 关键事件召回率。
- 最佳机位 Top-1/Top-2 命中率。
- 自动片段可用率。
- 人工换镜率。
- 一次审核通过率。

### 15.4 验收门槛

MVP 建议门槛：

- 20 组黄金样本端到端成功率不低于 90%。
- 投料、翻炒、出锅、成品四类关键事件召回率不低于 85%。
- 自动选择镜头可用率不低于 80%。
- 30 秒成片在目标硬件上的平均生成时间不超过素材总时长的 1.5 倍。
- 无黑屏、越界裁剪、损坏输出等严重技术问题。
- 经过一次人工轻量调整后，试点成片通过率不低于 90%。

数值应在获得样本和确认硬件配置后重新校准。

## 16. 部署建议

### 16.1 试点部署

- 单机或单节点 Worker。
- 本地磁盘保存短期素材，配置独立作业根目录。
- 安装固定版本 FFmpeg、Node.js、Chromium 和 Remotion。
- GPU 可选；外部视觉模型负责语义分析。
- 并发 1～2 个作业，先验证流程稳定性。

### 16.2 生产部署

- API、作业队列、媒体 Worker、模型 Worker、渲染 Worker 分离。
- 原视频与输出使用对象存储，中间文件使用 Worker 临时盘。
- 根据 CPU/GPU/内存和队列长度水平扩展。
- 每个阶段幂等，Worker 崩溃后能被其他 Worker 接管。
- 渲染镜像固定 FFmpeg、字体、浏览器和 npm 依赖版本。

### 16.3 容量估算方法

实际容量应以真实素材压测，不直接承诺固定数字。至少采集：

- 单路视频平均时长、码率和分辨率。
- 每次作业摄像头数量。
- 每日作业量和峰值并发。
- 代理与中间帧膨胀比例。
- 原始素材、代理、输出各自保留期限。

## 17. 分阶段交付计划

### Phase 0：需求冻结与样本准备（约 3～5 人日）

- 确认摄像头数量、编码、命名、时间同步能力和素材传输方式。
- 收集不少于 20 组真实多机位样本及机器事件日志。
- 确认目标平台、时长、品牌模板、宣传禁用词和验收指标。
- 由客户或剪辑人员标注首批黄金样本。

### Phase 1：离线 MVP（约 15～22 人日）

- 创建 Suite 骨架与 7 个 Skill。
- 实现作业目录、schema、状态机和 CLI。
- 实现素材校验、代理、抽帧、基础同步和事件检测。
- 实现候选镜头评分、固定 15/30 秒模板和 EDL。
- 实现单一 9:16 Remotion 模板、渲染和技术质检。
- 在黄金样本集上建立基线指标。

### Phase 2：客户试点（约 12～18 人日）

- 接入机器事件日志和多策略同步。
- 增加 16:9 输出、品牌主题和音乐策略。
- 增加审核页面或最小时间线编辑器。
- 增加任务队列、断点恢复、预算限制和作业观测。
- 用客户真实日常素材迭代镜头规则和 Prompt。

### Phase 3：生产化（约 15～25 人日）

- 对象存储直传、租户隔离、保留策略和审计。
- Worker 拆分、容器化、并发控制和横向扩展。
- 自动回归、故障注入、负载测试与安全测试。
- 完整运营指标、告警、人工复核闭环和版本管理。

以上为工程工作量级，不等同于日历时间；是否开发完整可视化剪辑器、是否使用本地模型会显著影响排期。

## 18. 主要风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 摄像头没有统一时间基准 | 切换机位时动作不连续 | 设备事件优先；音频互相关；低置信度人工校正 |
| 油烟、蒸汽、污渍遮挡 | 事件漏检、画面不可用 | 多机位冗余；清洁告警；算法与模型联合评分 |
| 原视频体积过大 | 上传慢、分析贵 | 对象存储直传、代理、候选区间精抽帧 |
| 模型输出不稳定 | EDL 无法渲染 | JSON Schema、枚举约束、确定性装配、有限重试 |
| 宣传审美主观 | 自动成片返工多 | 模板化、品牌配置、审核节点、记录人工修改用于迭代 |
| 自动生成虚假卖点 | 合规风险 | 卖点白名单、证据字段、禁用词、人工审批 |
| 任意 Shell/路径访问 | 系统安全风险 | 受控 CLI、参数数组、路径根校验、最小权限 |
| Remotion 环境漂移 | 同一 EDL 输出不一致 | 固定镜像、字体、浏览器和依赖版本 |

## 19. 产品决策点

正式开发前需要客户确认：

1. 摄像头是否有统一时间码，是否保存音轨。
2. 炒菜机能否输出带毫秒时间戳的运行事件日志。
3. 视频由本地目录、NAS 还是对象存储进入系统。
4. 是否允许关键帧发送给云端视觉模型。
5. 首批目标平台、画幅、时长和日均作业量。
6. 是否强制人工审批，以及谁拥有最终发布权限。
7. Logo、字体、音乐和宣传语的授权材料。
8. 原始视频、代理帧和成片的保留期限。

## 20. Definition of Done

项目达到 MVP 完成状态需同时满足：

- Suite 能被现有 `@loong/suite` 安装并正确注册所有 Skill、权限及 pipeline plan。
- 一条命令能够对标准样本完成从导入到 9:16 成片和质量报告的全过程。
- 所有阶段有版本化 schema、状态记录、错误码和结构化日志。
- 失败后能从最近成功阶段恢复，且不会重复执行已缓存的模型分析。
- EDL 可人工修改并单独重渲染，无需重新分析视频。
- 自动测试、黄金样本评估和安全检查达到第 15.4 节门槛。
- 部署、配置、故障处理、数据保留和客户操作说明齐全。
