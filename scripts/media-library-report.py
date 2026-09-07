#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

MEDIA_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif",
    ".mp3", ".m4a", ".aac", ".wav", ".ogg", ".oga", ".flac",
    ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi",
}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif"}
INLINE_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
LARGE_IMAGE_WARNING_BYTES = 2 * 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def bundle_markdown_text(bundle: Path) -> str:
    chunks = []
    for markdown in sorted(bundle.glob("*.md")):
        chunks.append(markdown.read_text(encoding="utf-8", errors="strict"))
    return "\n".join(chunks)


def report(root: Path) -> dict[str, object]:
    root = root.resolve()
    media_files = sorted(
        path for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in MEDIA_EXTENSIONS
    )

    by_extension: Counter[str] = Counter()
    hashes: defaultdict[str, list[str]] = defaultdict(list)
    orphan_candidates: list[str] = []
    large_image_candidates: list[dict[str, object]] = []
    inline_images = 0
    inline_images_missing_alt = 0
    total_bytes = 0

    bundle_text_cache: dict[Path, str] = {}
    largest: list[dict[str, object]] = []

    for path in media_files:
        relative = path.relative_to(root).as_posix()
        size = path.stat().st_size
        total_bytes += size
        suffix = path.suffix.lower()
        by_extension[suffix] += 1
        hashes[sha256_file(path)].append(relative)
        largest.append({"path": relative, "bytes": size})

        bundle = path.parent
        text = bundle_text_cache.setdefault(bundle, bundle_markdown_text(bundle))
        if path.name not in text:
            orphan_candidates.append(relative)

        if suffix in IMAGE_EXTENSIONS and size > LARGE_IMAGE_WARNING_BYTES:
            large_image_candidates.append({"path": relative, "bytes": size})

    for markdown in sorted(root.rglob("*.md")):
        text = markdown.read_text(encoding="utf-8", errors="strict")
        for match in INLINE_IMAGE_RE.finditer(text):
            inline_images += 1
            if not match.group(1).strip():
                inline_images_missing_alt += 1

    duplicate_groups = [
        {"sha256": digest, "paths": paths, "wastedBytes": sum((root / p).stat().st_size for p in paths[1:])}
        for digest, paths in sorted(hashes.items())
        if len(paths) > 1
    ]

    largest.sort(key=lambda item: (-int(item["bytes"]), str(item["path"])))
    large_image_candidates.sort(key=lambda item: (-int(item["bytes"]), str(item["path"])))

    return {
        "status": "pass",
        "root": root.as_posix(),
        "media": {
            "count": len(media_files),
            "totalBytes": total_bytes,
            "byExtension": dict(sorted(by_extension.items())),
            "largest": largest[:10],
        },
        "duplicates": {
            "groups": duplicate_groups,
            "groupCount": len(duplicate_groups),
            "wastedBytes": sum(int(group["wastedBytes"]) for group in duplicate_groups),
        },
        "references": {
            "orphanCandidates": orphan_candidates,
            "orphanCandidateCount": len(orphan_candidates),
        },
        "accessibility": {
            "inlineImages": inline_images,
            "inlineImagesMissingAlt": inline_images_missing_alt,
        },
        "optimization": {
            "largeImageWarningBytes": LARGE_IMAGE_WARNING_BYTES,
            "largeImageCandidates": large_image_candidates,
            "largeImageCandidateCount": len(large_image_candidates),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Report current Hugo article media-library health without mutating content.")
    parser.add_argument("--root", default="content/posts", help="Article bundle root")
    parser.add_argument("--json", dest="json_path", help="Optional JSON report path")
    args = parser.parse_args()

    result = report(Path(args.root))
    payload = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.json_path:
        Path(args.json_path).write_text(payload, encoding="utf-8")

    media = result["media"]
    duplicates = result["duplicates"]
    references = result["references"]
    accessibility = result["accessibility"]
    optimization = result["optimization"]
    print(
        "Media Library report: PASS "
        f"(files={media['count']}, total={media['totalBytes']} bytes, "
        f"duplicate-groups={duplicates['groupCount']}, "
        f"orphan-candidates={references['orphanCandidateCount']}, "
        f"inline-images={accessibility['inlineImages']}, "
        f"missing-alt={accessibility['inlineImagesMissingAlt']}, "
        f"large-image-candidates={optimization['largeImageCandidateCount']})"
    )


if __name__ == "__main__":
    main()
