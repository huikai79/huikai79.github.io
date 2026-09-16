#!/usr/bin/env python3
from __future__ import annotations

import sys
from html.parser import HTMLParser
from pathlib import Path

from article_routing import routes

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def source_contract() -> None:
    template = (ROOT / "layouts" / "_default" / "single.html").read_text(encoding="utf-8")
    required = [
        'partial "related.html" .',
        'partial "article/author.html" .',
        'partial "article-comments.html" .',
    ]
    for token in required:
        if token not in template:
            fail(f"Article template is missing required native/preserved partial: {token}")
    for token in [
        'partial "article-pagination.html" .',
        'partial "article/pagination.html" .',
        'partial "article/related.html" .',
        'partial "sharing-links.html" .',
    ]:
        if token in template:
            fail(f"Article template contains an obsolete standalone footer partial: {token}")
    if "post-hero" not in template or "article-main" not in template:
        fail("Gate 6 phase 1 must preserve the custom article hero/body boundary")
    if "replaceRE `<h1([^>]*)>`" not in template:
        fail("Gate 6 phase 1 must preserve the defensive single-H1 boundary")
    for token in [".Params.categories", ".Params.entryType", ".Description", "article-context", "article-summary"]:
        if token not in template:
            fail(f"Article reader context contract is missing: {token}")

    author = (ROOT / "layouts" / "partials" / "article" / "author.html").read_text(encoding="utf-8")
    if 'partial "sharing-links.html" .' not in author:
        fail("Article endcap must keep sharing available alongside author context")

    params = (ROOT / "config" / "_default" / "params.toml").read_text(encoding="utf-8")
    if 'showPagination = false' not in params:
        fail("Ordinary article chronological pagination must remain disabled")

    related = (ROOT / "layouts" / "partials" / "related.html").read_text(encoding="utf-8")
    for token in [".Site.RegularPages.Related", "related-reading-list", "related-reading-item", ".Description"]:
        if token not in related:
            fail(f"Related-reading contract is missing: {token}")
    for obsolete in ["card-related.html", "sm:grid-cols-2", "md:grid-cols-3"]:
        if obsolete in related:
            fail(f"Obsolete related-card/grid contract remains active: {obsolete}")


class ArticleParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.h1_count = 0
        self.context_blocks = 0
        self.context_chips = 0
        self.summary_blocks = 0
        self.related_lists = 0
        self.related_items = 0
        self.related_summaries = 0
        self.related_cards = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        classes = set(data.get("class", "").split())
        if tag.lower() == "h1":
            self.h1_count += 1
        if "article-context" in classes:
            self.context_blocks += 1
        if "article-context-chip" in classes:
            self.context_chips += 1
        if "article-summary" in classes:
            self.summary_blocks += 1
        if "related-reading-list" in classes:
            self.related_lists += 1
        if "related-reading-item" in classes:
            self.related_items += 1
        if "related-reading-summary" in classes:
            self.related_summaries += 1
        if "article-link--related" in classes:
            self.related_cards += 1


def rendered_contract() -> int:
    article_routes = routes()
    if not article_routes:
        fail("No routed article pages found for Gate 6 verification")
        return 0

    rendered_paths: list[Path] = []
    related_lists_found = 0
    for route in article_routes:
        path = route.rendered(PUBLIC)
        rendered_paths.append(path)
        if not path.is_file():
            fail(f"Routed article output is missing: {route.language}:{route.slug} -> {path}")
            continue
        parser = ArticleParser()
        parser.feed(path.read_text(encoding="utf-8", errors="replace"))
        parser.close()
        if parser.h1_count != 1:
            fail(f"Gate 6 article must retain exactly one H1: {path} (found {parser.h1_count})")
        if parser.context_blocks != 1:
            fail(f"Article reader context must render exactly once: {path} (found {parser.context_blocks})")
        if parser.context_chips < 1:
            fail(f"Article reader context must expose at least one governed metadata chip: {path}")
        if parser.summary_blocks != 1:
            fail(f"Article summary must render exactly once: {path} (found {parser.summary_blocks})")
        if parser.related_cards:
            fail(f"Obsolete related image-card markup remains in rendered article: {path}")
        if parser.related_lists:
            related_lists_found += parser.related_lists
            if parser.related_lists != 1:
                fail(f"Related-reading list must render at most once per article: {path} (found {parser.related_lists})")
            if not 1 <= parser.related_items <= 3:
                fail(
                    f"Related-reading list must contain 1-3 items when present: {path} "
                    f"(found {parser.related_items})"
                )
            if parser.related_summaries != parser.related_items:
                fail(
                    f"Every related-reading item must carry its editorial description: {path} "
                    f"(items={parser.related_items}, summaries={parser.related_summaries})"
                )

    if len(rendered_paths) > 1:
        existing = [p for p in rendered_paths if p.is_file()]
        if existing and related_lists_found == 0:
            fail("HUIKAI related-reading list was not found in rendered articles")

    return len(article_routes)


source_contract()
count = rendered_contract()
if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)
print(f"Article nativeization verification: PASS ({count} articles checked)")
