#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

from article_routing import routes

ROOT = Path(__file__).resolve().parents[1]
POSTS = ROOT / "content" / "posts"
REPORT = ROOT / ".notion-sync-report.json"
NOTION_AUDIO_SHORTCODE_RE = re.compile(
    r'{{<\s*notion-audio\s+block="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"\s*>}}',
    re.I,
)
STREAMING_AUDIO_EXTENSIONS = {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"}
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def source_contract() -> None:
    strict_after_sync = REPORT.is_file()
    gateway_count = 0

    for route in routes():
        index = route.source
        if not index.is_file():
            fail(f"Routed audio source is missing: {route.source}")
            continue
        text = index.read_text(encoding="utf-8", errors="strict")
        gateway_count += len(NOTION_AUDIO_SHORTCODE_RE.findall(text))

    if strict_after_sync:
        audio_files = [
            path for path in POSTS.rglob("*")
            if path.is_file() and path.suffix.lower() in STREAMING_AUDIO_EXTENSIONS
        ]
        if audio_files:
            fail(
                "Streaming audio files are forbidden in synchronized article bundles: "
                + ", ".join(str(path) for path in audio_files)
            )

    if not ERRORS:
        print(
            "Audio source contract verification: PASS "
            f"(gateway={gateway_count}, strict={strict_after_sync})"
        )


class AudioParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.audios: list[dict[str, object]] = []
        self.gateway_blocks: list[str] = []
        self.current: dict[str, object] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value for key, value in attrs}
        block_id = data.get("data-notion-audio-block")
        if block_id:
            self.gateway_blocks.append(block_id)

        tag = tag.lower()
        if tag == "audio":
            self.current = {
                "controls": "controls" in data,
                "endpoint": data.get("data-media-endpoint"),
                "sources": [],
            }
            self.audios.append(self.current)
        elif tag == "source" and self.current is not None and data.get("src"):
            self.current["sources"].append(data["src"])

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "audio":
            self.current = None


def rendered_contract(public: Path) -> None:
    source_gateway = 0
    rendered_audios = 0

    for route in routes():
        index = route.source
        if not index.is_file():
            fail(f"Routed audio source is missing: {index}")
            continue
        source = index.read_text(encoding="utf-8", errors="strict")
        gateway = NOTION_AUDIO_SHORTCODE_RE.findall(source)
        source_gateway += len(gateway)

        html = route.rendered(public)
        if not html.is_file():
            fail(f"Rendered article missing for audio verification: {route.language}:{route.slug}")
            continue

        parser = AudioParser()
        parser.feed(html.read_text(encoding="utf-8", errors="replace"))
        parser.close()
        rendered_audios += len(parser.audios)

        if len(parser.audios) != len(gateway):
            fail(
                f"Rendered/source audio count mismatch for {route.language}:{route.slug}: "
                f"rendered={len(parser.audios)}, source={len(gateway)}"
            )
            continue

        for audio in parser.audios:
            if not audio["controls"]:
                fail(f"Rendered audio must include controls: {html}")
            if audio["sources"]:
                fail(f"Gateway audio must not expose a direct source element: {html}")

        for block_id in gateway:
            if parser.gateway_blocks.count(block_id) != 1:
                fail(f"Rendered gateway audio marker missing or duplicated for {block_id}: {html}")
            matching = [
                audio for audio in parser.audios
                if str(audio["endpoint"]).startswith(f"/media/audio/{block_id}?page=")
            ]
            if len(matching) != 1:
                fail(f"Rendered gateway audio endpoint missing or duplicated for {block_id}: {html}")

    if not ERRORS:
        print(
            "Audio rendered verification: PASS "
            f"(rendered={rendered_audios}, gateway={source_gateway})"
        )


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in {"source", "rendered"}:
        raise SystemExit("usage: verify-audio-rendering.py source | rendered <public-dir>")
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
