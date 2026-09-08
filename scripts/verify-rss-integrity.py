#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public")
ERRORS: list[str] = []
EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)


def fail(message: str) -> None:
    ERRORS.append(message)


def parse_feed(relative: str, expected_prefix: str) -> list[str]:
    path = PUBLIC / relative
    if not path.is_file():
        fail(f"missing RSS feed: {relative}")
        return []
    raw = path.read_text(encoding="utf-8", errors="replace")
    if "0001" in raw:
        fail(f"{relative}: zero-value date leaked into RSS")
    if "media:content" in raw:
        fail(f"{relative}: raw media attachment leaked into RSS")
    if EMAIL_RE.search(raw):
        fail(f"{relative}: author/editor email leaked into RSS")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        fail(f"{relative}: invalid XML: {exc}")
        return []
    channel = root.find("channel")
    if channel is None:
        fail(f"{relative}: RSS channel missing")
        return []
    items = channel.findall("item")
    links: list[str] = []
    for index, item in enumerate(items, start=1):
        link = (item.findtext("link") or "").strip()
        description = (item.findtext("description") or "").strip()
        pub_date = (item.findtext("pubDate") or "").strip()
        if not link:
            fail(f"{relative}: item {index} is missing link")
            continue
        path_part = urlparse(link).path.lower()
        if not path_part.startswith(expected_prefix):
            fail(f"{relative}: non-article item leaked into feed: {link}")
        if not description:
            fail(f"{relative}: item {index} has empty description")
        if not pub_date:
            fail(f"{relative}: item {index} has empty publication date")
        links.append(link)
    if not items:
        fail(f"{relative}: feed contains no article items")
    return links


tw_home = parse_feed("index.xml", "/posts/")
tw_posts = parse_feed("posts/index.xml", "/posts/")
cn_home = parse_feed("zh-cn/index.xml", "/zh-cn/posts/")
cn_posts = parse_feed("zh-cn/posts/index.xml", "/zh-cn/posts/")

if tw_home and tw_posts and tw_home != tw_posts:
    fail("zh-TW home RSS and article-section RSS do not expose the same canonical articles/order")
if cn_home and cn_posts and cn_home != cn_posts:
    fail("zh-CN home RSS and article-section RSS do not expose the same canonical articles/order")

# Non-article sections and discovery taxonomies should not emit stray RSS endpoints.
for relative in (
    "projects/index.xml",
    "about/index.xml",
    "explore/index.xml",
    "categories/index.xml",
    "tags/index.xml",
    "formats/index.xml",
    "zh-cn/projects/index.xml",
    "zh-cn/about/index.xml",
    "zh-cn/explore/index.xml",
    "zh-cn/categories/index.xml",
    "zh-cn/tags/index.xml",
    "zh-cn/formats/index.xml",
):
    if (PUBLIC / relative).exists():
        fail(f"unexpected non-article RSS endpoint: {relative}")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

print(f"RSS integrity verification: PASS (zh-TW={len(tw_home)} articles, zh-CN={len(cn_home)} articles)")
