#!/usr/bin/env python3
from __future__ import annotations

import struct
import sys
import tomllib
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
ROOT = Path(__file__).resolve().parents[1]
EXPECTED = (1200, 630)
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def site_hostname() -> str:
    try:
        with (ROOT / "config" / "_default" / "hugo.toml").open("rb") as handle:
            config = tomllib.load(handle)
        hostname = urlsplit(str(config.get("baseURL", ""))).hostname
        if not hostname:
            raise ValueError("baseURL has no hostname")
        return hostname.lower()
    except Exception as error:
        raise RuntimeError(f"Unable to resolve production hostname from Hugo baseURL: {error}") from error


SITE_HOSTNAME = site_hostname()


class MetaParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.og_images: list[str] = []
        self.twitter_images: list[str] = []
        self.twitter_cards: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "meta":
            return
        data = {key.lower(): value or "" for key, value in attrs}
        prop = data.get("property", "").lower()
        name = data.get("name", "").lower()
        content = data.get("content", "")
        if prop == "og:image" and content:
            self.og_images.append(content)
        if name == "twitter:image" and content:
            self.twitter_images.append(content)
        if name == "twitter:card" and content:
            self.twitter_cards.append(content)


def parse_meta(path: Path) -> MetaParser:
    parser = MetaParser()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    parser.close()
    return parser


def local_asset(url: str) -> Path | None:
    parsed = urlsplit(url)
    # Hugo emits absolute production URLs for social metadata. Treat only the
    # configured site host as local; a different host remains an external URL.
    if parsed.hostname and parsed.hostname.lower() != SITE_HOSTNAME:
        return None
    clean = unquote(parsed.path)
    if not clean:
        return None
    return PUBLIC / clean.lstrip("/")


def jpeg_dimensions(path: Path) -> tuple[int, int] | None:
    data = path.read_bytes()
    if not data.startswith(b"\xff\xd8"):
        return None
    offset = 2
    while offset + 9 <= len(data):
        if data[offset] != 0xFF:
            offset += 1
            continue
        marker = data[offset + 1]
        offset += 2
        if marker in {0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
            continue
        if offset + 2 > len(data):
            break
        length = struct.unpack(">H", data[offset:offset + 2])[0]
        if length < 2 or offset + length > len(data):
            break
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            height, width = struct.unpack(">HH", data[offset + 3:offset + 7])
            return width, height
        offset += length
    return None


def image_dimensions(path: Path) -> tuple[int, int] | None:
    data = path.read_bytes()[:32]
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    return jpeg_dimensions(path)


def verify_page(path: Path, label: str) -> None:
    if not path.is_file():
        fail(f"Missing rendered page for social preview: {label} ({path})")
        return

    parser = parse_meta(path)
    if not parser.og_images:
        fail(f"Missing og:image: {label}")
        return
    if not parser.twitter_images:
        fail(f"Missing twitter:image: {label}")
        return
    if "summary_large_image" not in parser.twitter_cards:
        fail(f"Twitter card is not summary_large_image: {label}")

    og = parser.og_images[0]
    twitter = parser.twitter_images[0]
    if og != twitter:
        fail(f"Open Graph and Twitter images differ: {label} (og={og}, twitter={twitter})")

    asset = local_asset(og)
    if asset is None:
        fail(f"Social preview must be a local production asset: {label} ({og})")
        return
    if not asset.is_file():
        fail(f"Social preview asset is missing: {label} ({asset})")
        return

    dimensions = image_dimensions(asset)
    if dimensions != EXPECTED:
        fail(f"Social preview dimensions must be 1200x630: {label} ({dimensions}, {asset})")


verify_page(PUBLIC / "index.html", "homepage")
verify_page(PUBLIC / "about" / "index.html", "about")
verify_page(PUBLIC / "posts" / "index.html", "posts index")
for article in sorted((PUBLIC / "posts").glob("*/index.html")):
    verify_page(article, f"article:{article.parent.name}")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

article_count = len(list((PUBLIC / "posts").glob("*/index.html")))
print(f"Social preview verification: PASS ({article_count} articles + homepage/about/posts index)")
