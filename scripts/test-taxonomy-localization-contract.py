#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory

from taxonomy_localization_contract import (
    ZH_CN_LABELS,
    ensure_zh_cn_term_override,
    localized_label,
    zh_cn_term_override_content,
    zh_cn_term_override_path,
)

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "content"

assert localized_label("formats", "文章", "zh-CN") == "文章"
assert localized_label("formats", "札記", "zh-CN") == "札记"
assert localized_label("formats", "紀錄", "zh-CN") == "纪录"
assert localized_label("formats", "紀錄", "zh-TW") == "紀錄"

assert zh_cn_term_override_content("formats", "文章") is None
assert zh_cn_term_override_content("formats", "紀錄") == '---\ntitle: "纪录"\n---\n'
assert zh_cn_term_override_path(CONTENT, "formats", "紀錄") == CONTENT / "formats" / "紀錄" / "_index.zh-cn.md"

# Every localization that differs from its canonical identity must have a
# committed term override. This catches inactive enum values before new content
# first activates them in a production materialized candidate.
for taxonomy, labels in ZH_CN_LABELS.items():
    for identity, label in labels.items():
        if label == identity:
            continue
        expected = zh_cn_term_override_content(taxonomy, identity)
        path = zh_cn_term_override_path(CONTENT, taxonomy, identity)
        assert path.is_file(), f"Missing committed zh-CN taxonomy override: {path}"
        assert path.read_text(encoding="utf-8") == expected, (
            f"Stale zh-CN taxonomy override: {path}; expected label {label!r}"
        )

with TemporaryDirectory() as temp:
    root = Path(temp)
    target = ensure_zh_cn_term_override(root, "formats", "紀錄")
    assert target == root / "formats" / "紀錄" / "_index.zh-cn.md"
    assert target.read_text(encoding="utf-8") == '---\ntitle: "纪录"\n---\n'
    assert ensure_zh_cn_term_override(root, "formats", "文章") is None

for unsafe in ("", ".", "..", "a/b", "a\\b"):
    try:
        zh_cn_term_override_path(CONTENT, "formats", unsafe)
    except ValueError:
        pass
    else:
        raise AssertionError(f"Unsafe taxonomy identity accepted: {unsafe!r}")

print("Taxonomy localization source contract tests: PASS")
