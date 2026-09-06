#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


class Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lang = ""
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        if tag.lower() == "html":
            self.lang = data.get("lang", "")
        if tag.lower() == "a" and data.get("href"):
            self.hrefs.append(data["href"])


def read_html(path: Path, label: str) -> tuple[str, Parser]:
    if not path.is_file():
        fail(f"{label} is missing: {path}")
        return "", Parser()
    text = path.read_text(encoding="utf-8", errors="replace")
    parser = Parser()
    parser.feed(text)
    parser.close()
    return text, parser


hugo_config = (ROOT / "config" / "_default" / "hugo.toml").read_text(encoding="utf-8")
if 'defaultContentLanguage = "zh-TW"' not in hugo_config:
    fail("Traditional Chinese must remain the default content language")

for config_name, expected in (
    ("languages.zh-TW.toml", ('displayName = "繁體中文"', 'htmlCode = "zh-TW"', 'contentRole = "primary"')),
    ("languages.zh-CN.toml", ('displayName = "简体中文"', 'htmlCode = "zh-CN"', 'contentRole = "interface-only"')),
):
    path = ROOT / "config" / "_default" / config_name
    if not path.is_file():
        fail(f"Language configuration is missing: {config_name}")
        continue
    text = path.read_text(encoding="utf-8")
    for token in expected:
        if token not in text:
            fail(f"{config_name} is missing multilingual contract token: {token}")

required_rendered = [
    (PUBLIC / "index.html", "Traditional homepage"),
    (PUBLIC / "about" / "index.html", "Traditional About"),
    (PUBLIC / "explore" / "index.html", "Traditional Explore"),
    (PUBLIC / "posts" / "index.html", "Traditional posts index"),
    (PUBLIC / "projects" / "index.html", "Traditional projects index"),
    (PUBLIC / "projects" / "nutrient-hackathon" / "index.html", "Traditional Nutrient project"),
    (PUBLIC / "projects" / "website-publishing-system" / "index.html", "Traditional publishing project"),
    (PUBLIC / "zh-cn" / "index.html", "Simplified homepage"),
    (PUBLIC / "zh-cn" / "about" / "index.html", "Simplified About"),
    (PUBLIC / "zh-cn" / "explore" / "index.html", "Simplified Explore"),
    (PUBLIC / "zh-cn" / "posts" / "index.html", "Simplified posts index"),
    (PUBLIC / "zh-cn" / "projects" / "index.html", "Simplified projects index"),
    (PUBLIC / "zh-cn" / "projects" / "nutrient-hackathon" / "index.html", "Simplified Nutrient project"),
    (PUBLIC / "zh-cn" / "projects" / "website-publishing-system" / "index.html", "Simplified publishing project"),
]
for path, label in required_rendered:
    if not path.is_file():
        fail(f"{label} is missing: {path}")

traditional, traditional_parser = read_html(PUBLIC / "index.html", "Traditional homepage")
simplified, simplified_parser = read_html(PUBLIC / "zh-cn" / "index.html", "Simplified homepage")

if traditional_parser.lang != "zh-TW":
    fail(f"Traditional homepage lang mismatch: {traditional_parser.lang!r}")
if simplified_parser.lang != "zh-CN":
    fail(f"Simplified homepage lang mismatch: {simplified_parser.lang!r}")
if "莊輝愷" not in traditional or "思考 AI、學習、閱讀與生活" not in traditional:
    fail("Traditional homepage identity/copy is incomplete")
if "庄辉恺" not in simplified or "思考 AI、学习、阅读与生活" not in simplified:
    fail("Simplified homepage identity/copy is incomplete")

if not any(href.rstrip("/") == "/zh-cn" for href in traditional_parser.hrefs):
    fail("Traditional homepage does not expose the native Simplified Chinese translation link")
if not any(href == "/" for href in simplified_parser.hrefs):
    fail("Simplified homepage does not expose the native Traditional Chinese translation link")
for href in ("/zh-cn/posts/", "/zh-cn/projects/", "/zh-cn/about/"):
    if href not in simplified_parser.hrefs:
        fail(f"Simplified homepage is missing language-scoped CTA: {href}")

article_pages = sorted(
    path for path in (PUBLIC / "posts").glob("*/index.html")
    if path.parent.name
)
if len(article_pages) != 6:
    fail(f"Primary-language article count must remain 6 during foundation phase; found {len(article_pages)}")

simplified_article_pages = sorted((PUBLIC / "zh-cn" / "posts").glob("*/index.html")) if (PUBLIC / "zh-cn" / "posts").exists() else []
if simplified_article_pages:
    fail(
        "Simplified article routes must not be fabricated before Notion language mapping exists: "
        + ", ".join(str(path.relative_to(PUBLIC)) for path in simplified_article_pages)
    )

# Translated static pages should be recognized as translation pairs by Hugo/Blowfish.
for left, right in (
    (PUBLIC / "about" / "index.html", "/zh-cn/about/"),
    (PUBLIC / "projects" / "index.html", "/zh-cn/projects/"),
    (PUBLIC / "projects" / "website-publishing-system" / "index.html", "/zh-cn/projects/website-publishing-system/"),
):
    _, parser = read_html(left, str(left.relative_to(PUBLIC)))
    if right not in parser.hrefs:
        fail(f"Translated page does not expose its Simplified counterpart: {left} -> {right}")

# Keep the interface-only language honest: no Notion article module until article language metadata exists.
if 'id="home-selected"' in simplified or 'id="home-recent"' in simplified:
    fail("Simplified homepage must not mirror primary-language article selections before article translations exist")

# The generated Simplified posts section must survive every Notion sync rebuild.
expected_index = '---\ntitle: "文章"\ndescription: "庄辉恺的文章与笔记。"\n---\n'
source_index = ROOT / "content" / "posts" / "_index.zh-cn.md"
if not source_index.is_file() or source_index.read_text(encoding="utf-8") != expected_index:
    fail("Simplified posts section index is missing or nondeterministic")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

print("Multilingual site verification: PASS (zh-TW primary + zh-CN interface foundation)")
