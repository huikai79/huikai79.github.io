#!/usr/bin/env python3
from __future__ import annotations

import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


# Source cleanup contracts.
for legacy in (
    ROOT / "layouts/partials/article/pagination.html",
    ROOT / "layouts/partials/article/related.html",
):
    if legacy.exists():
        fail(f"Legacy article partial still exists after Gate 7: {legacy.relative_to(ROOT)}")

params = (ROOT / "config/_default/params.toml").read_text(encoding="utf-8")
if "customCSS" in params:
    fail("Obsolete Blowfish assets.customCSS configuration remains")

head_hook = ROOT / "layouts/partials/extend-head-uncached.html"
if not head_hook.is_file():
    fail("404 metadata hook is missing")
else:
    hook = head_hook.read_text(encoding="utf-8")
    if 'eq .RelPermalink "/404.html"' not in hook:
        fail("404 metadata hook must be scoped only to /404.html")
    if 'name="robots" content="noindex,follow"' not in hook:
        fail("404 metadata hook must emit noindex,follow")

for root in (ROOT / "layouts", ROOT / "assets/css", ROOT / "config"):
    if not root.exists():
        continue
    for path in root.rglob("*"):
        if path.is_file():
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            if "mt-13" in text:
                fail(f"Legacy mt-13 spacing token remains: {path.relative_to(ROOT)}")


class HeadParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.robots: list[str] = []
        self.canonicals: list[str] = []
        self.h1_count = 0
        self.h1_text: list[str] = []
        self._in_h1 = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        tag = tag.lower()
        if tag == "meta" and data.get("name", "").lower() == "robots":
            self.robots.append(data.get("content", ""))
        if tag == "link" and "canonical" in data.get("rel", "").lower().split():
            self.canonicals.append(data.get("href", ""))
        if tag == "h1":
            self.h1_count += 1
            self._in_h1 = True

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "h1":
            self._in_h1 = False

    def handle_data(self, data: str) -> None:
        if self._in_h1:
            self.h1_text.append(data)


# Rendered 404 contract.
page404 = PUBLIC / "404.html"
if not page404.is_file():
    fail("Rendered 404.html is missing")
else:
    parser = HeadParser()
    parser.feed(page404.read_text(encoding="utf-8", errors="replace"))
    parser.close()
    normalized_robots = [value.replace(" ", "").lower() for value in parser.robots]
    if normalized_robots.count("noindex,follow") != 1:
        fail(f"404 must contain exactly one robots noindex,follow meta tag: {parser.robots}")
    if len(parser.canonicals) != 1 or not parser.canonicals[0].endswith("/404.html"):
        fail(f"404 canonical metadata is invalid: {parser.canonicals}")
    if parser.h1_count != 1:
        fail(f"404 must render exactly one H1; found {parser.h1_count}")
    if "找不到網頁" not in " ".join(parser.h1_text):
        fail("404 visible heading is not localized")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

print("Gate 7 cleanup verification: PASS")
