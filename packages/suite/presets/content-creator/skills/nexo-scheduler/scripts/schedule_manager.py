#!/usr/bin/env python3
"""
nexo-scheduler 排期管理工具。

用法:
  python schedule_manager.py --create <draft_id> --time <iso_time> --platform <platform>
  python schedule_manager.py --list [--status scheduled|published|all]
  python schedule_manager.py --update <schedule_id> --status <new_status>
  python schedule_manager.py --prepare-publish <schedule_id>  # 准备发布数据包
"""

import json
import sys
import os
import argparse
from pathlib import Path
from datetime import datetime
import uuid


SUITE_DIR = Path(__file__).resolve().parent.parent.parent
SCHEDULE_DIR = SUITE_DIR / "data" / "schedule"
DRAFTS_DIR = SUITE_DIR / "data" / "drafts"
PUBLISHED_DIR = SUITE_DIR / "data" / "published"


def ensure_dirs():
    """确保必要目录存在"""
    SCHEDULE_DIR.mkdir(parents=True, exist_ok=True)
    PUBLISHED_DIR.mkdir(parents=True, exist_ok=True)


def create_schedule(draft_id: str, scheduled_time: str, platform: str) -> dict:
    """创建排期"""
    ensure_dirs()

    schedule_id = f"schedule_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"

    # 验证草稿存在
    draft_files = list(DRAFTS_DIR.glob(f"*{draft_id}*"))
    if not draft_files:
        return {"error": f"Draft {draft_id} not found"}

    schedule = {
        "id": schedule_id,
        "draft_id": draft_id,
        "draft_file": str(draft_files[0].name),
        "platform": platform,
        "status": "scheduled",
        "scheduled_time": scheduled_time,
        "created_at": datetime.now().isoformat(),
        "published_at": None,
        "publish_result": None,
    }

    schedule_file = SCHEDULE_DIR / f"{schedule_id}.json"
    with open(schedule_file, "w", encoding="utf-8") as f:
        json.dump(schedule, f, ensure_ascii=False, indent=2)

    return schedule


def list_schedules(status_filter: str = "all") -> list:
    """列出排期"""
    ensure_dirs()
    schedules = []

    for f in sorted(SCHEDULE_DIR.glob("*.json")):
        with open(f, "r", encoding="utf-8") as fh:
            schedule = json.load(fh)
            if status_filter == "all" or schedule.get("status") == status_filter:
                schedules.append(schedule)

    return schedules


def update_status(schedule_id: str, new_status: str) -> dict:
    """更新排期状态"""
    ensure_dirs()
    schedule_file = SCHEDULE_DIR / f"{schedule_id}.json"

    if not schedule_file.exists():
        return {"error": f"Schedule {schedule_id} not found"}

    with open(schedule_file, "r", encoding="utf-8") as f:
        schedule = json.load(f)

    schedule["status"] = new_status

    if new_status == "published":
        schedule["published_at"] = datetime.now().isoformat()
        # 同时复制到 published 目录
        published_file = PUBLISHED_DIR / f"{schedule_id}.json"
        with open(published_file, "w", encoding="utf-8") as f:
            json.dump(schedule, f, ensure_ascii=False, indent=2)

    with open(schedule_file, "w", encoding="utf-8") as f:
        json.dump(schedule, f, ensure_ascii=False, indent=2)

    return schedule


def prepare_publish(schedule_id: str) -> dict:
    """准备发布数据包（供 Browser Relay 使用）"""
    ensure_dirs()
    schedule_file = SCHEDULE_DIR / f"{schedule_id}.json"

    if not schedule_file.exists():
        return {"error": f"Schedule {schedule_id} not found"}

    with open(schedule_file, "r", encoding="utf-8") as f:
        schedule = json.load(f)

    # 读取草稿内容
    draft_file = DRAFTS_DIR / schedule.get("draft_file", "")
    if not draft_file.exists():
        # 尝试模糊匹配
        draft_files = list(DRAFTS_DIR.glob(f"*{schedule['draft_id']}*"))
        if draft_files:
            draft_file = draft_files[0]
        else:
            return {"error": f"Draft file not found for {schedule['draft_id']}"}

    with open(draft_file, "r", encoding="utf-8") as f:
        draft = json.load(f)

    # 构造发布数据包
    selected_title_idx = draft.get("selected_title", 0)
    titles = draft.get("titles", [])
    title = titles[selected_title_idx]["text"] if titles else ""

    publish_package = {
        "schedule_id": schedule_id,
        "platform": schedule["platform"],
        "title": title,
        "body": draft.get("body", ""),
        "tags": draft.get("tags", []),
        "cover_suggestion": draft.get("cover_suggestion", ""),
        "prepared_at": datetime.now().isoformat(),
    }

    # 保存发布数据包
    package_file = SCHEDULE_DIR / f"{schedule_id}_publish_package.json"
    with open(package_file, "w", encoding="utf-8") as f:
        json.dump(publish_package, f, ensure_ascii=False, indent=2)

    return publish_package


def main():
    parser = argparse.ArgumentParser(description="nexo-scheduler 排期管理")
    parser.add_argument("--create", metavar="DRAFT_ID", help="创建排期")
    parser.add_argument("--time", metavar="ISO_TIME", help="排期时间")
    parser.add_argument("--platform", default="xiaohongshu", help="目标平台")
    parser.add_argument("--list", action="store_true", help="列出排期")
    parser.add_argument("--status", default="all", help="状态过滤")
    parser.add_argument("--update", metavar="SCHEDULE_ID", help="更新状态")
    parser.add_argument("--prepare-publish", metavar="SCHEDULE_ID", help="准备发布数据包")
    args = parser.parse_args()

    if args.create:
        if not args.time:
            print("Error: --time is required for --create")
            sys.exit(1)
        result = create_schedule(args.create, args.time, args.platform)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.list:
        result = list_schedules(args.status)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.update:
        result = update_status(args.update, args.status)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.prepare_publish:
        result = prepare_publish(args.prepare_publish)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
