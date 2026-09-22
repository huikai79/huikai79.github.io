#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETED = ROOT / ".github" / "workflows" / "translation-drafts.yml"
AUTOMATIC = ROOT / ".github" / "workflows" / "translation-auto-drafts.yml"

targeted = TARGETED.read_text(encoding="utf-8")
automatic = AUTOMATIC.read_text(encoding="utf-8")
errors: list[str] = []

manual_expression = "github.event_name == 'workflow_dispatch' && inputs.apply && '1' || '0'"
if manual_expression not in targeted:
    errors.append("Targeted translation apply must require workflow_dispatch with apply=true")
if "workflow_dispatch:" not in targeted:
    errors.append("Targeted translation workflow must expose workflow_dispatch")
if "workflow_run:" in targeted:
    errors.append("Targeted translation workflow must not be chained from sync/preflight completion")
if "schedule:" in targeted or "\n  push:" in targeted:
    errors.append("Targeted translation workflow must remain manual-only")
if "TRANSLATION_APPLY:" not in targeted:
    errors.append("Targeted translation workflow is missing TRANSLATION_APPLY gate")

if 'cron: "*/15 * * * *"' not in automatic:
    errors.append("Automatic translation workflow must retain the 15-minute schedule")
if "workflow_run:" in automatic:
    errors.append("Automatic translation writes must not be chained from sync/preflight completion")
if "workflow_dispatch:" in automatic or "\n  push:" in automatic:
    errors.append("Automatic translation workflow must remain schedule-only")
if 'TRANSLATION_APPLY: "1"' not in automatic:
    errors.append("Automatic translation workflow is missing the explicit apply contract")
if 'TRANSLATION_AUTOMATIC: "1"' not in automatic:
    errors.append("Automatic translation workflow is missing the automatic queue contract")

if errors:
    for error in errors:
        print(f"::error::{error}")
    raise SystemExit(1)

print(
    "Translation workflow safety verification: PASS "
    "(targeted=manual-only, automatic=schedule-only)"
)
