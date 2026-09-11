#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from html.parser import HTMLParser
from pathlib import Path

PUBLIC = Path(sys.argv[1] if len(sys.argv) > 1 else "public").resolve()
ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


class Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lang = ""
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key.lower(): value or "" for key, value in attrs}
        if tag.lower() == "html":
            self.lang = data.get("lang", "")
        if tag.lower() == "a" and data.get("href"):
            self.hrefs.append(data["href"])


def read_html(path: Path, label: str) -> tuple[str, Parser]:
    if not path.is_file():
        fail(f"{label} is missing: {path}")
        return "", Parser()
    text = path.read_text(encoding="utf-8", errors="replace")
    parser = Parser()
    parser.feed(text)
    parser.close()
    return text, parser


def rendered_article_path(language: str, slug: str) -> Path:
    base = PUBLIC if language == "zh-TW" else PUBLIC / language.lower()
    return base / "posts" / slug.lower() / "index.html"


def expected_content_file(language: str) -> str:
    return {
        "zh-TW": "index.md",
        "zh-CN": "index.zh-cn.md",
        "en": "index.en.md",
    }.get(language, "")


def manifest_bundle_path(entry: dict, page_id: str, slug: str) -> str:
    bundle_path = str(entry.get("bundlePath", slug)).strip() or slug
    if bundle_path in {".", ".."} or "/" in bundle_path or "\\" in bundle_path:
        fail(f"Unsafe routed article bundlePath: {page_id} -> {bundle_path!r}")
    return bundle_path


hugo_config = (ROOT / "config" / "_default" / "hugo.toml").read_text(encoding="utf-8")
if 'defaultContentLanguage = "zh-TW"' not in hugo_config:
    fail("Traditional Chinese must remain the default content language")

for config_name, expected in (
    ("languages.zh-TW.toml", ('label = "繁體"', 'displayName = "繁體"', 'htmlCode = "zh-TW"', 'contentRole = "primary"')),
    ("languages.zh-CN.toml", ('label = "简体"', 'displayName = "简体"', 'htmlCode = "zh-CN"', 'contentRole = "secondary"')),
):
    path = ROOT / "config" / "_default" / config_name
    if not path.is_file():
        fail(f"Language configuration is missing: {config_name}")
        continue
    text = path.read_text(encoding="utf-8")
    for token in expected:
        if token not in text:
            fail(f"{config_name} is missing multilingual contract token: {token}")

required_rendered = [
    (PUBLIC / "index.html", "Traditional homepage"),
    (PUBLIC / "about" / "index.html", "Traditional About"),
    (PUBLIC / "explore" / "index.html", "Traditional Explore"),
    (PUBLIC / "posts" / "index.html", "Traditional posts index"),
    (PUBLIC / "projects" / "index.html", "Traditional projects index"),
    (PUBLIC / "projects" / "nutrient-hackathon" / "index.html", "Traditional Nutrient project"),
    (PUBLIC / "projects" / "website-publishing-system" / "index.html", "Traditional publishing project"),
    (PUBLIC / "zh-cn" / "index.html", "Simplified homepage"),
    (PUBLIC / "zh-cn" / "about" / "index.html", "Simplified About"),
    (PUBLIC / "zh-cn" / "explore" / "index.html", "Simplified Explore"),
    (PUBLIC / "zh-cn" / "posts" / "index.html", "Simplified posts index"),
    (PUBLIC / "zh-cn" / "projects" / "index.html", "Simplified projects index"),
    (PUBLIC / "zh-cn" / "projects" / "nutrient-hackathon" / "index.html", "Simplified Nutrient project"),
    (PUBLIC / "zh-cn" / "projects" / "website-publishing-system" / "index.html", "Simplified publishing project"),
]
for path, label in required_rendered:
    if not path.is_file():
        fail(f"{label} is missing: {path}")

traditional, traditional_parser = read_html(PUBLIC / "index.html", "Traditional homepage")
simplified, simplified_parser = read_html(PUBLIC / "zh-cn" / "index.html", "Simplified homepage")

if traditional_parser.lang != "zh-TW":
    fail(f"Traditional homepage lang mismatch: {traditional_parser.lang!r}")
if simplified_parser.lang != "zh-CN":
    fail(f"Simplified homepage lang mismatch: {simplified_parser.lang!r}")
if "HUIKAI" not in traditional or "澄心之遊" not in traditional or "記錄那些值得長期保留的價值" not in traditional:
    fail("Traditional homepage brand/copy is incomplete")
if "HUIKAI" not in simplified or "澄心之遊" not in simplified or "记录那些值得长期保留的价值" not in simplified:
    fail("Simplified homepage brand/copy is incomplete")

if not any(href.rstrip("/") == "/zh-cn" for href in traditional_parser.hrefs):
    fail("Traditional homepage does not expose the native Simplified Chinese translation link")
if not any(href == "/" for href in simplified_parser.hrefs):
    fail("Simplified homepage does not expose the native Traditional Chinese translation link")
for href in ("/zh-cn/posts/", "/zh-cn/projects/", "/zh-cn/about/"):
    if href not in simplified_parser.hrefs:
        fail(f"Simplified homepage is missing language-scoped CTA: {href}")

for left, right in (
    (PUBLIC / "about" / "index.html", "/zh-cn/about/"),
    (PUBLIC / "projects" / "index.html", "/zh-cn/projects/"),
    (PUBLIC / "projects" / "website-publishing-system" / "index.html", "/zh-cn/projects/website-publishing-system/"),
):
    _, parser = read_html(left, str(left.relative_to(PUBLIC)))
    if right not in parser.hrefs:
        fail(f"Translated page does not expose its Simplified counterpart: {left} -> {right}")

expected_indexes = {
    "_index.md": '---\ntitle: "文章"\ndescription: "莊輝愷的文章與筆記。"\noutputs: ["HTML", "RSS"]\n---\n\n{{< page-lead >}}{{< /page-lead >}}\n',
    "_index.zh-cn.md": '---\ntitle: "文章"\ndescription: "庄辉恺的文章与笔记。"\noutputs: ["HTML", "RSS"]\n---\n\n{{< page-lead >}}{{< /page-lead >}}\n',
}
for name, expected in expected_indexes.items():
    source = ROOT / "content" / "posts" / name
    if not source.is_file() or source.read_text(encoding="utf-8") != expected:
        fail(f"Posts section index is missing or nondeterministic: {name}")

try:
    manifest = json.loads((ROOT / ".notion-sync-manifest.json").read_text(encoding="utf-8"))
except Exception as error:
    manifest = {"pages": {}}
    fail(f"Unable to read Notion manifest for multilingual routing: {error}")

pages = manifest.get("pages", {}) if isinstance(manifest, dict) else {}
if not isinstance(pages, dict):
    fail("Notion manifest pages map is invalid")
    pages = {}

migrated = bool(pages) and all(
    isinstance(entry, dict) and entry.get("language") and entry.get("contentFile")
    for entry in pages.values()
)

if not migrated:
    traditional_articles = sorted((PUBLIC / "posts").glob("*/index.html")) if (PUBLIC / "posts").exists() else []
    simplified_articles = sorted((PUBLIC / "zh-cn" / "posts").glob("*/index.html")) if (PUBLIC / "zh-cn" / "posts").exists() else []
    if len(traditional_articles) != len(pages):
        fail(
            "Pre-routing snapshot must keep all manifest articles in the default language: "
            f"manifest={len(pages)}, rendered={len(traditional_articles)}"
        )
    if simplified_articles:
        fail("Pre-routing snapshot unexpectedly contains Simplified article routes")
else:
    rendered_expected: set[Path] = set()
    groups: dict[str, list[tuple[str, Path]]] = {}
    bundle_owners: dict[str, str] = {}
    for page_id, entry in sorted(pages.items()):
        if not isinstance(entry, dict):
            fail(f"Invalid manifest article entry: {page_id}")
            continue
        slug = str(entry.get("slug", "")).strip()
        language = str(entry.get("language", "")).strip()
        content_file = str(entry.get("contentFile", "")).strip()
        group = str(entry.get("translationGroup", "")).strip()
        if not slug or not language or not content_file or not group:
            fail(f"Routed article manifest metadata is incomplete: {page_id}")
            continue
        bundle_path = manifest_bundle_path(entry, page_id, slug)
        if bundle_path in bundle_owners:
            fail(f"Duplicate routed article bundlePath: {bundle_path} -> {bundle_owners[bundle_path]} / {page_id}")
        bundle_owners[bundle_path] = page_id
        expected_file = expected_content_file(language)
        if not expected_file:
            fail(f"Unsupported routed article language: {page_id} -> {language}")
            continue
        if content_file != expected_file:
            fail(f"Manifest contentFile mismatch: {page_id} -> {content_file}, expected {expected_file}")
        source = ROOT / "content" / "posts" / bundle_path / content_file
        if not source.is_file():
            fail(f"Routed source article is missing: {source}")
        source_text = source.read_text(encoding="utf-8", errors="replace") if source.is_file() else ""
        if f'contentLanguage: "{language}"' not in source_text:
            fail(f"Routed source is missing contentLanguage front matter: {source}")
        if f'translationKey: "{group}"' not in source_text:
            fail(f"Routed source is missing translationKey front matter: {source}")

        rendered = rendered_article_path(language, slug)
        rendered_expected.add(rendered.resolve())
        _, parser = read_html(rendered, f"article:{language}:{slug}")
        if parser.lang != language:
            fail(f"Article language mismatch: {language}:{slug} rendered lang={parser.lang!r}")
        groups.setdefault(group, []).append((language, rendered))

    actual = set(path.resolve() for path in (PUBLIC / "posts").glob("*/index.html"))
    actual.update(path.resolve() for path in (PUBLIC / "zh-cn" / "posts").glob("*/index.html"))
    if actual != rendered_expected:
        fail(
            "Rendered multilingual article routes differ from manifest: "
            f"expected={sorted(str(p.relative_to(PUBLIC)) for p in rendered_expected)}, "
            f"actual={sorted(str(p.relative_to(PUBLIC)) for p in actual)}"
        )

    for group, members in groups.items():
        languages = {language for language, _ in members}
        if len(languages) != len(members):
            fail(f"Translation Group contains duplicate language entries: {group}")
        if len(members) > 1:
            expected_hrefs = {
                "/" + str(path.relative_to(PUBLIC).parent).replace("\\", "/").strip("/") + "/"
                for _, path in members
            }
            for language, path in members:
                _, parser = read_html(path, f"translation-group:{group}:{language}")
                own = "/" + str(path.relative_to(PUBLIC).parent).replace("\\", "/").strip("/") + "/"
                for href in expected_hrefs - {own}:
                    if href not in parser.hrefs:
                        fail(f"Real translation counterpart is missing from language switcher: {group} -> {href}")

if ERRORS:
    for error in ERRORS:
        print(f"::error::{error}")
    raise SystemExit(1)

state = "routed articles" if migrated else "pre-routing snapshot"
print(f"Multilingual site verification: PASS (zh-TW primary + zh-CN secondary, {state})")
