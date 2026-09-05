#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POSTS_DIR = ROOT / "content" / "posts"
REPORT_PATH = ROOT / ".notion-sync-report.json"
MANIFEST_PATH = ROOT / ".notion-sync-manifest.json"
IMAGE_EXTENSIONS = {".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"}
MARKDOWN_IMAGE_RE = re.compile(r'!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)')


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

    for index_path in sorted(POSTS_DIR.glob("*/index.md")):
        bundle = index_path.parent
        slug = bundle.name
        text = index_path.read_text(encoding="utf-8", errors="strict").replace("\r\n", "\n")
        lines = text.split("\n")
        _, closing = front_matter_bounds(lines, index_path)
        front_lines = lines[1:closing]

        # Explicit Notion/manual cover always wins. Phase 1 only resolves a
        # missing cover from media already localized into this article bundle.
        if front_matter_value(front_lines, "cover") is not None:
            continue

        body = "\n".join(lines[closing + 1:])
        image = first_local_markdown_image(body, bundle)
        if not image:
            continue

        additions = [f"cover: {json.dumps(image, ensure_ascii=False)}"]
        if front_matter_value(front_lines, "images") is None:
            additions.append(f"images: [{json.dumps(image, ensure_ascii=False)}]")

        lines[closing:closing] = additions
        index_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")

        manifest_entry = by_slug.get(slug)
        if manifest_entry is None:
            raise RuntimeError(f"Resolved article is missing from Notion manifest: {slug}")

        page_id, entry = manifest_entry
        entry["bundleHash"] = directory_hash(bundle)
        resolved.append({"pageId": page_id, "slug": slug, "cover": image})
        print(f"🖼️  自動封面（內文首圖） {slug}: {image}")

    if resolved:
        MANIFEST_PATH.write_text(
            f"{json.dumps(manifest, ensure_ascii=False, indent=2)}\n",
            encoding="utf-8",
            newline="\n",
        )

    report["coverResolution"] = {
        "status": "complete",
        "strategy": "first-localized-markdown-image",
        "resolved": resolved,
    }
    REPORT_PATH.write_text(
        f"{json.dumps(report, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
        newline="\n",
    )

    print(f"Cover resolution: PASS ({len(resolved)} article(s) resolved)")


if __name__ == "__main__":
    main()
