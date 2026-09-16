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
HUGO = ROOT / "config" / "_default" / "hugo.toml"
EXPECTED = {
    "facebook": "facebook.com/sharer/sharer.php",
    "line": "line.me/R/share",
    "whatsapp": "api.whatsapp.com/send",
    "telegram": "t.me/share/url",
    "email": "mailto:",
}


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.hrefs: list[str] = []
        self.copy_buttons: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        tag = tag.lower()
        if tag == "a" and data.get("href"):
            self.hrefs.append(data["href"].strip())
        if tag == "button" and data.get("data-copy-share-url"):
            self.copy_buttons.append(data)


def normalized_target(href: str) -> str:
    parsed = urlsplit(href)
    return f"{parsed.netloc}{parsed.path}".lower()


def matches_provider(href: str, provider: str) -> bool:
    expected = EXPECTED[provider].lower()
    return href.lower().startswith(expected) if provider == "email" else expected in normalized_target(href)


with PARAMS.open("rb") as handle:
    params = tomllib.load(handle)
article = params.get("article", {}) if isinstance(params, dict) else {}
sharing = article.get("sharingLinks", []) if isinstance(article, dict) else []
if sharing != list(EXPECTED):
    raise SystemExit(f"Article sharing configuration mismatch: expected={list(EXPECTED)}, actual={sharing}")

with HUGO.open("rb") as handle:
    hugo = tomllib.load(handle)
base_url = str(hugo.get("baseURL", "")).strip()
base = urlsplit(base_url)
if not base.scheme or not base.netloc:
    raise SystemExit(f"Invalid Hugo baseURL for sharing verification: {base_url!r}")

article_routes = routes()
for route in article_routes:
    rendered = route.rendered(PUBLIC)
    if not route.source.is_file():
        raise SystemExit(f"Article sharing routed source is missing: {route.source}")
    if not rendered.is_file():
        raise SystemExit(f"Article sharing routed output is missing: {rendered}")

    parser = LinkParser()
    parser.feed(rendered.read_text(encoding="utf-8", errors="replace"))
    parser.close()

    if len(parser.copy_buttons) != 1:
        raise SystemExit(
            f"Article copy-link action must render exactly once for {route.language}:{route.slug}: "
            f"found={len(parser.copy_buttons)}"
        )
    copy_button = parser.copy_buttons[0]
    copied_url = urlsplit(copy_button["data-copy-share-url"])
    if copied_url.netloc != base.netloc or copied_url.path != route.permalink_path:
        raise SystemExit(
            f"Article copy-link target mismatch for {route.language}:{route.slug}: "
            f"expected_host={base.netloc}, expected_path={route.permalink_path}, "
            f"actual={copy_button['data-copy-share-url']}"
        )
    for attr in ("data-copy-label", "data-copy-success", "data-copy-failure"):
        if not copy_button.get(attr):
            raise SystemExit(
                f"Article copy-link action is missing {attr} for {route.language}:{route.slug}"
            )

    for provider in sharing:
        matches = [href for href in parser.hrefs if matches_provider(href, provider)]
        if len(matches) != 1:
            external = [href for href in parser.hrefs if href.startswith(("http://", "https://", "mailto:"))]
            raise SystemExit(
                f"Article sharing link must render exactly once for {route.language}:{route.slug}: "
                f"provider={provider}, found={len(matches)}, external_hrefs={external}"
            )
        href = matches[0]
        if provider != "email" and base.netloc not in href:
            raise SystemExit(
                f"Article sharing link does not contain the production permalink for "
                f"{route.language}:{route.slug}: provider={provider}, href={href}"
            )

print(
    f"Article sharing verification: PASS "
    f"({len(article_routes)} articles, providers={','.join(sharing)}, copy-link=enabled)"
)
