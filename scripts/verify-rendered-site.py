#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
import tomllib
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


def require(pattern: str, text: str, message: str, flags: int = 0) -> None:
    if not re.search(pattern, text, flags):
        fail(message)


def extract_section(html: str, section_id: str) -> str:
    match = re.search(
        rf'<section\b[^>]*\bid=["\']{re.escape(section_id)}["\'][^>]*>(.*?)</section>',
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if not match:
        fail(f"Homepage section #{section_id} is missing")
        return ""
    return match.group(1)


def normalize_config_path(value: str) -> str:
    return "/" + value.strip("/").lower() + "/"


home = read_required(PUBLIC / "index.html", "Homepage output")
article = read_required(
    PUBLIC / "posts" / "how-to-be-an-expert" / "index.html",
    "Known article output",
)

if home:
    require(r'<html\b[^>]*\blang=["\']zh-CN["\']', home, "Homepage language is not zh-CN", re.I)
    require(r'庄辉恺的个人博客', home, "Homepage site description is missing")
    require(r'property=["\']og:image["\']', home, "Homepage Open Graph image metadata is missing", re.I)
    require(r'name=["\']twitter:image["\']', home, "Homepage Twitter image metadata is missing", re.I)
    require(r'HUIKAI', home, "Landing hero caption is missing")
    require(r'思考 AI、学习、阅读与生活', home, "Landing hero positioning text is missing")
    require(r'href=["\'][^"\']*/posts/["\']', home, "Landing posts CTA is missing", re.I)

    selected = extract_section(home, "home-selected")
    recent = extract_section(home, "home-recent")

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

    selected_paths = re.findall(
        r'class=["\'][^"\']*\bhome-selected-item\b[^"\']*["\'][^>]*\bdata-home-path=["\']([^"\']+)["\']',
        selected,
        re.I,
    )
    recent_paths = re.findall(
        r'class=["\'][^"\']*\bhome-recent-row\b[^"\']*["\'][^>]*\bdata-home-path=["\']([^"\']+)["\']',
        recent,
        re.I,
    )

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

    if selected and len(re.findall(r'<img\b', selected, re.I)) < selected_limit:
        fail("Every current Selected card must have a cover image before rotation is introduced")
    if recent and re.search(r'<img\b', recent, re.I):
        fail("Homepage Recent must remain image-free editorial rows")

if article:
    require(r'class=["\'][^"\']*\bscroll-to-top\b', article, "Scroll-to-top class is missing", re.I)
    require(r'id=["\']scroll-to-top["\']', article, "Scroll-to-top DOM id is missing", re.I)
    require(r'href=["\']#the-top["\']', article, "Scroll-to-top anchor target is missing", re.I)

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
