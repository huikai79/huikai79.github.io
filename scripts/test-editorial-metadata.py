#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import tempfile
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("apply-editorial-metadata.py")
spec = importlib.util.spec_from_file_location("apply_editorial_metadata", MODULE_PATH)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
add_or_replace_lastmod = module.add_or_replace_lastmod
apply = module.apply

SAMPLE = """---
title: \"Sample\"
date: \"2026-09-01\"
slug: \"sample\"
---

Body.
"""

rewritten, changed = add_or_replace_lastmod(SAMPLE, "2026-09-10T01:02:03.000Z")
assert changed
assert 'date: "2026-09-01"\nlastmod: "2026-09-10T01:02:03.000Z"' in rewritten
rewritten_again, changed_again = add_or_replace_lastmod(rewritten, "2026-09-10T01:02:03.000Z")
assert not changed_again
assert rewritten_again == rewritten

with tempfile.TemporaryDirectory() as raw:
    root = Path(raw)
    posts = root / "posts"
    bundle = posts / "sample"
    bundle.mkdir(parents=True)
    source = bundle / "index.md"
    source.write_text(SAMPLE, encoding="utf-8")
    manifest = root / "manifest.json"
    manifest.write_text(json.dumps({
        "version": 2,
        "pages": {
            "11111111-1111-4111-8111-111111111111": {
                "slug": "sample",
                "bundlePath": "sample",
                "contentFile": "index.md",
                "lastEditedTime": "2026-09-10T01:02:03.000Z",
                "bundleHash": "old"
            }
        }
    }), encoding="utf-8")

    changed_count, total = apply(manifest, posts)
    assert (changed_count, total) == (1, 1)
    state = json.loads(manifest.read_text(encoding="utf-8"))
    assert state["pages"]["11111111-1111-4111-8111-111111111111"]["bundleHash"] != "old"
    changed_count, total = apply(manifest, posts)
    assert (changed_count, total) == (0, 1)

print("Editorial metadata projection tests: PASS")
