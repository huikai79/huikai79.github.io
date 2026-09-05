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
    temporary_pdf = (
        "https://prod-files-secure.s3.us-west-2.amazonaws.com/"
        "workspace/page/evidence.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc"
    )
    same_pdf_new_signature = (
        "https://prod-files-secure.s3.us-west-2.amazonaws.com/"
        "workspace/page/evidence.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=def"
    )
    temporary_video = (
        "https://prod-files-secure.s3.us-west-2.amazonaws.com/"
        "workspace/page/demo.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=video"
    )
    external_url = "https://example.com/reference.pdf"
    external_video = "https://example.com/demo.mp4"
    legacy_local_video = "attachment-0123456789abcdef.mp4"

    if not module.is_temporary_notion_media_url(temporary_pdf):
        fail("Expected Notion temporary media URL to be recognized")
    if module.is_temporary_notion_media_url(external_url):
        fail("Ordinary external URL must not be treated as temporary Notion media")

    pdf_name_a = module.stable_attachment_name(temporary_pdf)
    pdf_name_b = module.stable_attachment_name(same_pdf_new_signature)
    video_name = module.stable_attachment_name(temporary_video)
    if pdf_name_a != pdf_name_b:
        fail("Attachment filename must ignore expiring signed query parameters")
    if not pdf_name_a.endswith(".pdf") or not video_name.endswith(".mp4"):
        fail("Attachment filename must preserve a safe extension")

    with tempfile.TemporaryDirectory() as tmp:
        bundle = Path(tmp)
        downloads: list[tuple[str, str]] = []

        def fake_fetcher(url: str, destination: Path) -> None:
            destination.write_bytes(b"fixture attachment bytes")
            downloads.append((url, destination.name))

        markdown = (
            f"[image]({temporary_pdf})\n\n"
            f"[video]({temporary_video})\n\n"
            f"[legacy video]({legacy_local_video})\n\n"
            f"[ordinary external]({external_url})\n\n"
            f"[external video]({external_video})\n\n"
            f"![already-an-image]({temporary_pdf})\n"
        )
        updated, localized = module.localize_markdown_links(markdown, bundle, fake_fetcher)
        updated, converted = module.normalize_local_video_links(updated)

        if f"[image]({pdf_name_a})" not in updated:
            fail("Temporary Notion non-video attachment link was not localized")
        if f'{{{{< video src="{video_name}" >}}}}' not in updated:
            fail("Temporary Notion MP4 was not converted to the native video shortcode")
        if f'{{{{< video src="{legacy_local_video}" >}}}}' not in updated:
            fail("Previously localized MP4 link was not migrated to the video shortcode")
        if converted != [legacy_local_video]:
            fail(f"Expected exactly one legacy local video migration, got {converted}")
        if f"[ordinary external]({external_url})" not in updated:
            fail("Ordinary external link was unexpectedly changed")
        if f"[external video]({external_video})" not in updated:
            fail("External MP4 link must remain an ordinary external link")
        if f"![already-an-image]({temporary_pdf})" not in updated:
            fail("Image syntax must remain owned by the existing image localizer")
        if len(localized) != 2 or len(downloads) != 2:
            fail("Expected exactly two temporary attachment localizations")
        if not (bundle / pdf_name_a).is_file() or not (bundle / video_name).is_file():
            fail("Localized attachment files were not written")

        second, second_localized = module.localize_markdown_links(updated, bundle, fake_fetcher)
        second, second_converted = module.normalize_local_video_links(second)
        if second != updated or second_localized or second_converted:
            fail("Second run must be byte-stable and perform no further localization")
        if len(downloads) != 2:
            fail("Second run must not redownload already-localized Markdown")

    print("Notion media localization fixture verification: PASS")


if __name__ == "__main__":
    main()
