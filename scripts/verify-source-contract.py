#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STRICT = os.environ.get("STRICT_CONTENT") == "1"
errors: list[str] = []
warnings: list[str] = []


def front_matter_value(front_lines: list[str], key: str) -> str | None:
    prefix = f"{key}:"
    for line in front_lines:
        if not line.startswith(prefix):
            continue
        raw = line[len(prefix):].strip()
        if not raw:
            return ""
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return raw.strip('"\'')
        return str(value)
    return None


for path in sorted((ROOT / "content" / "posts").glob("*/index.md")):
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.replace("\r\n", "\n").split("\n")
    rel = path.relative_to(ROOT)

    problems: list[str] = []
    if not lines or lines[0] != "---":
        problems.append("missing opening front matter delimiter")
        closing = None
    else:
        closing = next((i for i, line in enumerate(lines[1:], start=1) if line == "---"), None)
        if closing is None:
            problems.append("missing standalone closing front matter delimiter")

    front_lines = lines[1:closing] if closing is not None else []
    cover = front_matter_value(front_lines, "cover")
    if cover:
        cover_path = Path(cover)
        if cover_path.is_absolute() or ".." in cover_path.parts:
            problems.append("cover must reference a local file inside the article bundle")
        elif not (path.parent / cover_path).is_file():
            problems.append(f"cover resource is missing: {cover}")

    body = lines[(closing + 1) if closing is not None else 1:]
    first_content = next((line for line in body if line.strip()), "")
    if first_content.startswith("# "):
        problems.append("body starts with H1; article template owns the document H1")
    if any(line.strip() == "undefined" for line in body):
        problems.append("standalone converter sentinel 'undefined' remains in source")

    if problems:
        message = f"{rel}: " + "; ".join(problems)
        if STRICT:
            errors.append(message)
        else:
            warnings.append(message + " (legacy snapshot allowed only before closure normalization)")

for message in warnings:
    print(f"::warning::{message}")

if errors:
    for message in errors:
        print(f"::error::{message}")
    raise SystemExit(1)

print(f"Source contract verification: PASS ({len(list((ROOT / 'content' / 'posts').glob('*/index.md')))} articles checked)")
