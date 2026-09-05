#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import json
import os
import re
import tomllib
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "data" / "homepage.toml"
MANIFEST_PATH = ROOT / ".notion-sync-manifest.json"
RUNTIME_PATH = ROOT / "data" / "homepage_runtime.toml"
WEEK_RE = re.compile(r"^(\d{4})-W(\d{2})$")


def fail(message: str) -> "None":
    raise SystemExit(f"Homepage rotation error: {message}")


def week_monday(value: str) -> dt.date:
    match = WEEK_RE.fullmatch(value)
    if not match:
        fail(f"rotation key must use YYYY-Www format, got {value!r}")
    year, week = map(int, match.groups())
    try:
        return dt.date.fromisocalendar(year, week, 1)
    except ValueError as error:
        fail(str(error))


def current_rotation_key(timezone_name: str) -> str:
    try:
        now = dt.datetime.now(ZoneInfo(timezone_name))
    except Exception as error:
        fail(f"invalid rotation timezone {timezone_name!r}: {error}")
    iso = now.isocalendar()
    return f"{iso.year:04d}-W{iso.week:02d}"


def normalize_path(value: str) -> str:
    return value.strip().strip("/")


def resolve_items(
    label: str,
    items: list[dict[str, object]],
    manifest_pages: dict[str, dict[str, object]],
    seen_page_ids: set[str],
    seen_paths: set[str],
) -> list[dict[str, str]]:
    resolved: list[dict[str, str]] = []
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            fail(f"{label} entry #{index} must be a table")
        page_id = str(item.get("pageId", "")).strip()
        path_hint = normalize_path(str(item.get("pathHint", "")))
        if not page_id:
            fail(f"{label} entry #{index} is missing pageId")
        if page_id in seen_page_ids:
            fail(f"pageId is duplicated across homepage selection config: {page_id}")
        seen_page_ids.add(page_id)

        manifest_entry = manifest_pages.get(page_id)
        if not manifest_entry:
            fail(f"{label} pageId is not Published in the Notion manifest: {page_id}")
        slug = str(manifest_entry.get("slug", "")).strip()
        if not slug:
            fail(f"{label} manifest entry has no slug: {page_id}")

        resolved_path = f"posts/{slug}"
        path_key = resolved_path.lower()
        if path_key in seen_paths:
            fail(f"resolved homepage path is duplicated: {resolved_path}")
        seen_paths.add(path_key)

        source_dir = ROOT / "content" / resolved_path
        covers = sorted(path for path in source_dir.glob("cover*") if path.is_file())
        if not covers:
            fail(f"{label} article is not rotation-eligible because it has no local cover: {resolved_path}")

        if path_hint and path_hint.lower() != resolved_path.lower():
            print(
                f"::warning::Homepage {label} pathHint is stale for {page_id}: "
                f"configured={path_hint}, manifest={resolved_path}. pageId remains authoritative."
            )

        resolved.append(
            {
                "pageId": page_id,
                "path": resolved_path,
                "source": label,
            }
        )
    return resolved


def toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def main() -> None:
    with CONFIG_PATH.open("rb") as handle:
        config = tomllib.load(handle)
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest_pages = manifest.get("pages", {})
    if not isinstance(manifest_pages, dict):
        fail("Notion manifest pages map is missing or invalid")

    selected_limit = int(config.get("selectedLimit", 3))
    recent_limit = int(config.get("recentLimit", 5))
    timezone_name = str(config.get("rotationTimezone", "Asia/Kuala_Lumpur"))
    epoch_key = str(config.get("rotationEpoch", "2026-W36"))
    pinned_config = config.get("pinned", [])
    pool_config = config.get("rotationPool", [])
    if not isinstance(pinned_config, list) or not isinstance(pool_config, list):
        fail("pinned and rotationPool must be TOML table arrays")
    if selected_limit < 1:
        fail("selectedLimit must be at least 1")
    if recent_limit < 1:
        fail("recentLimit must be at least 1")
    if len(pinned_config) > selected_limit:
        fail("pinned entries cannot exceed selectedLimit")

    rotation_slots = selected_limit - len(pinned_config)
    if rotation_slots > 0 and len(pool_config) < rotation_slots:
        fail(
            f"rotationPool needs at least {rotation_slots} entries for {rotation_slots} rotating slots; "
            f"found {len(pool_config)}"
        )

    seen_page_ids: set[str] = set()
    seen_paths: set[str] = set()
    pinned = resolve_items("pinned", pinned_config, manifest_pages, seen_page_ids, seen_paths)
    pool = resolve_items("rotationPool", pool_config, manifest_pages, seen_page_ids, seen_paths)

    requested_key = os.environ.get("HOMEPAGE_ROTATION_KEY", "").strip()
    rotation_key = requested_key or current_rotation_key(timezone_name)
    rotation_monday = week_monday(rotation_key)
    epoch_monday = week_monday(epoch_key)
    delta_days = (rotation_monday - epoch_monday).days
    if delta_days % 7 != 0:
        fail("rotation key and epoch do not align to ISO weeks")
    rotation_index = delta_days // 7

    pool_offset = 0
    rotating: list[dict[str, str]] = []
    if rotation_slots > 0:
        pool_offset = (rotation_index * rotation_slots) % len(pool)
        rotating = [pool[(pool_offset + index) % len(pool)] for index in range(rotation_slots)]

    selected = pinned + rotating
    if len(selected) != selected_limit:
        fail(f"resolved Selected count mismatch: expected {selected_limit}, got {len(selected)}")

    lines = [
        f"rotationKey = {toml_string(rotation_key)}",
        f"rotationIndex = {rotation_index}",
        f"rotationEpoch = {toml_string(epoch_key)}",
        f"rotationTimezone = {toml_string(timezone_name)}",
        f"selectedLimit = {selected_limit}",
        f"recentLimit = {recent_limit}",
        f"rotationSlots = {rotation_slots}",
        f"poolSize = {len(pool)}",
        f"poolOffset = {pool_offset}",
        "",
    ]
    for item in selected:
        lines.extend(
            [
                "[[selected]]",
                f"pageId = {toml_string(item['pageId'])}",
                f"path = {toml_string(item['path'])}",
                f"source = {toml_string(item['source'])}",
                "",
            ]
        )

    RUNTIME_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(
        "Homepage rotation prepared: "
        f"key={rotation_key}, index={rotation_index}, offset={pool_offset}, "
        f"selected={','.join(item['path'] for item in selected)}"
    )


if __name__ == "__main__":
    main()
