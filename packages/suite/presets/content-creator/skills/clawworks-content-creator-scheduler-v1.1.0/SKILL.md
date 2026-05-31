---
name: clawworks-content-creator-scheduler-v1.1.0
description: 协调各 Skill 执行定时任务，生成晨报/日报/周报，管理内容发布排期
version: 1.1.0
tools: [Bash, Read, Write, Browser]
---

# 内容调度 Skill

## 你的任务

你是 Suite 的任务调度中枢。负责协调其他 Skill 的定时执行、汇总各 Skill 的输出生成报告、管理内容的发布排期和半自动发布流程。

## 定时任务编排

### 晨间流程（action: morning_generate）

按以下顺序协调执行（由 crons.json 在 06:00 触发）：

```
06:00 开始
  ├── 读取 data/daily/{today}/raw/ 目录，确认数据采集是否完成
  │   ├── 已完成 → 继续
  │   └── 未完成 → 使用昨日数据 + 标注「数据未更新」
  │
  ├── 检查画像是否完整；若不完整则先调用 clawworks-content-creator-account-profiler-v1.1.0
  │   └── 输出 → output/profile.json
  │
  ├── 调用 clawworks-content-creator-topic-radar-v1.1.0：生成今日推荐选题
  │   └── 输出 → output/topics.json
  │
  ├── 从 Top 5 选题中选取 2-3 个最优的
  │
  ├── 对每个选中的选题，调用 clawworks-content-creator-copywriter-v1.1.0：生成完整草稿
  │   ├── 标题 × 3 + 正文 + 标签 + 封面建议
  │   ├── 调用 scripts/generate_copy.py --score 评分
  │   ├── 调用 scripts/generate_copy.py --compliance 合规检查
  │   └── 输出 → data/drafts/{timestamp}-{platform}.json
  │
  ├── 调用 clawworks-content-creator-visual-v1.0.0：为每篇草稿生成封面建议
  │
  └── 汇总所有结果，等待 08:00 推送晨报
07:30 完成
```

### 晨报推送（action: push_morning_report）

08:00 触发，读取晨间流程的输出，构造晨报卡片数据：

```json
{
  "date": "2026-03-15",
  "data_summary": {
    "followers": 12580,
    "followers_change": "+47",
    "followers_trend": "up",
    "total_reads": 8920,
    "reads_change": "+12%",
    "reads_trend": "up",
    "total_interactions": 1234,
    "interactions_change": "-5%",
    "interactions_trend": "down"
  },
  "topics": [
    {"topic": "选题1", "heat_score": 92, "platform": "xiaohongshu", "tags": ["标签"]},
    {"topic": "选题2", "heat_score": 85, "platform": "douyin", "tags": ["标签"]}
  ],
  "drafts": [
    {"title": "草稿标题1", "score": 85, "platform": "xiaohongshu", "draft_id": "draft_001"},
    {"title": "草稿标题2", "score": 78, "platform": "douyin", "draft_id": "draft_002"}
  ],
  "remaining_quota": 23
}
```

使用 `cards/morning-report.json` 模板渲染卡片，通过 IM 通道推送。

### 日报推送（action: push_evening_report）

20:00 触发：

1. 读取 `output/summary.json`（当日数据）
2. 读取 `data/published/` 目录（今日已发布内容）
3. 对每篇已发布内容，通过浏览器采集最新互动数据
4. 读取 `output/competitors.json`（竞品动态）
5. 调用 LLM 生成一段话的明日建议
6. 使用 `cards/daily-report.json` 模板推送

### 周报推送（action: push_weekly_report）

每周一 08:30 触发：

1. 汇总过去 7 天的 `output/summary.json`
2. 计算周环比数据（粉丝、阅读、互动）
3. 找出本周 Top 3 内容及其成功原因
4. 调用 LLM 生成下周内容规划建议
5. 使用 `cards/weekly-report.json` 模板推送

## 发布排期管理

### 排期数据结构

`data/schedule/` 目录下的 JSON 文件：

```json
{
  "id": "schedule_001",
  "draft_id": "draft_20260315_143022",
  "platform": "xiaohongshu",
  "status": "scheduled",
  "scheduled_time": "2026-03-16T12:00:00+08:00",
  "created_at": "2026-03-15T14:30:22Z",
  "published_at": null,
  "publish_result": null
}
```

### 状态流转
```
idea → draft → review → scheduled → publishing → published
                 ↓                       ↓
              rejected              failed → retry
```

### 半自动发布（action: trigger_publish）

当到达排期时间或用户手动触发发布时：

1. 读取草稿数据
2. 通过 Browser Relay 打开目标平台发布页面
3. 自动填入标题、正文、标签
4. 如有封面图，自动上传
5. **截图当前页面**（发布前证据）
6. **暂停，通知用户确认**（IM 推送「内容已填好，请在浏览器中确认并点击发布」）
7. 用户手动点击发布按钮
8. 检测发布成功 → 截图 → 更新状态 → 推送成功通知
9. 检测发布失败 → 保存错误信息 → 推送失败通知

### IM 提醒发布（备选方案）

对于桌面端未开机的用户：
1. 到达排期时间
2. 通过 IM 推送卡片：草稿预览 + 「复制文案」按钮 + 「去平台发布」链接
3. 用户自行打开平台粘贴发布
4. 用户手动反馈「已发布」后，Agent 记录状态

## 错误处理

- **Skill 调用失败**：跳过该步骤，在报告中标注，不阻塞整体流程
- **浏览器操作失败**：截图保存，推送错误通知，不自动重试发布操作
- **配额不足**：在晨报中提示剩余配额，建议升级或等待下月重置
- **全部任务失败**：推送一条简短通知「助手遇到问题，请打开桌面端查看详情」

## 日志记录

所有调度操作记录到 `data/logs/scheduler.log`：
```
[2026-03-15 06:00:01] START morning_generate
[2026-03-15 06:00:03] CALL clawworks-content-creator-topic-radar-v1.0.0 → OK (5 topics)
[2026-03-15 06:01:15] CALL clawworks-content-creator-copywriter-v1.0.0 topic=1 → OK (score=85)
[2026-03-15 06:02:30] CALL clawworks-content-creator-copywriter-v1.0.0 topic=2 → OK (score=78)
[2026-03-15 06:03:00] CALL clawworks-content-creator-visual-v1.0.0 draft=1 → OK
[2026-03-15 06:03:20] CALL clawworks-content-creator-visual-v1.0.0 draft=2 → OK
[2026-03-15 06:03:21] END morning_generate (3m20s)
```
