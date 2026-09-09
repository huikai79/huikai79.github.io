#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable


@dataclass(frozen=True)
class LegacyAliasPlan:
    route: Any
    primary_owner: Any | None

    @property
    def preserves_canonical(self) -> bool:
        return self.primary_owner is not None


def legacy_alias_plans(article_routes: Iterable[Any]) -> list[LegacyAliasPlan]:
    """Plan legacy root aliases without allowing them to replace real zh-TW routes.

    `/posts/<slug>/` is the canonical location for the default language. A
    non-default route may claim that legacy root only when no real zh-TW route
    owns the same slug. If multiple non-default languages share the same slug
    without a zh-TW owner, the legacy root is ambiguous and must fail closed.
    """

    by_slug: dict[str, list[Any]] = {}
    for route in article_routes:
        key = str(route.slug).casefold()
        by_slug.setdefault(key, []).append(route)

    plans: list[LegacyAliasPlan] = []
    for slug_key, members in sorted(by_slug.items()):
        primary = [route for route in members if route.language == "zh-TW"]
        secondary = [route for route in members if route.language != "zh-TW"]
        if not secondary:
            continue
        if len(primary) > 1:
            raise ValueError(
                f"Multiple zh-TW routes unexpectedly own /posts/{slug_key}/: "
                + ", ".join(route.page_id for route in primary)
            )
        if primary:
            owner = primary[0]
            plans.extend(LegacyAliasPlan(route=route, primary_owner=owner) for route in secondary)
            continue
        if len(secondary) > 1:
            details = ", ".join(f"{route.language}:{route.page_id}" for route in secondary)
            raise ValueError(
                f"Ambiguous legacy article route /posts/{slug_key}/ has multiple non-default owners: {details}"
            )
        plans.append(LegacyAliasPlan(route=secondary[0], primary_owner=None))

    return plans
