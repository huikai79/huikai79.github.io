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
SECONDARY_LANGUAGE = "zh-CN"
SUPPORTED_HOMEPAGE_LANGUAGES = (PRIMARY_LANGUAGE, SECONDARY_LANGUAGE)


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


def manifest_bundle_path(entry: dict[str, object], page_id: str) -> str:
    slug = str(entry.get("slug", "")).strip()
    bundle_path = str(entry.get("bundlePath", slug)).strip() or slug
    if not bundle_path:
        fail(f"manifest entry has no bundlePath/slug: {page_id}")
    if bundle_path in {".", ".."} or "/" in bundle_path or "\\" in bundle_path:
        fail(f"manifest entry has unsafe bundlePath {bundle_path!r}: {page_id}")
    return bundle_path


def collect_home_candidates(
    manifest_pages: dict[str, dict[str, object]],
    language: str,
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
        # default-language snapshot. Secondary-language selection only becomes
        # active after an entry explicitly declares its language.
        entry_language = str(entry.get("language", PRIMARY_LANGUAGE)).strip() or PRIMARY_LANGUAGE
        if entry_language != language:
            continue

        content_file = str(entry.get("contentFile", "index.md")).strip() or "index.md"
        bundle_path = manifest_bundle_path(entry, page_id)
        resolved_path = f"posts/{bundle_path}"
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

        # Runtime path is the Hugo content lookup path, not the public slug.
        # Public URLs remain governed by front matter `slug` and are verified
        # separately from the internal bundle directory.
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


def resolve_language_runtime(
    manifest_pages: dict[str, dict[str, object]],
    language: str,
    selected_cap: int,
    recent_limit: int,
    timezone_name: str,
    epoch_key: str,
    rotation_key: str,
    rotation_index: int,
) -> dict[str, object]:
    pinned, pool = collect_home_candidates(manifest_pages, language)
    if len(pinned) > selected_cap:
        fail(
            f"{language} Notion Home=Pinned count ({len(pinned)}) exceeds "
            f"homepage selectedLimit ({selected_cap})"
        )

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
        fail(
            f"{language} resolved Selected count mismatch: "
            f"expected {selected_limit}, got {len(selected)}"
        )

    return {
        "rotationKey": rotation_key,
        "rotationIndex": rotation_index,
        "rotationEpoch": epoch_key,
        "rotationTimezone": timezone_name,
        "selectedLimitCap": selected_cap,
        "selectedLimit": selected_limit,
        "recentLimit": recent_limit,
        "pinnedSize": len(pinned),
        "rotationSlots": rotation_slots,
        "poolSize": len(pool),
        "poolOffset": pool_offset,
        "selected": selected,
    }


def toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def runtime_lines(runtime: dict[str, object], table: str | None = None) -> list[str]:
    prefix = f"{table}." if table else ""
    lines: list[str] = []
    if table:
        lines.extend([f"[{table}]", ""])

    for key in (
        "rotationKey",
        "rotationIndex",
        "rotationEpoch",
        "rotationTimezone",
        "selectedLimitCap",
        "selectedLimit",
        "recentLimit",
        "pinnedSize",
        "rotationSlots",
        "poolSize",
        "poolOffset",
    ):
        value = runtime[key]
        if isinstance(value, str):
            lines.append(f"{key} = {toml_string(value)}")
        else:
            lines.append(f"{key} = {value}")
    lines.append("")

    selected = runtime.get("selected", [])
    if not isinstance(selected, list):
        fail(f"{prefix or 'primary'} selected runtime must be an array")
    for item in selected:
        if not isinstance(item, dict):
            fail(f"{prefix or 'primary'} selected runtime item must be an object")
        table_name = f"{table}.selected" if table else "selected"
        lines.extend(
            [
                f"[[{table_name}]]",
                f"pageId = {toml_string(str(item['pageId']))}",
                f"path = {toml_string(str(item['path']))}",
                f"source = {toml_string(str(item['source']))}",
                "",
            ]
        )
    return lines


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

    requested_key = os.environ.get("HOMEPAGE_ROTATION_KEY", "").strip()
    rotation_key = requested_key or current_rotation_key(timezone_name)
    rotation_monday = week_monday(rotation_key)
    epoch_monday = week_monday(epoch_key)
    delta_days = (rotation_monday - epoch_monday).days
    if delta_days % 7 != 0:
        fail("rotation key and epoch do not align to ISO weeks")
    rotation_index = delta_days // 7

    runtimes = {
        language: resolve_language_runtime(
            manifest_pages,
            language,
            selected_cap,
            recent_limit,
            timezone_name,
            epoch_key,
            rotation_key,
            rotation_index,
        )
        for language in SUPPORTED_HOMEPAGE_LANGUAGES
    }

    lines = runtime_lines(runtimes[PRIMARY_LANGUAGE])
    lines.extend(runtime_lines(runtimes[SECONDARY_LANGUAGE], "secondary"))
    RUNTIME_PATH.write_text("\n".join(lines), encoding="utf-8")

    summaries: list[str] = []
    for language in SUPPORTED_HOMEPAGE_LANGUAGES:
        runtime = runtimes[language]
        selected = runtime["selected"]
        assert isinstance(selected, list)
        summaries.append(
            f"{language}:pinned={runtime['pinnedSize']},pool={runtime['poolSize']},"
            f"offset={runtime['poolOffset']},selected="
            f"{','.join(str(item['path']) for item in selected if isinstance(item, dict))}"
        )
    print(
        "Homepage rotation prepared from Notion Home by language: "
        f"key={rotation_key}, index={rotation_index}, cap={selected_cap}; "
        + "; ".join(summaries)
    )


if __name__ == "__main__":
    main()
