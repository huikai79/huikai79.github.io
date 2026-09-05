#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
POSTS = ROOT / "content" / "posts"
MANIFEST = ROOT / ".notion-sync-manifest.json"
PARAMS = ROOT / "config" / "_default" / "params.toml"
COMMENTS_TAG = "技术学习"

ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def split_front(text: str) -> list[str]:
    lines = text.replace("\r\n", "\n").split("\n")
    if not lines or lines[0].strip() != "---":
        raise ValueError("missing opening front matter")
    closing = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if closing is None:
        raise ValueError("missing closing front matter")
    return lines[1:closing]


def value_for(front: list[str], key: str) -> str | None:
    prefix = f"{key}:"
    for line in front:
        if line.startswith(prefix):
            return line.split(":", 1)[1].strip()
    return None


def parse_tags(front: list[str]) -> list[str]:
    raw = value_for(front, "tags")
    if raw is None:
        return []
    parsed = json.loads(raw)
    if not isinstance(parsed, list):
        raise ValueError("tags is not a list")
    return [str(item) for item in parsed]


manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
pages = manifest.get("pages", {}) if isinstance(manifest, dict) else {}
slug_to_page_id = {
    str(entry.get("slug", "")): page_id
    for page_id, entry in pages.items()
    if isinstance(entry, dict) and entry.get("slug")
}

with PARAMS.open("rb") as handle:
    params = tomllib.load(handle)
giscus = params.get("giscus", {}) if isinstance(params, dict) else {}
giscus_enabled = bool(giscus.get("enabled", False)) if isinstance(giscus, dict) else False

technical_slugs: list[str] = []
nontechnical_slugs: list[str] = []

for index_file in sorted(POSTS.glob("*/index.md")):
    slug = index_file.parent.name
    page_id = slug_to_page_id.get(slug)
    if not page_id:
        fail(f"No Notion page ID found for comments policy: {slug}")
        continue

    try:
        front = split_front(index_file.read_text(encoding="utf-8"))
        tags = parse_tags(front)
    except Exception as error:
        fail(f"Unable to parse comments front matter for {slug}: {error}")
        continue

    show_comments = value_for(front, "showComments")
    comment_key_raw = value_for(front, "commentKey")
    expected_key = f"notion:{page_id}"

    if COMMENTS_TAG in tags:
        technical_slugs.append(slug)
        if show_comments != "true":
            fail(f"Technical article must have showComments: true: {slug}")
        if comment_key_raw is None:
            fail(f"Technical article is missing commentKey: {slug}")
        else:
            try:
                actual_key = json.loads(comment_key_raw)
            except json.JSONDecodeError:
                actual_key = comment_key_raw.strip('"')
            if actual_key != expected_key:
                fail(f"Technical article commentKey mismatch for {slug}: {actual_key!r} != {expected_key!r}")
    else:
        nontechnical_slugs.append(slug)
        if show_comments is not None or comment_key_raw is not None:
            fail(f"Non-technical article must not retain comments fields: {slug}")

for slug in technical_slugs + nontechnical_slugs:
    rendered = PUBLIC / "posts" / slug / "index.html"
    if not rendered.is_file():
        fail(f"Rendered article missing for comments verification: {slug}")
        continue
    html = rendered.read_text(encoding="utf-8", errors="replace")
    has_giscus = "https://giscus.app/client.js" in html

    if slug in technical_slugs and giscus_enabled:
        if not has_giscus:
            fail(f"Enabled technical article did not render giscus: {slug}")
        page_id = slug_to_page_id[slug]
        expected = f'data-term="notion:{page_id}"'
        if expected not in html:
            fail(f"Rendered giscus term does not use stable Notion page ID: {slug}")
        if 'data-mapping="specific"' not in html or 'data-strict="1"' not in html:
            fail(f"Rendered giscus mapping contract is incomplete: {slug}")
    else:
        if has_giscus:
            fail(f"giscus leaked into a disabled/non-technical article: {slug}")

if giscus_enabled:
    required = ["repo", "repoId", "category", "categoryId"]
    for key in required:
        if not str(giscus.get(key, "")).strip():
            fail(f"giscus enabled but {key} is empty")

if not technical_slugs:
    fail(f"No articles currently carry the required comments tag {COMMENTS_TAG!r}")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

print(
    f"Comments policy verification: PASS (technical={len(technical_slugs)}, "
    f"nontechnical={len(nontechnical_slugs)}, giscus_enabled={str(giscus_enabled).lower()})"
)
