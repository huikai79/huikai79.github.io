#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
from pathlib import Path

ROOT = Path(os.environ.get("SITE_ROOT", Path(__file__).resolve().parents[1])).resolve()
STRICT = os.environ.get("STRICT_CONTENT") == "1"
REPORT_PATH = ROOT / ".notion-sync-report.json"
LEGACY_FALLBACK_FILENAME = "cover-fallback.png"
MARKDOWN_IMAGE_RE = re.compile(r'!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)')
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


def front_matter_list(front_lines: list[str], key: str) -> list[str] | None:
    prefix = f"{key}:"
    for line in front_lines:
        if not line.startswith(prefix):
            continue
        raw = line[len(prefix):].strip()
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return None
        if not isinstance(value, list):
            return None
        return [str(item) for item in value]
    return None


def completed_presentation_resolution() -> bool:
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


def article_sources() -> list[Path]:
    return sorted((ROOT / "content" / "posts").glob("*/index*.md"))


def first_body_image(body: str) -> str | None:
    match = MARKDOWN_IMAGE_RE.search(body)
    return match.group(1) if match else None


presentation_resolved = completed_presentation_resolution()
sources = article_sources()

for path in sources:
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
    entry_type = front_matter_value(front_lines, "entryType")
    formats = front_matter_list(front_lines, "formats")
    if entry_type and formats != [entry_type]:
        problems.append(
            f"formats taxonomy must mirror entryType exactly: entryType={entry_type!r}, formats={formats!r}"
        )

    if cover:
        cover_path = Path(cover)
        resolved_cover = path.parent / cover_path
        if cover_path.is_absolute() or ".." in cover_path.parts:
            problems.append("cover must reference a local file inside the article bundle")
        elif not resolved_cover.is_file():
            problems.append(f"cover resource is missing: {cover}")
        if presentation_resolved and cover == LEGACY_FALLBACK_FILENAME:
            problems.append("legacy procedural Hero fallback remains after presentation resolution")

    body_lines = lines[(closing + 1) if closing is not None else 1:]
    body = "\n".join(body_lines)
    first_image = first_body_image(body)
    if (
        presentation_resolved
        and cover
        and first_image == cover
        and re.fullmatch(r"image-\d+\.[A-Za-z0-9]+", Path(cover).name)
    ):
        problems.append("first body image remains auto-promoted as Hero after presentation resolution")

    first_content = next((line for line in body_lines if line.strip()), "")
    if first_content.startswith("# "):
        problems.append("body starts with H1; article template owns the document H1")
    if any(line.strip() == "undefined" for line in body_lines):
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
    f"({len(sources)} articles checked, Hero=optional"
    f", presentation={'resolved' if presentation_resolved else 'unresolved'})"
)
