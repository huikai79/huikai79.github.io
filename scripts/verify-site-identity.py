#!/usr/bin/env python3
from __future__ import annotations

import sys
from html.parser import HTMLParser
from pathlib import Path

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def read(path: Path, label: str) -> str:
    if not path.is_file() or path.stat().st_size == 0:
        fail(f"{label} is missing: {path}")
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


class Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.anchors: list[tuple[str, str]] = []
        self._anchor_href: str | None = None
        self._anchor_text: list[str] = []
        self.h1: list[str] = []
        self._in_h1 = False
        self._h1_text: list[str] = []
        self.description = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        tag = tag.lower()
        if tag == "a":
            self._anchor_href = data.get("href", "")
            self._anchor_text = []
        elif tag == "h1":
            self._in_h1 = True
            self._h1_text = []
        elif tag == "meta" and data.get("name", "").lower() == "description":
            self.description = data.get("content", "")

    def handle_data(self, data: str) -> None:
        if self._anchor_href is not None:
            self._anchor_text.append(data)
        if self._in_h1:
            self._h1_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "a" and self._anchor_href is not None:
            text = " ".join("".join(self._anchor_text).split())
            self.anchors.append((self._anchor_href, text))
            self._anchor_href = None
            self._anchor_text = []
        elif tag == "h1" and self._in_h1:
            self.h1.append(" ".join("".join(self._h1_text).split()))
            self._in_h1 = False
            self._h1_text = []


def parse(text: str) -> Parser:
    parser = Parser()
    parser.feed(text)
    parser.close()
    return parser


language_config = read(ROOT / "config" / "_default" / "languages.zh-CN.toml", "Language config")
menu_config = read(ROOT / "config" / "_default" / "menus.zh-CN.toml", "Menu config")
home_source = read(ROOT / "content" / "_index.md", "Homepage source")
about_source = read(ROOT / "content" / "about" / "index.md", "About source")

expected_description = "庄辉恺的个人网站，记录 AI、学习、阅读、视觉设计、教育与数字工具相关的文章、作品、实验与思考。"
if expected_description not in language_config:
    fail("Site description is not aligned with the current homepage positioning")
for forbidden in ("生活分享｜AI 学习｜读书笔记｜影视心得", "记录生活分享、AI 学习、读书笔记与影视心得"):
    if forbidden in language_config:
        fail(f"Legacy positioning remains in language metadata: {forbidden}")
if 'pageRef = "about"' not in menu_config or 'name = "关于"' not in menu_config:
    fail("Main navigation does not include the About page")
if 'label: "查看文章"' not in home_source or 'url: "/posts/"' not in home_source:
    fail("Homepage primary article CTA source contract is missing")
if 'label: "关于我"' not in home_source or 'url: "/about/"' not in home_source:
    fail("Homepage secondary About CTA source contract is missing")
if 'layout: "simple"' not in about_source:
    fail("About page must explicitly use Blowfish native simple layout")

home = read(PUBLIC / "index.html", "Rendered homepage")
about = read(PUBLIC / "about" / "index.html", "Rendered About page")
if home:
    parser = parse(home)
    ctas = {(href.rstrip("/") or "/", text) for href, text in parser.anchors}
    if ("/posts", "查看文章") not in ctas:
        fail("Rendered homepage is missing the 查看文章 CTA")
    if ("/about", "关于我") not in ctas:
        fail("Rendered homepage is missing the 关于我 CTA")
    if parser.description != expected_description:
        fail(f"Rendered homepage description mismatch: {parser.description!r}")

if about:
    parser = parse(about)
    if parser.h1 != ["关于"]:
        fail(f"About page must render exactly one H1 named 关于; found {parser.h1}")
    for text in (
        "视觉设计、教育、AI 与数字工具",
        "文章、作品、实验与思考",
        "长期可读和容易维护",
    ):
        if text not in about:
            fail(f"About page is missing expected positioning text: {text}")
    if "阅读约" in about:
        fail("About page incorrectly inherited article reading-time chrome")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

print("Site identity verification: PASS")
