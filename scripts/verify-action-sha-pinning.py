#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
USES_RE = re.compile(r"^\s*uses:\s*([^#\s]+)(?:\s+#.*)?$", re.MULTILINE)
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")


def main() -> None:
    failures: list[str] = []
    checked = 0

    for workflow in sorted(WORKFLOWS.glob("*.yml")):
        text = workflow.read_text(encoding="utf-8")
        for match in USES_RE.finditer(text):
            reference = match.group(1)
            if reference.startswith(("./", "docker://")):
                continue
            if "@" not in reference:
                failures.append(f"{workflow.relative_to(ROOT)}: action reference has no @ref: {reference}")
                continue
            target, ref = reference.rsplit("@", 1)
            checked += 1
            if not target or not FULL_SHA_RE.fullmatch(ref):
                failures.append(
                    f"{workflow.relative_to(ROOT)}: remote action must use a full 40-character commit SHA: {reference}"
                )

    if failures:
        for failure in failures:
            print(f"ERROR: {failure}")
        raise SystemExit(f"GitHub Actions SHA pinning: FAIL ({len(failures)} issue(s))")

    print(f"GitHub Actions SHA pinning: PASS (remote action references={checked})")


if __name__ == "__main__":
    main()
