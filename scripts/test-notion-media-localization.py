#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import io
import tempfile
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).with_name("localize-notion-media.py")
spec = importlib.util.spec_from_file_location("localize_notion_media", SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError("Unable to load localize-notion-media.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fail(message: str) -> None:
    raise AssertionError(message)


class ShortReadBytesIO(io.BytesIO):
    def __init__(self, payload: bytes, max_chunk: int):
        super().__init__(payload)
        self.max_chunk = max_chunk

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            size = self.max_chunk
        return super().read(min(size, self.max_chunk))


class HeaderBytesIO(io.BytesIO):
    def __init__(self, payload: bytes, content_type: str):
        super().__init__(payload)
        self.headers = {"Content-Type": content_type}


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
    temporary_audio = (
        "https://prod-files-secure.s3.us-west-2.amazonaws.com/"
        "workspace/page/audio.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=audio"
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
    if pdf_name_a != pdf_name_b:
        fail("Attachment filename must ignore expiring signed query parameters")
    if not pdf_name_a.endswith(".pdf"):
        fail("Attachment filename must preserve a safe extension")

    if module.read_limited(io.BytesIO(b"12345"), limit=5) != b"12345":
        fail("Attachment size guard must accept a payload exactly at the limit")
    try:
        module.read_limited(io.BytesIO(b"123456"), limit=5)
    except RuntimeError as error:
        if "exceeds Git localization limit" not in str(error):
            fail(f"Unexpected attachment size error: {error}")
    else:
        fail("Attachment size guard must reject a payload over the limit")

    if module.read_limited(ShortReadBytesIO(b"12345", max_chunk=2), limit=5) != b"12345":
        fail("Attachment size guard must collect partial reads until EOF")
    try:
        module.read_limited(ShortReadBytesIO(b"123456", max_chunk=2), limit=5)
    except RuntimeError:
        pass
    else:
        fail("Attachment size guard must reject an over-limit payload even when reads are partial")

    if not module.is_streaming_content_type("audio/wav; charset=binary"):
        fail("Audio MIME type must be treated as streaming media")
    if not module.is_streaming_content_type("VIDEO/MP4"):
        fail("Video MIME type matching must be case-insensitive")
    if module.is_streaming_content_type("application/pdf"):
        fail("Ordinary document MIME type must not be treated as streaming media")

    with tempfile.TemporaryDirectory() as tmp:
        bundle = Path(tmp)
        downloads: list[tuple[str, str]] = []

        def fake_fetcher(url: str, destination: Path) -> None:
            destination.write_bytes(b"fixture attachment bytes")
            downloads.append((url, destination.name))

        markdown = (
            f"[attachment]({temporary_pdf})\n\n"
            f"[ordinary external]({external_url})\n\n"
            f"[external video]({external_video})\n\n"
            f"![already-an-image]({temporary_pdf})\n"
        )
        updated, localized = module.localize_markdown_links(markdown, bundle, fake_fetcher)

        if f"[attachment]({pdf_name_a})" not in updated:
            fail("Temporary Notion non-streaming attachment link was not localized")
        if f"[ordinary external]({external_url})" not in updated:
            fail("Ordinary external link was unexpectedly changed")
        if f"[external video]({external_video})" not in updated:
            fail("External MP4 link must remain an ordinary external link")
        if f"![already-an-image]({temporary_pdf})" not in updated:
            fail("Image syntax must remain owned by the existing image localizer")
        if len(localized) != 1 or len(downloads) != 1:
            fail("Expected exactly one temporary non-streaming attachment localization")
        if not (bundle / pdf_name_a).is_file():
            fail("Localized attachment file was not written")

        for label, media_url in [("video", temporary_video), ("audio", temporary_audio)]:
            try:
                module.localize_markdown_links(f"[{label}]({media_url})", bundle, fake_fetcher)
            except RuntimeError as error:
                if "streaming media" not in str(error) or "refusing to write it into Git" not in str(error):
                    fail(f"Unexpected {label} refusal error: {error}")
            else:
                fail(f"Temporary Notion {label} must fail closed instead of being downloaded")

        if len(downloads) != 1:
            fail("Temporary Notion streaming-media refusal must occur before any download")

        mime_destination = bundle / "attachment-extensionless.bin"
        with mock.patch.object(
            module.urllib.request,
            "urlopen",
            return_value=HeaderBytesIO(b"streaming bytes", "audio/wav"),
        ):
            try:
                module.download_file("https://example.invalid/attachment", mime_destination, attempts=1)
            except RuntimeError as error:
                if "streaming media content type" not in str(error):
                    fail(f"Unexpected MIME refusal error: {error}")
            else:
                fail("Streaming MIME type must fail closed even when the URL has no media extension")
        if mime_destination.exists():
            fail("Streaming MIME refusal must not install a destination file")
        if list(bundle.glob("attachment-extensionless.bin.tmp-*")):
            fail("Streaming MIME refusal must clean up temporary files")

        legacy_markdown = f"[legacy video]({legacy_local_video})"
        converted, names = module.normalize_local_video_links(legacy_markdown)
        if f'{{{{< video src="{legacy_local_video}" >}}}}' not in converted:
            fail("Legacy local MP4 link migration must remain supported during transition")
        if names != [legacy_local_video]:
            fail(f"Unexpected legacy conversion result: {names}")

        second, second_localized = module.localize_markdown_links(updated, bundle, fake_fetcher)
        if second != updated or second_localized:
            fail("Second non-streaming localization run must be byte-stable")
        if len(downloads) != 1:
            fail("Second run must not redownload already-localized Markdown")

    print("Notion media localization fixture verification: PASS")


if __name__ == "__main__":
    main()
