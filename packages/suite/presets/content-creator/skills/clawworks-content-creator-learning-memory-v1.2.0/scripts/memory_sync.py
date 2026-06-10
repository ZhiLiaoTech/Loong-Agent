#!/usr/bin/env python3
"""自学习摘要与记忆沉淀脚本。"""
import json, argparse, hashlib
from pathlib import Path
from datetime import datetime, timedelta


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return default


def append_jsonl(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a', encoding='utf-8') as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + '
')


def fingerprint(text: str) -> str:
    return hashlib.sha1(text.encode('utf-8')).hexdigest()[:12]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--conversation-summary', required=True, help='由上层调度器提供的最近窗口摘要 JSON')
    ap.add_argument('--output', required=True)
    ap.add_argument('--memory-jsonl', required=True)
    args = ap.parse_args()

    payload = load_json(Path(args.conversation_summary), {})
    insights = payload.get('confirmed_insights', [])
    hypotheses = payload.get('hypotheses', [])
    rules = payload.get('actionable_rules', [])
    source = payload.get('source', 'conversation_window')
    now = datetime.now()

    summary = {
        'generated_at': now.isoformat(),
        'window_minutes': payload.get('window_minutes', 60),
        'confirmed_insights': insights,
        'hypotheses': hypotheses,
        'actionable_rules': rules,
        'write_targets': payload.get('write_targets', {
            'soul': ['stable_preferences'],
            'working_memory': ['recent_constraints', 'recent_feedback']
        })
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')

    rows = []
    for item in insights + rules:
        rows.append({
            'id': fingerprint(item + source),
            'type': 'confirmed' if item in insights else 'rule',
            'confidence': payload.get('confidence', 0.78),
            'source': source,
            'created_at': now.isoformat(),
            'expires_at': (now + timedelta(days=14)).isoformat(),
            'content': item,
        })
    for item in hypotheses:
        rows.append({
            'id': fingerprint(item + source),
            'type': 'hypothesis',
            'confidence': payload.get('hypothesis_confidence', 0.55),
            'source': source,
            'created_at': now.isoformat(),
            'expires_at': (now + timedelta(days=7)).isoformat(),
            'content': item,
        })
    append_jsonl(Path(args.memory_jsonl), rows)
    print(json.dumps(summary, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
