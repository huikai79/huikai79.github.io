#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
worker = (ROOT / "workers/notion-media-gateway/index.js").read_text(encoding="utf-8")
shortcode = (ROOT / "layouts/shortcodes/notion-video.html").read_text(encoding="utf-8")
wrangler = (ROOT / "workers/notion-media-gateway/wrangler.toml").read_text(encoding="utf-8")

required_worker = [
    'const SITE_ORIGIN = "https://huikai.com.kg"',
    'const SESSION_TTL_SECONDS = 600',
    'env.NOTION_TOKEN',
    'env.MEDIA_SESSION_SECRET',
    'HttpOnly; Secure; SameSite=Strict',
    'publishedPageContainsVideo',
    'htmlContainsVideoBlock',
    'data-notion-video-block\\\\s*=\\\\s*',
    'Content-Disposition", "inline"',
    'Cache-Control", "private, no-store"',
]
required_shortcode = [
    'data-notion-video-block=',
    'controlslist="nodownload noremoteplayback"',
    'disablepictureinpicture',
    'disableremoteplayback',
    'fetch("/media/session"',
    'credentials: "same-origin"',
]

errors = []
for needle in required_worker:
    if needle not in worker:
        errors.append(f"worker contract missing: {needle}")
for needle in required_shortcode:
    if needle not in shortcode:
        errors.append(f"shortcode contract missing: {needle}")
if 'pattern = "huikai.com.kg/media/*"' not in wrangler:
    errors.append("worker route is not limited to huikai.com.kg/media/*")

if 'html.includes(`data-notion-video-block="${blockId}"`)' in worker:
    errors.append("worker must not require quoted video marker attributes after Hugo minification")

for forbidden in ["secret =", "NOTION_TOKEN =", "MEDIA_SESSION_SECRET ="]:
    if forbidden in worker or forbidden in wrangler:
        errors.append(f"credential-like literal must not be committed: {forbidden}")

if errors:
    for error in errors:
        print(f"::error::{error}")
    raise SystemExit(1)

print("Notion media gateway static verification: PASS")
