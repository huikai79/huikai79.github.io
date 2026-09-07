#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
worker = (ROOT / "workers/notion-media-gateway/index.js").read_text(encoding="utf-8")
video_shortcode = (ROOT / "layouts/shortcodes/notion-video.html").read_text(encoding="utf-8")
audio_shortcode = (ROOT / "layouts/shortcodes/notion-audio.html").read_text(encoding="utf-8")
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
    'publishedPageContainsAudio',
    'htmlContainsAudioBlock',
    'data-notion-audio-block\\\\s*=\\\\s*',
    'notionUploadedFileUrl',
    'proxyUploadedMedia',
    'Content-Disposition", "inline"',
    'Cache-Control", "private, no-store"',
]
required_video_shortcode = [
    'data-notion-video-block=',
    'controlslist="nodownload noremoteplayback"',
    'disablepictureinpicture',
    'disableremoteplayback',
    'data-media-endpoint="/media/video/',
    'fetch("/media/session"',
    'credentials: "same-origin"',
]
required_audio_shortcode = [
    'data-notion-audio-block=',
    'controlslist="nodownload noremoteplayback"',
    'disableremoteplayback',
    'data-media-endpoint="/media/audio/',
    'fetch("/media/session"',
    'credentials: "same-origin"',
]
required_wrangler = [
    'name = "huikai-notion-media"',
    'workers_dev = false',
    '[secrets]',
    'required = ["NOTION_TOKEN", "MEDIA_SESSION_SECRET"]',
    'pattern = "huikai.com.kg/media/*"',
    'zone_name = "huikai.com.kg"',
]

errors = []
for needle in required_worker:
    if needle not in worker:
        errors.append(f"worker contract missing: {needle}")
for needle in required_video_shortcode:
    if needle not in video_shortcode:
        errors.append(f"video shortcode contract missing: {needle}")
for needle in required_audio_shortcode:
    if needle not in audio_shortcode:
        errors.append(f"audio shortcode contract missing: {needle}")
for needle in required_wrangler:
    if needle not in wrangler:
        errors.append(f"wrangler contract missing: {needle}")

if 'html.includes(`data-notion-video-block="${blockId}"`)' in worker:
    errors.append("worker must not require quoted video marker attributes after Hugo minification")
if 'html.includes(`data-notion-audio-block="${blockId}"`)' in worker:
    errors.append("worker must not require quoted audio marker attributes after Hugo minification")

for forbidden in ["secret =", "NOTION_TOKEN =", "MEDIA_SESSION_SECRET ="]:
    if forbidden in worker or forbidden in wrangler:
        errors.append(f"credential-like literal must not be committed: {forbidden}")

if errors:
    for error in errors:
        print(f"::error::{error}")
    raise SystemExit(1)

print("Notion media gateway static verification: PASS")
