#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import struct
from pathlib import Path

ROOT = Path(os.environ.get("SITE_ROOT", Path(__file__).resolve().parents[1])).resolve()
STRICT = os.environ.get("STRICT_CONTENT") == "1"
REPORT_PATH = ROOT / ".notion-sync-report.json"
FALLBACK_FILENAME = "cover-fallback.png"
FALLBACK_WIDTH = 1600
FALLBACK_HEIGHT = 900
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
errors: list[str] = []
warnings: list[str] = []


def front_matter_value(front_lines: list[str], key: str) -> str | None:
    prefix = f"{key}:"
    for line in front_lines:
        if not line.startswith(prefix):
            continue
        raw = line[len(prefix):].strip()
        if not raw:
            return ""
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return raw.strip('"\'')
        return str(value)
    return None


def completed_cover_resolution() -> bool:
    if not REPORT_PATH.is_file():
        return False
    try:
        report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    resolution = report.get("coverResolution")
    return (
        report.get("status") == "complete"
        and isinstance(resolution, dict)
        and resolution.get("status") == "complete"
    )


require_cover = completed_cover_resolution()

for path in sorted((ROOT / "content" / "posts").glob("*/index.md")):
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.replace("\r\n", "\n").split("\n")
    rel = path.relative_to(ROOT)

    problems: list[str] = []
    if not lines or lines[0] != "---":
        problems.append("missing opening front matter delimiter")
        closing = None
    else:
        closing = next((i for i, line in enumerate(lines[1:], start=1) if line == "---"), None)
        if closing is None:
            problems.append("missing standalone closing front matter delimiter")

    front_lines = lines[1:closing] if closing is not None else []
    cover = front_matter_value(front_lines, "cover")
    if require_cover and not cover:
        problems.append("cover is missing after completed cover resolution")

    if cover:
        cover_path = Path(cover)
        resolved_cover = path.parent / cover_path
        if cover_path.is_absolute() or ".." in cover_path.parts:
            problems.append("cover must reference a local file inside the article bundle")
        elif not resolved_cover.is_file():
            problems.append(f"cover resource is missing: {cover}")
        elif cover == FALLBACK_FILENAME:
            data = resolved_cover.read_bytes()
            if len(data) < 24 or data[:8] != PNG_SIGNATURE:
                problems.append("deterministic fallback cover is not a valid PNG")
            else:
                width, height = struct.unpack(">II", data[16:24])
                if (width, height) != (FALLBACK_WIDTH, FALLBACK_HEIGHT):
                    problems.append(
                        "deterministic fallback cover has invalid dimensions: "
                        f"{width}x{height}"
                    )

    body = lines[(closing + 1) if closing is not None else 1:]
    first_content = next((line for line in body if line.strip()), "")
    if first_content.startswith("# "):
        problems.append("body starts with H1; article template owns the document H1")
    if any(line.strip() == "undefined" for line in body):
        problems.append("standalone converter sentinel 'undefined' remains in source")

    if problems:
        message = f"{rel}: " + "; ".join(problems)
        if STRICT:
            errors.append(message)
        else:
            warnings.append(message + " (legacy snapshot allowed only before closure normalization)")

for message in warnings:
    print(f"::warning::{message}")

if errors:
    for message in errors:
        print(f"::error::{message}")
    raise SystemExit(1)

print(
    "Source contract verification: PASS "
    f"({len(list((ROOT / 'content' / 'posts').glob('*/index.md')))} articles checked"
    f", cover requirement={'on' if require_cover else 'off'})"
)
