#!/usr/bin/env python3
from __future__ import annotations

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
        self.selected: list[dict[str, str]] = []
        self.recent: list[str] = []
        self.undefined = False
        self.rotation_key = ""
        self.rotation_index = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        classes = set(data.get("class", "").split())
        if tag.lower() == "html":
            self.lang = data.get("lang", "")
        if tag.lower() == "h1":
            self.h1_count += 1
        if tag.lower() == "a" and data.get("href"):
            self.hrefs.append(data["href"])
        if tag.lower() in {"img", "script", "source", "video", "audio", "iframe"} and data.get("src"):
            self.srcs.append(data["src"])
        if tag.lower() == "link" and data.get("href"):
            self.srcs.append(data["href"])
        if tag.lower() == "section" and data.get("id") == "home-selected":
            self.rotation_key = data.get("data-rotation-key", "")
            self.rotation_index = data.get("data-rotation-index", "")
        if "home-selected-item" in classes and data.get("data-home-path"):
            self.selected.append({
                "path": data["data-home-path"],
                "pageId": data.get("data-page-id", ""),
                "source": data.get("data-selection-source", ""),
            })
        if "home-recent-row" in classes and data.get("data-home-path"):
            self.recent.append(data["data-home-path"])

    def handle_data(self, data: str) -> None:
        if data.strip() == "undefined":
            self.undefined = True


def parse(path: Path, label: str) -> Parser:
    parser = Parser()
    if not path.is_file():
        fail(f"Rendered page missing: {label} -> {path}")
        return parser
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    parser.close()
    return parser


def local_target(page: Path, raw: str) -> Path | None:
    value = raw.strip()
    if not value or value.startswith(("#", "//", "mailto:", "tel:")):
        return None
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        return None
    clean = unquote(parsed.path)
    if not clean:
        return None
    target = PUBLIC / clean.lstrip("/") if clean.startswith("/") else page.parent / clean
    if clean.endswith("/") or not target.suffix:
        target = target / "index.html"
    return target


def runtime_for_language(runtime: dict[str, object], language: str) -> dict[str, object]:
    if language == "zh-TW":
        return runtime
    if language == "zh-CN":
        secondary = runtime.get("secondary", {})
        if isinstance(secondary, dict):
            return secondary
        fail("Homepage runtime secondary table is missing or invalid")
        return {}
    fail(f"Homepage runtime verifier does not support language: {language}")
    return {}


def verify_homepage(
    language: str,
    page: Path,
    language_routes,
    runtime: dict[str, object],
) -> None:
    parser = parse(page, f"{language} homepage")
    if parser.lang != language:
        fail(f"Homepage lang mismatch for {language}: {parser.lang!r}")

    selected = runtime.get("selected", [])
    if not isinstance(selected, list):
        fail(f"Homepage runtime selected must be an array for {language}")
        selected = []
    expected_count = int(runtime.get("selectedLimit", 0))
    if len(selected) != expected_count:
        fail(
            f"Homepage runtime Selected count mismatch for {language}: "
            f"selected={len(selected)}, selectedLimit={expected_count}"
        )
    if int(runtime.get("rotationSlots", 0)) > int(runtime.get("poolSize", 0)):
        fail(f"Homepage runtime rotationSlots exceeds poolSize for {language}")

    by_page_id = {route.page_id: route for route in language_routes}
    expected_selected: list[dict[str, str]] = []
    for item in selected:
        if not isinstance(item, dict):
            fail(f"Homepage runtime Selected item must be an object for {language}")
            continue
        page_id = str(item.get("pageId", ""))
        route = by_page_id.get(page_id)
        if route is None:
            fail(f"Homepage runtime references a non-{language} article: {page_id}")
            continue
        expected_selected.append({
            "path": route.permalink_path.lower(),
            "pageId": page_id,
            "source": str(item.get("source", "")),
        })

    actual_selected = [
        {
            "path": str(item.get("path", "")).lower(),
            "pageId": str(item.get("pageId", "")),
            "source": str(item.get("source", "")),
        }
        for item in parser.selected
    ]
    if actual_selected != expected_selected:
        fail(
            f"Homepage Selected mismatch for {language}: "
            f"rendered={actual_selected}, runtime={expected_selected}"
        )

    if expected_count > 0:
        if parser.rotation_key != str(runtime.get("rotationKey", "")):
            fail(f"Homepage rotationKey mismatch for {language}")
        if parser.rotation_index != str(runtime.get("rotationIndex", "")):
            fail(f"Homepage rotationIndex mismatch for {language}")
    elif parser.selected:
        fail(f"Homepage rendered Selected despite selectedLimit=0 for {language}")

    valid_paths = {route.permalink_path.lower() for route in language_routes}
    selected_paths = {item["path"] for item in actual_selected}
    for raw in parser.recent:
        path = raw.lower()
        if path not in valid_paths:
            fail(f"Homepage leaked a non-{language} article into Recent: {raw}")
        if path in selected_paths:
            fail(f"Homepage Selected/Recent overlap for {language}: {raw}")

    expected_recent = min(
        int(runtime.get("recentLimit", 5)),
        max(0, len(language_routes) - expected_count),
    )
    if len(parser.recent) != expected_recent:
        fail(
            f"Homepage Recent count mismatch for {language}: "
            f"rendered={len(parser.recent)}, expected={expected_recent}"
        )


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

with RUNTIME.open("rb") as handle:
    runtime_root = tomllib.load(handle)
verify_homepage(
    "zh-TW",
    PUBLIC / "index.html",
    primary_routes,
    runtime_for_language(runtime_root, "zh-TW"),
)
verify_homepage(
    "zh-CN",
    PUBLIC / "zh-cn" / "index.html",
    secondary_routes,
    runtime_for_language(runtime_root, "zh-CN"),
)

actual_primary = set((PUBLIC / "posts").glob("*/index.html"))
actual_secondary = set((PUBLIC / "zh-cn" / "posts").glob("*/index.html"))
expected_primary = {route.rendered(PUBLIC) for route in primary_routes}
expected_secondary = {route.rendered(PUBLIC) for route in secondary_routes}
if {p.resolve() for p in actual_primary} != {p.resolve() for p in expected_primary}:
    fail("Primary rendered article set differs from routed manifest")
if {p.resolve() for p in actual_secondary} != {p.resolve() for p in expected_secondary}:
    fail("Secondary rendered article set differs from routed manifest")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)
print(
    "Routed rendered-site verification: PASS "
    f"(zh-TW={len(primary_routes)}, zh-CN={len(secondary_routes)}, bilingual homepage governance)"
)
