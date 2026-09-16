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


def remove_lastmod(text: str) -> tuple[str, bool]:
    normalized = text.replace("\r\n", "\n")
    if not normalized.startswith("---\n"):
        raise ValueError("missing opening front matter delimiter")
    closing = normalized.find("\n---\n", 4)
    if closing < 0:
        raise ValueError("missing closing front matter delimiter")

    front = normalized[4:closing]
    next_front = LASTMOD_RE.sub("", front)
    rewritten = "---\n" + next_front + normalized[closing:]
    return rewritten, rewritten != normalized


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
        rewritten, did_change = remove_lastmod(source.read_text(encoding="utf-8"))
        if did_change:
            source.write_text(rewritten, encoding="utf-8")
            changed += 1
        entry["bundleHash"] = directory_hash(source.parent)

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return changed, len(pages)


def main() -> None:
    changed, total = apply()
    print(f"Editorial metadata normalization: lastmod removed={changed}, total={total}")


if __name__ == "__main__":
    main()
