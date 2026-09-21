#!/usr/bin/env python3
from __future__ import annotations

from article_routing import ArticleRoute
from content_link_graph import build_graph, canonical_path, extract_explicit_links


def route(page_id: str, slug: str, language: str = "zh-TW") -> ArticleRoute:
    bundle = slug if language == "zh-TW" else f"{slug}--{language.lower()}"
    content_file = "index.md" if language == "zh-TW" else "index.zh-cn.md"
    return ArticleRoute(
        page_id=page_id,
        slug=slug,
        bundle_path=bundle,
        language=language,
        content_file=content_file,
        translation_group=slug,
    )


def main() -> None:
    source = route("source", "source")
    target = route("target", "target")
    cn = route("cn", "target-cn", "zh-CN")

    bodies = {
        "source": """---
sourceURL: "https://huikai.com.kg/posts/frontmatter-must-not-count/"
---

[internal](/posts/target/)
[duplicate absolute](https://huikai.com.kg/posts/target/?from=test#section)
[cn](/zh-cn/posts/target-cn/)
[external](https://example.com/posts/not-ours/)
[self](/posts/source/)
[missing](/posts/missing/)

`[inline-code](/posts/ignored-code/)`

```md
[fenced-code](/posts/ignored-fence/)
```
""",
        "target": "[source-relative](../source/)",
        "cn": "",
    }

    links = extract_explicit_links(bodies["source"])
    assert "/posts/target/" in links
    assert "https://huikai.com.kg/posts/target/?from=test#section" in links
    assert "/posts/frontmatter-must-not-count/" not in links
    assert "/posts/ignored-code/" not in links
    assert "/posts/ignored-fence/" not in links

    path, internal = canonical_path("https://huikai.com.kg/posts/target/?x=1#y", source.permalink_path)
    assert internal is True
    assert path == "/posts/target/"

    path, internal = canonical_path("https://example.com/posts/target/", source.permalink_path)
    assert internal is False
    assert path is None

    graph = build_graph(
        [source, target, cn],
        source_reader=lambda article: bodies[article.page_id],
    )

    assert graph["summary"] == {
        "nodes": 3,
        "edges": 3,
        "linkedNodes": 3,
        "unresolvedArticleLinks": 1,
    }
    assert graph["edges"] == [
        {"source": "source", "target": "cn"},
        {"source": "source", "target": "target"},
        {"source": "target", "target": "source"},
    ]
    assert graph["unresolvedArticleLinks"] == [
        {"source": "source", "targetPath": "/posts/missing/"}
    ]

    nodes = {node["pageId"]: node for node in graph["nodes"]}
    assert nodes["source"]["outgoing"] == ["cn", "target"]
    assert nodes["source"]["incoming"] == ["target"]
    assert nodes["target"]["incoming"] == ["source"]
    assert nodes["cn"]["incoming"] == ["source"]

    print("Content link graph contract: PASS")


if __name__ == "__main__":
    main()
