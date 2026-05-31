#!/usr/bin/env python3
"""
nexo-topic-radar 热点监控与选题匹配工具。

用法:
  python trend_monitor.py --match <trends_dir> <user_md>   # 热点与用户定位匹配
  python trend_monitor.py --diff <old_json> <new_json>     # 竞品变更检测
"""

import json
import sys
import os
import re
import argparse
from pathlib import Path
from datetime import datetime, timedelta


def calculate_heat_score(item: dict) -> int:
    """计算话题热度评分（0-100）"""
    likes = item.get("likes", 0)
    comments = item.get("comments", 0)
    shares = item.get("shares", 0)
    search_volume = item.get("search_volume", 0)

    # 加权计算
    engagement = likes * 1 + comments * 3 + shares * 5
    # 归一化到 0-100
    score = min(100, int((engagement / 1000) * 30 + (search_volume / 10000) * 70))
    return max(1, score)


def calculate_match_score(topic: str, user_keywords: list, user_niche: str) -> int:
    """计算话题与用户定位的匹配度（0-100）"""
    score = 0

    # 关键词命中
    topic_lower = topic.lower()
    hits = sum(1 for kw in user_keywords if kw.lower() in topic_lower)
    score += min(60, hits * 20)

    # 领域匹配
    if user_niche.lower() in topic_lower:
        score += 30

    # 基础分（有一定普适性的话题）
    score += 10

    return min(100, score)


def match_topics(trends_dir: str, user_md_path: str) -> dict:
    """将采集到的热点与用户定位做匹配"""
    # 读取用户信息
    user_keywords = []
    user_niche = ""
    if os.path.exists(user_md_path):
        with open(user_md_path, "r", encoding="utf-8") as f:
            user_content = f.read()
            # 简易解析 USER.md
            niche_match = re.search(r"内容领域[：:]\s*(.+)", user_content)
            if niche_match:
                user_niche = niche_match.group(1).strip()
                user_keywords = [w.strip() for w in user_niche.split("、")]

    # 读取趋势数据
    trends = []
    trends_path = Path(trends_dir)
    if trends_path.exists():
        for f in trends_path.glob("*.json"):
            with open(f, "r", encoding="utf-8") as fh:
                data = json.load(fh)
                if isinstance(data, list):
                    trends.extend(data)
                elif isinstance(data, dict) and "items" in data:
                    trends.extend(data["items"])

    # 计算评分
    scored_topics = []
    for item in trends:
        topic = item.get("topic", item.get("title", ""))
        if not topic:
            continue
        heat = calculate_heat_score(item)
        match = calculate_match_score(topic, user_keywords, user_niche)

        # 综合分
        overall = round(match * 0.4 + heat * 0.3 + 20)  # 20 = 时效基础分
        scored_topics.append({
            "topic": topic,
            "heat_score": heat,
            "match_score": match,
            "overall_score": overall,
            "platform": item.get("platform", "unknown"),
            "tags": item.get("tags", []),
            "source_url": item.get("url", ""),
        })

    # 排序取 Top 5
    scored_topics.sort(key=lambda x: -x["overall_score"])
    top_topics = scored_topics[:5]

    return {
        "generated_at": datetime.now().isoformat(),
        "user_niche": user_niche,
        "total_trends_analyzed": len(trends),
        "topics": top_topics,
    }


def diff_competitors(old_path: str, new_path: str) -> dict:
    """比较两次竞品巡检结果，输出变更"""
    old_data = {}
    new_data = {}

    if os.path.exists(old_path):
        with open(old_path, "r", encoding="utf-8") as f:
            old_data = json.load(f)

    with open(new_path, "r", encoding="utf-8") as f:
        new_data = json.load(f)

    changes = []
    old_titles = set()
    for comp in old_data.get("competitors", []):
        for content in comp.get("new_contents", []):
            old_titles.add(content.get("title", ""))

    for comp in new_data.get("competitors", []):
        for content in comp.get("new_contents", []):
            title = content.get("title", "")
            if title and title not in old_titles:
                changes.append({
                    "account_name": comp.get("account_name"),
                    "platform": comp.get("platform"),
                    "content": content,
                })

    return {
        "checked_at": datetime.now().isoformat(),
        "has_changes": len(changes) > 0,
        "new_contents": changes,
    }


def main():
    parser = argparse.ArgumentParser(description="nexo-topic-radar 热点工具")
    parser.add_argument("--match", nargs=2, metavar=("TRENDS_DIR", "USER_MD"),
                        help="热点匹配")
    parser.add_argument("--diff", nargs=2, metavar=("OLD_JSON", "NEW_JSON"),
                        help="竞品变更检测")
    args = parser.parse_args()

    if args.match:
        result = match_topics(args.match[0], args.match[1])
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.diff:
        result = diff_competitors(args.diff[0], args.diff[1])
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
