#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
ERRORS: list[str] = []
READING_TIME_RE = re.compile(r"(?:閱讀約|阅读约)\s*(\d+)\s*分鐘|(?:閱讀約|阅读约)\s*(\d+)\s*分钟")


def fail(message: str) -> None:
    ERRORS.append(message)


class Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.html_lang = ""
        self.ids: set[str] = set()
        self.classes: set[str] = set()
        self.scroll_label = ""
        self.article_heading_count = 0
        self.in_article_main = False
        self.text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        classes = set(data.get("class", "").split())
        self.classes.update(classes)
        if data.get("id"):
            self.ids.add(data["id"])
        if tag.lower() == "html":
            self.html_lang = data.get("lang", "")
        if data.get("id") == "scroll-to-top":
            self.scroll_label = data.get("aria-label", "")
        if tag.lower() == "article" and "article-main" in classes:
            self.in_article_main = True
        elif self.in_article_main and tag.lower() in {"h2", "h3", "h4"}:
            self.article_heading_count += 1

    def handle_data(self, data: str) -> None:
        stripped = data.strip()
        if stripped:
            self.text.append(stripped)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "article" and self.in_article_main:
            self.in_article_main = False


def parse(path: Path) -> Parser:
    parser = Parser()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    parser.close()
    return parser


article_paths = sorted((PUBLIC / "posts").glob("*/index.html"))
article_paths += sorted((PUBLIC / "zh-cn" / "posts").glob("*/index.html"))
if not article_paths:
    fail("No rendered article pages found for reader-navigation verification")

expected_toc_pages = 0
for path in article_paths:
    parser = parse(path)
    text = " ".join(parser.text)
    match = READING_TIME_RE.search(text)
    minutes = int(next((value for value in match.groups() if value), "0")) if match else 0
    should_have_toc = minutes >= 5 and parser.article_heading_count > 0
    has_toc = "TableOfContents" in parser.ids and "article-toc" in parser.classes

    if should_have_toc:
        expected_toc_pages += 1
        if not has_toc:
            fail(f"Long structured article is missing Smart TOC: {path.relative_to(PUBLIC)}")
    elif has_toc:
        fail(f"Short or unstructured article unexpectedly renders Smart TOC: {path.relative_to(PUBLIC)}")

    expected_label = "回到頂部" if parser.html_lang == "zh-TW" else "回到顶部"
    if parser.scroll_label != expected_label:
        fail(
            f"Back-to-top label mismatch for {path.relative_to(PUBLIC)}: "
            f"lang={parser.html_lang!r}, label={parser.scroll_label!r}, expected={expected_label!r}"
        )

if expected_toc_pages == 0:
    fail("Reader-navigation fixture set contains no long structured article with a Smart TOC")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

print(
    "Reader navigation verification: PASS "
    f"(articles={len(article_paths)}, smart-toc-pages={expected_toc_pages}, localized-back-to-top=all)"
)
