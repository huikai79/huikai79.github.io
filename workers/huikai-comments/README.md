# HUIKAI accountless comments

HUIKAI uses a native accountless comment service for public article responses. The service runs as a Cloudflare Worker on the same site origin, stores comment records in D1, and uses Cloudflare Turnstile for abuse protection. Readers do not need GitHub, Google, or another identity provider.

## V1 product contract

Public submissions contain only a display name and plain-text body. Every reader submission starts as `pending`; nothing user-submitted is auto-published. D1 stores no email address and no raw IP address. Reader text is rendered with `textContent`, so Markdown and HTML are never interpreted. Replies are limited to one level. Reserved author/admin names are rejected for public submissions.

A successful submission returns an opaque management capability. Only its SHA-256 hash is stored. The browser may retain the capability locally so the reader can later withdraw that comment from the same browser. Pending withdrawal deletes the unpublished row. Approved withdrawal clears the public name/body and retains a neutral tombstone when replies need context. Author replies are created only through the admin API and carry `is_author=1`.

Turnstile is mandatory for public POSTs. Server-side Siteverify must succeed for hostname `huikai.com.kg` and action `comment-submit`. The Workers Rate Limiting binding is an abuse throttle only; moderation remains the publication gate.

## API

Same-origin prefix: `/api/comments/v1`.

Public endpoints: `GET /comments?articleKey=notion:<page-id>`, `POST /comments`, `POST /comments/:id/withdraw`, and `GET /health`.

Admin endpoints require `Authorization: Bearer COMMENTS_ADMIN_TOKEN`: `GET /admin/pending`, `POST /admin/comments/:id/approve`, `POST /admin/comments/:id/hide`, and `POST /admin/replies`.

The unlisted `/comments-admin/` page is the V1 moderation surface. It is marked `noindex,nofollow,noarchive`, is excluded from ordinary page collections, and is not linked from navigation. The administrator enters `COMMENTS_ADMIN_TOKEN` locally; the client keeps it only in page memory and clears the password field after successful authentication. It is never written to `localStorage`, `sessionStorage`, cookies, content, or repository files.

## Stable article identity

The existing Notion comments policy assigns Public articles a stable `commentKey` such as `notion:3d07a59e-0439-8048-ae89-da587d3ba5d0`. The native provider reuses this key, so provider migration does not require changing Notion schema or article URLs. Public POSTs also include the current article path; the Worker fetches that published page and requires a matching `data-comment-key` marker before accepting a submission.

## Production resources and lineage

The production Cloudflare runtime was provisioned before frontend cutover. It consists of the `huikai-comments` D1 database, the `HUIKAI Comments` managed Turnstile widget scoped to `huikai.com.kg`, and the `huikai-comments` Worker route at `huikai.com.kg/api/comments/*`. Worker secrets are provisioned through the production environment and are never committed.

The committed `wrangler.toml` deliberately retains an all-zero D1 UUID for repository/local validation. Production deployment generates an exact runtime config with the real database UUID and exact current-main source SHA, applies versioned migrations, reconfirms main before deployment, and verifies live Worker lineage and the moderation authorization boundary.

## Legacy Giscus and rollback

The pre-cutover GitHub Discussions inventory found zero discussions in the configured Giscus category and zero `notion:*` Giscus discussions/comments, so there is no legacy reader data to migrate.

The `[giscus]` configuration remains in `config/_default/params.toml` as a rollback path. Candidate QA continues to render and verify a deterministic Giscus rollback snapshot so the fallback does not silently rot. Rolling back the provider must not delete D1 data or GitHub Discussions.
