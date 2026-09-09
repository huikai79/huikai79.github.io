#!/usr/bin/env python3
from __future__ import annotations

import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

from article_routing import routes

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
ERRORS: list[str] = []

# Notion keeps one editorial taxonomy vocabulary. Reader-facing Simplified
# labels are localized at the Hugo term layer so stable taxonomy identities and
# existing URLs do not fork merely because the glyph form changes.
ZH_CN_LABELS: dict[str, dict[str, str]] = {
    "categories": {
        "科技": "科技",
        "學習": "学习",
        "創作": "创作",
        "生活": "生活",
    },
    "formats": {
        "文章": "文章",
        "札記": "札记",
        "紀錄": "纪录",
    },
    "tags": {
        "AI": "AI",
        "Hackathon": "Hackathon",
        "創業": "创业",
        "教育": "教育",
        "寫作": "写作",
        # Historical term identities remain valid aliases/entry points.
        "创业": "创业",
        "好文推荐": "好文推荐",
        "技术学习": "技术学习",
    },
}
SINGULAR_TO_PLURAL = {
    "category": "categories",
    "format": "formats",
    "tag": "tags",
}


def normalized_text(parts: list[str]) -> str:
    return " ".join("".join(parts).split())


def taxonomy_from_href(href: str) -> tuple[str, str] | None:
    path = unquote(urlsplit(href).path)
    pieces = [piece for piece in path.split("/") if piece]
    if pieces and pieces[0].lower() == "zh-cn":
        pieces = pieces[1:]
    if len(pieces) < 2:
        return None
    taxonomy, identity = pieces[0], pieces[1]
    if taxonomy not in ZH_CN_LABELS:
        return None
    return taxonomy, identity


def expected_label(taxonomy: str, identity: str) -> str:
    labels = ZH_CN_LABELS[taxonomy]
    if identity not in labels:
        ERRORS.append(
            f"Unknown zh-CN taxonomy identity requires an explicit localization decision: "
            f"{taxonomy}/{identity}"
        )
        return identity
    return labels[identity]


class ReaderParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.discovery_links: list[tuple[str, str, str]] = []
        self.explore_links: list[tuple[str, str, str]] = []
        self.h1_parts: list[str] = []
        self._h1_depth = 0
        self._active_link: dict[str, object] | None = None
        self._explore_name_depth = 0
        self._taxonomy_sections: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        classes = set(data.get("class", "").split())
        if tag.lower() == "h1":
            self._h1_depth += 1
        if tag.lower() == "section":
            self._taxonomy_sections.append(data.get("data-discovery-taxonomy", ""))
        if (
            tag.lower() == "span"
            and "explore-topic-name" in classes
            and self._active_link is not None
            and self._active_link.get("target") == "explore"
        ):
            self._explore_name_depth += 1
        if tag.lower() != "a" or not data.get("href"):
            return
        kind = data.get("data-discovery-kind", "")
        if kind:
            plural = SINGULAR_TO_PLURAL.get(kind)
            if plural is None:
                ERRORS.append(f"Unknown article discovery taxonomy kind: {kind}")
                plural = kind
            self._active_link = {
                "target": "article",
                "kind": plural,
                "href": data["href"],
                "parts": [],
            }
        elif "explore-topic" in classes and self._taxonomy_sections:
            taxonomy = self._taxonomy_sections[-1]
            if taxonomy:
                self._active_link = {
                    "target": "explore",
                    "kind": taxonomy,
                    "href": data["href"],
                    "parts": [],
                }

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "h1" and self._h1_depth:
            self._h1_depth -= 1
        if tag.lower() == "span" and self._explore_name_depth:
            self._explore_name_depth -= 1
        if tag.lower() == "a" and self._active_link is not None:
            target = str(self._active_link["target"])
            record = (
                str(self._active_link["kind"]),
                str(self._active_link["href"]),
                normalized_text(list(self._active_link["parts"])),
            )
            if target == "article":
                self.discovery_links.append(record)
            else:
                self.explore_links.append(record)
            self._active_link = None
            self._explore_name_depth = 0
        if tag.lower() == "section" and self._taxonomy_sections:
            self._taxonomy_sections.pop()

    def handle_data(self, data: str) -> None:
        if self._h1_depth:
            self.h1_parts.append(data)
        if self._active_link is None:
            return
        target = str(self._active_link["target"])
        if target == "explore" and not self._explore_name_depth:
            return
        parts = self._active_link["parts"]
        if isinstance(parts, list):
            parts.append(data)

    @property
    def h1(self) -> str:
        return normalized_text(self.h1_parts)


def parse(path: Path, label: str) -> ReaderParser | None:
    if not path.is_file():
        ERRORS.append(f"Missing rendered page for taxonomy localization: {label} -> {path}")
        return None
    parser = ReaderParser()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    parser.close()
    return parser


def verify_link(kind: str, href: str, rendered_label: str, context: str) -> None:
    parsed = taxonomy_from_href(href)
    if parsed is None:
        ERRORS.append(f"Unable to resolve taxonomy link in {context}: {kind} {href}")
        return
    taxonomy, identity = parsed
    if taxonomy != kind:
        ERRORS.append(
            f"Taxonomy kind/path mismatch in {context}: kind={kind}, href={href}"
        )
        return
    expected = expected_label(taxonomy, identity)
    if rendered_label != expected:
        ERRORS.append(
            f"zh-CN taxonomy label mismatch in {context}: {taxonomy}/{identity} "
            f"rendered={rendered_label!r}, expected={expected!r}"
        )


# Article context chips must use localized reader labels while their href keeps
# the stable canonical taxonomy identity.
for route in routes():
    if route.language != "zh-CN":
        continue
    parser = parse(route.rendered(PUBLIC), f"article:{route.slug}")
    if parser is None:
        continue
    for kind, href, label in parser.discovery_links:
        verify_link(kind, href, label, f"article:{route.slug}")

# Explore uses the same term pages and must present the same localized labels.
explore = parse(PUBLIC / "zh-cn" / "explore" / "index.html", "zh-CN Explore")
if explore is not None:
    for kind, href, label in explore.explore_links:
        verify_link(kind, href, label, "zh-CN Explore")

        parsed = taxonomy_from_href(href)
        if parsed is None:
            continue
        taxonomy, identity = parsed
        term_path = PUBLIC / unquote(urlsplit(href).path).lstrip("/") / "index.html"
        term = parse(term_path, f"term:{taxonomy}/{identity}")
        if term is None:
            continue
        expected = expected_label(taxonomy, identity)
        if term.h1 != expected:
            ERRORS.append(
                f"zh-CN taxonomy term title mismatch: {taxonomy}/{identity} "
                f"rendered={term.h1!r}, expected={expected!r}"
            )

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

print("Taxonomy localization verification: PASS (stable identities + zh-CN reader labels)")
