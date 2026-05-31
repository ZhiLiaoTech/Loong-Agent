---
name: clawworks-content-creator-account-profiler-v1.1.0
description: 当用户未填写内容偏好或画像过旧时，读取账号近期作品与互动线索，自动识别内容定位、目标人群与创作偏好
version: 1.1.0
tools: [Read, Write, Browser, WebSearch]
---

# 账号画像识别 Skill

## 你的任务

当用户未完整配置内容偏好，或者当前画像已经过期、置信度偏低时，先读取账号最近作品、标题、简介、评论、互动数据，自动推断：

- 内容方向 / 细分赛道
- 主要内容形式
- 目标人群
- 核心需求
- 风格偏好
- 高表现主题
- 高频关键词
- 建议发布时间

然后将结果沉淀到 `output/profile.json`，并按需回写到 `soul/USER.md`。

## 触发条件

满足任一条件时优先执行：

1. `soul/USER.md` 缺失或关键字段为空
2. 用户明确要求“识别我的内容定位/目标人群”
3. 最近画像更新时间超过 7 天
4. 账号最近新增作品 >= 5 条且画像尚未刷新
5. 选题 / 写稿前检测到当前偏好置信度低于 0.65

## 输入来源

- 平台创作者后台最近 20~50 条作品
- 作品标题、封面文案、正文/脚本摘要
- 互动数据（阅读、点赞、评论、收藏、分享）
- 评论区高频问题
- 用户已填写的基础信息（若存在）

## 输出规范

输出到 `output/profile.json`：

```json
{
  "generated_at": "2026-03-19T10:00:00+08:00",
  "profile_source": "auto_inferred",
  "confidence": 0.81,
  "sample_size": 36,
  "niche": "国学、诗词、AI讲国学",
  "target_audience": "25-55 岁宝妈、传统文化爱好者",
  "audience_needs": ["希望用更轻松的方式理解国学", "希望给孩子做启蒙", "希望获得可传播的文化表达素材"],
  "style_preference": ["专业严谨", "古风", "通俗讲解"],
  "content_types": ["短视频", "图文"],
  "top_keywords": ["诗词", "国学", "孩子启蒙", "AI讲解"],
  "best_topics": ["诗词故事化讲解", "经典原文现代解释"],
  "preferred_post_time": ["09:00", "12:00", "20:00"],
  "evidence": {
    "high_performing_posts": ["..."],
    "comment_signals": ["..."],
    "title_patterns": ["..."]
  }
}
```

## 注意事项

- 优先保留用户手动填写信息，不自动覆盖强主观字段
- 自动识别结果必须标注 `profile_source=auto_inferred`
- 仅在证据充分时写入 `soul/USER.md`，否则仅输出建议草案
