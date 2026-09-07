#!/usr/bin/env python3
from __future__ import annotations

from discovery_taxonomy_contract import parse_scalar, project_formats, split_front_matter


def assert_equal(actual, expected, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: {actual!r} != {expected!r}")


def main() -> None:
    source = (
        '---\n'
        'title: "Example"\n'
        'entryType: "推薦／整理"\n'
        'formats: ["stale"]\n'
        'contentLanguage: "zh-TW"\n'
        '---\n\n'
        'Body\n'
    )
    projected, entry_type = project_formats(source)
    assert_equal(entry_type, "推薦／整理", "entryType")
    if projected.count("formats:") != 1:
        raise AssertionError("formats projection must contain exactly one formats key")
    if 'formats: ["推薦／整理"]' not in projected:
        raise AssertionError("formats projection did not mirror entryType")
    if "Body\n" not in projected:
        raise AssertionError("formats projection changed article body")

    second, second_type = project_formats(projected)
    assert_equal(second, projected, "projection idempotency")
    assert_equal(second_type, entry_type, "projection entryType idempotency")

    front, body = split_front_matter(projected)
    assert_equal(parse_scalar(front, "entryType"), "推薦／整理", "entryType parser")
    assert_equal(body, "\nBody\n", "body preservation")

    try:
        project_formats('---\ntitle: "Missing"\n---\n\nBody\n')
    except ValueError as error:
        if "entryType" not in str(error):
            raise
    else:
        raise AssertionError("missing entryType must fail closed")

    print("Discovery taxonomy contract verification: PASS")


if __name__ == "__main__":
    main()
