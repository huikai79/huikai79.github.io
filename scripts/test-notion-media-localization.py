#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("localize-notion-media.py")
spec = importlib.util.spec_from_file_location("localize_notion_media", SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError("Unable to load localize-notion-media.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fail(message: str) -> None:
    raise AssertionError(message)


def main() -> None:
    temporary_url = (
        "https://prod-files-secure.s3.us-west-2.amazonaws.com/"
        "workspace/page/evidence.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc"
    )
    same_file_new_signature = (
        "https://prod-files-secure.s3.us-west-2.amazonaws.com/"
        "workspace/page/evidence.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=def"
    )
    external_url = "https://example.com/reference.pdf"

    if not module.is_temporary_notion_media_url(temporary_url):
        fail("Expected Notion temporary media URL to be recognized")
    if module.is_temporary_notion_media_url(external_url):
        fail("Ordinary external URL must not be treated as temporary Notion media")

    name_a = module.stable_attachment_name(temporary_url)
    name_b = module.stable_attachment_name(same_file_new_signature)
    if name_a != name_b:
        fail("Attachment filename must ignore expiring signed query parameters")
    if not name_a.endswith(".pdf"):
        fail("Attachment filename must preserve a safe extension")

    with tempfile.TemporaryDirectory() as tmp:
        bundle = Path(tmp)
        downloads: list[tuple[str, str]] = []

        def fake_fetcher(url: str, destination: Path) -> None:
            destination.write_bytes(b"fixture attachment bytes")
            downloads.append((url, destination.name))

        markdown = (
            f"[image]({temporary_url})\n\n"
            f"[ordinary external]({external_url})\n\n"
            f"![already-an-image]({temporary_url})\n"
        )
        updated, localized = module.localize_markdown_links(markdown, bundle, fake_fetcher)

        expected_local = f"[image]({name_a})"
        if expected_local not in updated:
            fail("Temporary Notion attachment link was not localized")
        if f"[ordinary external]({external_url})" not in updated:
            fail("Ordinary external link was unexpectedly changed")
        if f"![already-an-image]({temporary_url})" not in updated:
            fail("Image syntax must remain owned by the existing image localizer")
        if len(localized) != 1 or len(downloads) != 1:
            fail("Expected exactly one temporary attachment localization")
        if not (bundle / name_a).is_file():
            fail("Localized attachment file was not written")

        second, second_localized = module.localize_markdown_links(updated, bundle, fake_fetcher)
        if second != updated or second_localized:
            fail("Second run must be byte-stable and perform no further localization")
        if len(downloads) != 1:
            fail("Second run must not redownload already-localized Markdown")

    print("Notion media localization fixture verification: PASS")


if __name__ == "__main__":
    main()
