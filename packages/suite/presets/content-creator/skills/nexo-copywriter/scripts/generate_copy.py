#!/usr/bin/env python3
"""
nexo-copywriter 文案评分与合规检查工具。
跨平台兼容（Windows + macOS），禁止使用 Bash/Shell 命令。

用法:
  python generate_copy.py --score <draft_path>       # 计算文案评分
  python generate_copy.py --compliance <draft_path>   # 违规风险检查
  python generate_copy.py --tags <draft_path>         # 生成标签推荐
"""

import json
import sys
import os
import re
import argparse
from pathlib import Path
from datetime import datetime


# ── 路径配置 ──────────────────────────────────────────────────

SUITE_DIR = Path(__file__).resolve().parent.parent.parent
REFERENCES_DIR = Path(__file__).resolve().parent.parent / "references"
DRAFTS_DIR = SUITE_DIR / "data" / "drafts"
COMPLIANCE_KEYWORDS_PATH = REFERENCES_DIR / "compliance-keywords.json"


# ── 评分模块 ──────────────────────────────────────────────────

PLATFORM_TITLE_LENGTH = {
    "xiaohongshu": (10, 20),
    "douyin": (8, 15),
    "bilibili": (15, 30),
    "wechat_mp": (15, 30),
}

PLATFORM_BODY_LENGTH = {
    "xiaohongshu": (300, 800),
    "douyin": (100, 500),
    "bilibili": (500, 5000),
    "wechat_mp": (1000, 3000),
}


def score_title(title: str, platform: str) -> dict:
    """标题评分（满分 100）"""
    scores = {}

    # 悬念/好奇心（25分）- 检测疑问词、省略号、反转词
    curiosity_patterns = [
        r"[？?]", r"竟然", r"没想到", r"居然", r"原来", r"秘密",
        r"真相", r"终于", r"\.\.\.", r"…", r"不要", r"别再",
    ]
    curiosity_hits = sum(1 for p in curiosity_patterns if re.search(p, title))
    scores["curiosity"] = min(25, curiosity_hits * 8)

    # 平台适配（15分）- 标题长度
    min_len, max_len = PLATFORM_TITLE_LENGTH.get(platform, (10, 25))
    title_len = len(title)
    if min_len <= title_len <= max_len:
        scores["length"] = 15
    elif title_len < min_len:
        scores["length"] = max(0, 15 - (min_len - title_len) * 3)
    else:
        scores["length"] = max(0, 15 - (title_len - max_len) * 2)

    # Emoji 检测（小红书加分）
    emoji_count = len(re.findall(r"[\U0001F300-\U0001F9FF]", title))
    if platform == "xiaohongshu":
        scores["emoji"] = min(10, emoji_count * 5)
    else:
        scores["emoji"] = 5 if emoji_count <= 1 else 3

    # 情感共鸣（20分）- 检测情感词
    emotion_words = [
        "爱", "恨", "哭", "笑", "感动", "震惊", "后悔", "幸福",
        "崩溃", "治愈", "绝了", "太香", "yyds", "神仙", "宝藏",
    ]
    emotion_hits = sum(1 for w in emotion_words if w in title)
    scores["emotion"] = min(20, emotion_hits * 7)

    # 关键词命中（25分）- 需要结合用户 USER.md 中的领域关键词
    # 此处为基础评分，实际由 LLM 综合判断
    scores["keyword"] = 15  # 基础分

    total = sum(scores.values())
    return {"total": min(100, total), "breakdown": scores}


def score_body(body: str, platform: str) -> dict:
    """正文评分（满分 100）"""
    scores = {}
    body_len = len(body)

    # 长度适配（15分）
    min_len, max_len = PLATFORM_BODY_LENGTH.get(platform, (300, 2000))
    if min_len <= body_len <= max_len:
        scores["length"] = 15
    elif body_len < min_len:
        scores["length"] = max(0, 15 - (min_len - body_len) // 50)
    else:
        scores["length"] = max(5, 15 - (body_len - max_len) // 200)

    # 结构清晰度（20分）- 段落数、换行分布
    paragraphs = [p.strip() for p in body.split("\n") if p.strip()]
    para_count = len(paragraphs)
    if 3 <= para_count <= 15:
        scores["structure"] = 20
    elif para_count < 3:
        scores["structure"] = 8
    else:
        scores["structure"] = 12

    # 开头吸引力（20分）- 首段长度和钩子检测
    if paragraphs:
        first_para = paragraphs[0]
        hook_patterns = [r"[？?]", r"你有没有", r"曾经", r"想象一下", r"别急"]
        hook_hits = sum(1 for p in hook_patterns if re.search(p, first_para))
        scores["opening"] = min(20, 10 + hook_hits * 5)
    else:
        scores["opening"] = 0

    # 互动引导（15分）- 检测 CTA
    cta_patterns = [
        r"点赞", r"收藏", r"关注", r"转发", r"评论区", r"留言",
        r"你觉得", r"你们", r"一起", r"快来",
    ]
    cta_hits = sum(1 for p in cta_patterns if re.search(p, body))
    scores["cta"] = min(15, cta_hits * 5)

    # 基础分
    scores["density"] = 15  # 信息密度由 LLM 判断
    scores["compliance"] = 15  # 合规性由 compliance_check 判断

    total = sum(scores.values())
    return {"total": min(100, total), "breakdown": scores}


def score_draft(draft_path: str) -> dict:
    """对完整草稿进行评分"""
    with open(draft_path, "r", encoding="utf-8") as f:
        draft = json.load(f)

    platform = draft.get("platform", "xiaohongshu")
    results = {"platform": platform, "titles": [], "body": None}

    # 评分每个标题
    for t in draft.get("titles", []):
        title_text = t.get("text", "")
        results["titles"].append({
            "text": title_text,
            **score_title(title_text, platform),
        })

    # 评分正文
    body = draft.get("body", "")
    if body:
        results["body"] = score_body(body, platform)

    # 综合评分
    title_scores = [t["total"] for t in results["titles"]] or [0]
    body_score = results["body"]["total"] if results["body"] else 0
    results["overall"] = round(max(title_scores) * 0.4 + body_score * 0.6)

    return results


# ── 合规检查模块 ──────────────────────────────────────────────

def load_compliance_keywords() -> dict:
    """加载各平台敏感词库"""
    if COMPLIANCE_KEYWORDS_PATH.exists():
        with open(COMPLIANCE_KEYWORDS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    # 内置基础词库
    return {
        "universal": [
            "最好", "第一", "唯一", "必须买", "100%", "绝对",
            "国家级", "顶级", "极品", "永久",
        ],
        "medical": [
            "治疗", "治愈", "药效", "疗效", "根治", "特效药",
        ],
        "financial": [
            "稳赚", "保本", "零风险", "翻倍", "暴富",
        ],
    }


def compliance_check(draft_path: str) -> dict:
    """检查内容合规性"""
    with open(draft_path, "r", encoding="utf-8") as f:
        draft = json.load(f)

    keywords = load_compliance_keywords()
    warnings = []

    # 合并所有文本
    all_text = ""
    for t in draft.get("titles", []):
        all_text += t.get("text", "") + " "
    all_text += draft.get("body", "")

    # 检查各类敏感词
    for category, words in keywords.items():
        for word in words:
            if word in all_text:
                warnings.append({
                    "category": category,
                    "keyword": word,
                    "severity": "high" if category in ["medical", "financial"] else "medium",
                    "suggestion": f"建议移除或替换「{word}」，可能触发平台审核",
                })

    return {
        "passed": len(warnings) == 0,
        "warning_count": len(warnings),
        "warnings": warnings,
        "checked_at": datetime.now().isoformat(),
    }


# ── 标签推荐模块 ──────────────────────────────────────────────

def suggest_tags(draft_path: str) -> dict:
    """基于内容生成标签推荐（基础版，实际由 LLM 增强）"""
    with open(draft_path, "r", encoding="utf-8") as f:
        draft = json.load(f)

    body = draft.get("body", "")
    platform = draft.get("platform", "xiaohongshu")
    existing_tags = draft.get("tags", [])

    # 提取高频词作为候选标签（简易版）
    # 实际生产环境中由 LLM 生成更精准的标签
    words = re.findall(r"[\u4e00-\u9fff]{2,4}", body)
    word_freq = {}
    for w in words:
        word_freq[w] = word_freq.get(w, 0) + 1

    # 按频率排序
    sorted_words = sorted(word_freq.items(), key=lambda x: -x[1])
    candidates = [w for w, c in sorted_words[:20] if c >= 2]

    return {
        "existing_tags": existing_tags,
        "suggested_tags": candidates[:15],
        "platform": platform,
    }


# ── 主入口 ────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="nexo-copywriter 文案工具")
    parser.add_argument("--score", metavar="PATH", help="计算文案评分")
    parser.add_argument("--compliance", metavar="PATH", help="违规风险检查")
    parser.add_argument("--tags", metavar="PATH", help="生成标签推荐")
    args = parser.parse_args()

    if args.score:
        result = score_draft(args.score)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.compliance:
        result = compliance_check(args.compliance)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.tags:
        result = suggest_tags(args.tags)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
