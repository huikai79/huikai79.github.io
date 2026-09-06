#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

from article_routing import routes

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
ERRORS: list[str] = []

for route in routes():
    if route.language == "zh-TW":
        continue
    legacy = PUBLIC / "posts" / route.slug.lower() / "index.html"
    if not legacy.is_file():
        ERRORS.append(f"Legacy language-migration alias is missing: {legacy}")
        continue
    text = legacy.read_text(encoding="utf-8", errors="replace")
    expected = f"https://huikai.com.kg{route.permalink_path}"
    if expected not in text:
        ERRORS.append(f"Legacy alias target mismatch for {route.slug}: expected {expected}")
    if 'meta name="robots" content="noindex"' not in text:
        ERRORS.append(f"Legacy alias must be noindex: {route.slug}")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)
print("Language route alias verification: PASS")
