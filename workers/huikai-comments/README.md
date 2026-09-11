# HUIKAI accountless comments

HUIKAI uses a native accountless comment service for public article responses. The service runs as a Cloudflare Worker on the same site origin, stores comment records in D1, and uses Cloudflare Turnstile for abuse protection. Readers do not need GitHub, Google, or another identity provider.

## Product contract

Public submissions contain only a display name and plain-text body. Every reader submission starts as `pending`; nothing user-submitted is auto-published. D1 stores no email address and no raw IP address. Reader text is rendered with `textContent`, so Markdown and HTML are never interpreted. Reserved author/admin names are rejected for public submissions.

A successful reader submission returns an opaque management capability. Only its SHA-256 hash is stored. The browser may retain the capability locally so the reader can later withdraw that comment from the same browser. Pending withdrawal deletes the unpublished row. Approved withdrawal clears the public name/body and retains a neutral tombstone. Author replies are created only through the admin API and carry `is_author=1`.

Turnstile is mandatory for public POSTs. Server-side Siteverify must succeed for hostname `huikai.com.kg` and action `comment-submit`. The Workers Rate Limiting binding is an abuse throttle only; moderation remains the publication gate.

## Flat visual threads with direct-reply semantics

The public UI intentionally renders at most two visual levels: one root comment and a flat list of replies beneath it. The data model separates that visual root from the actual message being answered:

- `parent_id` is the stable root comment of the thread.
- `reply_to_id` is the direct message being answered.

Public clients submit `replyToId`. The Worker resolves the target, verifies it belongs to the same article and is currently replyable, and computes `parent_id` itself. A reply to another reply therefore stays under the original root while preserving the direct conversational link.

The frontend shows labels such as `回覆 HUIKAI` instead of adding another indentation level. If the direct target later becomes a withdrawal/removal tombstone, the relationship remains readable without exposing deleted content.

During a staged frontend/Worker rollout, the clients keep a narrow compatibility path for the previous V1 response shape. Once the new Worker response includes `replyToId` / `reply_to_id`, normal requests use the new direct-reply contract and do not rely on a client-computed root.

## Comment lifecycle

The admin surface is `/comments-admin/` with three working views:

- `pending`: approve, hide, delete, or approve and reply.
- `approved`: reply, hide, or delete.
- `hidden`: restore or delete.

`hidden` is reversible and remains stored. Admin deletion has two outcomes:

- no dependent comments: hard delete the D1 row;
- referenced by later comments: clear the name/body/capability and retain an admin-removal tombstone (`status='withdrawn'`, `removed_by_admin=1`).

Reader withdrawal remains distinct: pending withdrawal hard-deletes; approved withdrawal becomes a reader-withdrawal tombstone with `removed_by_admin=0`.

The administration UI also shows the validated `page_path`, thread root context, and direct reply target. Older rows created before `page_path` existed may not have a path; they remain manageable through their stable `article_key`.

## API

Same-origin prefix: `/api/comments/v1`.

Public endpoints:

- `GET /comments?articleKey=notion:<page-id>`
- `POST /comments`
- `POST /comments/:id/withdraw`
- `GET /health`

Admin endpoints require the existing `COMMENTS_ADMIN_TOKEN` authorization contract:

- `GET /admin/comments?status=pending|approved|hidden`
- `GET /admin/pending` (compatibility alias)
- `POST /admin/comments/:id/approve`
- `POST /admin/comments/:id/hide`
- `POST /admin/comments/:id/restore`
- `POST /admin/comments/:id/delete`
- `POST /admin/replies`

The unlisted `/comments-admin/` page is marked `noindex,nofollow,noarchive`, is excluded from ordinary page collections, and is not linked from navigation. The administrator credential is kept only in page memory and cleared from the field after successful authentication. It is never written to browser storage, content, or repository files.

## Stable article identity and path provenance

The existing Notion comments policy assigns Public articles a stable `commentKey` such as `notion:3d07a59e-0439-8048-ae89-da587d3ba5d0`. The native provider reuses this key, so the comment system does not require a new Notion schema or article URL.

Public POSTs include the current article path. The Worker validates the path, fetches that published page, requires a matching `data-comment-key` marker, and only then stores the verified `page_path`. Author replies inherit the verified path from the target/root thread; arbitrary admin/client-provided article paths are not trusted.

## Deployment and migration

The committed `wrangler.toml` retains its repository-safe placeholder D1 identifier. Production deployment remains controlled by the existing dedicated Worker workflow, which applies versioned migrations before deployment and verifies live Worker lineage. The V2 migration adds `reply_to_id`, `page_path`, and `removed_by_admin`; existing V1 child replies are safely backfilled with `reply_to_id = parent_id` because V1 only allowed direct replies to a top-level parent.

Website deployment and Worker/D1 deployment remain separate completion stages. A branch/PR can validate this change without modifying the production D1 database or production Worker.

## Intentionally deferred

The native comments system is not a social network. This version intentionally does not add unlimited nesting, likes, reactions, badges, Markdown, image uploads, user accounts, social login, AI moderation, ranking, bulk management, or reply notifications. Notification can be reconsidered later only if real usage justifies an explicit privacy-preserving opt-in mechanism.

## Legacy Giscus and rollback

The existing Giscus configuration remains available as a rollback path. Rolling back the provider must not delete D1 data or GitHub Discussions.
