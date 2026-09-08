#!/usr/bin/env python3
from __future__ import annotations

import html
import re
import sys
from pathlib import Path

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public")
ERRORS: list[str] = []


def read(relative: str) -> str:
    path = PUBLIC / relative
    if not path.is_file():
        ERRORS.append(f"missing rendered file: {relative}")
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def visible_text(source: str) -> str:
    text = re.sub(r"<script\b[^>]*>[\s\S]*?</script>", " ", source, flags=re.I)
    text = re.sub(r"<style\b[^>]*>[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


# Hugo must use CJK-aware word and reading-time rules for Chinese content.
hugo_config = Path("config/_default/hugo.toml").read_text(encoding="utf-8")
if not re.search(r"(?m)^\s*hasCJKLanguage\s*=\s*true\s*$", hugo_config):
    ERRORS.append("config/_default/hugo.toml must enable hasCJKLanguage = true")

# Project cards must never expose Hugo's zero-value date or incidental reading time.
for relative in ("projects/index.html", "zh-cn/projects/index.html"):
    source = read(relative)
    text = visible_text(source)
    if "0001" in text:
        ERRORS.append(f"{relative}: zero-value project date leaked into reader UI")
    if re.search(r"(?:閱讀|阅读).{0,4}\d+\s*分鐘|\d+\s*(?:分鐘|分钟)", text):
        ERRORS.append(f"{relative}: project card reading-time metadata should be hidden")

# Utility/identity/navigation pages are not articles and should not render article share controls.
share_markers = (
    "facebook.com/sharer",
    "line.me/R/share",
    "api.whatsapp.com/send",
    "t.me/share/url",
)
for relative in (
    "about/index.html",
    "explore/index.html",
    "site-log/index.html",
    "zh-cn/about/index.html",
    "zh-cn/explore/index.html",
    "zh-cn/site-log/index.html",
):
    source = read(relative)
    if any(marker in source for marker in share_markers):
        ERRORS.append(f"{relative}: article share controls leaked onto utility page")

# Both localized 404 documents must be excluded from indexing and have a localized home action.
for relative, label in (("404.html", "回到首頁"), ("zh-cn/404.html", "返回首页")):
    source = read(relative)
    compact = re.sub(r"\s+", " ", source)
    if not re.search(r'<meta\s+name=["\']?robots["\']?\s+content=["\']noindex,follow["\']', compact, re.I):
        ERRORS.append(f"{relative}: missing robots noindex,follow")
    if label not in visible_text(source):
        ERRORS.append(f"{relative}: localized home action {label!r} missing")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

print("Reader completeness verification: PASS (CJK metrics, projects, utility sharing, localized 404)")
