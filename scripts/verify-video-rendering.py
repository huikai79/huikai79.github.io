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
LEGACY_VIDEO_SHORTCODE_RE = re.compile(r'{{<\s*video\s+src="([^"]+\.mp4)"\s*>}}', re.I)
NOTION_VIDEO_SHORTCODE_RE = re.compile(
    r'{{<\s*notion-video\s+block="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"\s*>}}',
    re.I,
)
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def source_contract() -> None:
    strict_after_sync = REPORT.is_file()
    legacy_count = 0
    gateway_count = 0

    for index in sorted(POSTS.glob("*/index.md")):
        text = index.read_text(encoding="utf-8", errors="strict")
        ordinary_mp4 = LOCAL_MP4_LINK_RE.findall(text)
        if strict_after_sync and ordinary_mp4:
            fail(f"Local MP4 links are forbidden after Notion sync: {index} ({ordinary_mp4})")

        legacy = LEGACY_VIDEO_SHORTCODE_RE.findall(text)
        legacy_count += len(legacy)
        for filename in legacy:
            resource = index.parent / filename
            if strict_after_sync:
                fail(f"Legacy local video shortcode survived fresh sync: {index} -> {filename}")
            elif not resource.is_file() or resource.stat().st_size == 0:
                fail(f"Legacy video shortcode resource is missing: {index} -> {filename}")

        gateway = NOTION_VIDEO_SHORTCODE_RE.findall(text)
        gateway_count += len(gateway)

    if strict_after_sync:
        mp4_files = [path for path in POSTS.rglob("*.mp4") if path.is_file()]
        if mp4_files:
            fail("MP4 files are forbidden in synchronized article bundles: " + ", ".join(str(path) for path in mp4_files))

    if ERRORS:
        return
    print(
        "Video source contract verification: PASS "
        f"(gateway={gateway_count}, legacy={legacy_count}, strict={strict_after_sync})"
    )


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
                "endpoint": data.get("data-media-endpoint"),
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
    source_legacy = 0
    source_gateway = 0
    rendered_videos = 0

    for index in sorted(POSTS.glob("*/index.md")):
        source = index.read_text(encoding="utf-8", errors="strict")
        legacy = LEGACY_VIDEO_SHORTCODE_RE.findall(source)
        gateway = NOTION_VIDEO_SHORTCODE_RE.findall(source)
        source_legacy += len(legacy)
        source_gateway += len(gateway)

        html = public / "posts" / index.parent.name.lower() / "index.html"
        if not html.is_file():
            candidates = [
                p for p in (public / "posts").glob("*/index.html")
                if p.parent.name.lower() == index.parent.name.lower()
            ]
            html = candidates[0] if candidates else html
        if not html.is_file():
            fail(f"Rendered article missing for video verification: {index.parent.name}")
            continue

        html_text = html.read_text(encoding="utf-8", errors="replace")
        parser = VideoParser()
        parser.feed(html_text)
        parser.close()
        rendered_videos += len(parser.videos)

        expected_total = len(legacy) + len(gateway)
        if len(parser.videos) != expected_total:
            fail(
                f"Rendered/source video count mismatch for {index.parent.name}: "
                f"rendered={len(parser.videos)}, source={expected_total}"
            )
            continue

        gateway_videos = [video for video in parser.videos if video["endpoint"]]
        local_videos = [video for video in parser.videos if not video["endpoint"]]
        if len(gateway_videos) != len(gateway):
            fail(
                f"Rendered gateway video count mismatch for {index.parent.name}: "
                f"rendered={len(gateway_videos)}, source={len(gateway)}"
            )
        if len(local_videos) != len(legacy):
            fail(
                f"Rendered legacy video count mismatch for {index.parent.name}: "
                f"rendered={len(local_videos)}, source={len(legacy)}"
            )

        for video in parser.videos:
            if not video["controls"] or not video["playsinline"]:
                fail(f"Rendered video must include controls and playsinline: {html}")

        for video in local_videos:
            sources = video["sources"]
            if len(sources) != 1:
                fail(f"Legacy rendered video must contain exactly one source: {html}")
                continue
            target = local_target(html, str(sources[0]))
            if target is None or not target.is_file() or target.stat().st_size == 0:
                fail(f"Rendered legacy video source is missing or external: {html} -> {sources[0]}")

        for block_id in gateway:
            marker = f'data-notion-video-block="{block_id}"'
            if marker not in html_text:
                fail(f"Rendered gateway marker missing for {block_id}: {html}")
            matching = [
                video for video in gateway_videos
                if str(video["endpoint"]).startswith(f"/media/video/{block_id}?page=")
            ]
            if len(matching) != 1:
                fail(f"Rendered gateway endpoint missing or duplicated for {block_id}: {html}")
                continue
            if matching[0]["sources"]:
                fail(f"Gateway video must not expose a direct source element: {html} -> {block_id}")

    if not ERRORS:
        print(
            "Video rendered verification: PASS "
            f"(rendered={rendered_videos}, gateway={source_gateway}, legacy={source_legacy})"
        )


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
