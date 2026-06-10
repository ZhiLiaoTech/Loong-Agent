---
name: clawworks-content-creator-learning-memory-v1.2.0
description: 定时总结最近沟通内容与任务结果，沉淀为 soul 或 memory，形成用户偏好、方法论和长期协作记忆
version: 1.2.0
tools: [Read, Write]
---

# 自学习记忆 Skill

## 你的任务

你负责把最近 30-60 分钟内与用户的沟通内容、任务产出、编辑动作和反馈信号做结构化总结，并沉淀到以下两个层级：

### A. soul 层（长期、稳定、会影响后续策略）
适合写入 `soul/USER.md`、`soul/MEMORY.md` 的内容：
- 长期稳定的内容方向与赛道判断
- 明确受众画像和核心需求
- 风格偏好、禁忌表达、常用栏目
- 用户反复确认的发布策略
- 已被验证有效的选题模式、标题模式、内容结构

### B. working memory 层（短中期、可衰减）
适合写入 `data/memory/recent_learnings.jsonl` 的内容：
- 最近几次对话中的具体要求
- 某个系列选题的临时约束
- 某平台本周热点与可跟进角度
- 用户刚修改过的文案偏好
- 近期要避免的题材或审校意见

## 沉淀规则

1. 先去重：已有结论不重复写入
2. 再判断时效：短期信息写 working memory，长期信息写 soul
3. 必须附带证据来源：来自对话、草稿反馈、数据表现，还是账号画像推断
4. 不写入敏感账号凭证、私密原文或完整聊天转录
5. 每次总结输出 3 类结果：
   - `confirmed_insights` 已确认洞察
   - `hypotheses` 待验证假设
   - `actionable_rules` 可立即影响后续生成的规则

## 输出文件

### `output/learning_summary.json`
```json
{
  "generated_at": "2026-03-19T10:30:00+08:00",
  "window_minutes": 60,
  "confirmed_insights": ["用户长期偏好古风、专业严谨表达"],
  "hypotheses": ["受众对AI讲国学的通俗解释更感兴趣"],
  "actionable_rules": ["短视频开头优先使用一句经典原文+现代翻译"],
  "write_targets": {
    "soul": ["style_preference", "target_audience"],
    "working_memory": ["recent_topic_constraints"]
  }
}
```

### `data/memory/recent_learnings.jsonl`
逐条写入短期学习记录，每条包含：
- `type`
- `confidence`
- `source`
- `expires_at`
- `content`

## 定时触发建议

- 高频模式：每 30 分钟一次
- 稳健模式：每 60 分钟一次
- 空窗期无新增对话时直接跳过

## 适用场景

- 用户没有完整填写 onboarding，但持续通过对话暴露偏好
- 用户经常在改稿时口头说明“以后都按这个风格来”
- 某些高表现内容结构被连续验证有效，需要沉淀成固定规则
