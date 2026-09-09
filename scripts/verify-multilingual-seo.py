#!/usr/bin/env python3
from __future__ import annotations

import sys
from html.parser import HTMLParser
from pathlib import Path

from article_routing import routes

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
BASE = "https://huikai.com.kg"
ERRORS: list[str] = []


class HeadParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.canonical = ""
        self.alternates: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "link":
            return
        data = {key.lower(): value or "" for key, value in attrs}
        rel = {item.lower() for item in data.get("rel", "").split()}
        if "canonical" in rel:
            self.canonical = data.get("href", "")
        if "alternate" in rel and data.get("hreflang"):
            self.alternates[data["hreflang"]] = data.get("href", "")


def parse(path: Path, label: str) -> HeadParser | None:
    if not path.is_file():
        ERRORS.append(f"Missing multilingual SEO page: {label} -> {path}")
        return None
    parser = HeadParser()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    parser.close()
    return parser


article_routes = routes()
groups: dict[str, list[object]] = {}
for route in article_routes:
    groups.setdefault(route.translation_group, []).append(route)

for route in article_routes:
    parser = parse(route.rendered(PUBLIC), f"{route.language}:{route.slug}")
    if parser is None:
        continue

    expected_canonical = f"{BASE}{route.permalink_path}"
    if parser.canonical != expected_canonical:
        ERRORS.append(
            f"Article canonical mismatch: {route.language}:{route.slug} "
            f"rendered={parser.canonical!r}, expected={expected_canonical!r}"
        )

    members = groups.get(route.translation_group, [])
    if len(members) <= 1:
        # A page with no real counterpart must not advertise a fabricated
        # article translation. Other alternate link types are ignored because
        # this parser records only links carrying hreflang.
        unexpected = {
            lang: href
            for lang, href in parser.alternates.items()
            if "/posts/" in href
        }
        if unexpected:
            ERRORS.append(
                f"Unpaired article advertises hreflang counterpart: "
                f"{route.language}:{route.slug} -> {unexpected}"
            )
        continue

    expected_alternates = {
        member.language: f"{BASE}{member.permalink_path}"
        for member in members
    }
    actual = {
        lang: href
        for lang, href in parser.alternates.items()
        if lang in expected_alternates
    }
    if actual != expected_alternates:
        ERRORS.append(
            f"Translation hreflang mismatch for group {route.translation_group}: "
            f"page={route.language}:{route.slug}, rendered={actual}, expected={expected_alternates}"
        )

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

print("Multilingual SEO verification: PASS (canonical + real-counterpart hreflang)")
