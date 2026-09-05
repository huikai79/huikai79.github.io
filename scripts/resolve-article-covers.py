#!/usr/bin/env python3
from __future__ import annotations

import binascii
import hashlib
import json
import os
import re
import struct
import zlib
from pathlib import Path

ROOT = Path(os.environ.get("SITE_ROOT", Path(__file__).resolve().parents[1])).resolve()
POSTS_DIR = ROOT / "content" / "posts"
REPORT_PATH = ROOT / ".notion-sync-report.json"
MANIFEST_PATH = ROOT / ".notion-sync-manifest.json"
IMAGE_EXTENSIONS = {".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"}
MARKDOWN_IMAGE_RE = re.compile(r'!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)')
FALLBACK_FILENAME = "cover-fallback.png"
FALLBACK_WIDTH = 1600
FALLBACK_HEIGHT = 900
PALETTES = (
    ((22, 33, 55), (59, 130, 246), (147, 197, 253)),
    ((39, 39, 42), (168, 85, 247), (216, 180, 254)),
    ((30, 41, 59), (14, 165, 233), (125, 211, 252)),
    ((28, 25, 23), (245, 158, 11), (253, 230, 138)),
    ((20, 83, 45), (34, 197, 94), (187, 247, 208)),
    ((76, 29, 149), (236, 72, 153), (251, 207, 232)),
)


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


def front_matter_bounds(lines: list[str], path: Path) -> tuple[int, int]:
    if not lines or lines[0] != "---":
        raise RuntimeError(f"{path.relative_to(ROOT)}: missing opening front matter delimiter")

    closing = next((index for index, line in enumerate(lines[1:], start=1) if line == "---"), None)
    if closing is None:
        raise RuntimeError(f"{path.relative_to(ROOT)}: missing closing front matter delimiter")

    return 0, closing


def front_matter_value(front_lines: list[str], key: str) -> str | None:
    prefix = f"{key}:"
    for line in front_lines:
        if not line.startswith(prefix):
            continue
        raw = line[len(prefix):].strip()
        if not raw:
            return ""
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return raw.strip('"\'')
        return str(value)
    return None


def first_local_markdown_image(body: str, bundle: Path) -> str | None:
    bundle_root = bundle.resolve()

    for match in MARKDOWN_IMAGE_RE.finditer(body):
        target = match.group(1)
        if "://" in target or target.startswith(("/", "#", "data:")):
            continue

        relative = Path(target)
        if relative.suffix.lower() not in IMAGE_EXTENSIONS or ".." in relative.parts:
            continue

        candidate = (bundle / relative).resolve()
        try:
            candidate.relative_to(bundle_root)
        except ValueError:
            continue

        if candidate.is_file():
            return relative.as_posix()

    return None


def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    payload = chunk_type + data
    return (
        struct.pack(">I", len(data))
        + payload
        + struct.pack(">I", binascii.crc32(payload) & 0xFFFFFFFF)
    )


def procedural_cover_png(page_id: str, slug: str, title: str) -> bytes:
    seed = hashlib.sha256(f"{page_id}\0{slug}\0{title}".encode("utf-8")).digest()
    background, accent, highlight = PALETTES[seed[0] % len(PALETTES)]

    band_gap = 420 + seed[2] % 240
    band_width = 90 + seed[1] % 150
    slope = 1 + seed[3] % 3
    offset = seed[4] % (FALLBACK_WIDTH + band_gap)
    horizon = 520 + seed[5] % 180

    raw = bytearray()
    for y in range(FALLBACK_HEIGHT):
        raw.append(0)
        row = bytearray()
        for x in range(FALLBACK_WIDTH):
            color = background
            diagonal = (x + slope * y + offset) % band_gap
            if diagonal < band_width:
                color = accent
            if y > horizon and ((x // 160) + (y // 90) + seed[6]) % 5 == 0:
                color = highlight
            row.extend(color)
        raw.extend(row)

    ihdr = struct.pack(">IIBBBBB", FALLBACK_WIDTH, FALLBACK_HEIGHT, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", zlib.compress(bytes(raw), level=9))
        + png_chunk(b"IEND", b"")
    )


def main() -> None:
    # This file is intentionally ignored by Git. Its presence means sync.mjs has
    # just produced a candidate Notion snapshot in the current workflow run.
    # Deploy/validation jobs therefore execute this script read-only and skip.
    if not REPORT_PATH.is_file():
        print("Cover resolution: SKIP (no fresh Notion sync report)")
        return

    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    if report.get("status") != "complete":
        raise RuntimeError("Notion sync report is not complete; refusing cover resolution")

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
    touched: set[str] = set()

    for index_path in sorted(POSTS_DIR.glob("*/index.md")):
        bundle = index_path.parent
        slug = bundle.name
        manifest_entry = by_slug.get(slug)
        if manifest_entry is None:
            raise RuntimeError(f"Article is missing from Notion manifest: {slug}")
        page_id, entry = manifest_entry

        text = index_path.read_text(encoding="utf-8", errors="strict").replace("\r\n", "\n")
        lines = text.split("\n")
        _, closing = front_matter_bounds(lines, index_path)
        front_lines = lines[1:closing]
        cover = front_matter_value(front_lines, "cover")
        fallback_path = bundle / FALLBACK_FILENAME

        # Explicit Notion/manual cover always wins. Remove only our reserved
        # generated fallback if it survived an incremental bundle reuse.
        if cover and cover != FALLBACK_FILENAME:
            if fallback_path.is_file():
                fallback_path.unlink()
                touched.add(slug)
                print(f"🧹 移除舊 fallback 封面 {slug}: {FALLBACK_FILENAME}")
            continue

        body = "\n".join(lines[closing + 1:])
        image = first_local_markdown_image(body, bundle)

        # Phase 1: prefer media already localized into the article bundle.
        if not cover and image:
            additions = [f"cover: {json.dumps(image, ensure_ascii=False)}"]
            if front_matter_value(front_lines, "images") is None:
                additions.append(f"images: [{json.dumps(image, ensure_ascii=False)}]")
            lines[closing:closing] = additions
            index_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
            if fallback_path.is_file():
                fallback_path.unlink()
            touched.add(slug)
            resolved.append({
                "pageId": page_id,
                "slug": slug,
                "cover": image,
                "strategy": "first-localized-markdown-image",
            })
            print(f"🖼️  自動封面（內文首圖） {slug}: {image}")
            continue

        # Phase 2: articles with no reusable image receive a deterministic 16:9
        # PNG generated only from stable article identity/title. No AI API,
        # network request, font, image package, or random source is involved.
        if not cover or cover == FALLBACK_FILENAME:
            title = front_matter_value(front_lines, "title") or slug
            expected = procedural_cover_png(page_id, slug, title)
            if not fallback_path.is_file() or fallback_path.read_bytes() != expected:
                fallback_path.write_bytes(expected)
                touched.add(slug)

            additions: list[str] = []
            if not cover:
                additions.append(f"cover: {json.dumps(FALLBACK_FILENAME)}")
            if front_matter_value(front_lines, "images") is None:
                additions.append(f"images: [{json.dumps(FALLBACK_FILENAME)}]")

            if additions:
                lines[closing:closing] = additions
                index_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
                touched.add(slug)

            resolved.append({
                "pageId": page_id,
                "slug": slug,
                "cover": FALLBACK_FILENAME,
                "strategy": "deterministic-procedural-png",
            })
            print(f"🎨 自動封面（程序化 fallback） {slug}: {FALLBACK_FILENAME}")

    if touched:
        for slug in sorted(touched):
            _, entry = by_slug[slug]
            entry["bundleHash"] = directory_hash(POSTS_DIR / slug)

        MANIFEST_PATH.write_text(
            f"{json.dumps(manifest, ensure_ascii=False, indent=2)}\n",
            encoding="utf-8",
            newline="\n",
        )

    report["coverResolution"] = {
        "status": "complete",
        "strategy": "explicit-cover > first-localized-markdown-image > deterministic-procedural-png",
        "resolved": resolved,
    }
    REPORT_PATH.write_text(
        f"{json.dumps(report, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
        newline="\n",
    )

    print(f"Cover resolution: PASS ({len(resolved)} article(s) resolved/verified)")


if __name__ == "__main__":
    main()
