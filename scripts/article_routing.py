#!/usr/bin/env python3
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POSTS = ROOT / "content" / "posts"
MANIFEST = ROOT / ".notion-sync-manifest.json"

LANGUAGE_FILES = {
    "zh-TW": "index.md",
    "zh-CN": "index.zh-cn.md",
    "en": "index.en.md",
}
LANGUAGE_PREFIXES = {
    "zh-TW": "",
    "zh-CN": "zh-cn",
    "en": "en",
}


def manifest_bundle_path(entry: dict, page_id: str) -> str:
    slug = str(entry.get("slug", "")).strip()
    bundle_path = str(entry.get("bundlePath", slug)).strip() or slug
    if not bundle_path:
        raise ValueError(f"Manifest entry has no bundlePath/slug: {page_id}")
    if bundle_path in {".", ".."} or "/" in bundle_path or "\\" in bundle_path:
        raise ValueError(f"Unsafe article bundlePath for {page_id}: {bundle_path!r}")
    return bundle_path


@dataclass(frozen=True)
class ArticleRoute:
    page_id: str
    slug: str
    bundle_path: str
    language: str
    content_file: str
    translation_group: str

    @property
    def source(self) -> Path:
        return POSTS / self.bundle_path / self.content_file

    @property
    def bundle(self) -> Path:
        return POSTS / self.bundle_path

    @property
    def source_path(self) -> str:
        return f"posts/{self.bundle_path}"

    def rendered(self, public: Path) -> Path:
        prefix = LANGUAGE_PREFIXES[self.language]
        base = public / prefix if prefix else public
        return base / "posts" / self.slug.lower() / "index.html"

    @property
    def permalink_path(self) -> str:
        prefix = LANGUAGE_PREFIXES[self.language]
        parts = [prefix, "posts", self.slug.lower()] if prefix else ["posts", self.slug.lower()]
        return "/" + "/".join(part for part in parts if part) + "/"


def load_manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def routes(manifest: dict | None = None) -> list[ArticleRoute]:
    manifest = manifest or load_manifest()
    pages = manifest.get("pages", {})
    if not isinstance(pages, dict):
        raise ValueError("Notion manifest pages map is missing or invalid")
    result: list[ArticleRoute] = []
    seen_bundles: dict[str, str] = {}
    seen_routes: dict[tuple[str, str], str] = {}
    for page_id, entry in sorted(pages.items()):
        if not isinstance(entry, dict):
            raise ValueError(f"Invalid manifest entry for {page_id}")
        slug = str(entry.get("slug", "")).strip()
        if not slug:
            raise ValueError(f"Manifest entry has no slug: {page_id}")
        language = str(entry.get("language", "zh-TW")).strip() or "zh-TW"
        if language not in LANGUAGE_FILES:
            raise ValueError(f"Unsupported article language for {page_id}: {language}")
        content_file = str(entry.get("contentFile", LANGUAGE_FILES[language])).strip() or LANGUAGE_FILES[language]
        if content_file != LANGUAGE_FILES[language]:
            raise ValueError(f"Content filename mismatch for {page_id}: {content_file} != {LANGUAGE_FILES[language]}")
        bundle_path = manifest_bundle_path(entry, page_id)
        if bundle_path in seen_bundles:
            raise ValueError(
                f"Duplicate article bundlePath {bundle_path}: {seen_bundles[bundle_path]} / {page_id}"
            )
        seen_bundles[bundle_path] = page_id
        route_key = (language, slug.casefold())
        if route_key in seen_routes:
            raise ValueError(
                f"Duplicate rendered article route {language}/{slug}: {seen_routes[route_key]} / {page_id}"
            )
        seen_routes[route_key] = page_id
        result.append(ArticleRoute(
            page_id=page_id,
            slug=slug,
            bundle_path=bundle_path,
            language=language,
            content_file=content_file,
            translation_group=str(entry.get("translationGroup", "")).strip(),
        ))
    return result


def source_files(manifest: dict | None = None) -> list[Path]:
    return [route.source for route in routes(manifest)]


def rendered_files(public: Path, manifest: dict | None = None) -> list[Path]:
    return [route.rendered(public) for route in routes(manifest)]
