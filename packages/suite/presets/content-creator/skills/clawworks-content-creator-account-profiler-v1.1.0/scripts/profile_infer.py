#!/usr/bin/env python3
"""账号画像识别骨架脚本。

当前版本实现了本地样本聚合、关键词统计、时段偏好统计与 profile.json 输出骨架。
真实浏览器抓取与评论理解由 Suite 运行时结合 Browser/LLM 完成。
"""
import json, re, argparse
from collections import Counter,defaultdict
from pathlib import Path
from datetime import datetime

STOPWORDS = {"我们","你们","这个","那个","真的","就是","一个","什么","怎么","可以","一下","大家","今天","自己"}


def read_samples(sample_dir: Path):
    samples=[]
    if sample_dir.exists():
        for f in sorted(sample_dir.glob('*.json')):
            try:
                data=json.loads(f.read_text(encoding='utf-8'))
                if isinstance(data,list): samples.extend(data)
                elif isinstance(data,dict): samples.append(data)
            except Exception:
                continue
    return samples


def extract_keywords(text: str):
    words=re.findall(r"[一-鿿]{2,6}", text)
    return [w for w in words if w not in STOPWORDS]


def infer_profile(samples):
    kw=Counter(); forms=Counter(); hours=Counter(); perf=[]
    audience_hints=Counter(); style_hints=Counter()
    for s in samples:
        text=' '.join(str(s.get(k,'')) for k in ['title','body','summary','caption'])
        for w in extract_keywords(text): kw[w]+=1
        forms[s.get('content_type') or s.get('platform') or 'unknown'] += 1
        published_at = str(s.get('published_at',''))
        m=re.search(r'T?(\d{2}):', published_at)
        if m: hours[m.group(1)+':00'] += 1
        score = int(s.get('likes',0))+int(s.get('comments',0))*3+int(s.get('collects',0))*4+int(s.get('shares',0))*5
        perf.append((score, s.get('title','')))
        comments=' '.join(s.get('top_comments',[]) if isinstance(s.get('top_comments'),list) else [str(s.get('top_comments',''))])
        for w in extract_keywords(comments): audience_hints[w]+=1
        if '老师' in text or '解读' in text: style_hints['专业严谨'] += 1
        if '故事' in text or '讲给孩子' in text: style_hints['通俗讲解'] += 1
        if '诗词' in text or '古文' in text: style_hints['古风'] += 1
    top_kw=[w for w,_ in kw.most_common(12)]
    niche='、'.join(top_kw[:3]) if top_kw else '待识别'
    perf.sort(reverse=True)
    audience='、'.join([w for w,_ in audience_hints.most_common(5)]) or '待识别'
    return {
        'generated_at': datetime.now().isoformat(),
        'profile_source': 'auto_inferred',
        'confidence': round(min(0.9, 0.45 + len(samples)*0.01), 2),
        'sample_size': len(samples),
        'niche': niche,
        'target_audience': audience,
        'audience_needs': top_kw[:5],
        'style_preference': [w for w,_ in style_hints.most_common(3)] or ['专业严谨'],
        'content_types': [w for w,_ in forms.most_common(3)],
        'top_keywords': top_kw,
        'best_topics': [title for _,title in perf[:5] if title],
        'preferred_post_time': [h for h,_ in hours.most_common(3)],
        'evidence': {
            'high_performing_posts': [title for _,title in perf[:5] if title],
            'comment_signals': [w for w,_ in audience_hints.most_common(10)],
            'title_patterns': top_kw[:8],
        }
    }


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--samples', required=True)
    ap.add_argument('--output', required=True)
    args=ap.parse_args()
    samples=read_samples(Path(args.samples))
    result=infer_profile(samples)
    out=Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
