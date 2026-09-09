#!/usr/bin/env python3
from __future__ import annotations

import sys
from html.parser import HTMLParser
from pathlib import Path

from article_routing import routes
from language_route_alias_contract import legacy_alias_plans

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
BASE = "https://huikai.com.kg"
ERRORS: list[str] = []


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lang = ""
        self.canonical = ""
        self.refresh = ""
        self.robots = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        if tag.lower() == "html":
            self.lang = data.get("lang", "")
        if tag.lower() == "link" and data.get("rel", "").lower() == "canonical":
            self.canonical = data.get("href", "")
        if tag.lower() == "meta":
            http_equiv = data.get("http-equiv", "").lower()
            name = data.get("name", "").lower()
            if http_equiv == "refresh":
                self.refresh = data.get("content", "")
            if name == "robots":
                self.robots = data.get("content", "")


def parse_page(path: Path, label: str) -> PageParser | None:
    if not path.is_file() or path.stat().st_size == 0:
        ERRORS.append(f"Missing rendered route: {label} ({path})")
        return None
    parser = PageParser()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    parser.close()
    return parser


article_routes = routes()
for plan in legacy_alias_plans(article_routes):
    route = plan.route
    legacy_path = f"/posts/{route.slug.lower()}/"
    legacy = PUBLIC / "posts" / route.slug.lower() / "index.html"
    parser = parse_page(legacy, legacy_path)
    if parser is None:
        continue

    if plan.preserves_canonical:
        owner = plan.primary_owner
        if owner is None:
            ERRORS.append(f"Alias plan lost canonical owner for {legacy_path}")
            continue
        if legacy.resolve() != owner.rendered(PUBLIC).resolve():
            ERRORS.append(
                f"Canonical route path mismatch for {legacy_path}: "
                f"expected {owner.rendered(PUBLIC)}"
            )
        expected_canonical = f"{BASE}{owner.permalink_path}"
        if parser.lang != "zh-TW":
            ERRORS.append(
                f"Canonical root route was replaced or has wrong language: "
                f"{legacy_path} lang={parser.lang!r}"
            )
        if parser.canonical != expected_canonical:
            ERRORS.append(
                f"Canonical root URL mismatch for {legacy_path}: "
                f"rendered={parser.canonical!r}, expected={expected_canonical!r}"
            )
        if parser.refresh:
            ERRORS.append(f"Canonical root route must not be a refresh redirect: {legacy_path}")
        if "noindex" in parser.robots.lower():
            ERRORS.append(f"Canonical root route must remain indexable: {legacy_path}")
        continue

    expected = f"{BASE}{route.permalink_path}"
    if parser.canonical != expected:
        ERRORS.append(
            f"Legacy alias target mismatch for {route.slug}: "
            f"rendered={parser.canonical!r}, expected={expected!r}"
        )
    if not parser.refresh or expected not in parser.refresh:
        ERRORS.append(f"Legacy alias refresh target mismatch for {route.slug}: expected {expected}")
    if "noindex" not in parser.robots.lower():
        ERRORS.append(f"Legacy alias must be noindex: {route.slug}")

# Final post-mutation guard: every real default-language article must still be
# an indexable zh-TW document after all legacy aliases have been written.
for route in article_routes:
    if route.language != "zh-TW":
        continue
    page = route.rendered(PUBLIC)
    parser = parse_page(page, f"canonical:{route.permalink_path}")
    if parser is None:
        continue
    expected = f"{BASE}{route.permalink_path}"
    if parser.lang != "zh-TW":
        ERRORS.append(f"Default-language article lang drifted after alias write: {route.slug}")
    if parser.canonical != expected:
        ERRORS.append(
            f"Default-language canonical drifted after alias write: "
            f"{route.slug} -> {parser.canonical!r}, expected {expected!r}"
        )
    if parser.refresh:
        ERRORS.append(f"Default-language article became a redirect after alias write: {route.slug}")
    if "noindex" in parser.robots.lower():
        ERRORS.append(f"Default-language article became noindex after alias write: {route.slug}")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)
print("Language route alias and post-mutation canonical verification: PASS")
