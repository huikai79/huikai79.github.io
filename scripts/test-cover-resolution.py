#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESOLVER = ROOT / "scripts" / "resolve-article-covers.py"
SOURCE_VERIFIER = ROOT / "scripts" / "verify-source-contract.py"
LEGACY_FALLBACK_FILENAME = "cover-fallback.png"
SOCIAL_FALLBACK_FILENAME = "social-preview.png"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def directory_hash(directory: Path) -> str:
    digest = hashlib.sha256()
    for entry in sorted(directory.rglob("*"), key=lambda item: item.relative_to(directory).as_posix()):
        if not entry.is_file():
            continue
        relative = entry.relative_to(directory)
        digest.update(relative.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(entry.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def run(script: Path, site_root: Path, *, strict: bool = False) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["SITE_ROOT"] = str(site_root)
    if strict:
        env["STRICT_CONTENT"] = "1"
    return subprocess.run(
        [sys.executable, str(script)],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=True,
    )


def write_fixture(root: Path) -> None:
    posts = root / "content" / "posts"
    explicit = posts / "explicit"
    svg = posts / "svg-hero"
    first = posts / "first-bundle"
    no_image = posts / "no-image"
    legacy = posts / "legacy-auto"
    for bundle in (explicit, svg, first, no_image, legacy):
        bundle.mkdir(parents=True)

    (explicit / "index.md").write_text(
        '---\ntitle: "Explicit"\ncover: "manual.jpg"\nimages: ["manual.jpg"]\n---\n\nBody\n',
        encoding="utf-8",
        newline="\n",
    )
    (explicit / "manual.jpg").write_bytes(b"manual")

    (svg / "index.md").write_text(
        '---\ntitle: "SVG hero"\ncover: "cover.svg"\nimages: ["cover.svg"]\n---\n\nBody without raster image.\n',
        encoding="utf-8",
        newline="\n",
    )
    (svg / "cover.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900"/></svg>\n',
        encoding="utf-8",
        newline="\n",
    )

    (first / "index.md").write_text(
        '---\ntitle: "First image"\nslug: "first-image"\n---\n\n![](image-01.jpg)\n',
        encoding="utf-8",
        newline="\n",
    )
    (first / "image-01.jpg").write_bytes(b"localized")

    (no_image / "index.md").write_text(
        '---\ntitle: "No image article"\n---\n\nNo image here.\n',
        encoding="utf-8",
        newline="\n",
    )

    (legacy / "index.md").write_text(
        f'---\ntitle: "Legacy auto hero"\ncover: "image-01.jpg"\nimages: ["image-01.jpg"]\n---\n\n![](image-01.jpg)\n',
        encoding="utf-8",
        newline="\n",
    )
    (legacy / "image-01.jpg").write_bytes(b"legacy-body")
    (legacy / LEGACY_FALLBACK_FILENAME).write_bytes(b"stale")

    manifest = {
        "pages": {
            "page-explicit": {"slug": "explicit", "bundleHash": directory_hash(explicit)},
            "page-svg": {"slug": "svg-hero", "bundleHash": directory_hash(svg)},
            "page-first": {
                "slug": "first-image",
                "bundlePath": "first-bundle",
                "contentFile": "index.md",
                "bundleHash": directory_hash(first),
            },
            "page-no-image": {"slug": "no-image", "bundleHash": directory_hash(no_image)},
            "page-legacy": {"slug": "legacy-auto", "bundleHash": directory_hash(legacy)},
        }
    }
    (root / ".notion-sync-manifest.json").write_text(
        f"{json.dumps(manifest, indent=2)}\n",
        encoding="utf-8",
        newline="\n",
    )
    (root / ".notion-sync-report.json").write_text(
        json.dumps({"status": "complete"}) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def assert_social_preview(bundle: Path, index_path: Path) -> bytes:
    text = index_path.read_text(encoding="utf-8")
    if f'images: ["{SOCIAL_FALLBACK_FILENAME}"]' not in text:
        raise AssertionError(f"{bundle.name}: social fallback front matter was not written")
    png = bundle / SOCIAL_FALLBACK_FILENAME
    if not png.is_file():
        raise AssertionError(f"{bundle.name}: social preview PNG was not generated")
    data = png.read_bytes()
    if data[:8] != PNG_SIGNATURE:
        raise AssertionError(f"{bundle.name}: social preview is not PNG")
    width, height = struct.unpack(">II", data[16:24])
    if (width, height) != (1200, 630):
        raise AssertionError(f"{bundle.name}: unexpected social dimensions {width}x{height}")
    return data


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="cover-resolution-") as tmp:
        site_root = Path(tmp)
        write_fixture(site_root)

        explicit_bundle = site_root / "content" / "posts" / "explicit"
        explicit_index = explicit_bundle / "index.md"
        svg_bundle = site_root / "content" / "posts" / "svg-hero"
        svg_index = svg_bundle / "index.md"
        first_bundle = site_root / "content" / "posts" / "first-bundle"
        first_index = first_bundle / "index.md"
        no_image_bundle = site_root / "content" / "posts" / "no-image"
        no_image_index = no_image_bundle / "index.md"
        legacy_bundle = site_root / "content" / "posts" / "legacy-auto"
        legacy_index = legacy_bundle / "index.md"

        explicit_before = explicit_index.read_bytes()
        svg_cover_before = (svg_bundle / "cover.svg").read_bytes()

        first_run = run(RESOLVER, site_root)
        report_text = (site_root / ".notion-sync-report.json").read_text(encoding="utf-8")
        if "explicit-cover-or-none" not in report_text:
            raise AssertionError("presentation report does not record optional Hero strategy")
        if "deterministic-social-preview-png" not in report_text:
            raise AssertionError("presentation report does not record social fallback strategy")
        if '"bundlePath": "first-bundle"' not in report_text:
            raise AssertionError("presentation report does not preserve bundlePath provenance")

        if explicit_index.read_bytes() != explicit_before:
            raise AssertionError("explicit raster cover article was modified")

        svg_text = svg_index.read_text(encoding="utf-8")
        if 'cover: "cover.svg"' not in svg_text:
            raise AssertionError("explicit SVG Hero was not preserved")
        if (svg_bundle / "cover.svg").read_bytes() != svg_cover_before:
            raise AssertionError("explicit SVG Hero asset was modified")
        svg_social = assert_social_preview(svg_bundle, svg_index)

        first_text = first_index.read_text(encoding="utf-8")
        if "cover:" in first_text:
            raise AssertionError("body image was incorrectly promoted to Hero")
        if "![](image-01.jpg)" not in first_text:
            raise AssertionError("body image was removed while resolving presentation")
        first_social = assert_social_preview(first_bundle, first_index)

        no_image_text = no_image_index.read_text(encoding="utf-8")
        if "cover:" in no_image_text:
            raise AssertionError("no-image article received an artificial Hero")
        no_image_social = assert_social_preview(no_image_bundle, no_image_index)

        legacy_text = legacy_index.read_text(encoding="utf-8")
        if 'cover: "image-01.jpg"' in legacy_text:
            raise AssertionError("legacy first-body-image Hero was not removed")
        if not "![](image-01.jpg)" in legacy_text:
            raise AssertionError("legacy body image was removed instead of only its Hero promotion")
        if (legacy_bundle / LEGACY_FALLBACK_FILENAME).exists():
            raise AssertionError("legacy procedural Hero fallback was not removed")
        legacy_social = assert_social_preview(legacy_bundle, legacy_index)

        manifest = json.loads((site_root / ".notion-sync-manifest.json").read_text(encoding="utf-8"))
        for page_id, bundle in {
            "page-explicit": explicit_bundle,
            "page-svg": svg_bundle,
            "page-first": first_bundle,
            "page-no-image": no_image_bundle,
            "page-legacy": legacy_bundle,
        }.items():
            if manifest["pages"][page_id]["bundleHash"] != directory_hash(bundle):
                raise AssertionError(f"bundle hash was not refreshed for {page_id}")

        snapshot = {
            "explicit": explicit_index.read_bytes(),
            "svg": svg_index.read_bytes(),
            "svg_social": svg_social,
            "first": first_index.read_bytes(),
            "first_social": first_social,
            "no_image": no_image_index.read_bytes(),
            "no_image_social": no_image_social,
            "legacy": legacy_index.read_bytes(),
            "legacy_social": legacy_social,
            "manifest": (site_root / ".notion-sync-manifest.json").read_bytes(),
        }

        second_run = run(RESOLVER, site_root)
        if explicit_index.read_bytes() != snapshot["explicit"]:
            raise AssertionError("second resolver run changed explicit raster article")
        if svg_index.read_bytes() != snapshot["svg"] or (svg_bundle / SOCIAL_FALLBACK_FILENAME).read_bytes() != snapshot["svg_social"]:
            raise AssertionError("SVG presentation is not stable")
        if first_index.read_bytes() != snapshot["first"] or (first_bundle / SOCIAL_FALLBACK_FILENAME).read_bytes() != snapshot["first_social"]:
            raise AssertionError("no-Hero body-image presentation is not stable")
        if no_image_index.read_bytes() != snapshot["no_image"] or (no_image_bundle / SOCIAL_FALLBACK_FILENAME).read_bytes() != snapshot["no_image_social"]:
            raise AssertionError("no-image presentation is not stable")
        if legacy_index.read_bytes() != snapshot["legacy"] or (legacy_bundle / SOCIAL_FALLBACK_FILENAME).read_bytes() != snapshot["legacy_social"]:
            raise AssertionError("legacy cleanup is not stable")
        if (site_root / ".notion-sync-manifest.json").read_bytes() != snapshot["manifest"]:
            raise AssertionError("second resolver run changed manifest despite stable bundles")

        run(SOURCE_VERIFIER, site_root, strict=True)

        print(first_run.stdout.strip())
        print(second_run.stdout.strip())
        print("Article presentation fixture verification: PASS")


if __name__ == "__main__":
    main()
