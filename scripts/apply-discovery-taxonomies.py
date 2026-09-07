#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from article_routing import MANIFEST, routes
from discovery_taxonomy_contract import project_formats


def directory_hash(directory: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in directory.rglob("*") if item.is_file()):
        relative = path.relative_to(directory).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    pages = manifest.get("pages")
    if not isinstance(pages, dict):
        raise SystemExit("Notion manifest is missing pages")

    article_routes = routes(manifest)
    missing = [str(route.source) for route in article_routes if not route.source.is_file()]
    if missing:
        raise SystemExit(f"Discovery taxonomy routed source missing: {missing}")

    changed = 0
    formats: dict[str, int] = {}
    for route in article_routes:
        original = route.source.read_text(encoding="utf-8")
        rewritten, entry_type = project_formats(original)
        formats[entry_type] = formats.get(entry_type, 0) + 1
        if rewritten != original.replace("\r\n", "\n"):
            route.source.write_text(rewritten, encoding="utf-8", newline="\n")
            changed += 1
        pages[route.page_id]["bundleHash"] = directory_hash(route.source.parent)

    MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(
        "Discovery taxonomy projection: "
        f"changed={changed}, total={len(article_routes)}, formats={formats}"
    )


if __name__ == "__main__":
    main()
