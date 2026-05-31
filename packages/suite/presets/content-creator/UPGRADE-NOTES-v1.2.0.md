# 自媒体创作助手 Suite 升级说明（v1.2.0）

## 本次新增能力

### 1. 账号画像自动识别
当用户未完整填写内容偏好时，Suite 会先基于最近作品与互动线索识别：
- 内容方向
- 目标人群
- 风格偏好
- 高频关键词
- 高表现主题
- 建议发布时间

### 2. 自学习记忆沉淀
新增定时任务：**每小时**总结最近 60 分钟沟通内容、草稿修改与任务结果。
- 长期稳定信息 → 写入 `soul/MEMORY.md` / `soul/USER.md`
- 短中期约束 → 写入 `data/memory/recent_learnings.jsonl`

## 新增 / 升级的 Skill

- 新增：`clawworks-content-creator-account-profiler-v1.1.0`
- 新增：`clawworks-content-creator-learning-memory-v1.2.0`
- 升级：`clawworks-content-creator-topic-radar-v1.1.0`
- 升级：`clawworks-content-creator-copywriter-v1.1.0`
- 升级：`clawworks-content-creator-scheduler-v1.1.0`

## 新增定时任务

- `profile-refresh`：每周一、周四 05:45
- `self-learning-memory-sync`：每小时整点

## 当前实现状态

已经写入：
- Suite 配置
- UI 入口
- Cron 编排
- 新 Skill 目录与 SKILL.md
- `profile_infer.py` 基础识别骨架
- `memory_sync.py` 记忆沉淀脚本骨架
- `soul/MEMORY.md` 与用户模板扩展字段

仍建议继续补强：
- 将最近对话 / 最近编辑动作的原始窗口摘要标准化输出给 `memory_sync.py`
- 让调度器在实际运行时自动合并 `learning_summary.json` 到 `soul/MEMORY.md`
- 为 `profile_infer.py` 接入真实平台抓取字段与评论分析
