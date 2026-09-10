# HUIKAI accountless comments

This is a production-gated foundation for a HUIKAI-native comment system. It is **not enabled on the live site yet**; production remains on Giscus until Cloudflare resources, moderation, legacy-discussion handling and live QA are explicitly approved.

## V1 product contract

Readers do not create an account and do not need GitHub, Google or another identity provider. Public submissions contain only a display name and plain-text body. Every reader submission starts as `pending`; nothing user-submitted is auto-published. D1 stores no email address and no raw IP address. Reader text is rendered with `textContent`, so Markdown and HTML are never interpreted. Replies are limited to one level. Reserved author/admin names are rejected for public submissions.

A successful submission returns an opaque management capability. Only its SHA-256 hash is stored. The browser may retain the capability locally so the reader can later withdraw that comment from the same browser. Pending withdrawal deletes the unpublished row. Approved withdrawal clears the public name/body and retains a neutral tombstone when replies need context. Author replies are created only through the admin API and carry `is_author=1`.

Turnstile is mandatory for public POSTs. Server-side Siteverify must succeed for hostname `huikai.com.kg` and action `comment-submit`. The Workers Rate Limiting binding is an abuse throttle only; moderation remains the publication gate.

## API

Same-origin prefix: `/api/comments/v1`.

Public endpoints: `GET /comments?articleKey=notion:<page-id>`, `POST /comments`, `POST /comments/:id/withdraw`, and `GET /health`.

Admin endpoints require `Authorization: Bearer COMMENTS_ADMIN_TOKEN`: `GET /admin/pending`, `POST /admin/comments/:id/approve`, `POST /admin/comments/:id/hide`, and `POST /admin/replies`.

There is intentionally no public admin page in this foundation. A usable protected moderation path must be in place before provider cutover.

## Stable article identity

The existing Notion comments policy already assigns Public articles a stable `commentKey` such as `notion:3d07a59e-0439-8048-ae89-da587d3ba5d0`. The custom provider reuses this key, so provider migration does not require changing Notion schema or article URLs. Public POSTs also include the current article path; the Worker fetches that published page and requires a matching `data-comment-key` marker before accepting a submission.

## Production gate and rollback

`config/_default/params.toml` keeps `comments.provider = "giscus"`. A future cutover changes it to `huikai` only after a real D1 database, Turnstile site key/secret, `COMMENTS_ADMIN_TOKEN`, moderation path, existing Giscus inventory decision and production live QA are ready.

The committed Wrangler config deliberately contains an all-zero D1 UUID for PR/local validation. The production deployment workflow requires a real D1 UUID and exact current-main SHA, applies versioned migrations, reconfirms main before deployment and verifies the live Worker source lineage. Secrets are never committed.

Until cutover, rollback is simply keeping `provider = "giscus"`. After cutover, reverting the provider must not delete D1 data or GitHub Discussions.
