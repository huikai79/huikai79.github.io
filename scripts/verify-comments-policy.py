#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import tomllib
from html.parser import HTMLParser
from pathlib import Path

from article_routing import MANIFEST, routes

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
PARAMS = ROOT / "config" / "_default" / "params.toml"
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


def parse_scalar(front: list[str], key: str) -> str:
    raw = value_for(front, key)
    if raw is None:
        return ""
    try:
        return str(json.loads(raw)).strip()
    except json.JSONDecodeError:
        return raw.strip('"').strip()


def expected_comments(front: list[str]) -> tuple[bool, str]:
    visibility = parse_scalar(front, "contentVisibility")
    if not visibility:
        raise ValueError("contentVisibility is required for comments policy")
    return visibility == "Public", f"contentVisibility={visibility}"


class CommentsParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.giscus_scripts: list[dict[str, str]] = []
        self.comment_containers: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        tag = tag.lower()
        if tag == "script" and data.get("src") == GISCUS_CLIENT:
            self.giscus_scripts.append(data)
        if tag == "div" and "giscus-comments" in set(data.get("class", "").split()):
            self.comment_containers.append(data)


def parse_comments_html(text: str) -> CommentsParser:
    parser = CommentsParser(); parser.feed(text); parser.close(); return parser


manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
article_routes = routes(manifest)
with PARAMS.open("rb") as handle:
    params = tomllib.load(handle)
giscus = params.get("giscus", {}) if isinstance(params, dict) else {}
giscus_enabled = bool(giscus.get("enabled", False)) if isinstance(giscus, dict) else False
if giscus_enabled:
    for key in ["repo", "repoId", "category", "categoryId"]:
        if not str(giscus.get(key, "")).strip():
            fail(f"giscus enabled but {key} is empty")

enabled: list[str] = []
disabled: list[str] = []
policy_sources: dict[str, int] = {}
seen_rendered: set[Path] = set()

for route in article_routes:
    if not route.source.is_file():
        fail(f"Routed source missing for comments verification: {route.source}")
        continue
    try:
        front = split_front(route.source.read_text(encoding="utf-8"))
        should_enable, policy_source = expected_comments(front)
    except Exception as error:
        fail(f"Unable to parse comments front matter for {route.slug}: {error}")
        continue
    policy_sources[policy_source] = policy_sources.get(policy_source, 0) + 1
    show_comments = value_for(front, "showComments")
    comment_key_raw = value_for(front, "commentKey")
    expected_key = f"notion:{route.page_id}"
    label = f"{route.language}:{route.slug}"
    if should_enable:
        enabled.append(label)
        if show_comments != "true": fail(f"Comments-enabled article must have showComments: true: {label}")
        if comment_key_raw is None:
            fail(f"Comments-enabled article is missing commentKey: {label}")
        else:
            try: actual_key = json.loads(comment_key_raw)
            except json.JSONDecodeError: actual_key = comment_key_raw.strip('"')
            if actual_key != expected_key: fail(f"Article commentKey mismatch for {label}: {actual_key!r} != {expected_key!r}")
    else:
        disabled.append(label)
        if show_comments is not None or comment_key_raw is not None:
            fail(f"Comments-disabled article must not retain comments fields: {label}")

    rendered = route.rendered(PUBLIC)
    seen_rendered.add(rendered.resolve())
    if not rendered.is_file():
        fail(f"Rendered article missing for comments verification: {label} -> {rendered}")
        continue
    parsed = parse_comments_html(rendered.read_text(encoding="utf-8", errors="replace"))
    if should_enable and giscus_enabled:
        if len(parsed.giscus_scripts) != 1:
            fail(f"Comments-enabled article must render exactly one giscus client script: {label} (found {len(parsed.giscus_scripts)})")
            continue
        if len(parsed.comment_containers) != 1:
            fail(f"Comments-enabled article must render exactly one giscus comments container: {label} (found {len(parsed.comment_containers)})")
            continue
        script = parsed.giscus_scripts[0]; container = parsed.comment_containers[0]
        expected_attrs = {
            "data-repo": str(giscus.get("repo", "")), "data-repo-id": str(giscus.get("repoId", "")),
            "data-category": str(giscus.get("category", "")), "data-category-id": str(giscus.get("categoryId", "")),
            "data-mapping": "specific", "data-term": expected_key, "data-strict": "1",
            "data-reactions-enabled": "1", "data-emit-metadata": "0",
            "data-lang": route.language,
        }
        for key, expected_value in expected_attrs.items():
            actual = script.get(key, "")
            if actual != expected_value:
                fail(f"Rendered giscus attribute mismatch for {label}: {key}={actual!r}, expected {expected_value!r}")
        if container.get("data-comment-key", "") != expected_key:
            fail(f"Rendered giscus container key mismatch for {label}")
    elif parsed.giscus_scripts or parsed.comment_containers:
        fail(f"giscus leaked into a disabled article: {label}")

actual_rendered = set(path.resolve() for path in (PUBLIC / "posts").glob("*/index.html"))
actual_rendered.update(path.resolve() for path in (PUBLIC / "zh-cn" / "posts").glob("*/index.html"))
if actual_rendered != seen_rendered:
    fail(f"Rendered/manifest article mismatch for comments verification: expected={len(seen_rendered)}, actual={len(actual_rendered)}")

if ERRORS:
    for error in ERRORS: print(f"::error::{error}")
    raise SystemExit(1)
print(f"Comments policy verification: PASS (enabled={len(enabled)}, disabled={len(disabled)}, giscus_enabled={str(giscus_enabled).lower()}, sources={policy_sources})")
