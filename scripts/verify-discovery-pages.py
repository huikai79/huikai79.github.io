#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

from article_routing import routes

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []
LANGUAGE_PREFIXES = {"zh-TW": "", "zh-CN": "zh-cn"}
TAXONOMIES = ("categories", "formats", "tags")
# Preserve historical taxonomy identities/URLs while allowing reader-facing
# labels to follow the active language. These identities already exist in
# production and must not be silently renamed by display-only cleanup.
EXPECTED_TAG_LABELS = {
    "zh-TW": {
        "创业": "創業",
        "好文推荐": "好文推薦",
        "技术学习": "技術學習",
    },
    "zh-CN": {
        "创业": "创业",
        "好文推荐": "好文推荐",
    },
}


def fail(message: str) -> None:
    ERRORS.append(message)


def normalized_path(raw: str) -> str:
    path = unquote(urlsplit(raw).path).strip()
    if not path:
        return "/"
    return "/" + path.strip("/").lower() + "/"


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.hrefs: list[str] = []
        self.classes: set[str] = set()
        self.discovery_taxonomies: set[str] = set()
        self.discovery_links: list[tuple[str, str]] = []
        self.text_content: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        self.classes.update(data.get("class", "").split())
        taxonomy = data.get("data-discovery-taxonomy", "")
        if taxonomy:
            self.discovery_taxonomies.add(taxonomy)
        if tag.lower() == "a" and data.get("href"):
            self.hrefs.append(data["href"])
            kind = data.get("data-discovery-kind", "")
            if kind:
                self.discovery_links.append((kind, data["href"]))

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if text:
            self.text_content.append(text)


def parse_page(path: Path, label: str) -> PageParser | None:
    if not path.is_file() or path.stat().st_size == 0:
        fail(f"Missing rendered discovery page: {label} ({path})")
        return None
    parser = PageParser()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    parser.close()
    return parser


def front_matter(text: str) -> list[str]:
    lines = text.replace("\r\n", "\n").split("\n")
    if not lines or lines[0] != "---":
        return []
    try:
        closing = next(index for index in range(1, len(lines)) if lines[index] == "---")
    except StopIteration:
        return []
    return lines[1:closing]


def front_list(front: list[str], key: str) -> list[str]:
    prefix = f"{key}:"
    for line in front:
        if not line.startswith(prefix):
            continue
        try:
            value = json.loads(line[len(prefix):].strip())
        except json.JSONDecodeError:
            return []
        return [str(item) for item in value] if isinstance(value, list) else []
    return []


def front_scalar(front: list[str], key: str) -> str:
    prefix = f"{key}:"
    for line in front:
        if not line.startswith(prefix):
            continue
        raw = line[len(prefix):].strip()
        try:
            return str(json.loads(raw))
        except json.JSONDecodeError:
            return raw.strip('"').strip()
    return ""


def language_root(language: str) -> Path:
    prefix = LANGUAGE_PREFIXES.get(language)
    if prefix is None:
        raise ValueError(f"Unsupported discovery verifier language: {language}")
    return PUBLIC / prefix if prefix else PUBLIC


def expected_term_paths(root: Path, taxonomy: str) -> set[str]:
    directory = root / taxonomy
    if not directory.is_dir():
        return set()
    result: set[str] = set()
    for page in directory.glob("*/index.html"):
        # Hugo can emit translated/historical term shells with no content in
        # the active language. Explore intentionally lists active terms only,
        # so those empty shells must not be required as navigation entries.
        parser = PageParser()
        parser.feed(page.read_text(encoding="utf-8", errors="replace"))
        parser.close()
        article_prefix = "/posts/" if root == PUBLIC else f"/{root.relative_to(PUBLIC).as_posix()}/posts/"
        if not any(normalized_path(href).startswith(article_prefix) for href in parser.hrefs):
            continue
        relative = page.parent.relative_to(PUBLIC).as_posix()
        result.add("/" + relative.lower().strip("/") + "/")
    return result


def all_json_strings(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        result: list[str] = []
        for item in value:
            result.extend(all_json_strings(item))
        return result
    if isinstance(value, dict):
        result = []
        for item in value.values():
            result.extend(all_json_strings(item))
        return result
    return []


# Native Blowfish/Hugo discovery controls must stay enabled; the project should
# extend these capabilities rather than replace them with a parallel search or
# pagination implementation.
params_text = (ROOT / "config" / "_default" / "params.toml").read_text(encoding="utf-8")
hugo_text = (ROOT / "config" / "_default" / "hugo.toml").read_text(encoding="utf-8")
single_text = (ROOT / "layouts" / "_default" / "single.html").read_text(encoding="utf-8")
for token in ('enableSearch = true', 'showPagination = true', 'showRelatedContent = true'):
    if token not in params_text:
        fail(f"Native reader discovery control is disabled or missing: {token}")
if 'home = ["HTML", "RSS", "JSON"]' not in hugo_text:
    fail("Native search JSON output is not enabled for the language home pages")
if 'format = "formats"' not in hugo_text:
    fail("Reader-facing format taxonomy is not configured")
for token in ('partial "article-pagination.html"', 'partial "related.html"'):
    if token not in single_text:
        fail(f"Article discovery partial is missing: {token}")

home = parse_page(PUBLIC / "index.html", "homepage")
if home:
    home_paths = {normalized_path(href) for href in home.hrefs}
    for required in ("/projects/", "/explore/"):
        if required not in home_paths:
            fail(f"Homepage/navigation does not expose discovery route: {required}")

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

article_routes = routes()
by_language = {
    language: [route for route in article_routes if route.language == language]
    for language in LANGUAGE_PREFIXES
}

for language, language_routes in by_language.items():
    root = language_root(language)
    prefix = LANGUAGE_PREFIXES[language]
    explore_path = root / "explore" / "index.html"
    explore = parse_page(explore_path, f"{language} explore")
    if explore:
        if "explore-grid" not in explore.classes or "explore-topic" not in explore.classes:
            fail(f"{language} Explore page did not render the discovery hub")
        if not set(TAXONOMIES).issubset(explore.discovery_taxonomies):
            fail(
                f"{language} Explore page taxonomy groups are incomplete: "
                f"{sorted(explore.discovery_taxonomies)}"
            )
        explore_paths = {normalized_path(href) for href in explore.hrefs}
        for taxonomy in TAXONOMIES:
            terms = expected_term_paths(root, taxonomy)
            if not terms:
                fail(f"{language} taxonomy produced no active term pages: {taxonomy}")
            for expected in terms:
                if expected not in explore_paths:
                    fail(f"{language} Explore page is missing {taxonomy} term: {expected}")
        posts_path = f"/{prefix}/posts/" if prefix else "/posts/"
        if normalized_path(posts_path) not in explore_paths:
            fail(f"{language} Explore page must link back to the language-scoped posts index")

    for identity, display_label in EXPECTED_TAG_LABELS.get(language, {}).items():
        tag_page = root / "tags" / identity / "index.html"
        tag_parser = parse_page(tag_page, f"{language} tag identity:{identity}")
        if tag_parser is None:
            continue
        if display_label not in tag_parser.text_content:
            fail(
                f"{language} tag display label drifted without changing the historical identity: "
                f"identity={identity!r}, expected_label={display_label!r}"
            )
        expected_url = f"/{prefix}/tags/{identity}/" if prefix else f"/tags/{identity}/"
        # Historical term pages may be intentionally empty in one language;
        # their URL/label contract is verified independently of Explore.
        if not (root / "tags" / identity / "index.html").is_file():
            fail(f"Historical tag URL disappeared: {expected_url}")

    search_path = root / "index.json"
    if not search_path.is_file() or search_path.stat().st_size == 0:
        fail(f"{language} native search index is missing: {search_path}")
    else:
        try:
            search_data = json.loads(search_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            fail(f"{language} native search index is invalid JSON: {error}")
            search_data = []
        search_strings = "\n".join(all_json_strings(search_data))
        if not search_strings.strip():
            fail(f"{language} native search index is empty")
        for route in language_routes:
            source_front = front_matter(route.source.read_text(encoding="utf-8", errors="strict"))
            title = front_scalar(source_front, "title")
            if title and title not in search_strings:
                fail(f"{language} search index is missing routed article title: {title}")

for route in article_routes:
    source_front = front_matter(route.source.read_text(encoding="utf-8", errors="strict"))
    categories = front_list(source_front, "categories")
    formats = front_list(source_front, "formats")
    tags = front_list(source_front, "tags")
    entry_type = front_scalar(source_front, "entryType")
    if formats != ([entry_type] if entry_type else []):
        fail(
            f"Discovery format projection mismatch for {route.language}:{route.slug}: "
            f"entryType={entry_type!r}, formats={formats!r}"
        )

    rendered = route.rendered(PUBLIC)
    parser = parse_page(rendered, f"article discovery {route.language}:{route.slug}")
    if parser is None:
        continue
    links_by_kind: dict[str, list[str]] = {}
    for kind, href in parser.discovery_links:
        links_by_kind.setdefault(kind, []).append(normalized_path(href))

    expected_counts = {
        "category": len(categories),
        "format": len(formats),
        "tag": len(tags),
    }
    for kind, expected_count in expected_counts.items():
        actual = links_by_kind.get(kind, [])
        if len(actual) != expected_count:
            fail(
                f"Article discovery link count mismatch for {route.language}:{route.slug} "
                f"{kind}: rendered={len(actual)}, expected={expected_count}"
            )
        for href in actual:
            target = PUBLIC / href.strip("/") / "index.html"
            if not target.is_file():
                fail(
                    f"Article discovery link target is missing for {route.language}:{route.slug}: {href}"
                )
            prefix = LANGUAGE_PREFIXES.get(route.language, "")
            if prefix and not href.startswith(f"/{prefix}/"):
                fail(
                    f"Article discovery link escaped language scope for {route.language}:{route.slug}: {href}"
                )
            if not prefix and href.startswith("/zh-cn/"):
                fail(
                    f"Primary article discovery link leaked into secondary language: {route.slug} -> {href}"
                )

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

term_counts = {
    language: {
        taxonomy: len(expected_term_paths(language_root(language), taxonomy))
        for taxonomy in TAXONOMIES
    }
    for language in LANGUAGE_PREFIXES
}
print(
    "Reader discovery verification: PASS "
    f"(articles={len(article_routes)}, taxonomies={term_counts}, native search indexes=2)"
)
