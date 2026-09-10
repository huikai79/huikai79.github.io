#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import tomllib
from html.parser import HTMLParser
from pathlib import Path

from article_routing import MANIFEST, routes

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
PARAMS = ROOT / "config" / "_default" / "params.toml"
GISCUS_CLIENT = "https://giscus.app/client.js"
TURNSTILE_CLIENT = "https://challenges.cloudflare.com/turnstile/v0/api.js"
TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA"
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


def scalar(front: list[str], key: str) -> str:
    raw = value_for(front, key)
    if raw is None:
        return ""
    try:
        return str(json.loads(raw)).strip()
    except json.JSONDecodeError:
        return raw.strip('"').strip()


class Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.giscus_scripts: list[dict[str, str]] = []
        self.giscus_containers: list[dict[str, str]] = []
        self.huikai_sections: list[dict[str, str]] = []
        self.huikai_scripts: list[dict[str, str]] = []
        self.turnstile_scripts: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        classes = set(data.get("class", "").split())
        if tag.lower() == "script":
            src = data.get("src", "")
            if src == GISCUS_CLIENT:
                self.giscus_scripts.append(data)
            if src.startswith(TURNSTILE_CLIENT):
                self.turnstile_scripts.append(data)
            if "huikai-comments" in src and src.endswith(".js"):
                self.huikai_scripts.append(data)
        if tag.lower() == "div" and "giscus-comments" in classes:
            self.giscus_containers.append(data)
        if tag.lower() == "section" and "huikai-comments" in classes:
            self.huikai_sections.append(data)


def parse_html(path: Path) -> Parser:
    parser = Parser()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    parser.close()
    return parser


manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
article_routes = routes(manifest)
with PARAMS.open("rb") as handle:
    params = tomllib.load(handle)

comments = params.get("comments", {}) if isinstance(params, dict) else {}
provider = str(comments.get("provider", "giscus")).strip().lower()
if provider not in {"giscus", "huikai"}:
    fail(f"unsupported comments provider: {provider!r}")

giscus = params.get("giscus", {}) if isinstance(params, dict) else {}
if provider == "giscus":
    if not bool(giscus.get("enabled", False)):
        fail("comments.provider=giscus requires giscus.enabled=true")
    for key in ["repo", "repoId", "category", "categoryId"]:
        if not str(giscus.get(key, "")).strip():
            fail(f"giscus enabled but {key} is empty")

api_base = str(comments.get("apiBase", "")).strip()
site_key = str(comments.get("turnstileSiteKey", "")).strip()
if provider == "huikai":
    if not api_base.startswith("/") or api_base.startswith("//"):
        fail("comments.provider=huikai requires a same-origin comments.apiBase")
    if not site_key:
        fail("comments.provider=huikai requires comments.turnstileSiteKey")
    if site_key == TURNSTILE_TEST_SITE_KEY and os.environ.get("COMMENTS_QA_ALLOW_TEST_KEYS") != "1":
        fail("Cloudflare Turnstile test site key must not be used in a production HUIKAI comments build")

seen_rendered: set[Path] = set()
enabled = 0
disabled = 0

for route in article_routes:
    if not route.source.is_file():
        fail(f"Routed source missing for comments verification: {route.source}")
        continue
    try:
        front = split_front(route.source.read_text(encoding="utf-8"))
    except Exception as error:
        fail(f"Unable to parse comments front matter for {route.slug}: {error}")
        continue

    visibility = scalar(front, "contentVisibility")
    should_enable = visibility == "Public"
    expected_key = f"notion:{route.page_id}"
    label = f"{route.language}:{route.slug}"
    show_comments = value_for(front, "showComments")
    comment_key_raw = value_for(front, "commentKey")

    if should_enable:
        enabled += 1
        if show_comments != "true":
            fail(f"Comments-enabled article must have showComments: true: {label}")
        if comment_key_raw is None:
            fail(f"Comments-enabled article is missing commentKey: {label}")
        else:
            try:
                actual_key = json.loads(comment_key_raw)
            except json.JSONDecodeError:
                actual_key = comment_key_raw.strip('"')
            if actual_key != expected_key:
                fail(f"Article commentKey mismatch for {label}: {actual_key!r} != {expected_key!r}")
    else:
        disabled += 1
        if show_comments is not None or comment_key_raw is not None:
            fail(f"Comments-disabled article must not retain comments fields: {label}")

    rendered = route.rendered(PUBLIC)
    seen_rendered.add(rendered.resolve())
    if not rendered.is_file():
        fail(f"Rendered article missing for comments verification: {label} -> {rendered}")
        continue
    parsed = parse_html(rendered)

    if not should_enable:
        if parsed.giscus_scripts or parsed.giscus_containers or parsed.huikai_sections or parsed.huikai_scripts or parsed.turnstile_scripts:
            fail(f"comments provider leaked into a disabled article: {label}")
        continue

    if provider == "giscus":
        if len(parsed.giscus_scripts) != 1 or len(parsed.giscus_containers) != 1:
            fail(f"Giscus must render exactly once for {label}")
            continue
        if parsed.huikai_sections or parsed.huikai_scripts or parsed.turnstile_scripts:
            fail(f"HUIKAI comments assets leaked into Giscus output: {label}")
        script = parsed.giscus_scripts[0]
        container = parsed.giscus_containers[0]
        expected = {
            "data-repo": str(giscus.get("repo", "")),
            "data-repo-id": str(giscus.get("repoId", "")),
            "data-category": str(giscus.get("category", "")),
            "data-category-id": str(giscus.get("categoryId", "")),
            "data-mapping": "specific",
            "data-term": expected_key,
            "data-strict": "1",
            "data-theme": "preferred_color_scheme",
            "data-lang": route.language,
        }
        for key, expected_value in expected.items():
            if script.get(key, "") != expected_value:
                fail(f"Rendered Giscus attribute mismatch for {label}: {key}")
        if container.get("data-comment-key", "") != expected_key:
            fail(f"Rendered Giscus comment key mismatch for {label}")

    if provider == "huikai":
        if parsed.giscus_scripts or parsed.giscus_containers:
            fail(f"Giscus leaked into HUIKAI comments output: {label}")
        if len(parsed.huikai_sections) != 1 or len(parsed.huikai_scripts) != 1 or len(parsed.turnstile_scripts) != 1:
            fail(f"HUIKAI comments assets must render exactly once for {label}")
            continue
        section = parsed.huikai_sections[0]
        expected_page_path = "/" + rendered.relative_to(PUBLIC).parent.as_posix().strip("/") + "/"
        for key, expected_value in {
            "data-comment-key": expected_key,
            "data-api-base": api_base,
            "data-turnstile-site-key": site_key,
            "data-page-path": expected_page_path,
        }.items():
            if section.get(key, "") != expected_value:
                fail(f"Rendered HUIKAI comments attribute mismatch for {label}: {key}")

actual_rendered = {path.resolve() for path in (PUBLIC / "posts").glob("*/index.html")}
actual_rendered.update(path.resolve() for path in (PUBLIC / "zh-cn" / "posts").glob("*/index.html"))
if actual_rendered != seen_rendered:
    fail(f"Rendered/manifest article mismatch for comments verification: expected={len(seen_rendered)}, actual={len(actual_rendered)}")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

print(f"Comments policy verification: PASS (provider={provider}, enabled={enabled}, disabled={disabled})")
