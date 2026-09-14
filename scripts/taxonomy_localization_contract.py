from __future__ import annotations

import json
from pathlib import Path

# Notion owns one canonical editorial taxonomy vocabulary. Reader-facing
# Simplified Chinese labels are presentation data only: canonical identities
# and URLs stay stable across languages.
ZH_CN_LABELS: dict[str, dict[str, str]] = {
    "categories": {
        "科技": "科技",
        "學習": "学习",
        "創作": "创作",
        "生活": "生活",
    },
    "formats": {
        "文章": "文章",
        "札記": "札记",
        "紀錄": "纪录",
    },
    "tags": {
        "AI": "AI",
        "Hackathon": "Hackathon",
        "創業": "创业",
        "教育": "教育",
        "寫作": "写作",
        # Historical term identities remain valid aliases/entry points.
        "创业": "创业",
        "好文推荐": "好文推荐",
        "技术学习": "技术学习",
    },
}


def localized_label(taxonomy: str, identity: str, language: str) -> str:
    if language != "zh-CN":
        return identity
    labels = ZH_CN_LABELS.get(taxonomy)
    if labels is None or identity not in labels:
        raise ValueError(
            "Unknown zh-CN taxonomy identity requires an explicit localization decision: "
            f"{taxonomy}/{identity}"
        )
    return labels[identity]


def _safe_identity(identity: str) -> str:
    value = str(identity).strip()
    if not value or value in {".", ".."} or "/" in value or "\\" in value:
        raise ValueError(f"Unsafe taxonomy identity: {identity!r}")
    return value


def zh_cn_term_override_path(content_root: Path, taxonomy: str, identity: str) -> Path:
    safe_identity = _safe_identity(identity)
    if taxonomy not in ZH_CN_LABELS:
        raise ValueError(f"Unknown taxonomy: {taxonomy!r}")
    return content_root / taxonomy / safe_identity / "_index.zh-cn.md"


def zh_cn_term_override_content(taxonomy: str, identity: str) -> str | None:
    label = localized_label(taxonomy, identity, "zh-CN")
    if label == identity:
        return None
    return f"---\ntitle: {json.dumps(label, ensure_ascii=False)}\n---\n"


def ensure_zh_cn_term_override(content_root: Path, taxonomy: str, identity: str) -> Path | None:
    expected = zh_cn_term_override_content(taxonomy, identity)
    if expected is None:
        return None
    target = zh_cn_term_override_path(content_root, taxonomy, identity)
    target.parent.mkdir(parents=True, exist_ok=True)
    current = target.read_text(encoding="utf-8") if target.is_file() else None
    if current != expected:
        target.write_text(expected, encoding="utf-8", newline="\n")
    return target
