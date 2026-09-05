#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import json
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


def normalize_path(value: str) -> str:
    return "/" + value.strip("/").lower() + "/"


def iso_week_monday(value: str) -> dt.date:
    try:
        year_text, week_text = value.split("-W", 1)
        return dt.date.fromisocalendar(int(year_text), int(week_text), 1)
    except Exception as error:
        fail(f"Invalid homepage rotation week {value!r}: {error}")
        return dt.date(1970, 1, 5)


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
        self.selected_items: list[dict[str, str]] = []
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
        self.rotation_key = ""
        self.rotation_index = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = attrs_dict(attrs)
        tag = tag.lower()
        classes = set(data.get("class", "").split())
        self.classes.update(classes)
        self.tag_depth += 1

        if tag == "div":
            self.div_depth += 1
        if data.get("id"):
            self.ids.add(data["id"])
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
            self.section_stack.append(data.get("id", ""))
            if data.get("id") == "home-selected":
                self.rotation_key = data.get("data-rotation-key", "")
                self.rotation_index = data.get("data-rotation-index", "")

        current_section = self.section_stack[-1] if self.section_stack else ""
        if current_section == "home-selected":
            if tag == "div" and "home-selected-item" in classes and data.get("data-home-path"):
                item = {
                    "path": data["data-home-path"],
                    "pageId": data.get("data-page-id", ""),
                    "source": data.get("data-selection-source", ""),
                }
                self.selected_items.append(item)
                self.selected_item_path = item["path"]
                self.selected_item_depth = self.div_depth
                self.selected_image_counts.setdefault(item["path"], 0)
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
    target = (PUBLIC / clean.lstrip("/")) if clean.startswith("/") else (html_path.parent / clean)
    candidates = [target]
    if clean.endswith("/") or not target.suffix:
        candidates.append(target / "index.html")
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return target


def load_toml(path: Path, label: str) -> dict[str, object]:
    try:
        with path.open("rb") as handle:
            return tomllib.load(handle)
    except Exception as error:
        fail(f"Unable to read {label} {path}: {error}")
        return {}


home = read_required(PUBLIC / "index.html", "Homepage output")
if home:
    parser = parse_html(home)
    if parser.html_lang != "zh-CN":
        fail(f"Homepage language is not zh-CN: {parser.html_lang!r}")
    if "og:image" not in parser.meta_properties:
        fail("Homepage Open Graph image metadata is missing")
    if "twitter:image" not in parser.meta_names:
        fail("Homepage Twitter image metadata is missing")
    if "HUIKAI" not in home:
        fail("Landing hero caption is missing")
    if "思考 AI、学习、阅读与生活" not in home:
        fail("Landing hero positioning text is missing")

    hero_ctas = [
        anchor for anchor in parser.anchors
        if anchor_text(anchor) == "查看文章"
        and str(anchor.get("href", "")).rstrip("/").endswith("/posts")
    ]
    if len(hero_ctas) != 1:
        fail(f"Landing hero must contain exactly one 查看文章 CTA to /posts/; found {len(hero_ctas)}")
    if "home-selected" not in parser.ids or "home-recent" not in parser.ids:
        fail("Homepage Selected/Recent section contract is incomplete")

    config = load_toml(ROOT / "data" / "homepage.toml", "homepage config")
    runtime = load_toml(ROOT / "data" / "homepage_runtime.toml", "homepage runtime")
    try:
        manifest = json.loads((ROOT / ".notion-sync-manifest.json").read_text(encoding="utf-8"))
    except Exception as error:
        manifest = {"pages": {}}
        fail(f"Unable to read Notion manifest: {error}")

    selected_limit = int(config.get("selectedLimit", 3))
    recent_limit = int(config.get("recentLimit", 5))
    pinned = config.get("pinned", [])
    pool = config.get("rotationPool", [])
    runtime_selected = runtime.get("selected", [])
    if not isinstance(pinned, list) or not isinstance(pool, list) or not isinstance(runtime_selected, list):
        fail("Homepage pinned, rotationPool and runtime selected values must be arrays")
        pinned, pool, runtime_selected = [], [], []

    rotation_slots = selected_limit - len(pinned)
    if rotation_slots < 0:
        fail("Homepage pinned count exceeds selectedLimit")
    if rotation_slots > 0 and len(pool) < rotation_slots:
        fail("Homepage rotationPool is too small for the configured rotating slots")
    if len(runtime_selected) != selected_limit:
        fail(f"Homepage runtime must contain exactly {selected_limit} Selected entries; found {len(runtime_selected)}")

    manifest_pages = manifest.get("pages", {}) if isinstance(manifest, dict) else {}
    configured_ids: set[str] = set()
    pool_ids: list[str] = []
    for label, items in (("pinned", pinned), ("rotationPool", pool)):
        for index, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                fail(f"Homepage {label} entry #{index} must be a table")
                continue
            page_id = str(item.get("pageId", "")).strip()
            if not page_id:
                fail(f"Homepage {label} entry #{index} is missing pageId")
                continue
            if page_id in configured_ids:
                fail(f"Homepage pageId is duplicated across pinned/pool: {page_id}")
            configured_ids.add(page_id)
            if page_id not in manifest_pages:
                fail(f"Homepage {label} pageId is not Published in Notion manifest: {page_id}")
            if label == "rotationPool":
                pool_ids.append(page_id)

    key = str(runtime.get("rotationKey", ""))
    epoch = str(runtime.get("rotationEpoch", config.get("rotationEpoch", "")))
    runtime_index = int(runtime.get("rotationIndex", 0))
    delta_days = (iso_week_monday(key) - iso_week_monday(epoch)).days
    expected_index = delta_days // 7 if delta_days % 7 == 0 else 0
    if runtime_index != expected_index:
        fail(f"Homepage rotation index mismatch: runtime={runtime_index}, expected={expected_index}")
    if parser.rotation_key != key or parser.rotation_index != str(runtime_index):
        fail("Rendered homepage rotation metadata does not match committed runtime state")

    expected_runtime: list[dict[str, str]] = []
    for item in pinned:
        page_id = str(item.get("pageId", ""))
        manifest_entry = manifest_pages.get(page_id, {})
        expected_runtime.append({"pageId": page_id, "path": f"posts/{manifest_entry.get('slug', '')}", "source": "pinned"})
    if rotation_slots > 0 and pool_ids:
        offset = (expected_index * rotation_slots) % len(pool_ids)
        if int(runtime.get("poolOffset", -1)) != offset:
            fail(f"Homepage pool offset mismatch: runtime={runtime.get('poolOffset')}, expected={offset}")
        for slot in range(rotation_slots):
            page_id = pool_ids[(offset + slot) % len(pool_ids)]
            manifest_entry = manifest_pages.get(page_id, {})
            expected_runtime.append({"pageId": page_id, "path": f"posts/{manifest_entry.get('slug', '')}", "source": "rotationPool"})

    normalized_runtime = [
        {
            "pageId": str(item.get("pageId", "")),
            "path": str(item.get("path", "")),
            "source": str(item.get("source", "")),
        }
        for item in runtime_selected if isinstance(item, dict)
    ]
    if normalized_runtime != expected_runtime:
        fail(f"Committed homepage runtime selection is not deterministic: expected={expected_runtime}, actual={normalized_runtime}")

    rendered_selected = parser.selected_items
    if len(rendered_selected) != selected_limit:
        fail(f"Homepage Selected must render exactly {selected_limit} items; found {len(rendered_selected)}")
    if len(parser.recent_paths) != recent_limit:
        fail(f"Homepage Recent must render exactly {recent_limit} items; found {len(parser.recent_paths)}")

    expected_rendered = [
        {"path": normalize_path(item["path"]), "pageId": item["pageId"], "source": item["source"]}
        for item in expected_runtime
    ]
    actual_rendered = [
        {"path": item["path"].lower(), "pageId": item["pageId"], "source": item["source"]}
        for item in rendered_selected
    ]
    if actual_rendered != expected_rendered:
        fail(f"Rendered Selected does not match runtime state: expected={expected_rendered}, actual={actual_rendered}")

    selected_paths = {item["path"] for item in actual_rendered}
    overlap = sorted(selected_paths & {path.lower() for path in parser.recent_paths})
    if overlap:
        fail(f"Homepage Selected and Recent overlap: {overlap}")
    if parser.recent_images != 0:
        fail(f"Homepage Recent must remain image-free; found {parser.recent_images} image(s)")

    for item in expected_runtime:
        source_dir = ROOT / "content" / item["path"]
        covers = [path for path in source_dir.glob("cover*") if path.is_file()]
        if not covers:
            fail(f"Selected article has no real local cover: {item['path']}")
        rendered_path = normalize_path(item["path"])
        if parser.selected_image_counts.get(rendered_path, 0) < 1:
            fail(f"Selected card rendered without an image: {rendered_path}")

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
            warn(message)
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