#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import tomllib
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
POSTS = ROOT / "content" / "posts"
MANIFEST = ROOT / ".notion-sync-manifest.json"
PARAMS = ROOT / "config" / "_default" / "params.toml"
COMMENTS_TAG = "技术学习"
GISCUS_CLIENT = "https://giscus.app/client.js"

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


def attrs_dict(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
    return {key.lower(): value or "" for key, value in attrs}


class CommentsParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.giscus_scripts: list[dict[str, str]] = []
        self.comment_containers: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = attrs_dict(attrs)
        tag = tag.lower()
        if tag == "script" and data.get("src") == GISCUS_CLIENT:
            self.giscus_scripts.append(data)
        if tag == "div" and "giscus-comments" in set(data.get("class", "").split()):
            self.comment_containers.append(data)


def parse_comments_html(text: str) -> CommentsParser:
    parser = CommentsParser()
    parser.feed(text)
    parser.close()
    return parser


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

if giscus_enabled:
    required = ["repo", "repoId", "category", "categoryId"]
    for key in required:
        if not str(giscus.get(key, "")).strip():
            fail(f"giscus enabled but {key} is empty")

rendered_by_slug: dict[str, Path] = {}
posts_output = PUBLIC / "posts"
if posts_output.is_dir():
    for rendered in sorted(posts_output.glob("*/index.html")):
        normalized = rendered.parent.name.lower()
        if normalized in rendered_by_slug:
            fail(f"Rendered article slug collision after URL normalization: {normalized}")
        rendered_by_slug[normalized] = rendered

source_slug_keys: dict[str, str] = {}
for index_file in sorted(POSTS.glob("*/index.md")):
    slug = index_file.parent.name
    normalized = slug.lower()
    if normalized in source_slug_keys and source_slug_keys[normalized] != slug:
        fail(f"Source slug collision after Hugo URL normalization: {source_slug_keys[normalized]} / {slug}")
    source_slug_keys[normalized] = slug

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
    technical = COMMENTS_TAG in tags

    if technical:
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

    rendered = rendered_by_slug.get(slug.lower())
    if rendered is None:
        fail(f"Rendered article missing for comments verification: {slug}")
        continue

    html = rendered.read_text(encoding="utf-8", errors="replace")
    parsed = parse_comments_html(html)

    if technical and giscus_enabled:
        if len(parsed.giscus_scripts) != 1:
            fail(f"Technical article must render exactly one giscus client script: {slug} (found {len(parsed.giscus_scripts)})")
            continue
        if len(parsed.comment_containers) != 1:
            fail(f"Technical article must render exactly one giscus comments container: {slug} (found {len(parsed.comment_containers)})")

        script = parsed.giscus_scripts[0]
        container = parsed.comment_containers[0]
        expected_attrs = {
            "data-repo": str(giscus.get("repo", "")),
            "data-repo-id": str(giscus.get("repoId", "")),
            "data-category": str(giscus.get("category", "")),
            "data-category-id": str(giscus.get("categoryId", "")),
            "data-mapping": "specific",
            "data-term": expected_key,
            "data-strict": "1",
            "data-reactions-enabled": "1",
            "data-emit-metadata": "0",
        }
        for key, expected in expected_attrs.items():
            actual = script.get(key, "")
            if actual != expected:
                fail(f"Rendered giscus attribute mismatch for {slug}: {key}={actual!r}, expected {expected!r}")
        if container.get("data-comment-key", "") != expected_key:
            fail(f"Rendered giscus container key mismatch for {slug}")
    else:
        if parsed.giscus_scripts or parsed.comment_containers:
            fail(f"giscus leaked into a disabled/non-technical article: {slug}")

if not technical_slugs:
    fail(f"No articles currently carry the required comments tag {COMMENTS_TAG!r}")

if len(rendered_by_slug) != len(source_slug_keys):
    fail(
        f"Rendered/source article count mismatch for comments verification: "
        f"rendered={len(rendered_by_slug)}, source={len(source_slug_keys)}"
    )

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

print(
    f"Comments policy verification: PASS (technical={len(technical_slugs)}, "
    f"nontechnical={len(nontechnical_slugs)}, giscus_enabled={str(giscus_enabled).lower()})"
)
