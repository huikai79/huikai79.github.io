#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "translation-drafts.yml"
text = WORKFLOW.read_text(encoding="utf-8")
errors: list[str] = []

manual_expression = "github.event_name == 'workflow_dispatch' && inputs.apply && '1' || '0'"
if manual_expression not in text:
    errors.append("Translation apply must require workflow_dispatch with apply=true")

unsafe_patterns = (
    "github.event_name == 'workflow_run' || inputs.apply",
    "github.event_name == 'workflow_run' && '1'",
)
for pattern in unsafe_patterns:
    if pattern in text:
        errors.append(f"Automatic sync-triggered translation apply is forbidden: {pattern}")

if "workflow_run:" not in text:
    errors.append("Translation workflow must retain sync-triggered preflight observability")
if "TRANSLATION_APPLY:" not in text:
    errors.append("Translation workflow is missing TRANSLATION_APPLY gate")

if errors:
    for error in errors:
        print(f"::error::{error}")
    raise SystemExit(1)

print("Translation workflow safety verification: PASS (automatic runs are preflight-only)")
