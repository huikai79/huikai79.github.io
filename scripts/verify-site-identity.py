#!/usr/bin/env python3
from __future__ import annotations

import json
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


language_config = read(ROOT / "config" / "_default" / "languages.zh-TW.toml", "Language config")
menu_config = read(ROOT / "config" / "_default" / "menus.zh-TW.toml", "Menu config")
home_source = read(ROOT / "content" / "_index.md", "Homepage source")
about_source = read(ROOT / "content" / "about" / "index.md", "About source")
manifest_source = read(ROOT / "static" / "site.webmanifest", "Web app manifest")

expected_description = "HUIKAI 是莊輝愷的個人網站。澄心之遊，記錄那些值得長期保留的價值，也留下理解如何改變。"
if 'title = "HUIKAI"' not in language_config:
    fail("Primary site title must use the HUIKAI brand")
if expected_description not in language_config:
    fail("Site description is not aligned with the HUIKAI positioning")
for forbidden in (
    "生活分享｜AI 學習｜讀書筆記｜影視心得",
    "記錄生活分享、AI 學習、讀書筆記與影視心得",
    "AI｜學習｜閱讀｜視覺設計｜教育｜數位工具",
):
    if forbidden in language_config:
        fail(f"Legacy positioning remains in language metadata: {forbidden}")
if 'pageRef = "about"' not in menu_config or 'name = "關於"' not in menu_config:
    fail("Main navigation does not include the About page")
if 'title: "澄心之遊"' not in home_source or 'heroCaption: "HUIKAI"' not in home_source:
    fail("Homepage source must present HUIKAI with the 澄心之遊 spirit line")
if 'heroLead: "記錄那些值得長期保留的價值。"' not in home_source:
    fail("Homepage source must use the settled HUIKAI value statement")
if 'label: "閱讀文章"' not in home_source or 'url: "/posts/"' not in home_source:
    fail("Homepage primary article CTA source contract is missing")
if 'label: "關於我"' not in home_source or 'url: "/about/"' not in home_source:
    fail("Homepage secondary About CTA source contract is missing")
if 'layout: "simple"' not in about_source:
    fail("About page must explicitly use Blowfish native simple layout")
if manifest_source:
    try:
        manifest = json.loads(manifest_source)
        if manifest.get("name") != "HUIKAI" or manifest.get("short_name") != "HUIKAI":
            fail("Web app manifest identity must use HUIKAI")
    except json.JSONDecodeError as error:
        fail(f"Web app manifest is invalid JSON: {error}")

home = read(PUBLIC / "index.html", "Rendered homepage")
about = read(PUBLIC / "about" / "index.html", "Rendered About page")
if home:
    parser = parse(home)
    ctas = {(href.rstrip("/") or "/", text) for href, text in parser.anchors}
    if parser.h1 != ["澄心之遊"]:
        fail(f"Homepage must render exactly one H1 named 澄心之遊; found {parser.h1}")
    if "HUIKAI" not in home:
        fail("Rendered homepage is missing the HUIKAI brand")
    if "記錄那些值得長期保留的價值" not in home:
        fail("Rendered homepage is missing the settled HUIKAI value statement")
    if "遊而澄心" not in home:
        fail("Rendered homepage is missing the 澄心之遊 interpretation")
    if ("/posts", "閱讀文章") not in ctas:
        fail("Rendered homepage is missing the 閱讀文章 CTA")
    if ("/about", "關於我") not in ctas:
        fail("Rendered homepage is missing the 關於我 CTA")
    if parser.description != expected_description:
        fail(f"Rendered homepage description mismatch: {parser.description!r}")

if about:
    parser = parse(about)
    if parser.h1 != ["關於"]:
        fail(f"About page must render exactly one H1 named 關於; found {parser.h1}")
    for text in (
        "澄心之遊",
        "遊而澄心",
        "一次次澄的是心",
        "長年沉澱下來的，也許才逐漸成為性",
        "自己曾經怎麼看，又是什麼讓自己後來看得不一樣",
        "一個普通的人，在所見、所學、所歷之間",
        "留下那些值得長期回望的人事物",
    ):
        if text not in about:
            fail(f"About page is missing expected positioning text: {text}")
    if "閱讀約" in about:
        fail("About page incorrectly inherited article reading-time chrome")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

print("Site identity verification: PASS (HUIKAI + 澄心之遊, current About philosophy preserved)")
