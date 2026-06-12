#!/usr/bin/env python3
"""
nexo-visual 封面建议辅助工具。

用法:
  python visual_helper.py --dimensions <platform>   # 输出平台封面尺寸规范
  python visual_helper.py --palette <mood>           # 推荐配色方案
"""

import json
import sys
import argparse


PLATFORM_DIMENSIONS = {
    "xiaohongshu": {"width": 1080, "height": 1440, "ratio": "3:4", "orientation": "portrait"},
    "douyin": {"width": 1080, "height": 1920, "ratio": "9:16", "orientation": "portrait"},
    "bilibili": {"width": 1920, "height": 1080, "ratio": "16:9", "orientation": "landscape"},
    "wechat_mp": {"width": 900, "height": 383, "ratio": "2.35:1", "orientation": "landscape"},
}

MOOD_PALETTES = {
    "warm": {
        "primary": "#FF6B35", "secondary": "#F7931E", "accent": "#FFD23F",
        "background": "#FFF8F0", "text": "#2D2D2D",
        "description": "温暖活力，适合美食、生活、亲子类内容",
    },
    "cool": {
        "primary": "#4A90D9", "secondary": "#7B68EE", "accent": "#00D4FF",
        "background": "#F0F4FF", "text": "#1A1A2E",
        "description": "冷静专业，适合科技、财经、教育类内容",
    },
    "fresh": {
        "primary": "#2ECC71", "secondary": "#27AE60", "accent": "#F1C40F",
        "background": "#F0FFF4", "text": "#2C3E50",
        "description": "清新自然，适合健康、运动、旅行类内容",
    },
    "cute": {
        "primary": "#FF69B4", "secondary": "#FF1493", "accent": "#FFB6C1",
        "background": "#FFF0F5", "text": "#4A4A4A",
        "description": "可爱甜美，适合穿搭、美妆、宠物类内容",
    },
    "luxury": {
        "primary": "#C9A96E", "secondary": "#8B7355", "accent": "#F5E6CC",
        "background": "#1A1A1A", "text": "#FFFFFF",
        "description": "高端质感，适合奢侈品、高端生活方式类内容",
    },
    "minimal": {
        "primary": "#333333", "secondary": "#666666", "accent": "#FF4444",
        "background": "#FFFFFF", "text": "#1A1A1A",
        "description": "极简干净，适合知识分享、干货教程类内容",
    },
}


def get_dimensions(platform: str) -> dict:
    dims = PLATFORM_DIMENSIONS.get(platform)
    if not dims:
        return {"error": f"Unknown platform: {platform}", "supported": list(PLATFORM_DIMENSIONS.keys())}
    return {"platform": platform, **dims}


def get_palette(mood: str) -> dict:
    palette = MOOD_PALETTES.get(mood)
    if not palette:
        return {"error": f"Unknown mood: {mood}", "supported": list(MOOD_PALETTES.keys())}
    return {"mood": mood, **palette}


def main():
    parser = argparse.ArgumentParser(description="nexo-visual 封面辅助工具")
    parser.add_argument("--dimensions", metavar="PLATFORM", help="平台封面尺寸")
    parser.add_argument("--palette", metavar="MOOD", help="推荐配色方案")
    args = parser.parse_args()

    if args.dimensions:
        print(json.dumps(get_dimensions(args.dimensions), ensure_ascii=False, indent=2))
    elif args.palette:
        print(json.dumps(get_palette(args.palette), ensure_ascii=False, indent=2))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
