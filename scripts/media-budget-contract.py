#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024
DEFAULT_TOTAL_MEDIA_BYTES = 100 * 1024 * 1024
DEFAULT_WARN_FILE_BYTES = 2 * 1024 * 1024
STREAMING_MEDIA_EXTENSIONS = {
    ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi",
    ".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac",
}
TEXT_EXTENSIONS = {".md", ".markdown", ".txt", ".json", ".toml", ".yaml", ".yml"}


@dataclass(frozen=True)
class MediaFile:
    path: Path
    size: int


@dataclass(frozen=True)
class MediaAudit:
    files: tuple[MediaFile, ...]
    total_bytes: int
    warnings: tuple[str, ...]
    errors: tuple[str, ...]


def managed_media_files(posts_root: Path) -> list[MediaFile]:
    if not posts_root.is_dir():
        raise ValueError(f"Managed posts root does not exist: {posts_root}")
    files: list[MediaFile] = []
    for path in sorted(item for item in posts_root.rglob("*") if item.is_file()):
        if path.name.startswith("_index.") or path.name == "_index.md":
            continue
        if path.suffix.lower() in TEXT_EXTENSIONS:
            continue
        files.append(MediaFile(path=path, size=path.stat().st_size))
    return files


def audit_media(
    posts_root: Path,
    *,
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
    total_media_bytes: int = DEFAULT_TOTAL_MEDIA_BYTES,
    warn_file_bytes: int = DEFAULT_WARN_FILE_BYTES,
) -> MediaAudit:
    files = managed_media_files(posts_root)
    errors: list[str] = []
    warnings: list[str] = []
    total = sum(item.size for item in files)

    for item in files:
        relative = item.path.relative_to(posts_root).as_posix()
        suffix = item.path.suffix.lower()
        if suffix in STREAMING_MEDIA_EXTENSIONS:
            errors.append(
                f"streaming media must not be committed under content/posts: {relative} ({item.size} bytes)"
            )
        if item.size > max_file_bytes:
            errors.append(
                f"managed media file exceeds {max_file_bytes}-byte hard limit: {relative} ({item.size} bytes)"
            )
        elif item.size >= warn_file_bytes:
            warnings.append(
                f"large managed media file: {relative} ({item.size} bytes; warning threshold {warn_file_bytes})"
            )

    if total > total_media_bytes:
        errors.append(
            f"managed article media total exceeds {total_media_bytes}-byte budget: {total} bytes"
        )

    return MediaAudit(
        files=tuple(files),
        total_bytes=total,
        warnings=tuple(warnings),
        errors=tuple(errors),
    )
