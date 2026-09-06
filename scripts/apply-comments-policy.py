#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POSTS = ROOT / "content" / "posts"
MANIFEST = ROOT / ".notion-sync-manifest.json"
LEGACY_COMMENTS_TAG = "技术学习"


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


def split_front_matter(text: str) -> tuple[list[str], str]:
    normalized = text.replace("\r\n", "\n")
    lines = normalized.split("\n")
    if not lines or lines[0].strip() != "---":
        raise ValueError("missing opening front matter delimiter")

    try:
        closing = next(index for index in range(1, len(lines)) if lines[index].strip() == "---")
    except StopIteration as error:
        raise ValueError("missing closing front matter delimiter") from error

    return lines[1:closing], "\n".join(lines[closing + 1 :])


def value_for(front: list[str], key: str) -> str | None:
    prefix = f"{key}:"
    for line in front:
        if line.startswith(prefix):
            return line.split(":", 1)[1].strip()
    return None


def parse_tags(front: list[str]) -> list[str]:
    raw = value_for(front, "tags")
    if raw is None:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError(f"tags must remain a JSON-compatible YAML array: {raw}") from error
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise ValueError("tags must be an array of strings")
    return parsed


def parse_scalar(front: list[str], key: str) -> str:
    raw = value_for(front, key)
    if raw is None:
        return ""
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return raw.strip('"').strip()
    return str(parsed).strip()


def comments_policy(front: list[str]) -> tuple[bool, str]:
    visibility = parse_scalar(front, "contentVisibility")
    if visibility:
        return visibility == "Public", f"contentVisibility={visibility}"

    # Compatibility only while legacy generated articles do not yet carry the
    # new editorial front matter. Remove this fallback after production mode is activated.
    legacy = LEGACY_COMMENTS_TAG in parse_tags(front)
    return legacy, f"legacy-tag={LEGACY_COMMENTS_TAG}"


def apply_policy(index_file: Path, page_id: str) -> tuple[bool, bool, str]:
    original = index_file.read_text(encoding="utf-8")
    front, body = split_front_matter(original)
    comments_enabled, policy_source = comments_policy(front)

    cleaned = [
        line
        for line in front
        if not line.startswith("showComments:") and not line.startswith("commentKey:")
    ]

    if comments_enabled:
        insertion = next((i + 1 for i, line in enumerate(cleaned) if line.startswith("tags:")), len(cleaned))
        cleaned[insertion:insertion] = [
            "showComments: true",
            f"commentKey: {json.dumps(f'notion:{page_id}', ensure_ascii=False)}",
        ]

    rewritten = "---\n" + "\n".join(cleaned) + "\n---\n" + body
    if not rewritten.endswith("\n"):
        rewritten += "\n"

    changed = rewritten != original.replace("\r\n", "\n")
    if changed:
        index_file.write_text(rewritten, encoding="utf-8")
    return changed, comments_enabled, policy_source


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    pages = manifest.get("pages")
    if not isinstance(pages, dict):
        raise SystemExit("Notion manifest is missing pages")

    slug_to_page_id: dict[str, str] = {}
    for page_id, entry in pages.items():
        if not isinstance(entry, dict):
            raise SystemExit(f"Invalid manifest entry for {page_id}")
        slug = str(entry.get("slug", "")).strip()
        if not slug:
            raise SystemExit(f"Manifest page {page_id} has no slug")
        if slug in slug_to_page_id:
            raise SystemExit(f"Duplicate slug in manifest: {slug}")
        slug_to_page_id[slug] = page_id

    source_slugs = sorted(path.parent.name for path in POSTS.glob("*/index.md"))
    manifest_slugs = sorted(slug_to_page_id)
    if source_slugs != manifest_slugs:
        raise SystemExit(
            f"Comments policy source/manifest mismatch: source={source_slugs}, manifest={manifest_slugs}"
        )

    changed = 0
    enabled = 0
    policy_sources: dict[str, int] = {}

    for slug in source_slugs:
        index_file = POSTS / slug / "index.md"
        page_id = slug_to_page_id[slug]
        did_change, is_enabled, policy_source = apply_policy(index_file, page_id)
        changed += int(did_change)
        enabled += int(is_enabled)
        policy_sources[policy_source] = policy_sources.get(policy_source, 0) + 1
        pages[page_id]["bundleHash"] = directory_hash(index_file.parent)

    MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        "Comments policy: "
        f"enabled={enabled}, changed={changed}, total={len(source_slugs)}, sources={policy_sources}"
    )


if __name__ == "__main__":
    main()
