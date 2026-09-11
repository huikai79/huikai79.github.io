#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POSTS = ROOT / "content" / "posts"

INDEXES = {
    "_index.md": """---
title: \"文章\"
description: \"莊輝愷的文章與筆記。\"
outputs: [\"HTML\", \"RSS\"]
---

{{< page-lead >}}
""",
    "_index.zh-cn.md": """---
title: \"文章\"
description: \"庄辉恺的文章与笔记。\"
outputs: [\"HTML\", \"RSS\"]
---

{{< page-lead >}}
""",
}

POSTS.mkdir(parents=True, exist_ok=True)
changed: list[str] = []
for name, expected in INDEXES.items():
    target = POSTS / name
    current = target.read_text(encoding="utf-8") if target.is_file() else ""
    if current != expected:
        target.write_text(expected, encoding="utf-8")
        changed.append(name)

if changed:
    print("Multilingual section indexes: refreshed " + ", ".join(f"content/posts/{name}" for name in changed))
else:
    print("Multilingual section indexes: PASS")
