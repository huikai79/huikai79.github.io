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
HOME_PLACEMENTS = {"None", "Pinned", "Rotation"}
PRIMARY_LANGUAGE = "zh-TW"


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


def front_matter_scalar(index_path: Path, key: str) -> str:
    text = index_path.read_text(encoding="utf-8").replace("\r\n", "\n")
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        fail(f"article is missing front matter: {index_path.relative_to(ROOT)}")
    closing = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if closing is None:
        fail(f"article is missing closing front matter: {index_path.relative_to(ROOT)}")

    prefix = f"{key}:"
    for line in lines[1:closing]:
        if not line.startswith(prefix):
            continue
        raw = line[len(prefix):].strip()
        try:
            return str(json.loads(raw)).strip()
        except json.JSONDecodeError:
            return raw.strip('"').strip()
    return ""


def collect_home_candidates(
    manifest_pages: dict[str, dict[str, object]],
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    pinned: list[dict[str, str]] = []
    pool: list[dict[str, str]] = []

    for page_id, entry in sorted(manifest_pages.items()):
        if not isinstance(entry, dict):
            fail(f"manifest entry must be an object: {page_id}")
        slug = str(entry.get("slug", "")).strip()
        if not slug:
            fail(f"manifest entry has no slug: {page_id}")

        # Old manifests predate Language and therefore represent the historical
        # default-language snapshot. New manifests route only declared zh-TW
        # articles into the primary homepage selection.
        language = str(entry.get("language", PRIMARY_LANGUAGE)).strip() or PRIMARY_LANGUAGE
        if language != PRIMARY_LANGUAGE:
            continue

        content_file = str(entry.get("contentFile", "index.md")).strip() or "index.md"
        resolved_path = f"posts/{slug}"
        source_dir = ROOT / "content" / resolved_path
        index_path = source_dir / content_file
        if not index_path.is_file():
            fail(f"manifest article content file is missing: {resolved_path}/{content_file}")

        placement = front_matter_scalar(index_path, "homePlacement")
        if placement not in HOME_PLACEMENTS:
            fail(
                f"{resolved_path} has invalid or missing homePlacement {placement!r}; "
                "expected None, Pinned, or Rotation"
            )
        if placement == "None":
            continue

        covers = sorted(path for path in source_dir.glob("cover*") if path.is_file())
        if not covers:
            fail(f"{placement} article is not homepage-eligible because it has no local cover: {resolved_path}")

        item = {
            "pageId": page_id,
            "path": resolved_path,
            "source": "pinned" if placement == "Pinned" else "rotationPool",
        }
        if placement == "Pinned":
            pinned.append(item)
        else:
            pool.append(item)

    key = lambda item: (item["path"].casefold(), item["pageId"])
    pinned.sort(key=key)
    pool.sort(key=key)
    return pinned, pool


def toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def main() -> None:
    with CONFIG_PATH.open("rb") as handle:
        config = tomllib.load(handle)
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest_pages = manifest.get("pages", {})
    if not isinstance(manifest_pages, dict):
        fail("Notion manifest pages map is missing or invalid")

    selected_cap = int(config.get("selectedLimit", 3))
    recent_limit = int(config.get("recentLimit", 5))
    timezone_name = str(config.get("rotationTimezone", "Asia/Kuala_Lumpur"))
    epoch_key = str(config.get("rotationEpoch", "2026-W36"))
    if selected_cap < 0:
        fail("selectedLimit must be zero or greater")
    if recent_limit < 1:
        fail("recentLimit must be at least 1")

    pinned, pool = collect_home_candidates(manifest_pages)
    if len(pinned) > selected_cap:
        fail(
            f"Notion Home=Pinned count ({len(pinned)}) exceeds homepage selectedLimit ({selected_cap})"
        )

    requested_key = os.environ.get("HOMEPAGE_ROTATION_KEY", "").strip()
    rotation_key = requested_key or current_rotation_key(timezone_name)
    rotation_monday = week_monday(rotation_key)
    epoch_monday = week_monday(epoch_key)
    delta_days = (rotation_monday - epoch_monday).days
    if delta_days % 7 != 0:
        fail("rotation key and epoch do not align to ISO weeks")
    rotation_index = delta_days // 7

    available_rotation_slots = max(0, selected_cap - len(pinned))
    rotation_slots = min(available_rotation_slots, len(pool))
    selected_limit = len(pinned) + rotation_slots

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
        f"selectedLimitCap = {selected_cap}",
        f"selectedLimit = {selected_limit}",
        f"recentLimit = {recent_limit}",
        f"pinnedSize = {len(pinned)}",
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
        "Homepage rotation prepared from Notion Home for zh-TW: "
        f"key={rotation_key}, index={rotation_index}, cap={selected_cap}, "
        f"pinned={len(pinned)}, pool={len(pool)}, offset={pool_offset}, "
        f"selected={','.join(item['path'] for item in selected)}"
    )


if __name__ == "__main__":
    main()
