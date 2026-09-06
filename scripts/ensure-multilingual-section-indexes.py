#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POSTS = ROOT / "content" / "posts"

SIMPLIFIED_POSTS_INDEX = """---
title: \"文章\"
description: \"庄辉恺的文章与笔记。\"
---
"""

POSTS.mkdir(parents=True, exist_ok=True)
target = POSTS / "_index.zh-cn.md"
current = target.read_text(encoding="utf-8") if target.is_file() else ""
if current != SIMPLIFIED_POSTS_INDEX:
    target.write_text(SIMPLIFIED_POSTS_INDEX, encoding="utf-8")
    print("Multilingual section indexes: refreshed content/posts/_index.zh-cn.md")
else:
    print("Multilingual section indexes: PASS")
