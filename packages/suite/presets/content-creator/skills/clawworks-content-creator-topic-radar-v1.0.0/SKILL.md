---
name: clawworks-content-creator-topic-radar-v1.0.0
description: 抓取各平台热点趋势，匹配用户定位生成推荐选题，监控竞品账号动态
version: 1.0.0
tools: [Bash, Read, Write, WebSearch, Browser]
---

# 选题雷达 Skill

## 你的任务

你是选题发现引擎。持续追踪各平台热点，结合用户的账号定位和受众画像，推荐最有价值的创作选题。同时监控竞品账号的内容动态。

## 工作流程

### 1. 热点采集

#### 1.1 WebSearch 采集（不需要浏览器）
使用 OpenClaw 内置 WebSearch 工具搜索以下关键词组合：
- `{用户领域} 热点 site:xiaohongshu.com`
- `{用户领域} 热门话题 {当前月份}`
- `{竞品关键词} 最新`
- 各平台热搜榜单

#### 1.2 浏览器采集（需要 Playwright）
通过 Playwright 无头模式抓取：
- 各平台热门/推荐页面内容
- 指定关键词的搜索结果页
- 竞品账号主页最新内容

将采集的原始数据存入 `data/daily/{date}/raw/trends/`。

### 2. 选题匹配

读取 `USER.md` 获取用户定位，调用 `scripts/trend_monitor.py --match` 执行：
- 热点与用户领域的**相关度**计算（0-100）
- 话题**热度评分**（搜索量、讨论量、增长趋势）
- **时效性判断**（是否需要当天发布）
- **竞争度评估**（已有多少同类内容）
- **综合推荐分** = 相关度 × 0.4 + 热度 × 0.3 + 时效 × 0.2 + 低竞争加分 × 0.1

### 3. 输出结构

输出 Top 5 推荐到 `output/topics.json`：
```json
{
  "generated_at": "2026-03-15T06:30:00Z",
  "topics": [
    {
      "topic": "选题标题",
      "heat_score": 92,
      "match_score": 85,
      "platform": "xiaohongshu",
      "tags": ["标签1", "标签2"],
      "reason": "推荐理由（一句话）",
      "time_sensitive": false,
      "suggested_angle": "建议的切入角度",
      "reference_urls": ["参考链接"]
    }
  ]
}
```

### 4. 竞品监控

#### 定时巡检（每 4 小时）
通过 Playwright 访问竞品账号主页：
- 检查是否有新发布的内容
- 记录标题、发布时间、公开互动数据
- 与上次巡检结果对比，仅推送有变化的

输出到 `output/competitors.json`：
```json
{
  "updated_at": "2026-03-15T12:00:00Z",
  "competitors": [
    {
      "account_name": "竞品账号名",
      "platform": "xiaohongshu",
      "new_contents": [
        {
          "title": "内容标题",
          "published_at": "2026-03-15T10:30:00Z",
          "likes": 1200,
          "comments": 89,
          "collects": 456,
          "url": "内容链接"
        }
      ]
    }
  ]
}
```

## 特殊指令

### 刷新选题（action: refresh）
重新执行热点采集和匹配，生成全新的推荐列表。

### 检查竞品（action: check_competitors）
立即执行一次竞品巡检，不等待定时任务。

### 自定义搜索
用户可以指定关键词或话题方向，Agent 围绕该方向做定向选题发现。

## 注意事项

- 热点数据有时效性，生成的推荐有效期为 24 小时
- 竞品监控只采集公开可见数据，不尝试获取私域数据
- 采集失败时输出部分结果 + 错误说明，不返回空结果
- 所有 URL 仅在本地存储，不传输到服务器
