#!/usr/bin/env python3
from __future__ import annotations

import html
import sys
from pathlib import Path

from article_routing import routes
from language_route_alias_contract import legacy_alias_plans

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
BASE = "https://huikai.com.kg"


def redirect_document(target: str) -> str:
    escaped = html.escape(target, quote=True)
    return f'''<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0; url={escaped}">\n<link rel="canonical" href="{escaped}">\n<meta name="robots" content="noindex">\n<title>Redirecting…</title>\n</head>\n<body><p><a href="{escaped}">Continue</a></p></body>\n</html>\n'''


written = 0
preserved = 0
for plan in legacy_alias_plans(routes()):
    route = plan.route
    legacy_path = f"/posts/{route.slug.lower()}/"
    legacy = PUBLIC / "posts" / route.slug.lower() / "index.html"
    if plan.preserves_canonical:
        owner = plan.primary_owner
        if owner is None:
            raise RuntimeError("Legacy alias plan lost its canonical owner")
        expected_owner = owner.rendered(PUBLIC)
        if not expected_owner.is_file():
            raise SystemExit(
                f"Canonical zh-TW route is missing before alias preservation: {owner.permalink_path}"
            )
        if legacy.resolve() != expected_owner.resolve():
            raise SystemExit(
                f"Canonical alias planning mismatch for {legacy_path}: {legacy} != {expected_owner}"
            )
        preserved += 1
        print(
            f"Canonical route preserved: {legacy_path} owned by zh-TW; "
            f"no legacy alias written for {route.language}:{route.permalink_path}"
        )
        continue

    canonical = route.permalink_path
    destination = f"{BASE}{canonical}"
    if legacy.exists():
        raise SystemExit(
            f"Refusing to overwrite existing rendered route with legacy alias: {legacy_path}"
        )
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_text(redirect_document(destination), encoding="utf-8")
    written += 1
    print(f"Legacy route alias: {legacy_path} -> {canonical}")

print(f"Language route aliases written: {written}; canonical routes preserved: {preserved}")
