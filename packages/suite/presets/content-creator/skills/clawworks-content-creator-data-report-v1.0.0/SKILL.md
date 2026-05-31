---
name: clawworks-content-creator-data-report-v1.0.0
description: 通过浏览器自动化采集平台创作者后台数据，生成数据报告（日报/周报/趋势分析）
version: 1.0.0
tools: [Bash, Read, Write, Browser]
---

# 数据报告 Skill

## 你的任务

你是数据采集与分析引擎。通过浏览器自动化登录用户的创作者后台，采集粉丝、互动、阅读等数据，生成结构化报告。

## 工作流程

### 1. 数据采集（action: collect）

#### 1.1 私域数据采集（Browser Relay）
通过用户已登录的 Chrome 浏览器访问创作者后台：

**小红书创作者中心** (creator.xiaohongshu.com)：
- 概览页：粉丝总数、新增粉丝、笔记总数
- 数据中心：各笔记的阅读/点赞/收藏/评论数
- 粉丝画像：性别分布、年龄段、地域

**抖音创作者中心** (creator.douyin.com)：
- 主页数据：粉丝数、获赞数、作品数
- 作品分析：播放量、完播率、互动率
- 粉丝画像：活跃时段、兴趣标签

**B站创作者中心** (member.bilibili.com)：
- 数据总览：粉丝数、播放量、硬币数
- 稿件数据：各视频/专栏的播放/弹幕/评论
- 粉丝分析

**公众号后台** (mp.weixin.qq.com)：
- 数据统计：阅读量、分享量、新增关注
- 单篇数据：各文章详细阅读/转发/在看数

#### 1.2 采集策略
- 优先使用 **Accessibility Tree** 定位元素（不依赖 CSS selector）
- 由 LLM Agent 实时解析页面结构，适应 DOM 变更
- 每次采集前自动截图，失败时保存截图用于诊断
- 数据存入 `data/daily/{date}/raw/` 目录

#### 1.3 采集失败处理
- Chrome 未启动 → 跳过私域数据采集，在报告中标注「未更新」
- 平台未登录 → 推送提醒用户登录，本次使用上次成功采集的数据
- 页面结构变更 → 截图保存，记录错误日志，等待 Skill 热更新

### 2. 数据处理

调用 `scripts/data_collector.py --process` 将原始数据结构化：

```json
// output/summary.json — 仪表盘数据卡片数据源
{
  "date": "2026-03-15",
  "followers": 12580,
  "new_followers": 47,
  "followers_change": "+47",
  "followers_trend": "up",
  "total_reads": 8920,
  "total_interactions": 1234,
  "avg_reads": 2230,
  "published_count": 2,
  "top_content": {
    "title": "最佳内容标题",
    "reads": 5200,
    "platform": "xiaohongshu"
  }
}
```

```json
// output/trend.json — 粉丝增长趋势图数据源
{
  "period": "30d",
  "data": [
    {"date": "2026-02-14", "followers": 12100, "reads": 7800, "interactions": 980},
    {"date": "2026-02-15", "followers": 12130, "reads": 8200, "interactions": 1050}
  ]
}
```

### 3. 报告生成

根据数据生成自然语言分析（由 LLM 完成）：
- **日报**：今日数据速览 + 异常标注 + 一句话总结
- **周报**：趋势分析 + 爆款内容归因 + 下周建议
- **月报**：长期趋势 + 同比环比 + 策略调整建议

## 特殊指令

### 立即采集（action: collect_now）
不等待定时任务，立即执行一次完整数据采集。

### 查看数据（action: show_summary）
输出最新的 summary.json 数据，格式化为可读的报告。

### 导出数据（action: export）
将历史数据导出为 CSV 格式，存入 `data/exports/`。

## 数据安全

- 所有采集数据仅存储在用户本地（`data/` 目录），不传输到任何服务器
- 不存储或缓存平台登录凭证
- 审计日志记录每次数据采集的时间、范围、结果
