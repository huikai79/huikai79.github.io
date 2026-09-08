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
SOCIAL_FALLBACK_FILENAME = "social-preview.png"
SOCIAL_FALLBACK_WIDTH = 1200
SOCIAL_FALLBACK_HEIGHT = 630
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


def front_matter_list(front_lines: list[str], key: str) -> list[str] | None:
    prefix = f"{key}:"
    for line in front_lines:
        if not line.startswith(prefix):
            continue
        raw = line[len(prefix):].strip()
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return None
        if not isinstance(value, list):
            return None
        return [str(item) for item in value]
    return None


def set_front_matter_list(lines: list[str], closing: int, key: str, values: list[str]) -> tuple[int, bool]:
    prefix = f"{key}:"
    replacement = f"{key}: {json.dumps(values, ensure_ascii=False)}"
    for index in range(1, closing):
        if not lines[index].startswith(prefix):
            continue
        if lines[index] == replacement:
            return closing, False
        lines[index] = replacement
        return closing, True

    lines.insert(closing, replacement)
    return closing + 1, True


def local_raster_reference(reference: str | None, bundle: Path) -> str | None:
    if not reference or "://" in reference or reference.startswith(("/", "#", "data:")):
        return None

    relative = Path(reference)
    if relative.suffix.lower() not in IMAGE_EXTENSIONS or ".." in relative.parts:
        return None

    bundle_root = bundle.resolve()
    candidate = (bundle / relative).resolve()
    try:
        candidate.relative_to(bundle_root)
    except ValueError:
        return None

    return relative.as_posix() if candidate.is_file() else None


def first_local_markdown_image(body: str, bundle: Path) -> str | None:
    for match in MARKDOWN_IMAGE_RE.finditer(body):
        reference = local_raster_reference(match.group(1), bundle)
        if reference:
            return reference
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


def procedural_social_png(page_id: str, slug: str, title: str) -> bytes:
    seed = hashlib.sha256(f"social-preview\0{page_id}\0{slug}\0{title}".encode("utf-8")).digest()
    background, accent, highlight = PALETTES[seed[0] % len(PALETTES)]

    band_gap = 330 + seed[2] % 190
    band_width = 70 + seed[1] % 120
    slope = 1 + seed[3] % 3
    offset = seed[4] % (SOCIAL_FALLBACK_WIDTH + band_gap)
    horizon = 360 + seed[5] % 110

    raw = bytearray()
    for y in range(SOCIAL_FALLBACK_HEIGHT):
        raw.append(0)
        row = bytearray()
        for x in range(SOCIAL_FALLBACK_WIDTH):
            color = background
            diagonal = (x + slope * y + offset) % band_gap
            if diagonal < band_width:
                color = accent
            if y > horizon and ((x // 140) + (y // 80) + seed[6]) % 5 == 0:
                color = highlight
            row.extend(color)
        raw.extend(row)

    ihdr = struct.pack(">IIBBBBB", SOCIAL_FALLBACK_WIDTH, SOCIAL_FALLBACK_HEIGHT, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", zlib.compress(bytes(raw), level=9))
        + png_chunk(b"IEND", b"")
    )


def manifest_source(page_id: str, entry: dict) -> tuple[str, str, Path, Path]:
    slug = str(entry.get("slug", "")).strip()
    if not slug:
        raise RuntimeError(f"Manifest page {page_id} is missing slug")
    bundle_path = str(entry.get("bundlePath", slug)).strip() or slug
    if bundle_path in {".", ".."} or "/" in bundle_path or "\\" in bundle_path:
        raise RuntimeError(f"Manifest page {page_id} has unsafe bundlePath: {bundle_path!r}")
    content_file = str(entry.get("contentFile", "index.md")).strip() or "index.md"
    bundle = POSTS_DIR / bundle_path
    return slug, bundle_path, bundle, bundle / content_file


def main() -> None:
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

    seen_bundles: dict[str, str] = {}
    resolved: list[dict[str, str]] = []
    touched: set[str] = set()

    for page_id, entry in sorted(manifest_pages.items()):
        if not isinstance(entry, dict):
            raise RuntimeError(f"Manifest page {page_id} entry is invalid")
        slug, bundle_path, bundle, index_path = manifest_source(page_id, entry)
        if bundle_path in seen_bundles:
            raise RuntimeError(
                f"Duplicate bundlePath in Notion manifest: {bundle_path} "
                f"({seen_bundles[bundle_path]} / {page_id})"
            )
        seen_bundles[bundle_path] = page_id
        if not index_path.is_file():
            raise RuntimeError(f"Article source is missing from Notion manifest bundle: {index_path}")

        text = index_path.read_text(encoding="utf-8", errors="strict").replace("\r\n", "\n")
        lines = text.split("\n")
        _, closing = front_matter_bounds(lines, index_path)
        front_lines = lines[1:closing]
        cover = front_matter_value(front_lines, "cover")
        fallback_path = bundle / FALLBACK_FILENAME
        social_fallback_path = bundle / SOCIAL_FALLBACK_FILENAME
        body = "\n".join(lines[closing + 1:])

        if cover and cover != FALLBACK_FILENAME:
            images = front_matter_list(front_lines, "images") or []
            existing_social = next(
                (reference for image in images if (reference := local_raster_reference(image, bundle))),
                None,
            )

            if existing_social:
                if social_fallback_path.is_file() and existing_social != SOCIAL_FALLBACK_FILENAME:
                    social_fallback_path.unlink()
                    touched.add(page_id)
                    print(f"🧹 移除舊 Social Preview fallback {slug} [{bundle_path}]: {SOCIAL_FALLBACK_FILENAME}")
                if fallback_path.is_file():
                    fallback_path.unlink()
                    touched.add(page_id)
                    print(f"🧹 移除舊 fallback 封面 {slug} [{bundle_path}]: {FALLBACK_FILENAME}")
                continue

            social_image = local_raster_reference(cover, bundle)
            social_strategy = "explicit-raster-cover"
            if not social_image:
                social_image = first_local_markdown_image(body, bundle)
                social_strategy = "first-localized-markdown-image"

            if not social_image:
                title = front_matter_value(front_lines, "title") or slug
                expected = procedural_social_png(page_id, slug, title)
                if not social_fallback_path.is_file() or social_fallback_path.read_bytes() != expected:
                    social_fallback_path.write_bytes(expected)
                    touched.add(page_id)
                social_image = SOCIAL_FALLBACK_FILENAME
                social_strategy = "deterministic-social-preview-png"
            elif social_fallback_path.is_file() and social_image != SOCIAL_FALLBACK_FILENAME:
                social_fallback_path.unlink()
                touched.add(page_id)

            closing, images_changed = set_front_matter_list(lines, closing, "images", [social_image])
            if images_changed:
                index_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
                touched.add(page_id)

            if fallback_path.is_file():
                fallback_path.unlink()
                touched.add(page_id)
                print(f"🧹 移除舊 fallback 封面 {slug} [{bundle_path}]: {FALLBACK_FILENAME}")

            resolved.append({
                "pageId": page_id,
                "slug": slug,
                "bundlePath": bundle_path,
                "cover": cover,
                "socialImage": social_image,
                "strategy": social_strategy,
            })
            print(f"🌐 Social Preview {slug} [{bundle_path}]: {social_image} ({social_strategy})")
            continue

        if social_fallback_path.is_file():
            social_fallback_path.unlink()
            touched.add(page_id)
            print(f"🧹 移除舊 Social Preview fallback {slug} [{bundle_path}]: {SOCIAL_FALLBACK_FILENAME}")

        image = first_local_markdown_image(body, bundle)

        if not cover and image:
            additions = [f"cover: {json.dumps(image, ensure_ascii=False)}"]
            if front_matter_value(front_lines, "images") is None:
                additions.append(f"images: [{json.dumps(image, ensure_ascii=False)}]")
            lines[closing:closing] = additions
            index_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
            if fallback_path.is_file():
                fallback_path.unlink()
            touched.add(page_id)
            resolved.append({
                "pageId": page_id,
                "slug": slug,
                "bundlePath": bundle_path,
                "cover": image,
                "strategy": "first-localized-markdown-image",
            })
            print(f"🖼️  自動封面（內文首圖） {slug} [{bundle_path}]: {image}")
            continue

        if not cover or cover == FALLBACK_FILENAME:
            title = front_matter_value(front_lines, "title") or slug
            expected = procedural_cover_png(page_id, slug, title)
            if not fallback_path.is_file() or fallback_path.read_bytes() != expected:
                fallback_path.write_bytes(expected)
                touched.add(page_id)

            additions: list[str] = []
            if not cover:
                additions.append(f"cover: {json.dumps(FALLBACK_FILENAME)}")
            if front_matter_value(front_lines, "images") is None:
                additions.append(f"images: [{json.dumps(FALLBACK_FILENAME)}]")

            if additions:
                lines[closing:closing] = additions
                index_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
                touched.add(page_id)

            resolved.append({
                "pageId": page_id,
                "slug": slug,
                "bundlePath": bundle_path,
                "cover": FALLBACK_FILENAME,
                "strategy": "deterministic-procedural-png",
            })
            print(f"🎨 自動封面（程序化 fallback） {slug} [{bundle_path}]: {FALLBACK_FILENAME}")

    if touched:
        for page_id in sorted(touched):
            entry = manifest_pages[page_id]
            _, _, bundle, _ = manifest_source(page_id, entry)
            entry["bundleHash"] = directory_hash(bundle)

        MANIFEST_PATH.write_text(
            f"{json.dumps(manifest, ensure_ascii=False, indent=2)}\n",
            encoding="utf-8",
            newline="\n",
        )

    report["coverResolution"] = {
        "status": "complete",
        "strategy": (
            "hero: explicit-cover > first-localized-markdown-image > deterministic-procedural-png; "
            "social: existing-raster-images > raster-cover > first-localized-markdown-image > deterministic-social-preview-png"
        ),
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
