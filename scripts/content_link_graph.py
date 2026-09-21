#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

from article_routing import ArticleRoute, routes

SITE_HOSTS = {"huikai.com.kg", "www.huikai.com.kg"}

INLINE_LINK_RE = re.compile(r"(?<!!)\\[[^\\]]*\\]\\(\\s*(<[^>]+>|[^)\\s]+)(?:\\s+[^)]*)?\\)")
REFERENCE_LINK_RE = re.compile(r"(?<!!)\\[[^\\]]+\\]\\[([^\\]]*)\\]")
REFERENCE_DEF_RE = re.compile(r"(?m)^[ \\t]{0,3}\\[([^\\]]+)\\]:[ \\t]*(<[^>]+>|[^\\s]+)")
HTML_HREF_RE = re.compile(r"""(?i)\\bhref\\s*=\\s*["']([^"']+)["']""")
INLINE_CODE_RE = re.compile(r"`[^`\\n]*`")


def strip_front_matter(text: str) -> str:
    if not text.startswith("---"):
        return text
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return text
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            return "\\n".join(lines[index + 1 :])
    return text


def strip_fenced_code(text: str) -> str:
    output: list[str] = []
    fence: str | None = None
    for line in text.splitlines():
        stripped = line.lstrip()
        marker = None
        if stripped.startswith("```"):
            marker = "```"
        elif stripped.startswith("~~~"):
            marker = "~~~"
        if marker:
            if fence is None:
                fence = marker
            elif fence == marker:
                fence = None
            continue
        if fence is None:
            output.append(line)
    return "\\n".join(output)


def clean_target(raw: str) -> str:
    target = raw.strip()
    if target.startswith("<") and target.endswith(">"):
        target = target[1:-1].strip()
    return target


def extract_explicit_links(markdown: str) -> list[str]:
    body = INLINE_CODE_RE.sub("", strip_fenced_code(strip_front_matter(markdown)))
    references = {
        key.casefold(): clean_target(value)
        for key, value in REFERENCE_DEF_RE.findall(body)
    }

    found: list[str] = []
    found.extend(clean_target(match) for match in INLINE_LINK_RE.findall(body))
    found.extend(clean_target(match) for match in HTML_HREF_RE.findall(body))

    for label in REFERENCE_LINK_RE.findall(body):
        key = label.casefold()
        if key and key in references:
            found.append(references[key])

    return [target for target in found if target]


def canonical_path(raw: str, source_path: str) -> tuple[str | None, bool]:
    target = raw.strip()
    if not target or target.startswith(("#", "mailto:", "tel:", "javascript:", "data:")):
        return None, False

    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc:
        if parsed.scheme not in {"http", "https"}:
            return None, False
        if parsed.netloc.casefold() not in SITE_HOSTS:
            return None, False
        path = unquote(parsed.path or "/")
    else:
        joined = urljoin(f"https://huikai.com.kg{source_path}", target)
        path = unquote(urlsplit(joined).path or "/")

    if not path.startswith("/"):
        path = "/" + path
    path = re.sub(r"/{2,}", "/", path)
    if path != "/" and not Path(path).suffix and not path.endswith("/"):
        path += "/"
    return path.casefold(), True


def article_candidate(path: str) -> bool:
    return re.fullmatch(r"/(?:(?:zh-cn|en)/)?posts/[^/]+/", path) is not None


def build_graph(
    article_routes: list[ArticleRoute] | None = None,
    source_reader=None,
) -> dict:
    if article_routes is None:
        article_routes = routes()
    if source_reader is None:
        source_reader = lambda route: route.source.read_text(encoding="utf-8")

    route_lookup = {route.permalink_path.casefold(): route for route in article_routes}
    nodes = {
        route.page_id: {
            "pageId": route.page_id,
            "language": route.language,
            "slug": route.slug,
            "path": route.permalink_path,
            "translationGroup": route.translation_group,
            "incoming": [],
            "outgoing": [],
        }
        for route in article_routes
    }

    edges: set[tuple[str, str]] = set()
    unresolved: set[tuple[str, str]] = set()

    for source in article_routes:
        markdown = source_reader(source)
        for raw_target in extract_explicit_links(markdown):
            path, is_internal = canonical_path(raw_target, source.permalink_path)
            if not is_internal or path is None:
                continue
            target = route_lookup.get(path)
            if target is None:
                if article_candidate(path):
                    unresolved.add((source.page_id, path))
                continue
            if target.page_id == source.page_id:
                continue
            edges.add((source.page_id, target.page_id))

    for source_id, target_id in sorted(edges):
        nodes[source_id]["outgoing"].append(target_id)
        nodes[target_id]["incoming"].append(source_id)

    for node in nodes.values():
        node["incoming"].sort()
        node["outgoing"].sort()

    return {
        "version": 1,
        "summary": {
            "nodes": len(nodes),
            "edges": len(edges),
            "linkedNodes": sum(
                1 for node in nodes.values() if node["incoming"] or node["outgoing"]
            ),
            "unresolvedArticleLinks": len(unresolved),
        },
        "nodes": [nodes[key] for key in sorted(nodes)],
        "edges": [
            {"source": source_id, "target": target_id}
            for source_id, target_id in sorted(edges)
        ],
        "unresolvedArticleLinks": [
            {"source": source_id, "targetPath": path}
            for source_id, path in sorted(unresolved)
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a derived explicit-link graph from HUIKAI article sources."
    )
    parser.add_argument("--output", type=Path, help="Write graph JSON to this path.")
    args = parser.parse_args()

    graph = build_graph()
    payload = json.dumps(graph, ensure_ascii=False, indent=2) + "\\n"

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")

    summary = graph["summary"]
    print(
        "Content link graph: "
        f"nodes={summary['nodes']} "
        f"edges={summary['edges']} "
        f"linked_nodes={summary['linkedNodes']} "
        f"unresolved_article_links={summary['unresolvedArticleLinks']}"
    )


if __name__ == "__main__":
    main()
