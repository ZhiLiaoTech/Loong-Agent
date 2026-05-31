#!/usr/bin/env python3
"""
nexo-data-report 数据采集与处理工具。

用法:
  python data_collector.py --process <raw_dir>   # 将原始采集数据结构化
  python data_collector.py --summary <data_dir>  # 生成摘要数据
  python data_collector.py --trend <data_dir> [--days 30]  # 生成趋势数据
  python data_collector.py --export <data_dir> --format csv  # 导出数据
"""

import json
import sys
import os
import csv
import argparse
from pathlib import Path
from datetime import datetime, timedelta


def process_raw_data(raw_dir: str) -> dict:
    """将浏览器采集的原始数据结构化"""
    raw_path = Path(raw_dir)
    result = {
        "processed_at": datetime.now().isoformat(),
        "platforms": {},
    }

    for platform_file in raw_path.glob("*.json"):
        platform_name = platform_file.stem  # e.g., "xiaohongshu"
        with open(platform_file, "r", encoding="utf-8") as f:
            raw = json.load(f)

        # 标准化数据结构
        normalized = {
            "followers": raw.get("followers", raw.get("fans_count", 0)),
            "new_followers": raw.get("new_followers", raw.get("new_fans", 0)),
            "total_reads": raw.get("total_reads", raw.get("total_views", 0)),
            "total_likes": raw.get("total_likes", 0),
            "total_comments": raw.get("total_comments", 0),
            "total_collects": raw.get("total_collects", raw.get("total_favorites", 0)),
            "total_shares": raw.get("total_shares", raw.get("total_forwards", 0)),
            "contents": [],
        }

        # 标准化各内容数据
        for item in raw.get("contents", raw.get("notes", raw.get("articles", []))):
            normalized["contents"].append({
                "title": item.get("title", ""),
                "reads": item.get("reads", item.get("views", item.get("play_count", 0))),
                "likes": item.get("likes", 0),
                "comments": item.get("comments", 0),
                "collects": item.get("collects", item.get("favorites", 0)),
                "shares": item.get("shares", item.get("forwards", 0)),
                "published_at": item.get("published_at", ""),
                "url": item.get("url", ""),
            })

        # 计算互动总量
        normalized["total_interactions"] = (
            normalized["total_likes"]
            + normalized["total_comments"]
            + normalized["total_collects"]
            + normalized["total_shares"]
        )

        result["platforms"][platform_name] = normalized

    return result


def generate_summary(data_dir: str) -> dict:
    """生成当日摘要数据（ui.json metric-card 数据源）"""
    data_path = Path(data_dir)
    today = datetime.now().strftime("%Y-%m-%d")

    # 读取今日处理后的数据
    today_file = data_path / "daily" / today / "processed.json"
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    yesterday_file = data_path / "daily" / yesterday / "processed.json"

    today_data = {}
    yesterday_data = {}

    if today_file.exists():
        with open(today_file, "r", encoding="utf-8") as f:
            today_data = json.load(f)

    if yesterday_file.exists():
        with open(yesterday_file, "r", encoding="utf-8") as f:
            yesterday_data = json.load(f)

    # 汇总所有平台数据
    total_followers = 0
    total_new_followers = 0
    total_reads = 0
    total_interactions = 0
    all_contents = []

    for platform, data in today_data.get("platforms", {}).items():
        total_followers += data.get("followers", 0)
        total_new_followers += data.get("new_followers", 0)
        total_reads += data.get("total_reads", 0)
        total_interactions += data.get("total_interactions", 0)
        for content in data.get("contents", []):
            content["platform"] = platform
            all_contents.append(content)

    # 找出表现最好的内容
    top_content = None
    if all_contents:
        all_contents.sort(key=lambda x: x.get("reads", 0), reverse=True)
        top_content = all_contents[0]

    # 计算变化趋势
    yesterday_followers = 0
    for data in yesterday_data.get("platforms", {}).values():
        yesterday_followers += data.get("followers", 0)

    followers_change = total_followers - yesterday_followers
    followers_trend = "up" if followers_change > 0 else ("down" if followers_change < 0 else "flat")

    content_count = sum(
        len(data.get("contents", []))
        for data in today_data.get("platforms", {}).values()
    )

    summary = {
        "date": today,
        "followers": total_followers,
        "new_followers": total_new_followers,
        "followers_change": f"+{followers_change}" if followers_change >= 0 else str(followers_change),
        "followers_trend": followers_trend,
        "total_reads": total_reads,
        "total_interactions": total_interactions,
        "avg_reads": total_reads // max(content_count, 1),
        "published_count": content_count,
        "top_content": {
            "title": top_content["title"] if top_content else "",
            "reads": top_content.get("reads", 0) if top_content else 0,
            "platform": top_content.get("platform", "") if top_content else "",
        } if top_content else None,
        "generated_at": datetime.now().isoformat(),
    }

    return summary


def generate_trend(data_dir: str, days: int = 30) -> dict:
    """生成趋势数据（ui.json chart 数据源）"""
    data_path = Path(data_dir)
    trend_data = []

    for i in range(days, -1, -1):
        date = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
        daily_file = data_path / "daily" / date / "processed.json"

        if daily_file.exists():
            with open(daily_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            total_followers = sum(
                p.get("followers", 0) for p in data.get("platforms", {}).values()
            )
            total_reads = sum(
                p.get("total_reads", 0) for p in data.get("platforms", {}).values()
            )
            total_interactions = sum(
                p.get("total_interactions", 0) for p in data.get("platforms", {}).values()
            )

            trend_data.append({
                "date": date,
                "followers": total_followers,
                "reads": total_reads,
                "interactions": total_interactions,
            })

    return {
        "period": f"{days}d",
        "data_points": len(trend_data),
        "data": trend_data,
        "generated_at": datetime.now().isoformat(),
    }


def export_csv(data_dir: str, output_path: str):
    """导出历史数据为 CSV"""
    data_path = Path(data_dir)
    rows = []

    for daily_dir in sorted((data_path / "daily").glob("*")):
        processed_file = daily_dir / "processed.json"
        if processed_file.exists():
            with open(processed_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            date = daily_dir.name
            for platform, pdata in data.get("platforms", {}).items():
                rows.append({
                    "date": date,
                    "platform": platform,
                    "followers": pdata.get("followers", 0),
                    "new_followers": pdata.get("new_followers", 0),
                    "total_reads": pdata.get("total_reads", 0),
                    "total_interactions": pdata.get("total_interactions", 0),
                })

    if rows:
        with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        print(f"Exported {len(rows)} rows to {output_path}")
    else:
        print("No data to export")


def main():
    parser = argparse.ArgumentParser(description="nexo-data-report 数据工具")
    parser.add_argument("--process", metavar="RAW_DIR", help="处理原始数据")
    parser.add_argument("--summary", metavar="DATA_DIR", help="生成摘要")
    parser.add_argument("--trend", metavar="DATA_DIR", help="生成趋势")
    parser.add_argument("--days", type=int, default=30, help="趋势天数")
    parser.add_argument("--export", metavar="DATA_DIR", help="导出数据")
    parser.add_argument("--format", default="csv", help="导出格式")
    parser.add_argument("--output", default="data/exports/export.csv", help="导出路径")
    args = parser.parse_args()

    if args.process:
        result = process_raw_data(args.process)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.summary:
        result = generate_summary(args.summary)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.trend:
        result = generate_trend(args.trend, args.days)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.export:
        export_csv(args.export, args.output)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
