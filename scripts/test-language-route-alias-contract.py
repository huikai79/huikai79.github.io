#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass

from language_route_alias_contract import legacy_alias_plans


@dataclass(frozen=True)
class Route:
    page_id: str
    slug: str
    language: str


# A secondary-only article keeps its historical root URL as a redirect.
plans = legacy_alias_plans([Route("cn-only", "be-alife", "zh-CN")])
assert len(plans) == 1
assert plans[0].route.page_id == "cn-only"
assert plans[0].primary_owner is None
assert not plans[0].preserves_canonical

# A real default-language counterpart always owns /posts/<slug>/ and must not
# be overwritten by a redirect to another language.
primary = Route("tw", "How-you-know", "zh-TW")
secondary = Route("cn", "how-YOU-know", "zh-CN")
plans = legacy_alias_plans([secondary, primary])
assert len(plans) == 1
assert plans[0].route.page_id == "cn"
assert plans[0].primary_owner == primary
assert plans[0].preserves_canonical

# Default-language-only content needs no migration alias.
assert legacy_alias_plans([Route("tw-only", "essay", "zh-TW")]) == []

# More than one non-default owner for the same legacy root is ambiguous and
# must fail closed instead of choosing an arbitrary redirect destination.
try:
    legacy_alias_plans([
        Route("cn", "shared", "zh-CN"),
        Route("en", "SHARED", "en"),
    ])
except ValueError as error:
    assert "Ambiguous legacy article route" in str(error)
else:
    raise AssertionError("ambiguous non-default legacy route must fail closed")

print("Language route alias contract tests: PASS")
