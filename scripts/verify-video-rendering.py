#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
POSTS = ROOT / "content" / "posts"
REPORT = ROOT / ".notion-sync-report.json"
LOCAL_MP4_LINK_RE = re.compile(r'(?<!!)\[[^\]]*\]\((attachment-[^)\s]+\.mp4)(?:\s+"[^"]*")?\)', re.I)
VIDEO_SHORTCODE_RE = re.compile(r'{{<\s*video\s+src="([^"]+\.mp4)"\s*>}}', re.I)
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def source_contract() -> None:
    strict_after_sync = REPORT.is_file()
    shortcode_count = 0

    for index in sorted(POSTS.glob("*/index.md")):
        text = index.read_text(encoding="utf-8", errors="strict")
        ordinary_mp4 = LOCAL_MP4_LINK_RE.findall(text)
        if strict_after_sync and ordinary_mp4:
            fail(f"Localized MP4 must render through video shortcode after sync: {index} ({ordinary_mp4})")

        for filename in VIDEO_SHORTCODE_RE.findall(text):
            shortcode_count += 1
            resource = index.parent / filename
            if not resource.is_file() or resource.stat().st_size == 0:
                fail(f"Video shortcode resource is missing: {index} -> {filename}")

    if ERRORS:
        return
    print(f"Video source contract verification: PASS ({shortcode_count} shortcode(s), strict={strict_after_sync})")


class VideoParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.videos: list[dict[str, object]] = []
        self.current: dict[str, object] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value for key, value in attrs}
        tag = tag.lower()
        if tag == "video":
            self.current = {
                "controls": "controls" in data,
                "playsinline": "playsinline" in data,
                "sources": [],
            }
            self.videos.append(self.current)
        elif tag == "source" and self.current is not None and data.get("src"):
            self.current["sources"].append(data["src"])

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "video":
            self.current = None


def local_target(html: Path, raw: str) -> Path | None:
    parsed = urlsplit(raw)
    if parsed.scheme or parsed.netloc:
        return None
    clean = unquote(parsed.path)
    if not clean:
        return None
    return (html.parent / clean).resolve() if not clean.startswith("/") else (html.parents[2] / clean.lstrip("/")).resolve()


def rendered_contract(public: Path) -> None:
    source_shortcodes = 0
    rendered_videos = 0

    for index in sorted(POSTS.glob("*/index.md")):
        expected = VIDEO_SHORTCODE_RE.findall(index.read_text(encoding="utf-8", errors="strict"))
        source_shortcodes += len(expected)
        html = public / "posts" / index.parent.name.lower() / "index.html"
        if not html.is_file():
            # Hugo may preserve case in source while emitting lower-case URLs; fall back by scanning.
            candidates = [p for p in (public / "posts").glob("*/index.html") if p.parent.name.lower() == index.parent.name.lower()]
            html = candidates[0] if candidates else html
        if not html.is_file():
            fail(f"Rendered article missing for video verification: {index.parent.name}")
            continue

        parser = VideoParser()
        parser.feed(html.read_text(encoding="utf-8", errors="replace"))
        parser.close()
        rendered_videos += len(parser.videos)
        if len(parser.videos) != len(expected):
            fail(
                f"Rendered/source video count mismatch for {index.parent.name}: "
                f"rendered={len(parser.videos)}, source={len(expected)}"
            )
            continue

        for video in parser.videos:
            if not video["controls"] or not video["playsinline"]:
                fail(f"Rendered video must include controls and playsinline: {html}")
            sources = video["sources"]
            if len(sources) != 1:
                fail(f"Rendered video must contain exactly one source: {html}")
                continue
            target = local_target(html, str(sources[0]))
            if target is None or not target.is_file() or target.stat().st_size == 0:
                fail(f"Rendered video source is missing or external: {html} -> {sources[0]}")

    if not ERRORS:
        print(f"Video rendered verification: PASS ({rendered_videos}/{source_shortcodes} video(s))")


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in {"source", "rendered"}:
        raise SystemExit("usage: verify-video-rendering.py source | rendered <public-dir>")
    if sys.argv[1] == "source":
        source_contract()
    else:
        public = Path(sys.argv[2] if len(sys.argv) > 2 else "public").resolve()
        rendered_contract(public)

    if ERRORS:
        for error in ERRORS:
            print(f"::error::{error}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
