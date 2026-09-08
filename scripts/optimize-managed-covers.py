#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / ".notion-sync-manifest.json"
POSTS = ROOT / "content" / "posts"
WARNING_BYTES = 2 * 1024 * 1024
TARGET_BYTES = 1_900 * 1024
MIN_PSNR_DB = 35.0
MAX_PREFERRED_WIDTH = 2560
QUALITY_CANDIDATES = (90, 88, 86, 84, 82, 80)


def directory_hash(directory: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in directory.rglob("*") if item.is_file()):
        relative = path.relative_to(directory).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def load_manifest() -> dict:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    pages = data.get("pages")
    if not isinstance(pages, dict):
        raise RuntimeError("Notion manifest pages map is missing")
    return data


def managed_jpeg_covers(manifest: dict) -> list[tuple[str, Path]]:
    covers: list[tuple[str, Path]] = []
    seen: set[Path] = set()
    for page_id, entry in manifest["pages"].items():
        if not isinstance(entry, dict):
            continue
        bundle_path = str(entry.get("bundlePath") or entry.get("slug") or "").strip()
        if not bundle_path or bundle_path in {".", ".."} or "/" in bundle_path or "\\" in bundle_path:
            raise RuntimeError(f"Unsafe manifest bundle path for {page_id}: {bundle_path!r}")
        bundle = POSTS / bundle_path
        for name in ("cover.jpg", "cover.jpeg", "cover.JPG", "cover.JPEG"):
            cover = bundle / name
            if cover.is_file() and cover not in seen:
                seen.add(cover)
                covers.append((page_id, cover))
                break
    return covers


def oversized(covers: list[tuple[str, Path]]) -> list[tuple[str, Path]]:
    return [(page_id, path) for page_id, path in covers if path.stat().st_size > WARNING_BYTES]


def psnr(reference, candidate) -> float:
    from PIL import ImageChops

    diff = ImageChops.difference(reference, candidate)
    histogram = diff.histogram()
    squared_error = 0
    for channel in range(3):
        base = channel * 256
        squared_error += sum((value * value) * histogram[base + value] for value in range(256))
    samples = reference.width * reference.height * 3
    if squared_error == 0:
        return float("inf")
    mse = squared_error / samples
    return 10.0 * math.log10((255.0 * 255.0) / mse)


def dimension_candidates(width: int, height: int) -> list[tuple[int, int]]:
    result = [(width, height)]
    if width > MAX_PREFERRED_WIDTH:
        for target_width in (MAX_PREFERRED_WIDTH, 2304, 2048, 1792):
            if target_width >= width:
                continue
            target_height = max(1, round(height * target_width / width))
            pair = (target_width, target_height)
            if pair not in result:
                result.append(pair)
    return result


def encode_candidate(reference, quality: int) -> tuple[bytes, float]:
    from PIL import Image

    buffer = io.BytesIO()
    reference.save(
        buffer,
        format="JPEG",
        quality=quality,
        optimize=True,
        progressive=True,
    )
    payload = buffer.getvalue()
    decoded = Image.open(io.BytesIO(payload)).convert("RGB")
    score = psnr(reference, decoded)
    return payload, score


def optimize_cover(path: Path) -> dict:
    from PIL import Image, ImageOps

    original_bytes = path.stat().st_size
    with Image.open(path) as opened:
        base = ImageOps.exif_transpose(opened).convert("RGB")

    chosen: tuple[bytes, tuple[int, int], int, float] | None = None
    for dimensions in dimension_candidates(base.width, base.height):
        reference = base if dimensions == base.size else base.resize(dimensions, Image.Resampling.LANCZOS)
        for quality in QUALITY_CANDIDATES:
            payload, score = encode_candidate(reference, quality)
            if len(payload) <= TARGET_BYTES and score >= MIN_PSNR_DB:
                chosen = (payload, dimensions, quality, score)
                break
        if chosen is not None:
            break

    if chosen is None:
        raise RuntimeError(
            f"Unable to optimize {path.relative_to(ROOT)} below {TARGET_BYTES} bytes "
            f"while preserving PSNR >= {MIN_PSNR_DB:.1f} dB"
        )

    payload, dimensions, quality, score = chosen
    temporary = path.with_suffix(path.suffix + ".opt-tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)
    return {
        "path": path.relative_to(ROOT).as_posix(),
        "beforeBytes": original_bytes,
        "afterBytes": len(payload),
        "width": dimensions[0],
        "height": dimensions[1],
        "quality": quality,
        "psnrDb": round(score, 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check-needed",
        action="store_true",
        help="Exit 0 when managed JPEG covers need optimization; exit 1 when none do.",
    )
    args = parser.parse_args()

    manifest = load_manifest()
    covers = managed_jpeg_covers(manifest)
    pending = oversized(covers)

    if args.check_needed:
        if pending:
            print(
                "Managed cover optimization needed: "
                + ", ".join(f"{path.relative_to(ROOT)}={path.stat().st_size}B" for _, path in pending)
            )
            raise SystemExit(0)
        print("Managed cover optimization: not needed")
        raise SystemExit(1)

    if not pending:
        print("Managed cover optimization: PASS (no oversized JPEG covers)")
        return

    try:
        import PIL  # noqa: F401
    except ImportError as error:
        raise RuntimeError(
            "Pillow is required only when oversized managed JPEG covers need optimization"
        ) from error

    results: list[dict] = []
    changed_bundles: set[Path] = set()
    for _page_id, cover in pending:
        result = optimize_cover(cover)
        results.append(result)
        changed_bundles.add(cover.parent)
        print(
            f"Managed cover optimized: {result['path']} "
            f"{result['beforeBytes']} -> {result['afterBytes']} bytes, "
            f"{result['width']}x{result['height']}, q={result['quality']}, "
            f"PSNR={result['psnrDb']:.3f} dB"
        )

    for page_id, entry in manifest["pages"].items():
        if not isinstance(entry, dict):
            continue
        bundle_path = str(entry.get("bundlePath") or entry.get("slug") or "").strip()
        bundle = POSTS / bundle_path
        if bundle in changed_bundles:
            entry["bundleHash"] = directory_hash(bundle)

    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    remaining = oversized(managed_jpeg_covers(manifest))
    if remaining:
        raise RuntimeError(
            "Managed cover optimization left oversized files: "
            + ", ".join(str(path.relative_to(ROOT)) for _, path in remaining)
        )

    print(f"Managed cover optimization: PASS (optimized={len(results)})")


if __name__ == "__main__":
    main()
