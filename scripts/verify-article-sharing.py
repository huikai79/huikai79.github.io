#!/usr/bin/env python3
from __future__ import annotations

import sys
import tomllib
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

from article_routing import routes

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
PARAMS = ROOT / "config" / "_default" / "params.toml"
EXPECTED = {
    "facebook": "facebook.com/sharer/sharer.php",
    "line": "line.me/R/share",
    "whatsapp": "api.whatsapp.com/send",
    "telegram": "t.me/share/url",
    "email": "mailto:",
}

class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True); self.hrefs: list[str] = []
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a": return
        data = {key.lower(): value or "" for key, value in attrs}
        if data.get("href"): self.hrefs.append(data["href"].strip())

def normalized_target(href: str) -> str:
    parsed = urlsplit(href); return f"{parsed.netloc}{parsed.path}".lower()

def matches_provider(href: str, provider: str) -> bool:
    expected = EXPECTED[provider].lower()
    return href.lower().startswith(expected) if provider == "email" else expected in normalized_target(href)

with PARAMS.open("rb") as handle:
    params = tomllib.load(handle)
article = params.get("article", {}) if isinstance(params, dict) else {}
sharing = article.get("sharingLinks", []) if isinstance(article, dict) else []
if sharing != list(EXPECTED):
    raise SystemExit(f"Article sharing configuration mismatch: expected={list(EXPECTED)}, actual={sharing}")

article_routes = routes()
for route in article_routes:
    rendered = route.rendered(PUBLIC)
    if not route.source.is_file():
        raise SystemExit(f"Article sharing routed source is missing: {route.source}")
    if not rendered.is_file():
        raise SystemExit(f"Article sharing routed output is missing: {rendered}")
    parser = LinkParser(); parser.feed(rendered.read_text(encoding="utf-8", errors="replace")); parser.close()
    for provider in sharing:
        matches = [href for href in parser.hrefs if matches_provider(href, provider)]
        if len(matches) != 1:
            external = [href for href in parser.hrefs if href.startswith(("http://", "https://", "mailto:"))]
            raise SystemExit(f"Article sharing link must render exactly once for {route.language}:{route.slug}: provider={provider}, found={len(matches)}, external_hrefs={external}")
        href = matches[0]
        if provider != "email" and "huikai.com.kg" not in href:
            raise SystemExit(f"Article sharing link does not contain the production permalink for {route.language}:{route.slug}: provider={provider}, href={href}")

print(f"Article sharing verification: PASS ({len(article_routes)} articles, providers={','.join(sharing)})")
