#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import tempfile
from pathlib import Path

CONTRACT = Path(__file__).with_name("media-budget-contract.py")
spec = importlib.util.spec_from_file_location("media_budget_contract_test", CONTRACT)
if spec is None or spec.loader is None:
    raise RuntimeError("Unable to load media-budget-contract.py")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def create_file(path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        handle.truncate(size)


def assert_contains(items: tuple[str, ...], fragment: str) -> None:
    if not any(fragment in item for item in items):
        raise AssertionError(f"Expected {fragment!r} in {items!r}")


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        posts = Path(tmp) / "posts"
        create_file(posts / "a" / "index.md", 100)
        create_file(posts / "a" / "cover.jpg", 2_500)
        create_file(posts / "b" / "attachment.pdf", 1_000)

        healthy = module.audit_media(
            posts,
            max_file_bytes=5_000,
            total_media_bytes=10_000,
            warn_file_bytes=2_000,
        )
        if healthy.errors:
            raise AssertionError(f"Healthy fixture unexpectedly failed: {healthy.errors}")
        if healthy.total_bytes != 3_500 or len(healthy.files) != 2:
            raise AssertionError(f"Unexpected healthy accounting: {healthy}")
        assert_contains(healthy.warnings, "large managed media file")

        create_file(posts / "c" / "audio.mp3", 100)
        streaming = module.audit_media(
            posts,
            max_file_bytes=5_000,
            total_media_bytes=10_000,
            warn_file_bytes=2_000,
        )
        assert_contains(streaming.errors, "streaming media must not be committed")

        (posts / "c" / "audio.mp3").unlink()
        create_file(posts / "d" / "too-large.pdf", 5_001)
        oversized = module.audit_media(
            posts,
            max_file_bytes=5_000,
            total_media_bytes=20_000,
            warn_file_bytes=2_000,
        )
        assert_contains(oversized.errors, "hard limit")

        (posts / "d" / "too-large.pdf").unlink()
        create_file(posts / "d" / "more.bin", 7_000)
        total = module.audit_media(
            posts,
            max_file_bytes=8_000,
            total_media_bytes=9_000,
            warn_file_bytes=2_000,
        )
        assert_contains(total.errors, "media total exceeds")

    print("Media budget contract verification: PASS")


if __name__ == "__main__":
    main()
