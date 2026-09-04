#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
import tomllib
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
ROOT = Path(__file__).resolve().parents[1]
STRICT_CONTENT = os.environ.get("STRICT_CONTENT") == "1"
ERRORS: list[str] = []
WARNINGS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def warn(message: str) -> None:
    WARNINGS.append(message)


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
        self.srcs: list[str] = []
        self.ids: set[str] = set()
        self.classes: set[str] = set()
        self.section_stack: list[str] = []
        self.selected_paths: list[str] = []
        self.recent_paths: list[str] = []
        self.recent_images = 0
        self.selected_image_counts: dict[str, int] = {}
        self.div_depth = 0
        self.selected_item_depth: int | None = None
        self.selected_item_path = ""
        self.anchors: list[dict[str, object]] = []
        self.anchor_stack: list[dict[str, object]] = []
        self.h1_count = 0
        self.article_main_depth: int | None = None
        self.tag_depth = 0
        self.article_text: list[str] = []
        self.article_has_undefined = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = attrs_dict(attrs)
        tag = tag.lower()
        classes = set(data.get("class", "").split())
        self.classes.update(classes)
        self.tag_depth += 1

        if tag == "div":
            self.div_depth += 1

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

        if tag == "a":
            href = data.get("href", "")
            if href:
                self.hrefs.append(href)
            anchor: dict[str, object] = {"href": href, "text": []}
            self.anchors.append(anchor)
            self.anchor_stack.append(anchor)

        if tag in {"img", "script", "source", "video", "audio", "iframe"} and data.get("src"):
            self.srcs.append(data["src"])

        if tag == "link" and data.get("href"):
            self.srcs.append(data["href"])

        if tag == "section":
            self.section_stack.append(element_id)

        current_section = self.section_stack[-1] if self.section_stack else ""
        if current_section == "home-selected":
            if tag == "div" and "home-selected-item" in classes and data.get("data-home-path"):
                path = data["data-home-path"]
                self.selected_paths.append(path)
                self.selected_item_path = path
                self.selected_item_depth = self.div_depth
                self.selected_image_counts.setdefault(path, 0)
            if tag == "img" and self.selected_item_path:
                self.selected_image_counts[self.selected_item_path] += 1
        elif current_section == "home-recent":
            if "home-recent-row" in classes and data.get("data-home-path"):
                self.recent_paths.append(data["data-home-path"])
            if tag == "img":
                self.recent_images += 1

        if tag == "h1":
            self.h1_count += 1

        if tag == "article" and "article-main" in classes:
            self.article_main_depth = self.tag_depth

    def handle_data(self, data: str) -> None:
        if self.anchor_stack:
            self.anchor_stack[-1]["text"].append(data)

        if self.article_main_depth is not None:
            stripped = data.strip()
            if stripped:
                self.article_text.append(stripped)
                if stripped == "undefined":
                    self.article_has_undefined = True

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()

        if tag == "a" and self.anchor_stack:
            self.anchor_stack.pop()

        if tag == "section" and self.section_stack:
            self.section_stack.pop()

        if tag == "article" and self.article_main_depth == self.tag_depth:
            self.article_main_depth = None

        if tag == "div":
            if self.selected_item_depth == self.div_depth:
                self.selected_item_depth = None
                self.selected_item_path = ""
            self.div_depth = max(0, self.div_depth - 1)

        self.tag_depth = max(0, self.tag_depth - 1)


def parse_html(text: str) -> SiteParser:
    parser = SiteParser()
    parser.feed(text)
    parser.close()
    return parser


def anchor_text(anchor: dict[str, object]) -> str:
    return " ".join("".join(anchor["text"]).split())


def resolve_local_target(html_path: Path, raw: str) -> Path | None:
    value = raw.strip()
    if not value or value.startswith("#") or value.startswith("//"):
        return None

    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        return None

    clean = unquote(parsed.path)
    if not clean:
        return None

    if clean.startswith("/"):
        target = PUBLIC / clean.lstrip("/")
    else:
        target = html_path.parent / clean

    candidates = [target]
    if clean.endswith("/") or not target.suffix:
        candidates.append(target / "index.html")

    for candidate in candidates:
        if candidate.exists():
            return candidate

    return target


home = read_required(PUBLIC / "index.html", "Homepage output")
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

    hero_ctas = [
        anchor for anchor in home_parser.anchors
        if anchor_text(anchor) == "查看文章"
        and str(anchor.get("href", "")).rstrip("/").endswith("/posts")
    ]
    if len(hero_ctas) != 1:
        fail(f"Landing hero must contain exactly one 查看文章 CTA to /posts/; found {len(hero_ctas)}")

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
        fail(f"Homepage featured config must contain exactly {selected_limit} entries; found {len(featured)}")

    selected_paths = home_parser.selected_paths
    recent_paths = home_parser.recent_paths
    if len(selected_paths) != selected_limit:
        fail(f"Homepage Selected must render exactly {selected_limit} items; found {len(selected_paths)}")
    if len(recent_paths) != recent_limit:
        fail(f"Homepage Recent must render exactly {recent_limit} items; found {len(recent_paths)}")

    expected_selected = [normalize_config_path(path) for path in featured]
    actual_selected = [path.lower() for path in selected_paths]
    if actual_selected != expected_selected:
        fail(f"Homepage Selected order mismatch: expected={expected_selected}, actual={actual_selected}")

    overlap = sorted(set(actual_selected) & {path.lower() for path in recent_paths})
    if overlap:
        fail(f"Homepage Selected and Recent overlap: {overlap}")

    for configured, rendered in zip(featured, selected_paths):
        source_dir = ROOT / "content" / configured.strip("/")
        real_covers = [path for path in source_dir.glob("cover*") if path.is_file()]
        if not real_covers:
            fail(f"Selected article has no real local cover resource: {configured}")
        if home_parser.selected_image_counts.get(rendered, 0) < 1:
            fail(f"Selected card rendered without an image: {rendered}")

    if home_parser.recent_images != 0:
        fail(f"Homepage Recent must remain image-free; found {home_parser.recent_images} image(s)")

article_outputs = sorted((PUBLIC / "posts").glob("*/index.html")) if (PUBLIC / "posts").exists() else []
source_articles = sorted((ROOT / "content" / "posts").glob("*/index.md"))
if len(article_outputs) != len(source_articles):
    fail(f"Rendered/source article count mismatch: rendered={len(article_outputs)}, source={len(source_articles)}")

for article_path in article_outputs:
    rendered = read_required(article_path, f"Article output {article_path.parent.name}")
    if not rendered:
        continue
    parser = parse_html(rendered)
    if parser.h1_count != 1:
        fail(f"Article must render exactly one H1: {article_path} (found {parser.h1_count})")
    if not parser.article_text:
        fail(f"Article body is empty: {article_path}")
    if parser.article_has_undefined:
        message = f"Standalone converter sentinel 'undefined' rendered in article: {article_path}"
        if STRICT_CONTENT:
            fail(message)
        else:
            warn(message + " (legacy snapshot allowed only before closure sync)")
    if "scroll-to-top" not in parser.classes or "scroll-to-top" not in parser.ids or "#the-top" not in parser.hrefs:
        fail(f"Scroll-to-top contract is incomplete: {article_path}")

missing_links: list[str] = []
missing_assets: list[str] = []
for html_path in PUBLIC.rglob("*.html") if PUBLIC.exists() else []:
    rendered = html_path.read_text(encoding="utf-8", errors="replace")
    parser = parse_html(rendered)

    if "prod-files-secure.s3.us-west-2.amazonaws.com" in rendered:
        fail(f"Temporary Notion/S3 image URL remains in rendered site: {html_path}")
    if "<svg ..." in rendered:
        fail(f"Placeholder SVG markup remains in rendered site: {html_path}")

    for href in parser.hrefs:
        target = resolve_local_target(html_path, href)
        if target is not None and not target.exists() and not (target / "index.html").exists():
            missing_links.append(f"{html_path.relative_to(PUBLIC)} -> {href}")

    for src in parser.srcs:
        target = resolve_local_target(html_path, src)
        if target is not None and not target.exists():
            missing_assets.append(f"{html_path.relative_to(PUBLIC)} -> {src}")

for item in sorted(set(missing_links))[:20]:
    fail(f"Missing internal link target: {item}")
if len(set(missing_links)) > 20:
    fail(f"Additional missing internal links omitted: {len(set(missing_links)) - 20}")

for item in sorted(set(missing_assets))[:20]:
    fail(f"Missing internal asset: {item}")
if len(set(missing_assets)) > 20:
    fail(f"Additional missing internal assets omitted: {len(set(missing_assets)) - 20}")

for warning in WARNINGS:
    print(f"::warning::{warning}")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

print(f"Rendered-site verification: PASS ({len(article_outputs)} articles checked)")
