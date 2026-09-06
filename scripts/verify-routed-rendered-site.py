#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import tomllib
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

from article_routing import routes

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
RUNTIME = ROOT / "data" / "homepage_runtime.toml"
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


class Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lang = ""
        self.h1_count = 0
        self.hrefs: list[str] = []
        self.srcs: list[str] = []
        self.selected: list[str] = []
        self.recent: list[str] = []
        self.undefined = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        classes = set(data.get("class", "").split())
        if tag.lower() == "html": self.lang = data.get("lang", "")
        if tag.lower() == "h1": self.h1_count += 1
        if tag.lower() == "a" and data.get("href"): self.hrefs.append(data["href"])
        if tag.lower() in {"img", "script", "source", "video", "audio", "iframe"} and data.get("src"): self.srcs.append(data["src"])
        if tag.lower() == "link" and data.get("href"): self.srcs.append(data["href"])
        if "home-selected-item" in classes and data.get("data-home-path"): self.selected.append(data["data-home-path"])
        if "home-recent-row" in classes and data.get("data-home-path"): self.recent.append(data["data-home-path"])

    def handle_data(self, data: str) -> None:
        if data.strip() == "undefined": self.undefined = True


def parse(path: Path, label: str) -> Parser:
    parser = Parser()
    if not path.is_file():
        fail(f"Rendered page missing: {label} -> {path}")
        return parser
    parser.feed(path.read_text(encoding="utf-8", errors="replace")); parser.close()
    return parser


def local_target(page: Path, raw: str) -> Path | None:
    value = raw.strip()
    if not value or value.startswith(("#", "//", "mailto:", "tel:")): return None
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc: return None
    clean = unquote(parsed.path)
    if not clean: return None
    target = PUBLIC / clean.lstrip("/") if clean.startswith("/") else page.parent / clean
    if clean.endswith("/") or not target.suffix:
        target = target / "index.html"
    return target


article_routes = routes()
primary_routes = [route for route in article_routes if route.language == "zh-TW"]
secondary_routes = [route for route in article_routes if route.language == "zh-CN"]
if not article_routes:
    fail("Routed manifest contains no articles")

for route in article_routes:
    page = route.rendered(PUBLIC)
    parser = parse(page, f"{route.language}:{route.slug}")
    if parser.lang != route.language:
        fail(f"Rendered language mismatch for {route.slug}: {parser.lang!r} != {route.language!r}")
    if parser.h1_count != 1:
        fail(f"Article must render exactly one H1: {route.language}:{route.slug} -> {parser.h1_count}")
    if parser.undefined:
        fail(f"Article renders stray undefined text: {route.language}:{route.slug}")
    for raw in parser.srcs:
        target = local_target(page, raw)
        if target is not None and not target.exists():
            fail(f"Broken local asset on {route.language}:{route.slug}: {raw}")

home = parse(PUBLIC / "index.html", "zh-TW homepage")
if home.lang != "zh-TW": fail(f"Primary homepage lang mismatch: {home.lang!r}")
with RUNTIME.open("rb") as handle:
    runtime = tomllib.load(handle)
runtime_selected = runtime.get("selected", [])
expected_selected = [str(item.get("path", "")) for item in runtime_selected if isinstance(item, dict)]
actual_selected = [path.strip("/") for path in home.selected]
if [path.lower() for path in actual_selected] != [path.lower() for path in expected_selected]:
    fail(f"Primary homepage Selected mismatch: rendered={actual_selected}, runtime={expected_selected}")
primary_paths = {f"posts/{route.slug}".lower() for route in primary_routes}
for path in actual_selected + [value.strip("/") for value in home.recent]:
    if path.lower() not in primary_paths:
        fail(f"Primary homepage leaked a non-zh-TW article: {path}")

simplified = parse(PUBLIC / "zh-cn" / "index.html", "zh-CN homepage")
if simplified.lang != "zh-CN": fail(f"Secondary homepage lang mismatch: {simplified.lang!r}")
if simplified.selected or simplified.recent:
    fail("Secondary homepage must not reuse primary Selected/Recent rotation")

actual_primary = set((PUBLIC / "posts").glob("*/index.html"))
actual_secondary = set((PUBLIC / "zh-cn" / "posts").glob("*/index.html"))
expected_primary = {route.rendered(PUBLIC) for route in primary_routes}
expected_secondary = {route.rendered(PUBLIC) for route in secondary_routes}
if {p.resolve() for p in actual_primary} != {p.resolve() for p in expected_primary}:
    fail("Primary rendered article set differs from routed manifest")
if {p.resolve() for p in actual_secondary} != {p.resolve() for p in expected_secondary}:
    fail("Secondary rendered article set differs from routed manifest")

if ERRORS:
    for error in ERRORS: print(f"::error::{error}")
    raise SystemExit(1)
print(f"Routed rendered-site verification: PASS (zh-TW={len(primary_routes)}, zh-CN={len(secondary_routes)})")
