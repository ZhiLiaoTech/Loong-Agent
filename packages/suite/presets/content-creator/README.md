# 自媒体创作助手 Suite（content-creator）

> ClawWorks 的岗位级内容生产数字员工套件，覆盖账号画像识别、选题、创作、数据分析、排期发布与自学习记忆沉淀。

## 版本亮点（v1.2.0）

- 新增 **账号画像识别**：用户未填写偏好时，先读取账号近期作品，自动识别内容方向、目标人群与风格偏好
- 新增 **自学习记忆**：每小时总结最近沟通内容，把长期稳定偏好写入 soul，把短期约束写入 memory
- 升级 **选题雷达**：选题前先检查画像，不再盲推热点
- 升级 **文案创作**：写稿前优先读取手填偏好，其次使用自动画像
- 升级 **调度中枢**：晨间流程先补画像，再做选题与草稿生成

## 功能概览

| Skill | 作用 |
|-------|------|
| clawworks-content-creator-account-profiler-v1.1.0 | 识别账号画像，补齐内容定位与受众画像 |
| clawworks-content-creator-topic-radar-v1.1.0 | 热点选题、竞品监控、按画像匹配选题 |
| clawworks-content-creator-copywriter-v1.1.0 | 文案创作、标题优化、内容评分 |
| clawworks-content-creator-data-report-v1.0.0 | 平台数据采集、报告生成 |
| clawworks-content-creator-visual-v1.0.0 | 封面图建议、配色方案 |
| clawworks-content-creator-scheduler-v1.1.0 | 定时任务编排、排期管理、报告推送 |
| clawworks-content-creator-learning-memory-v1.2.0 | 自学习总结、Soul/Memory 沉淀 |

## 新的日常工作循环

```text
05:30  数据采集
05:45  检查并刷新账号画像（周一/周四）
06:00  画像检查 → 选题分析 → 草稿生成
08:00  推送晨报
      ↕ 用户随时可手动创作 / 编辑 / 发布
每小时  总结最近沟通内容，沉淀长期偏好与短期记忆
20:00  推送日报
周一    推送周报
```

## 记忆沉淀原则

- **Soul / MEMORY.md**：写长期稳定、可复用、影响策略的偏好与规则
- **data/memory/recent_learnings.jsonl**：写短中期、会过期的约束、反馈、热点判断
- 不沉淀账号密码、完整原始聊天转录、敏感隐私

## 部署位置

```text
~/.openclaw/suites/content-creator/
```
