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
    required = ['partial "article-pagination.html" .','partial "related.html" .','partial "article/author.html" .','partial "article-comments.html" .','partial "sharing-links.html" .']
    for token in required:
        if token not in template: fail(f"Article template is missing required native/preserved partial: {token}")
    for token in ['partial "article/pagination.html" .','partial "article/related.html" .']:
        if token in template: fail(f"Legacy article partial is still active in single.html: {token}")
    if "post-hero" not in template or "article-main" not in template: fail("Gate 6 phase 1 must preserve the custom article hero/body boundary")
    if "replaceRE `<h1([^>]*)>`" not in template: fail("Gate 6 phase 1 must preserve the defensive single-H1 boundary")
    for token in [".Params.categories", ".Params.entryType", ".Description", "article-context", "article-summary"]:
        if token not in template: fail(f"Article reader context contract is missing: {token}")

class ArticleParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True); self.h1_count=0; self.context_blocks=0; self.context_chips=0; self.summary_blocks=0
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data={key.lower():value or "" for key,value in attrs}; classes=set(data.get("class","").split())
        if tag.lower()=="h1": self.h1_count+=1
        if "article-context" in classes: self.context_blocks+=1
        if "article-context-chip" in classes: self.context_chips+=1
        if "article-summary" in classes: self.summary_blocks+=1

def rendered_contract() -> int:
    article_routes = routes()
    if not article_routes:
        fail("No routed article pages found for Gate 6 verification"); return 0
    rendered_paths=[]
    for route in article_routes:
        path=route.rendered(PUBLIC); rendered_paths.append(path)
        if not path.is_file():
            fail(f"Routed article output is missing: {route.language}:{route.slug} -> {path}"); continue
        parser=ArticleParser(); parser.feed(path.read_text(encoding="utf-8",errors="replace")); parser.close()
        if parser.h1_count != 1: fail(f"Gate 6 article must retain exactly one H1: {path} (found {parser.h1_count})")
        if parser.context_blocks != 1: fail(f"Article reader context must render exactly once: {path} (found {parser.context_blocks})")
        if parser.context_chips < 1: fail(f"Article reader context must expose at least one governed metadata chip: {path}")
        if parser.summary_blocks != 1: fail(f"Article summary must render exactly once: {path} (found {parser.summary_blocks})")
    if len(rendered_paths)>1:
        existing=[p for p in rendered_paths if p.is_file()]
        if existing and not any("border-dotted" in p.read_text(encoding="utf-8",errors="replace") and "leading-6" in p.read_text(encoding="utf-8",errors="replace") for p in existing):
            fail("Blowfish native article pagination markup was not found in rendered articles")
        if existing and not any("grid gap-4 sm:grid-cols-2 md:grid-cols-3" in p.read_text(encoding="utf-8",errors="replace") for p in existing):
            fail("Blowfish native related-content grid was not found in rendered articles")
    return len(article_routes)

source_contract(); count=rendered_contract()
if ERRORS:
    for error in ERRORS: print(f"::error::{error}")
    raise SystemExit(1)
print(f"Article nativeization verification: PASS ({count} articles checked)")
