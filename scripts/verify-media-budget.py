#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = Path(__file__).with_name("media-budget-contract.py")
spec = importlib.util.spec_from_file_location("media_budget_contract", CONTRACT)
if spec is None or spec.loader is None:
    raise RuntimeError("Unable to load media-budget-contract.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def mib(value: int) -> str:
    return f"{value / (1024 * 1024):.2f} MiB"


def main() -> None:
    audit = module.audit_media(ROOT / "content" / "posts")
    for warning in audit.warnings:
        print(f"::warning::{warning}")
    if audit.errors:
        for error in audit.errors:
            print(f"::error::{error}")
        raise SystemExit(1)

    largest = sorted(audit.files, key=lambda item: (-item.size, item.path.as_posix()))[:5]
    summary = ", ".join(
        f"{item.path.relative_to(ROOT / 'content' / 'posts').as_posix()}={mib(item.size)}"
        for item in largest
    ) or "none"
    print(
        "Media budget verification: PASS "
        f"(files={len(audit.files)}, total={mib(audit.total_bytes)}, "
        f"hard-file={mib(module.DEFAULT_MAX_FILE_BYTES)}, "
        f"total-budget={mib(module.DEFAULT_TOTAL_MEDIA_BYTES)}, largest={summary})"
    )


if __name__ == "__main__":
    main()
