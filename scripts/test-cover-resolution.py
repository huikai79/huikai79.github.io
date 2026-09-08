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
FALLBACK_FILENAME = "cover-fallback.png"
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
    fallback = posts / "fallback"
    for bundle in (explicit, svg, first, fallback):
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

    (fallback / "index.md").write_text(
        '---\ntitle: "Fallback article"\n---\n\nNo image here.\n',
        encoding="utf-8",
        newline="\n",
    )

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
            "page-fallback": {"slug": "fallback", "bundleHash": directory_hash(fallback)},
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


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="cover-resolution-") as tmp:
        site_root = Path(tmp)
        write_fixture(site_root)

        explicit_bundle = site_root / "content" / "posts" / "explicit"
        explicit_index = explicit_bundle / "index.md"
        svg_bundle = site_root / "content" / "posts" / "svg-hero"
        svg_index = svg_bundle / "index.md"
        social_png = svg_bundle / SOCIAL_FALLBACK_FILENAME
        first_bundle = site_root / "content" / "posts" / "first-bundle"
        first_index = first_bundle / "index.md"
        fallback_bundle = site_root / "content" / "posts" / "fallback"
        fallback_index = fallback_bundle / "index.md"
        fallback_png = fallback_bundle / FALLBACK_FILENAME

        explicit_before = explicit_index.read_bytes()
        svg_cover_before = (svg_bundle / "cover.svg").read_bytes()

        first_run = run(RESOLVER, site_root)
        report_text = (site_root / ".notion-sync-report.json").read_text(encoding="utf-8")
        if "deterministic-procedural-png" not in report_text:
            raise AssertionError("cover report does not record procedural fallback strategy")
        if "deterministic-social-preview-png" not in report_text:
            raise AssertionError("cover report does not record SVG social preview fallback strategy")
        if '"bundlePath": "first-bundle"' not in report_text:
            raise AssertionError("cover report does not preserve internal bundlePath provenance")

        if explicit_index.read_bytes() != explicit_before:
            raise AssertionError("explicit raster cover article was modified")

        svg_text = svg_index.read_text(encoding="utf-8")
        if 'cover: "cover.svg"' not in svg_text:
            raise AssertionError("SVG hero cover was not preserved")
        if f'images: ["{SOCIAL_FALLBACK_FILENAME}"]' not in svg_text:
            raise AssertionError("SVG hero did not receive independent raster social preview")
        if (svg_bundle / "cover.svg").read_bytes() != svg_cover_before:
            raise AssertionError("SVG hero asset was modified")
        if not social_png.is_file():
            raise AssertionError("SVG hero social preview PNG was not generated")
        social_data = social_png.read_bytes()
        if social_data[:8] != PNG_SIGNATURE:
            raise AssertionError("SVG hero social preview is not PNG")
        social_width, social_height = struct.unpack(">II", social_data[16:24])
        if (social_width, social_height) != (1200, 630):
            raise AssertionError(f"unexpected social preview dimensions: {social_width}x{social_height}")

        first_text = first_index.read_text(encoding="utf-8")
        if 'cover: "image-01.jpg"' not in first_text or 'images: ["image-01.jpg"]' not in first_text:
            raise AssertionError("first localized image was not promoted to cover/images")

        fallback_text = fallback_index.read_text(encoding="utf-8")
        if f'cover: "{FALLBACK_FILENAME}"' not in fallback_text:
            raise AssertionError("fallback cover front matter was not added")
        if f'images: ["{FALLBACK_FILENAME}"]' not in fallback_text:
            raise AssertionError("fallback images front matter was not added")
        if not fallback_png.is_file():
            raise AssertionError("fallback PNG was not generated")

        png_a = fallback_png.read_bytes()
        if png_a[:8] != PNG_SIGNATURE:
            raise AssertionError("fallback file is not PNG")
        width, height = struct.unpack(">II", png_a[16:24])
        if (width, height) != (1600, 900):
            raise AssertionError(f"unexpected fallback dimensions: {width}x{height}")

        manifest = json.loads((site_root / ".notion-sync-manifest.json").read_text(encoding="utf-8"))
        if manifest["pages"]["page-explicit"]["bundleHash"] != directory_hash(explicit_bundle):
            raise AssertionError("explicit raster bundle hash drifted unexpectedly")
        if manifest["pages"]["page-svg"]["bundleHash"] != directory_hash(svg_bundle):
            raise AssertionError("SVG hero bundle hash was not refreshed")
        if manifest["pages"]["page-first"]["bundleHash"] != directory_hash(first_bundle):
            raise AssertionError("bundlePath-backed first-image hash was not refreshed")
        if manifest["pages"]["page-fallback"]["bundleHash"] != directory_hash(fallback_bundle):
            raise AssertionError("fallback bundle hash was not refreshed")

        snapshot = {
            "explicit": explicit_index.read_bytes(),
            "svg": svg_index.read_bytes(),
            "social": social_png.read_bytes(),
            "first": first_index.read_bytes(),
            "fallback": fallback_index.read_bytes(),
            "png": png_a,
            "manifest": (site_root / ".notion-sync-manifest.json").read_bytes(),
        }

        second_run = run(RESOLVER, site_root)
        if explicit_index.read_bytes() != snapshot["explicit"]:
            raise AssertionError("second resolver run changed explicit raster article")
        if svg_index.read_bytes() != snapshot["svg"]:
            raise AssertionError("second resolver run changed SVG hero front matter")
        if social_png.read_bytes() != snapshot["social"]:
            raise AssertionError("SVG social preview is not byte-stable")
        if first_index.read_bytes() != snapshot["first"]:
            raise AssertionError("second resolver run changed first-image front matter")
        if fallback_index.read_bytes() != snapshot["fallback"]:
            raise AssertionError("second resolver run changed fallback front matter")
        if fallback_png.read_bytes() != snapshot["png"]:
            raise AssertionError("fallback PNG is not byte-stable")
        if (site_root / ".notion-sync-manifest.json").read_bytes() != snapshot["manifest"]:
            raise AssertionError("second resolver run changed manifest despite stable bundles")

        run(SOURCE_VERIFIER, site_root, strict=True)

        svg_index.write_text(
            svg_index.read_text(encoding="utf-8").replace(
                f'images: ["{SOCIAL_FALLBACK_FILENAME}"]',
                'images: ["manual.jpg"]',
            ),
            encoding="utf-8",
            newline="\n",
        )
        (svg_bundle / "manual.jpg").write_bytes(b"manual")
        run(RESOLVER, site_root)
        if social_png.exists():
            raise AssertionError("stale SVG social preview fallback was not removed after raster social image appeared")
        if 'cover: "cover.svg"' not in svg_index.read_text(encoding="utf-8"):
            raise AssertionError("SVG hero cover changed when raster social image appeared")

        fallback_index.write_text(
            fallback_index.read_text(encoding="utf-8")
            .replace(f'cover: "{FALLBACK_FILENAME}"', 'cover: "manual.jpg"')
            .replace(f'images: ["{FALLBACK_FILENAME}"]', 'images: ["manual.jpg"]'),
            encoding="utf-8",
            newline="\n",
        )
        (fallback_bundle / "manual.jpg").write_bytes(b"manual")
        run(RESOLVER, site_root)
        if fallback_png.exists():
            raise AssertionError("stale procedural fallback was not removed after explicit cover appeared")

        manifest = json.loads((site_root / ".notion-sync-manifest.json").read_text(encoding="utf-8"))
        if manifest["pages"]["page-svg"]["bundleHash"] != directory_hash(svg_bundle):
            raise AssertionError("SVG bundle hash was not refreshed after raster social image appeared")
        if manifest["pages"]["page-fallback"]["bundleHash"] != directory_hash(fallback_bundle):
            raise AssertionError("bundle hash was not refreshed after stale fallback cleanup")

        print(first_run.stdout.strip())
        print(second_run.stdout.strip())
        print("Cover resolution fixture verification: PASS")


if __name__ == "__main__":
    main()
