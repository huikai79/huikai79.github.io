#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable

from article_routing import MANIFEST, routes

ROOT = Path(__file__).resolve().parents[1]
REPORT_PATH = ROOT / ".notion-sync-report.json"
TEMP_NOTION_MEDIA_HOST = "prod-files-secure.s3.us-west-2.amazonaws.com"
MARKDOWN_LINK_RE = re.compile(r'(?<!!)\[([^\]]*)\]\((https?://[^)\s]+)(\s+"[^"]*")?\)')
LOCAL_VIDEO_LINK_RE = re.compile(r'(?<!!)\[([^\]]*)\]\((attachment-[^)\s]+\.mp4)(\s+"[^"]*")?\)', re.IGNORECASE)
SAFE_EXTENSION_RE = re.compile(r"^\.[A-Za-z0-9]{1,10}$")
VIDEO_EXTENSIONS = {".mp4"}


def directory_hash(directory: Path) -> str:
    digest = hashlib.sha256()
    for entry in sorted(path for path in directory.rglob("*") if path.is_file()):
        relative = entry.relative_to(directory).as_posix()
        digest.update(relative.encode("utf-8")); digest.update(b"\0")
        digest.update(entry.read_bytes()); digest.update(b"\0")
    return digest.hexdigest()


def is_temporary_notion_media_url(url: str) -> bool:
    try:
        parsed = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    return parsed.scheme in {"http", "https"} and parsed.hostname == TEMP_NOTION_MEDIA_HOST


def stable_attachment_name(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    decoded_path = urllib.parse.unquote(parsed.path)
    suffix = Path(decoded_path).suffix.lower()
    if not SAFE_EXTENSION_RE.fullmatch(suffix):
        suffix = ".bin"
    stable_key = hashlib.sha256(parsed.path.encode("utf-8")).hexdigest()[:16]
    return f"attachment-{stable_key}{suffix}"


def localized_markdown(filename: str, label: str, title: str = "") -> str:
    return f"[{label}]({filename}{title})"


def normalize_local_video_links(markdown: str) -> tuple[str, list[str]]:
    matches = list(LOCAL_VIDEO_LINK_RE.finditer(markdown))
    if not matches:
        return markdown, []
    result = markdown
    converted: list[str] = []
    for match in matches:
        original, filename = match.group(0), match.group(2)
        result = result.replace(original, f'{{{{< video src="{filename}" >}}}}', 1)
        converted.append(filename)
    return result, converted


def download_file(url: str, destination: Path, attempts: int = 3, timeout: int = 30) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f"{destination.name}.tmp-{os.getpid()}")
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "huikai-notion-sync/1"})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                temporary.write_bytes(response.read())
            temporary.replace(destination)
            return
        except Exception as error:  # noqa: BLE001
            last_error = error
            temporary.unlink(missing_ok=True)
            if attempt < attempts:
                time.sleep(0.5 * (2 ** (attempt - 1)))
    assert last_error is not None
    raise last_error


def localize_markdown_links(markdown: str, bundle: Path, fetcher: Callable[[str, Path], None] = download_file) -> tuple[str, list[dict[str, str]]]:
    matches = [match for match in MARKDOWN_LINK_RE.finditer(markdown) if is_temporary_notion_media_url(match.group(2))]
    if not matches:
        return markdown, []
    replacements: list[tuple[str, str]] = []
    localized: list[dict[str, str]] = []
    downloaded: set[str] = set()
    for match in matches:
        original, label, url, title = match.group(0), match.group(1), match.group(2), match.group(3) or ""
        filename = stable_attachment_name(url)
        if Path(filename).suffix.lower() in VIDEO_EXTENSIONS:
            raise RuntimeError("Temporary Notion MP4 reached the attachment localizer; refusing to write MP4 into Git.")
        destination = bundle / filename
        if filename not in downloaded:
            fetcher(url, destination); downloaded.add(filename)
        replacements.append((original, localized_markdown(filename, label, title)))
        localized.append({"host": TEMP_NOTION_MEDIA_HOST, "file": filename})
    result = markdown
    for original, replacement in replacements:
        result = result.replace(original, replacement, 1)
    return result, localized


def main() -> None:
    if not REPORT_PATH.is_file():
        print("Notion media localization: SKIP (no fresh Notion sync report)")
        return
    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    if report.get("status") != "complete":
        raise RuntimeError("Notion sync report is not complete; refusing media localization")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    pages = manifest.get("pages")
    if not isinstance(pages, dict):
        raise RuntimeError("Notion manifest pages object is missing")

    resolved: list[dict[str, str]] = []
    converted_videos: list[dict[str, str]] = []
    manifest_changed = False
    for route in routes(manifest):
        index_path = route.source
        if not index_path.is_file():
            raise RuntimeError(f"Routed article source is missing: {index_path}")
        bundle = index_path.parent
        source = index_path.read_text(encoding="utf-8", errors="strict").replace("\r\n", "\n")
        updated, localized = localize_markdown_links(source, bundle)
        updated, converted = normalize_local_video_links(updated)
        if not localized and not converted:
            continue
        index_path.write_text(updated, encoding="utf-8", newline="\n")
        pages[route.page_id]["bundleHash"] = directory_hash(bundle)
        manifest_changed = True
        for item in localized:
            resolved.append({"pageId": route.page_id, "slug": route.slug, **item})
            print(f"📎  Notion 附件本地化 {route.slug}: {item['file']}")
        for filename in converted:
            converted_videos.append({"pageId": route.page_id, "slug": route.slug, "file": filename})
            print(f"🎬  舊版本地影片連結正規化 {route.slug}: {filename}")

    if manifest_changed:
        MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    report["mediaLocalization"] = {
        "status": "complete", "strategy": "temporary-notion-nonvideo-links",
        "resolved": resolved, "legacyVideoShortcodes": converted_videos,
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Notion media localization: PASS ({len(resolved)} non-video link(s) localized, {len(converted_videos)} legacy video link(s) normalized)")


if __name__ == "__main__":
    main()
