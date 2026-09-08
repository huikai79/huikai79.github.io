#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from article_routing import MANIFEST, routes

DEFAULT_LANGUAGE = "zh-TW"
LANGUAGE_TOKENS = {"zh-CN": "zh-cn", "en": "en"}
RESOURCE_STEM = r"(?:cover|cover-fallback|social-preview|icon|image-\d+)"
MANAGED_NAME = re.compile(
    rf"^({RESOURCE_STEM})(?:\.(zh-cn|en))?(\.[A-Za-z0-9]+)$",
    re.IGNORECASE,
)
REFERENCE = re.compile(
    rf"(?<![A-Za-z0-9_./-])(({RESOURCE_STEM})\.[A-Za-z0-9]+)(?![A-Za-z0-9_.-])",
    re.IGNORECASE,
)


def directory_hash(directory: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in directory.rglob("*") if item.is_file()):
        relative = path.relative_to(directory).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def qualified_name(name: str, token: str) -> str:
    match = MANAGED_NAME.fullmatch(name)
    if not match:
        return name
    stem, existing_token, extension = match.groups()
    if existing_token:
        if existing_token.lower() != token:
            raise RuntimeError(f"Page resource language mismatch: {name} vs {token}")
        return name
    return f"{stem}.{token}{extension}"


def referenced_names(text: str) -> set[str]:
    return {match.group(1) for match in REFERENCE.finditer(text)}


def process_route(route, *, check: bool) -> bool:
    if route.language == DEFAULT_LANGUAGE:
        return False
    token = LANGUAGE_TOKENS.get(route.language)
    if not token:
        raise RuntimeError(f"No page-resource token configured for {route.language}")
    if not route.source.is_file():
        raise FileNotFoundError(f"Routed source is missing: {route.source}")

    text = route.source.read_text(encoding="utf-8")
    changed = False
    replacements: dict[str, str] = {}

    for path in sorted(item for item in route.bundle.iterdir() if item.is_file()):
        if path.name == route.content_file:
            continue
        match = MANAGED_NAME.fullmatch(path.name)
        if not match:
            continue
        target_name = qualified_name(path.name, token)
        if target_name == path.name:
            continue
        if check:
            raise RuntimeError(f"Unqualified {route.language} page resource: {path}")
        target = path.with_name(target_name)
        if target.exists():
            raise FileExistsError(f"Page-resource rename collision: {path} -> {target}")
        path.replace(target)
        replacements[path.name] = target_name
        changed = True

    for old_name in sorted(referenced_names(text)):
        target_name = qualified_name(old_name, token)
        if target_name == old_name:
            continue
        old_path = route.bundle / old_name
        target_path = route.bundle / target_name
        if check:
            raise RuntimeError(
                f"Unqualified {route.language} page-resource reference in {route.source}: {old_name}"
            )
        if old_path.exists() and old_name not in replacements:
            if target_path.exists():
                raise FileExistsError(f"Page-resource rename collision: {old_path} -> {target_path}")
            old_path.replace(target_path)
            replacements[old_name] = target_name
            changed = True
        elif not target_path.exists() and old_name not in replacements:
            raise FileNotFoundError(
                f"Referenced managed page resource is missing: {route.source} -> {old_name}"
            )
        replacements.setdefault(old_name, target_name)

    for old_name, target_name in replacements.items():
        text = text.replace(old_name, target_name)

    if changed:
        route.source.write_text(text, encoding="utf-8")

    verified = route.source.read_text(encoding="utf-8")
    leftovers = sorted(referenced_names(verified))
    if leftovers:
        raise RuntimeError(
            f"Unqualified {route.language} page-resource references remain in {route.source}: {leftovers}"
        )
    for path in route.bundle.iterdir():
        if path.is_file() and path.name != route.content_file:
            match = MANAGED_NAME.fullmatch(path.name)
            if match and not match.group(2):
                raise RuntimeError(f"Unqualified {route.language} page resource remains: {path}")

    return changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    pages = manifest.get("pages")
    if not isinstance(pages, dict):
        raise RuntimeError("Notion manifest pages map is missing")

    checked = 0
    changed = 0
    for route in routes(manifest):
        if route.language == DEFAULT_LANGUAGE:
            continue
        checked += 1
        if process_route(route, check=args.check):
            entry = pages.get(route.page_id)
            if not isinstance(entry, dict):
                raise RuntimeError(f"Manifest entry is missing for {route.page_id}")
            entry["bundleHash"] = directory_hash(route.bundle)
            changed += 1

    if not args.check and changed:
        MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    mode = "check" if args.check else "localize"
    print(f"Multilingual page resources: PASS ({mode}, articles={checked}, changed={changed})")


if __name__ == "__main__":
    main()
