#!/usr/bin/env python3
from __future__ import annotations

import sys
import tomllib
from html.parser import HTMLParser
from pathlib import Path

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public")
ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def read_required(path: Path, label: str) -> str:
    if not path.is_file() or path.stat().st_size == 0:
        fail(f"{label} is missing: {path}")
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def attrs_dict(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
    return {key.lower(): value or "" for key, value in attrs}


def normalize_config_path(value: str) -> str:
    return "/" + value.strip("/").lower() + "/"


class SiteParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.html_lang = ""
        self.meta_properties: set[str] = set()
        self.meta_names: set[str] = set()
        self.hrefs: list[str] = []
        self.ids: set[str] = set()
        self.classes: set[str] = set()
        self.section_stack: list[str] = []
        self.selected_paths: list[str] = []
        self.recent_paths: list[str] = []
        self.selected_images = 0
        self.recent_images = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = attrs_dict(attrs)
        tag = tag.lower()
        classes = set(data.get("class", "").split())
        self.classes.update(classes)

        element_id = data.get("id", "")
        if element_id:
            self.ids.add(element_id)

        if tag == "html":
            self.html_lang = data.get("lang", "")

        if tag == "meta":
            if data.get("property"):
                self.meta_properties.add(data["property"].lower())
            if data.get("name"):
                self.meta_names.add(data["name"].lower())

        if tag == "a" and data.get("href"):
            self.hrefs.append(data["href"])

        if tag == "section":
            self.section_stack.append(element_id)

        current_section = self.section_stack[-1] if self.section_stack else ""
        if current_section == "home-selected":
            if "home-selected-item" in classes and data.get("data-home-path"):
                self.selected_paths.append(data["data-home-path"])
            if tag == "img":
                self.selected_images += 1
        elif current_section == "home-recent":
            if "home-recent-row" in classes and data.get("data-home-path"):
                self.recent_paths.append(data["data-home-path"])
            if tag == "img":
                self.recent_images += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "section" and self.section_stack:
            self.section_stack.pop()


def parse_html(text: str) -> SiteParser:
    parser = SiteParser()
    parser.feed(text)
    parser.close()
    return parser


home = read_required(PUBLIC / "index.html", "Homepage output")
article = read_required(
    PUBLIC / "posts" / "how-to-be-an-expert" / "index.html",
    "Known article output",
)

if home:
    home_parser = parse_html(home)
    if home_parser.html_lang != "zh-CN":
        fail(f"Homepage language is not zh-CN: {home_parser.html_lang!r}")
    if "庄辉恺的个人博客" not in home:
        fail("Homepage site description is missing")
    if "og:image" not in home_parser.meta_properties:
        fail("Homepage Open Graph image metadata is missing")
    if "twitter:image" not in home_parser.meta_names:
        fail("Homepage Twitter image metadata is missing")
    if "HUIKAI" not in home:
        fail("Landing hero caption is missing")
    if "思考 AI、学习、阅读与生活" not in home:
        fail("Landing hero positioning text is missing")
    if not any(href.rstrip("/").endswith("/posts") for href in home_parser.hrefs):
        fail("Landing posts CTA is missing")
    if "home-selected" not in home_parser.ids:
        fail("Homepage section #home-selected is missing")
    if "home-recent" not in home_parser.ids:
        fail("Homepage section #home-recent is missing")

    config_path = ROOT / "data" / "homepage.toml"
    try:
        with config_path.open("rb") as handle:
            homepage_config = tomllib.load(handle)
    except Exception as error:
        homepage_config = {}
        fail(f"Unable to read {config_path}: {error}")

    selected_limit = int(homepage_config.get("selectedLimit", 3))
    recent_limit = int(homepage_config.get("recentLimit", 5))
    featured = homepage_config.get("featured", [])

    if len(featured) != selected_limit:
        fail(
            f"Homepage featured config must contain exactly {selected_limit} entries; "
            f"found {len(featured)}"
        )

    selected_paths = home_parser.selected_paths
    recent_paths = home_parser.recent_paths

    if len(selected_paths) != selected_limit:
        fail(f"Homepage Selected must render exactly {selected_limit} items; found {len(selected_paths)}")
    if len(recent_paths) != recent_limit:
        fail(f"Homepage Recent must render exactly {recent_limit} items; found {len(recent_paths)}")

    expected_selected = [normalize_config_path(path) for path in featured]
    actual_selected = [path.lower() for path in selected_paths]
    if actual_selected != expected_selected:
        fail(
            "Homepage Selected order does not match data/homepage.toml: "
            f"expected={expected_selected}, actual={actual_selected}"
        )

    overlap = sorted(set(actual_selected) & {path.lower() for path in recent_paths})
    if overlap:
        fail(f"Homepage Selected and Recent overlap: {overlap}")

    if home_parser.selected_images < selected_limit:
        fail("Every current Selected card must have a cover image before rotation is introduced")
    if home_parser.recent_images != 0:
        fail(f"Homepage Recent must remain image-free editorial rows; found {home_parser.recent_images} image(s)")

if article:
    article_parser = parse_html(article)
    if "scroll-to-top" not in article_parser.classes:
        fail("Scroll-to-top class is missing")
    if "scroll-to-top" not in article_parser.ids:
        fail("Scroll-to-top DOM id is missing")
    if "#the-top" not in article_parser.hrefs:
        fail("Scroll-to-top anchor target is missing")

for html_path in PUBLIC.rglob("*.html") if PUBLIC.exists() else []:
    rendered = html_path.read_text(encoding="utf-8", errors="replace")
    if "prod-files-secure.s3.us-west-2.amazonaws.com" in rendered:
        fail(f"Temporary Notion/S3 image URL remains in rendered site: {html_path}")
    if "<svg ..." in rendered:
        fail(f"Placeholder SVG markup remains in rendered site: {html_path}")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

print("Rendered-site verification: PASS")
