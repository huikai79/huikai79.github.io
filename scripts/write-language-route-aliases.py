#!/usr/bin/env python3
from __future__ import annotations

import html
import sys
from pathlib import Path

from article_routing import routes

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
BASE = "https://huikai.com.kg"


def redirect_document(target: str) -> str:
    escaped = html.escape(target, quote=True)
    return f'''<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0; url={escaped}">\n<link rel="canonical" href="{escaped}">\n<meta name="robots" content="noindex">\n<title>Redirecting…</title>\n</head>\n<body><p><a href="{escaped}">Continue</a></p></body>\n</html>\n'''


written = 0
for route in routes():
    if route.language == "zh-TW":
        continue
    legacy = PUBLIC / "posts" / route.slug.lower() / "index.html"
    canonical = route.permalink_path
    destination = f"{BASE}{canonical}"
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_text(redirect_document(destination), encoding="utf-8")
    written += 1
    print(f"Legacy route alias: /posts/{route.slug.lower()}/ -> {canonical}")

print(f"Language route aliases written: {written}")
