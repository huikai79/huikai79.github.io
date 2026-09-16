#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / ".notion-sync-manifest.json"
POSTS = ROOT / "content" / "posts"
LASTMOD_RE = re.compile(r"^lastmod:\s*.*(?:\n|$)", re.MULTILINE)
DESCRIPTION_RE = re.compile(r"^description:\s*(.+)$", re.MULTILINE)
SUMMARY_RE = re.compile(r"^summary:\s*.*$", re.MULTILINE)


def directory_hash(directory: Path) -> str:
    digest = hashlib.sha256()
    files = sorted(path for path in directory.rglob("*") if path.is_file())
    for file_path in files:
        relative = file_path.relative_to(directory).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(file_path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def split_front_matter(text: str) -> tuple[str, str, str]:
    normalized = text.replace("\r\n", "\n")
    if not normalized.startswith("---\n"):
        raise ValueError("missing opening front matter delimiter")
    closing = normalized.find("\n---\n", 4)
    if closing < 0:
        raise ValueError("missing closing front matter delimiter")
    return normalized, normalized[4:closing], normalized[closing:]


def remove_lastmod(text: str) -> tuple[str, bool]:
    normalized, front, suffix = split_front_matter(text)
    next_front = LASTMOD_RE.sub("", front)
    rewritten = "---\n" + next_front + suffix
    return rewritten, rewritten != normalized


def project_summary(text: str) -> tuple[str, bool]:
    normalized, front, suffix = split_front_matter(text)
    description_match = DESCRIPTION_RE.search(front)
    if not description_match:
        return normalized, False

    summary_line = f"summary: {description_match.group(1)}"
    if SUMMARY_RE.search(front):
        next_front = SUMMARY_RE.sub(summary_line, front, count=1)
    else:
        next_front = DESCRIPTION_RE.sub(
            lambda match: f"{match.group(0)}\n{summary_line}",
            front,
            count=1,
        )

    rewritten = "---\n" + next_front + suffix
    return rewritten, rewritten != normalized


def normalize_editorial_front_matter(text: str) -> tuple[str, bool]:
    without_lastmod, removed_lastmod = remove_lastmod(text)
    rewritten, projected_summary = project_summary(without_lastmod)
    return rewritten, removed_lastmod or projected_summary


def apply(manifest_path: Path = MANIFEST, posts_root: Path = POSTS) -> tuple[int, int]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    pages = manifest.get("pages")
    if not isinstance(pages, dict):
        raise ValueError("Notion manifest is missing pages")

    changed = 0
    for page_id, entry in pages.items():
        if not isinstance(entry, dict):
            raise ValueError(f"manifest page entry is invalid: {page_id}")
        bundle_path = str(entry.get("bundlePath") or entry.get("slug") or "").strip()
        content_file = str(entry.get("contentFile") or "index.md").strip()
        if not bundle_path or not content_file:
            raise ValueError(f"manifest page is missing bundlePath/contentFile: {page_id}")

        source = posts_root / bundle_path / content_file
        if not source.is_file():
            raise ValueError(f"manifest article source is missing: {source}")
        rewritten, did_change = normalize_editorial_front_matter(source.read_text(encoding="utf-8"))
        if did_change:
            source.write_text(rewritten, encoding="utf-8")
            changed += 1
        entry["bundleHash"] = directory_hash(source.parent)

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return changed, len(pages)


def main() -> None:
    changed, total = apply()
    print(f"Editorial metadata normalization: changed={changed}, total={total}")


if __name__ == "__main__":
    main()
