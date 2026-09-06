#!/usr/bin/env python3
from __future__ import annotations

import sys
import tomllib
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
PARAMS = ROOT / "config" / "_default" / "params.toml"
POSTS = ROOT / "content" / "posts"

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

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        data = {key.lower(): value or "" for key, value in attrs}
        href = data.get("href", "").strip()
        if href:
            self.hrefs.append(href)


def matches_provider(href: str, provider: str) -> bool:
    expected = EXPECTED[provider]
    if provider == "email":
        return href.startswith(expected)
    parsed = urlsplit(href)
    combined = f"{parsed.netloc}{parsed.path}"
    return expected in combined


with PARAMS.open("rb") as handle:
    params = tomllib.load(handle)
article = params.get("article", {}) if isinstance(params, dict) else {}
sharing = article.get("sharingLinks", []) if isinstance(article, dict) else []
if sharing != list(EXPECTED):
    raise SystemExit(
        "Article sharing configuration mismatch: "
        f"expected={list(EXPECTED)}, actual={sharing}"
    )

source_slugs = sorted(path.parent.name for path in POSTS.glob("*/index.md"))
rendered_slugs = sorted(path.parent.name for path in (PUBLIC / "posts").glob("*/index.html"))
if source_slugs != rendered_slugs:
    raise SystemExit(
        f"Article sharing source/render mismatch: source={source_slugs}, rendered={rendered_slugs}"
    )

for slug in rendered_slugs:
    rendered = PUBLIC / "posts" / slug / "index.html"
    parser = LinkParser()
    parser.feed(rendered.read_text(encoding="utf-8", errors="replace"))
    parser.close()

    for provider in sharing:
        matches = [href for href in parser.hrefs if matches_provider(href, provider)]
        if len(matches) != 1:
            raise SystemExit(
                f"Article sharing link must render exactly once for {slug}: "
                f"provider={provider}, found={len(matches)}"
            )
        href = matches[0]
        if provider != "email" and "huikai.com.kg" not in href:
            raise SystemExit(
                f"Article sharing link does not contain the production permalink for {slug}: "
                f"provider={provider}, href={href}"
            )

print(
    "Article sharing verification: PASS "
    f"({len(rendered_slugs)} articles, providers={','.join(sharing)})"
)
