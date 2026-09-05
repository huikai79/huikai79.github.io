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

ROOT = Path(__file__).resolve().parents[1]
POSTS_DIR = ROOT / "content" / "posts"
REPORT_PATH = ROOT / ".notion-sync-report.json"
MANIFEST_PATH = ROOT / ".notion-sync-manifest.json"
TEMP_NOTION_MEDIA_HOST = "prod-files-secure.s3.us-west-2.amazonaws.com"
MARKDOWN_LINK_RE = re.compile(
    r'(?<!!)\[([^\]]*)\]\((https?://[^)\s]+)(\s+"[^"]*")?\)'
)
SAFE_EXTENSION_RE = re.compile(r"^\.[A-Za-z0-9]{1,10}$")
VIDEO_EXTENSIONS = {".mp4"}


def directory_hash(directory: Path) -> str:
    digest = hashlib.sha256()

    def walk(current: Path, relative_base: Path = Path()) -> None:
        for entry in sorted(current.iterdir(), key=lambda item: item.name):
            relative = relative_base / entry.name
            if entry.is_dir():
                walk(entry, relative)
            elif entry.is_file():
                digest.update(relative.as_posix().encode("utf-8"))
                digest.update(b"\0")
                digest.update(entry.read_bytes())
                digest.update(b"\0")

    walk(directory)
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
    if Path(filename).suffix.lower() in VIDEO_EXTENSIONS:
        return f'{{{{< video src="{filename}" >}}}}'
    return f"[{label}]({filename}{title})"


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
        except Exception as error:  # noqa: BLE001 - retry boundary intentionally broad
            last_error = error
            temporary.unlink(missing_ok=True)
            if attempt < attempts:
                time.sleep(0.5 * (2 ** (attempt - 1)))

    assert last_error is not None
    raise last_error


def localize_markdown_links(
    markdown: str,
    bundle: Path,
    fetcher: Callable[[str, Path], None] = download_file,
) -> tuple[str, list[dict[str, str]]]:
    matches = [
        match
        for match in MARKDOWN_LINK_RE.finditer(markdown)
        if is_temporary_notion_media_url(match.group(2))
    ]
    if not matches:
        return markdown, []

    replacements: list[tuple[str, str]] = []
    localized: list[dict[str, str]] = []
    downloaded: set[str] = set()

    for match in matches:
        original, label, url, title = match.group(0), match.group(1), match.group(2), match.group(3) or ""
        filename = stable_attachment_name(url)
        destination = bundle / filename

        if filename not in downloaded:
            fetcher(url, destination)
            downloaded.add(filename)

        replacements.append((original, localized_markdown(filename, label, title)))
        localized.append({"host": TEMP_NOTION_MEDIA_HOST, "file": filename})

    result = markdown
    for original, replacement in replacements:
        result = result.replace(original, replacement, 1)

    return result, localized


def main() -> None:
    # The report is intentionally ignored by Git and exists only immediately
    # after sync.mjs has produced a candidate snapshot. PR/deploy verification
    # therefore stays read-only and skips this post-sync normalizer.
    if not REPORT_PATH.is_file():
        print("Notion media localization: SKIP (no fresh Notion sync report)")
        return

    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    if report.get("status") != "complete":
        raise RuntimeError("Notion sync report is not complete; refusing media localization")

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest_pages = manifest.get("pages")
    if not isinstance(manifest_pages, dict):
        raise RuntimeError("Notion manifest pages object is missing")

    by_slug: dict[str, tuple[str, dict]] = {}
    for page_id, entry in manifest_pages.items():
        slug = entry.get("slug") if isinstance(entry, dict) else None
        if not slug:
            raise RuntimeError(f"Manifest page {page_id} is missing slug")
        if slug in by_slug:
            raise RuntimeError(f"Duplicate slug in Notion manifest: {slug}")
        by_slug[slug] = (page_id, entry)

    resolved: list[dict[str, str]] = []
    manifest_changed = False

    for index_path in sorted(POSTS_DIR.glob("*/index.md")):
        bundle = index_path.parent
        slug = bundle.name
        source = index_path.read_text(encoding="utf-8", errors="strict").replace("\r\n", "\n")
        updated, localized = localize_markdown_links(source, bundle)
        if not localized:
            continue

        manifest_entry = by_slug.get(slug)
        if manifest_entry is None:
            raise RuntimeError(f"Localized article is missing from Notion manifest: {slug}")

        index_path.write_text(updated, encoding="utf-8", newline="\n")
        page_id, entry = manifest_entry
        entry["bundleHash"] = directory_hash(bundle)
        manifest_changed = True

        for item in localized:
            resolved.append({"pageId": page_id, "slug": slug, **item})
            print(f"📎  Notion 附件本地化 {slug}: {item['file']}")

    if manifest_changed:
        MANIFEST_PATH.write_text(
            f"{json.dumps(manifest, ensure_ascii=False, indent=2)}\n",
            encoding="utf-8",
            newline="\n",
        )

    report["mediaLocalization"] = {
        "status": "complete",
        "strategy": "temporary-notion-media-links",
        "resolved": resolved,
    }
    REPORT_PATH.write_text(
        f"{json.dumps(report, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
        newline="\n",
    )

    print(f"Notion media localization: PASS ({len(resolved)} link(s) localized)")


if __name__ == "__main__":
    main()
