#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import tempfile
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("media-library-report.py")
spec = importlib.util.spec_from_file_location("media_library_report", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp) / "posts"
    first = root / "first"
    second = root / "second"
    first.mkdir(parents=True)
    second.mkdir(parents=True)

    duplicate_bytes = b"same-image-bytes"
    (first / "cover.jpg").write_bytes(duplicate_bytes)
    (second / "copy.jpg").write_bytes(duplicate_bytes)
    (second / "orphan.png").write_bytes(b"orphan")
    (first / "index.md").write_text(
        '---\ncover: "cover.jpg"\n---\n\n![Useful alt](cover.jpg)\n![ ](missing.png)\n',
        encoding="utf-8",
    )
    (second / "index.md").write_text('---\ntitle: "Second"\n---\n', encoding="utf-8")

    result = module.report(root)

    assert result["status"] == "pass"
    assert result["media"]["count"] == 3
    assert result["duplicates"]["groupCount"] == 1
    assert result["duplicates"]["wastedBytes"] == len(duplicate_bytes)
    assert result["references"]["orphanCandidateCount"] == 2
    assert sorted(result["references"]["orphanCandidates"]) == ["second/copy.jpg", "second/orphan.png"]
    assert result["accessibility"]["inlineImages"] == 2
    assert result["accessibility"]["inlineImagesMissingAlt"] == 1
    assert result["optimization"]["largeImageCandidateCount"] == 0

print("Media Library report fixture verification: PASS")
