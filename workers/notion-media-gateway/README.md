# Notion media gateway

This Worker is a same-origin streaming gate for Notion-uploaded MP4 videos.

Security properties:

- The Notion signed S3 URL is fetched server-side and never emitted into article HTML.
- `NOTION_TOKEN` and `MEDIA_SESSION_SECRET` are Cloudflare Worker Secrets, never repository variables or browser JavaScript.
- Browser access uses a 10-minute `HttpOnly; Secure; SameSite=Strict` cookie refreshed while the page is open.
- The media route only accepts same-site browser requests and checks that the requested Notion video block ID is actually present in the published article HTML.
- No CORS headers are returned, so cross-origin browser embedding is not enabled.
- The upstream response is forced to `Content-Disposition: inline` and `Cache-Control: private, no-store`.

## Required Cloudflare secrets

- `NOTION_TOKEN`: the Notion integration token that can read the published source pages.
- `MEDIA_SESSION_SECRET`: an independent random secret of at least 32 bytes used only to sign short-lived media sessions.

Do not commit either value. Configure them with Cloudflare Worker Secrets before deployment.

The route is intentionally limited to `https://huikai.com.kg/media/*`; the rest of the site remains on GitHub Pages.
