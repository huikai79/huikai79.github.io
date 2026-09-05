#!/usr/bin/env python3
from __future__ import annotations

import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.hrefs: list[str] = []
        self.classes: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        self.classes.update(data.get("class", "").split())
        if tag.lower() == "a" and data.get("href"):
            self.hrefs.append(data["href"])


def parse_page(path: Path, label: str) -> PageParser | None:
    if not path.is_file() or path.stat().st_size == 0:
        fail(f"Missing rendered discovery page: {label} ({path})")
        return None
    parser = PageParser()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    parser.close()
    return parser


def normalized_path(raw: str) -> str:
    path = unquote(urlsplit(raw).path).strip()
    if not path:
        return "/"
    return "/" + path.strip("/").lower() + "/"


home = parse_page(PUBLIC / "index.html", "homepage")
if home:
    home_paths = {normalized_path(href) for href in home.hrefs}
    for required in ("/projects/", "/explore/"):
        if required not in home_paths:
            fail(f"Homepage/navigation does not expose Gate 5 route: {required}")

projects = parse_page(PUBLIC / "projects" / "index.html", "projects index")
source_projects = sorted((ROOT / "content" / "projects").glob("*/index.md"))
rendered_projects = sorted((PUBLIC / "projects").glob("*/index.html")) if (PUBLIC / "projects").exists() else []
if len(rendered_projects) != len(source_projects):
    fail(f"Rendered/source project count mismatch: rendered={len(rendered_projects)}, source={len(source_projects)}")
if projects:
    project_paths = {normalized_path(href) for href in projects.hrefs}
    for source in source_projects:
        expected = f"/projects/{source.parent.name.lower()}/"
        if expected not in project_paths:
            fail(f"Projects index does not link to project page: {expected}")

explore = parse_page(PUBLIC / "explore" / "index.html", "explore")
tag_outputs = sorted((PUBLIC / "tags").glob("*/index.html")) if (PUBLIC / "tags").exists() else []
if explore:
    if "explore-grid" not in explore.classes or "explore-topic" not in explore.classes:
        fail("Explore page did not render the dynamic topic hub")
    explore_paths = {normalized_path(href) for href in explore.hrefs}
    for tag in tag_outputs:
        expected = f"/tags/{tag.parent.name.lower()}/"
        if expected not in explore_paths:
            fail(f"Explore page is missing published topic: {expected}")
    if "/posts/" not in explore_paths:
        fail("Explore page must link back to the complete posts index")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

print(f"Discovery pages verification: PASS ({len(source_projects)} projects, {len(tag_outputs)} topics)")
